/**
 * Terminal simulator controller (terminal:open → ui:terminalClosed).
 * Feeds keyboard / mouse input to the ChallengeRunner and renders outcomes through the view and
 * the task panel. Output streams line by line; Enter / Space / Esc / click skips the stream.
 *
 * Session header: printed when a Claude session starts — at once when the first step is already
 * at a Claude prompt (or is a key / choice / info step), or when the prompt switches from the
 * shell to Claude (right after the shell command that launched it). `claude "task"` also sends the
 * task as the session's first message, so Claude's turn plays like one started at the prompt.
 * `\` + Enter (on a step that teaches it) keeps the line in the prompt; the next accepted line is
 * sent together with it, as one message.
 *
 * Touch controls: the input is focused only by a tap on the terminal during a typing step (focus
 * opens the on-screen keyboard), and the task panel adds buttons for Enter and leaving.
 */
import { comboFromEvent } from '../../content/match';
import type { ChoiceStep, CodexEntry, TerminalLesson } from '../../content/types';
import type { GameEvents } from '../../core/events';
import { Screen, bestStars, type UIContext } from '../context';
import { isConfirmKey } from '../keys';
import {
  continuedLine,
  formatCombo,
  groupBlocks,
  isShortcutCombo,
  keycapPalette,
  launchPrompt,
  normLines,
  pickVerb,
  turnSeconds,
  workedLine,
  type Block,
} from './lines';
import { ChallengeRunner, type Outcome } from './runner';
import { TaskPanel } from './taskPanel';
import { TerminalView, type Echo } from './view';

type Phase = 'idle' | 'busy' | 'input' | 'info' | 'choice' | 'success';
type Ok = Extract<Outcome, { type: 'ok' }>;

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);
const EXIT_HINT = 'Чтобы выйти из терминала, набери /exit или нажми ✕.';
/** Info steps take no typing, so /exit cannot be typed there. */
const EXIT_HINT_INFO = 'Нажми Enter, чтобы продолжить, или ✕, чтобы выйти из терминала.';

function hasClaudeWork(blocks: readonly Block[]): boolean {
  return blocks.some((b) => b.kind === 'line' && (b.line.style === 'claude' || b.line.style === 'tool'));
}

function delayFor(block: Block, afterSpinner: boolean): number {
  const explicit = block.kind === 'box' ? block.delayMs : block.line.delayMs;
  if (explicit !== undefined) return explicit;
  if (afterSpinner) return 0;
  if (block.kind === 'box') return 160;
  switch (block.line.style) {
    case 'tool':
      return 280;
    case 'result':
      return block.cont ? 60 : 420;
    case 'claude':
      return block.cont ? 90 : 200;
    case 'diffAdd':
    case 'diffDel':
    case 'code':
      return 40;
    default:
      return 90;
  }
}

/** Browser shortcuts we never swallow (reload, devtools, zoom…). */
function isBrowserKey(e: KeyboardEvent): boolean {
  return e.ctrlKey || e.metaKey || /^F\d+$/.test(e.key);
}

/**
 * comboFromEvent, but Ctrl / Alt / Meta + a letter key is read by its physical key, as a real terminal
 * does: on a Russian layout Ctrl+C arrives as key 'с' (code KeyC). AltGr (Ctrl+Alt) still types characters.
 */
function comboOf(e: KeyboardEvent): string | null {
  const letter = /^Key([A-Z])$/.exec(e.code);
  const shortcut = (e.ctrlKey || e.altKey || e.metaKey) && !(e.ctrlKey && e.altKey);
  if (letter && shortcut && e.key.length === 1 && !/^[a-z]$/i.test(e.key) && e.key.toLowerCase() !== e.key.toUpperCase()) {
    return comboFromEvent({ key: letter[1], ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, metaKey: e.metaKey });
  }
  return comboFromEvent(e);
}

export class TerminalScreen extends Screen {
  private readonly view = new TerminalView();
  private readonly panel = new TaskPanel();
  private runner: ChallengeRunner | null = null;
  private terminal: TerminalLesson | null = null;
  private levelId = '';
  private phase: Phase = 'idle';
  private session = 0;
  private skipping = false;
  private readonly waiters = new Set<() => void>();
  private history: string[] = [];
  private historyAt = 0;
  private choiceSel = 0;
  private ctrlCAt = -Infinity;
  private ctrlDAt = -Infinity;
  private reported = false;
  /** A Claude session is running (its header is on screen). */
  private sessionLive = false;
  private tipShown = false;
  private readonly onWindowFocus = () => {
    if (this.isOpen) this.view.focusInput();
  };

  constructor(ctx: UIContext) {
    super(ctx, 'hx-terminal');
    this.view.panelHost.append(this.panel.el);
    this.el.append(this.view.el);
    this.view.touch = ctx.touch.on;
    ctx.touch.onChange((on) => (this.view.touch = on));
    this.view.closeButton.addEventListener('click', () => this.leave());
    this.panel.hintButton.addEventListener('click', () => this.useHint());
    // Touch buttons act like the keys they stand for.
    this.panel.enterButton.addEventListener('click', () => this.onKey(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter' })));
    this.panel.exitButton.addEventListener('click', () => this.leave());
    this.view.window.addEventListener('click', (e) => this.onClick(e));
    this.view.window.addEventListener('pointerover', (e) => {
      const opt = (e.target as HTMLElement).closest<HTMLElement>('.hx-opt');
      if (opt && this.phase === 'choice') this.selectChoice(Number(opt.dataset.index), false);
    });
    this.el.addEventListener('pointerup', () => {
      if (this.isOpen && !window.getSelection()?.toString()) this.view.focusInput();
    });
    window.addEventListener('focus', this.onWindowFocus);
  }

  dispose(): void {
    this.close();
    window.removeEventListener('focus', this.onWindowFocus);
    this.view.dispose();
  }

  /** Monospace columns that fit in the transcript (layout checks in the harness). */
  measureColumns(): number {
    return this.view.measureColumns();
  }

  open({ levelId, terminalId }: GameEvents['terminal:open']): void {
    const terminal = this.ctx.content.terminal(levelId, terminalId);
    if (!terminal) {
      console.warn(`[ui] unknown terminal "${terminalId}" in level "${levelId}"`);
      this.ctx.bus.emit('ui:terminalClosed', { terminalId, completed: false });
      return;
    }
    this.session++;
    this.releaseWaits();
    this.terminal = terminal;
    this.levelId = levelId;
    this.runner = new ChallengeRunner(terminal.challenge);
    this.reported = false;
    this.history = [];
    this.historyAt = 0;
    this.ctrlCAt = -Infinity;
    this.ctrlDAt = -Infinity;
    this.sessionLive = false;
    this.tipShown = false;
    this.view.reset(terminal.title, terminal.challenge.cwd);
    this.view.holdFocus();
    this.panel.setChallenge(terminal, bestStars(this.ctx.store, levelId, terminalId));
    this.show();
    void this.enterStep();
  }

  /** Hides without reporting (the game left the 'terminal' state on its own). */
  close(): void {
    if (!this.isOpen) return;
    this.session++;
    this.releaseWaits();
    this.phase = 'idle';
    this.view.hideSpinner();
    this.view.input.blur();
    this.hide();
  }

  onTop(): void {
    this.view.focusInput();
  }

  onKey(e: KeyboardEvent): void {
    if (MODIFIERS.has(e.key)) return;
    if (e.key === 'F1') {
      e.preventDefault();
      if (!e.repeat) this.useHint();
      return;
    }
    switch (this.phase) {
      case 'busy':
        if (!isBrowserKey(e)) e.preventDefault();
        if ((e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') && !e.repeat) this.skip();
        return;
      case 'success':
        if (!isBrowserKey(e)) e.preventDefault();
        if ((isConfirmKey(e) || e.key === 'Escape') && !e.repeat) this.report(true);
        return;
      case 'info':
        if (!isBrowserKey(e)) e.preventDefault();
        if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) this.continueInfo();
        else if (e.key === 'Escape' && !e.repeat) this.view.showCoach(EXIT_HINT_INFO, 'info');
        return;
      case 'choice':
        this.onChoiceKey(e);
        return;
      case 'input':
        this.onInputKey(e);
        return;
      default:
        if (!isBrowserKey(e)) e.preventDefault();
    }
  }

  // ───────────── flow ─────────────

  /** Prints the session header once per Claude session. */
  private ensureSession(): void {
    if (this.sessionLive) return;
    this.sessionLive = true;
    this.view.printHeader();
  }

  private async enterStep(): Promise<void> {
    const runner = this.runner;
    if (!runner) return;
    const step = runner.step;
    const session = this.session;
    this.skipping = false;
    this.view.hideCoach();
    if (!step) {
      this.finish();
      return;
    }
    if (runner.context === 'claude') this.ensureSession();
    else this.sessionLive = false;
    // Lines kept by `\` + Enter wait in the Claude prompt; any other step clears it.
    if (step.kind !== 'key' && !(step.kind === 'command' && step.prompt === 'claude')) this.view.dropKept();
    // Touch: the on-screen keyboard stays up only for a step that takes typing.
    if (this.ctx.touch.on && step.kind !== 'command') this.view.input.blur();
    this.panel.setStep(runner.stepIndex, runner.stepCount, step, runner.hintState);
    this.panel.setStars(runner.stars, false);
    this.view.setStatus(runner.mode);
    switch (step.kind) {
      case 'command':
        this.phase = 'input';
        this.view.setValue('');
        this.view.showPrompt(step.prompt, { placeholder: true, seed: runner.stepIndex });
        this.view.focusInput();
        break;
      case 'key':
        this.phase = 'input';
        this.view.setValue('');
        this.view.showPrompt('claude');
        this.panel.setKeycaps(keycapPalette(step.keys, `${this.levelId}/${this.terminal?.id}/${step.id}`), (k) => this.pressCombo(k, true));
        this.view.focusInput();
        break;
      case 'choice': {
        const context = groupBlocks(normLines(step.context));
        if (context.length) {
          // What Claude did before asking: the turn goes on after the answer, so no end-of-turn line.
          this.phase = 'busy';
          await this.printOutput(context, true, { endTurn: false });
          if (session !== this.session) return;
        }
        this.phase = 'choice';
        this.choiceSel = 0;
        this.view.showChoice(step, 0);
        this.view.focusInput();
        break;
      }
      case 'info': {
        this.phase = 'busy';
        await this.printOutput(groupBlocks(normLines(step.output)), true);
        if (session !== this.session) return;
        this.phase = 'info';
        this.view.showContinue();
        this.view.focusInput();
        break;
      }
    }
  }

  /** `held`: the prompt stays as it is — a `\` + Enter line break sends nothing. */
  private async onSolved(out: Ok, echo?: Echo, held = false): Promise<void> {
    const runner = this.runner;
    if (!runner) return;
    const session = this.session;
    const step = out.step;
    const inShell = step.kind === 'command' && step.prompt === 'shell';
    // `claude "task"`: the session opens and sends the task as its first message.
    const launch = echo ? launchPrompt(step, echo.text) : null;
    this.phase = 'busy';
    this.view.hideCoach();
    if (!held) this.view.clearSlot();
    if (echo) this.view.echo(echo);
    this.ctx.sfx.play('stepOk');
    this.view.setStatus(runner.mode);
    if (inShell && (launch !== null || runner.context === 'claude')) this.ensureSession(); // this command started Claude Code
    if (launch !== null) this.view.echo({ text: launch, context: 'claude' });
    const blocks = step.kind === 'info' ? [] : groupBlocks(normLines(step.output));
    await this.printOutput(blocks, !inShell || launch !== null, { keepPrompt: held });
    if (session !== this.session) return;
    this.panel.showFeedback(out.reply, step.explain);
    if (out.finished) {
      await this.wait(320);
      if (session !== this.session) return;
      this.finish();
      return;
    }
    void this.enterStep();
  }

  private finish(): void {
    const runner = this.runner;
    const terminal = this.terminal;
    if (!runner || !terminal) return;
    this.phase = 'success';
    this.view.clearSlot();
    this.view.hideCoach();
    this.panel.complete(runner.stepCount);
    this.ctx.sfx.play('challengeDone');
    // "Новое в справочнике": only entries the save does not have yet (a replay unlocks nothing new).
    const known = new Set(this.ctx.store.data.codex);
    const unlocks = terminal.challenge.unlocks
      .filter((id) => !known.has(id))
      .map((id) => this.ctx.content.codexEntry(id))
      .filter((e): e is CodexEntry => !!e);
    this.view.showSuccess(
      { title: terminal.challenge.title, stars: runner.stars, best: bestStars(this.ctx.store, this.levelId, terminal.id), unlocks },
      () => this.report(true),
    );
  }

  private report(completed: boolean): void {
    const terminal = this.terminal;
    const runner = this.runner;
    if (this.reported || !terminal || !runner) return;
    this.reported = true;
    this.close();
    this.ctx.bus.emit(
      'ui:terminalClosed',
      completed ? { terminalId: terminal.id, completed: true, stars: runner.stars } : { terminalId: terminal.id, completed: false },
    );
  }

  /** ✕ button: leave at any time (after success it counts as completed). */
  private leave(): void {
    if (!this.isOpen) return;
    if (this.phase === 'success') {
      this.ctx.sfx.play('uiSelect');
      this.report(true);
      return;
    }
    this.exitNow(0);
  }

  private exitNow(delayMs: number): void {
    this.phase = 'idle';
    this.view.clearSlot();
    this.view.hideCoach();
    this.ctx.sfx.play('uiBack');
    if (delayMs <= 0) {
      this.report(false);
      return;
    }
    const session = this.session;
    window.setTimeout(() => {
      if (session === this.session) this.report(false);
    }, delayMs);
  }

  // ───────────── output streaming ─────────────

  /**
   * Streams blocks into the transcript. When `claude` is set and the blocks show Claude working,
   * the prompt stays on screen (inert) with a spinner above it and "esc to interrupt" below, and
   * an end-of-turn line closes the turn (unless `endTurn` is false) — as in the real tool.
   * Otherwise the input slot is cleared while the lines print, unless `keepPrompt` is set.
   */
  private async printOutput(blocks: readonly Block[], claude: boolean, opts: { endTurn?: boolean; keepPrompt?: boolean } = {}): Promise<void> {
    if (!blocks.length) return;
    const session = this.session;
    const working = claude && hasClaudeWork(blocks);
    if (working) {
      this.view.showPrompt('claude', { inert: true });
      this.view.setWorking(true);
      this.view.showSpinner(pickVerb(session * 7 + (this.runner?.stepIndex ?? 0) * 3), !this.tipShown);
      this.tipShown = true;
      const tools = blocks.filter((b) => b.kind === 'line' && b.line.style === 'tool').length;
      await this.wait(Math.min(1700, 700 + tools * 220));
      if (session !== this.session) return;
      this.view.hideSpinner();
    } else if (!opts.keepPrompt) {
      this.view.clearSlot();
    }
    let running: HTMLElement | null = null;
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const delay = delayFor(block, working && i === 0);
      if (delay > 0) await this.wait(delay);
      if (session !== this.session) return;
      if (running) {
        this.view.markToolDone(running);
        running = null;
      }
      const el = this.view.printBlock(block, claude);
      if (block.kind === 'line' && block.line.style === 'tool') running = el;
    }
    if (running) {
      await this.wait(260);
      if (session !== this.session) return;
      this.view.markToolDone(running);
    }
    if (working) {
      if (opts.endTurn ?? true) this.view.printWorked(workedLine(turnSeconds(blocks), session + (this.runner?.stepIndex ?? 0)));
      this.view.setWorking(false);
    }
  }

  private wait(ms: number): Promise<void> {
    if (this.skipping || ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        window.clearTimeout(timer);
        this.waiters.delete(done);
        resolve();
      };
      const timer = window.setTimeout(done, ms);
      this.waiters.add(done);
    });
  }

  private skip(): void {
    this.skipping = true;
    for (const w of [...this.waiters]) w();
  }

  private releaseWaits(): void {
    for (const w of [...this.waiters]) w();
    this.skipping = false;
  }

  // ───────────── input ─────────────

  private onInputKey(e: KeyboardEvent): void {
    const runner = this.runner;
    const step = runner?.step;
    if (!runner || !step) return;
    const combo = comboOf(e);
    if (!combo) return;
    // Selecting transcript text takes the focus off the prompt. Ctrl+C then copies the selection (as in
    // Windows Terminal) instead of clearing and exiting; any other key takes the focus back so it lands in the prompt.
    const away = document.activeElement !== this.view.input;
    if (away && combo === 'Ctrl+C' && step.kind !== 'key' && window.getSelection()?.toString()) return;
    if (away) this.view.focusInput(true); // a real key: also on touch screens (a hardware keyboard)

    if (step.kind === 'key') {
      if (combo === 'Enter' && !runner.expectsKey('Enter')) {
        e.preventDefault();
        if (!e.repeat) this.submitText();
        return;
      }
      if (isShortcutCombo(combo) || runner.expectsKey(combo)) {
        e.preventDefault();
        if (!e.repeat) this.pressCombo(combo, false);
        return;
      }
      runner.press(combo); // typing in between breaks a key sequence
      if (e.key.length === 1 || e.key === 'Backspace') this.ctx.sfx.play('key');
      return;
    }

    switch (combo) {
      case 'Enter':
        e.preventDefault();
        if (!e.repeat) this.submitText();
        return;
      case 'Escape':
        e.preventDefault();
        if (e.repeat) return;
        if (this.view.value) this.view.setValue('');
        else this.view.showCoach(EXIT_HINT, 'info');
        return;
      case 'Tab':
        e.preventDefault();
        return;
      case 'Shift+Tab':
        e.preventDefault();
        if (!e.repeat && runner.context === 'claude') {
          runner.press(combo); // cycles the permission mode, like the real tool
          this.view.setStatus(runner.mode);
          this.ctx.sfx.play('uiMove');
        }
        return;
      case 'ArrowUp':
        e.preventDefault();
        this.historyMove(-1);
        return;
      case 'ArrowDown':
        e.preventDefault();
        this.historyMove(1);
        return;
      case 'Ctrl+C':
        e.preventDefault();
        if (!e.repeat) this.ctrlC();
        return;
      case 'Ctrl+D':
        e.preventDefault();
        if (!e.repeat) this.ctrlD();
        return;
    }
    if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') this.ctx.sfx.play('key');
  }

  private pressCombo(combo: string, fromButton: boolean): void {
    const runner = this.runner;
    if (!runner || this.phase !== 'input' || runner.step?.kind !== 'key') return;
    const out = runner.press(combo); // Shift+Tab cycles the mode inside the runner
    this.view.setStatus(runner.mode);
    switch (out.type) {
      case 'ok':
        this.view.flashKey(combo, 'ok');
        void this.onSolved(out);
        break;
      case 'partial':
        this.view.flashKey(combo, 'partial');
        this.view.hideCoach();
        this.ctx.sfx.play('key');
        break;
      case 'wrong':
        this.view.flashKey(combo, 'wrong');
        this.wrong(out.reply);
        break;
      case 'ignored':
        if (fromButton) {
          this.view.flashKey(combo, 'wrong');
          this.wrong(`Это ${formatCombo(combo)}. Здесь нужно другое сочетание.`);
        }
        break;
    }
    this.view.focusInput();
  }

  private submitText(): void {
    const runner = this.runner;
    if (!runner) return;
    const raw = this.view.value;
    const context = runner.context;
    if (raw.trim()) {
      this.history.push(raw);
      this.historyAt = this.history.length;
    }
    const out = runner.submit(raw);
    switch (out.type) {
      case 'ok': {
        this.view.setValue('');
        const kept = continuedLine(out.step, raw);
        if (kept !== null) {
          // `\` + Enter: nothing is sent; the line stays in the prompt and the input goes on below it.
          this.view.keepLine(kept);
          void this.onSolved(out, undefined, true);
        } else void this.onSolved(out, { text: this.view.takeMessage(raw), context });
        break;
      }
      case 'wrong':
        this.wrong(out.reply);
        break;
      case 'exit':
        this.view.setValue('');
        this.view.echo({ text: this.view.takeMessage(raw), context });
        this.exitNow(320);
        break;
      case 'ignored':
        this.view.shake();
        break;
    }
  }

  private continueInfo(): void {
    const out = this.runner?.submit('');
    if (out?.type === 'ok') void this.onSolved(out);
  }

  private wrong(reply: string): void {
    this.view.showCoach(reply, 'wrong');
    this.view.shake();
    this.ctx.sfx.play('stepWrong', 250);
    if ((this.runner?.wrongCount ?? 0) >= 2) this.panel.nudgeHint();
  }

  /** Idle Ctrl+C: the first press clears the input, the second exits (reference §1.5). */
  private ctrlC(): void {
    const runner = this.runner;
    if (!runner) return;
    if (runner.context === 'shell') {
      this.view.setValue('');
      return;
    }
    const now = performance.now();
    if (now - this.ctrlCAt < 2000) {
      this.exitNow(0);
      return;
    }
    this.ctrlCAt = now;
    this.view.setValue('');
    this.view.setTransient('Press Ctrl-C again to exit', 2000);
  }

  /** Ctrl+D: with text it deletes forward; on an empty prompt a second press within 800 ms exits. */
  private ctrlD(): void {
    const runner = this.runner;
    if (!runner || runner.context === 'shell') return;
    const input = this.view.input;
    if (input.value) {
      const at = input.selectionStart ?? input.value.length;
      this.view.setValue(input.value.slice(0, at) + input.value.slice(at + 1));
      input.setSelectionRange(at, at);
      this.view.renderInput();
      return;
    }
    const now = performance.now();
    if (now - this.ctrlDAt < 800) {
      this.exitNow(0);
      return;
    }
    this.ctrlDAt = now;
    this.view.setTransient('Press Ctrl-D again to exit', 800);
  }

  private historyMove(dir: number): void {
    if (!this.history.length) return;
    this.historyAt = Math.min(this.history.length, Math.max(0, this.historyAt + dir));
    this.view.setValue(this.history[this.historyAt] ?? '');
  }

  // ───────────── choices ─────────────

  private onChoiceKey(e: KeyboardEvent): void {
    const runner = this.runner;
    const step = runner?.step;
    if (!runner || !step || step.kind !== 'choice') return;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selectChoice(this.choiceSel - 1, true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.selectChoice(this.choiceSel + 1, true);
      return;
    }
    if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      const i = Number(e.key) - 1;
      if (i < step.options.length && !e.repeat) {
        this.selectChoice(i, false);
        this.pick(i);
      }
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!e.repeat) this.pick(this.choiceSel);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (e.repeat) return;
      const esc = runner.escIndex(); // in Claude Code, Esc = No
      if (esc >= 0) {
        this.selectChoice(esc, false);
        this.pick(esc);
      } else this.view.showCoach('Выбери вариант — или нажми ✕, чтобы выйти из терминала.', 'info');
      return;
    }
    if (!isBrowserKey(e)) e.preventDefault();
  }

  private selectChoice(i: number, withSound: boolean): void {
    const step = this.runner?.step;
    if (!step || step.kind !== 'choice') return;
    const n = step.options.length;
    const next = ((i % n) + n) % n;
    if (next === this.choiceSel) return;
    this.choiceSel = next;
    this.view.selectOption(next);
    if (withSound) this.ctx.sfx.play('uiMove', 40);
  }

  private pick(i: number): void {
    const runner = this.runner;
    const step = runner?.step as ChoiceStep | null | undefined;
    if (!runner || !step || step.kind !== 'choice' || this.phase !== 'choice') return;
    const out = runner.choose(i);
    if (out.type === 'ok') {
      if (step.style === 'quiz') this.view.printQuizRecord(step.question, step.options[i].label, i);
      void this.onSolved(out);
    } else if (out.type === 'wrong') {
      this.view.markTried(i);
      this.wrong(out.reply);
    }
  }

  // ───────────── hints & mouse ─────────────

  private useHint(): void {
    const runner = this.runner;
    if (!runner || !['input', 'choice', 'info'].includes(this.phase)) return;
    const out = runner.hint();
    if (out.type === 'none') return;
    this.ctx.sfx.play('hint');
    if (out.type === 'hint') this.panel.addHint(out.text, out.index);
    else {
      this.panel.showAnswer(out.text);
      const step = runner.step;
      if (step?.kind === 'choice') this.view.markAnswer(step.options.findIndex((o) => o.correct));
    }
    this.panel.setHintState(runner.hintState);
    this.panel.setStars(runner.stars);
    this.view.focusInput();
  }

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (target.closest('.hx-tw-close')) return;
    const opt = target.closest<HTMLElement>('.hx-opt');
    if (opt && this.phase === 'choice') {
      const i = Number(opt.dataset.index);
      this.selectChoice(i, false);
      this.pick(i);
      return;
    }
    if (target.closest('[data-action="continue"]') && this.phase === 'info') {
      this.continueInfo();
      return;
    }
    if (this.phase === 'busy') this.skip();
    // Touch: a tap on the terminal brings up the on-screen keyboard when the step takes typing.
    else if (this.ctx.touch.on && this.phase === 'input' && this.runner?.step?.kind === 'command' && !target.closest('button')) this.view.openKeyboard();
  }
}
