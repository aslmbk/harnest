/**
 * DOM of the simulated Claude Code terminal: transcript, session header, spinner, prompt
 * (shell `$` line, or Claude's `❯` input line between two rules with the status line under it),
 * permission / quiz dialogs, coach notes and the success panel.
 * No game logic here — the controller (terminal.ts) decides what to show.
 */
import type { ChoiceStep, CodexEntry, PermissionMode } from '../../content/types';
import type { Stars } from '../../core/store';
import { fill, h, svg } from '../dom';
import { icon, starsRow } from '../icons';
import {
  CYCLE_HINT,
  SESSION,
  SPINNER_FRAMES,
  SPINNER_TIP,
  formatCombo,
  modeStatus,
  parseToolCall,
  ruleKind,
  stripMarker,
  type Block,
  type BoxBlock,
  type Line,
} from './lines';
import type { PromptContext } from './runner';

export interface Echo {
  text: string;
  context: PromptContext;
}

export interface SuccessInfo {
  title: string;
  stars: Stars;
  best?: Stars;
  unlocks: CodexEntry[];
}

const PLACEHOLDERS = [
  'Try "how does <filepath> work?"',
  'Try "fix lint errors"',
  'Try "write a test for <filepath>"',
  'Try "refactor <filepath>"',
];

/** The Claude Code mascot as 18×6 quadrant pixels (drawn over 9 columns × 3 rows). */
const MASCOT =
  '<svg viewBox="0 0 18 6" preserveAspectRatio="none" shape-rendering="crispEdges">' +
  '<path fill="currentColor" d="M3 0h12v1H3zM3 1h2v1H3zM6 1h6v1H6zM13 1h2v1h-2zM1 2h16v1H1zM3 3h12v1H3zM4 4h1v1H4zM6 4h1v1H6zM11 4h1v1h-1zM13 4h1v1h-1z"/>' +
  '</svg>';

/** `code` and **bold** inside Claude's prose. Built from text nodes only. */
function inlineFormat(text: string): Node[] {
  const out: Node[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(document.createTextNode(text.slice(last, m.index)));
    out.push(m[1] !== undefined ? h('span', { class: 'tl-icode', text: m[1] }) : h('strong', { text: m[2] }));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(document.createTextNode(text.slice(last)));
  return out;
}

export class TerminalView {
  readonly el: HTMLElement;
  readonly window: HTMLElement;
  readonly panelHost: HTMLElement;
  readonly closeButton: HTMLButtonElement;
  readonly input: HTMLInputElement;

  private readonly titleEl: HTMLElement;
  private readonly pathEl: HTMLElement;
  private readonly screen: HTMLElement;
  private readonly log: HTMLElement;
  private readonly spinner: HTMLElement;
  private readonly spinGlyph: HTMLElement;
  private readonly spinVerb: HTMLElement;
  private readonly spinTip: HTMLElement;
  private readonly coach: HTMLElement;
  private readonly slot: HTMLElement;
  private readonly status: HTMLElement;
  private readonly statusLeft: HTMLElement;
  private readonly statusHint: HTMLElement;
  private readonly success: HTMLElement;

  private readonly promptBox: HTMLElement;
  private readonly promptChar: HTMLElement;
  private readonly shellLine: HTMLElement;
  private readonly before: HTMLElement;
  private readonly caret: HTMLElement;
  private readonly after: HTMLElement;
  private readonly placeholder: HTMLElement;
  private readonly inputLine: HTMLElement;
  private readonly keyEcho: HTMLElement;

  private promptKind: PromptContext | null = null;
  private inert = false;
  private placeholderText = '';
  private cwd = '~';
  private spinTimer = 0;
  private transientTimer = 0;
  private keyEchoTimer = 0;
  private choiceEl: HTMLElement | null = null;
  private choiceRows: HTMLElement[] = [];
  private focusHeld = false;
  /** Lines kept in the Claude prompt by `\` + Enter: shown above the input line, sent with it. */
  private kept: string[] = [];
  /** Touch controls on: the input is focused only on request (focus opens the on-screen keyboard). */
  touch = false;

  constructor() {
    this.titleEl = h('span', 'hx-tw-title');
    this.pathEl = h('span', 'hx-tw-path');
    this.closeButton = h(
      'button',
      { class: 'hx-tw-close', title: 'Выйти из терминала (/exit)', attrs: { type: 'button', 'aria-label': 'Выйти из терминала' } },
      icon('close'),
    );
    this.closeButton.addEventListener('mousedown', (e) => e.preventDefault());

    this.log = h('div', { class: 'hx-tw-log', attrs: { role: 'log', 'aria-live': 'polite' } });
    this.spinGlyph = h('span', 'hx-spin-glyph');
    this.spinVerb = h('span', 'hx-spin-verb');
    this.spinTip = h('div', 'hx-spin-tip', [h('span', { class: 'tl-gut', text: '⎿' }), h('span', { text: SPINNER_TIP })]);
    this.spinner = h('div', 'hx-spin', [h('div', 'hx-spin-line', [this.spinGlyph, this.spinVerb]), this.spinTip]);
    this.coach = h('div', { class: 'hx-coach', attrs: { role: 'alert' } });

    this.promptChar = h('span', { class: 'hx-pb-char', text: '❯' });
    this.before = h('span');
    this.caret = h('span', 'hx-caret');
    this.after = h('span');
    this.placeholder = h('span', 'hx-pb-placeholder');
    this.keyEcho = h('span', 'hx-key-echo');
    this.inputLine = h('span', 'hx-pb-text', [this.before, this.caret, this.after, this.placeholder]);
    this.promptBox = h('div', 'hx-pb');
    this.shellLine = h('div', 'hx-sh');

    this.slot = h('div', 'hx-tw-slot');
    this.statusLeft = h('span', 'hx-status-left');
    this.statusHint = h('span', { class: 'hx-status-right', text: '? for shortcuts' });
    this.status = h('div', 'hx-status', [this.statusLeft, this.statusHint]);

    this.input = h('input', {
      class: 'hx-tw-input',
      attrs: { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Ввод терминала' },
    });
    for (const type of ['input', 'keyup', 'click', 'select']) this.input.addEventListener(type, () => this.renderInput());
    document.addEventListener('selectionchange', this.onSelection);

    this.screen = h('div', 'hx-tw-screen', [this.log, h('div', 'hx-tw-live', [this.spinner, this.slot, this.status, this.coach]), this.input]);
    this.success = h('div', 'hx-tw-success');

    this.window = h('section', 'hx-tw', [
      h('header', 'hx-tw-bar', [h('span', 'hx-tw-dots', [h('i'), h('i'), h('i')]), this.titleEl, this.pathEl, this.closeButton]),
      this.screen,
      this.success,
    ]);
    this.panelHost = h('div', 'hx-term-side');
    this.el = h('div', 'hx-term-layout', [this.window, this.panelHost]);
  }

  dispose(): void {
    document.removeEventListener('selectionchange', this.onSelection);
    window.clearInterval(this.spinTimer);
  }

  // ───────────── session ─────────────

  reset(title: string, cwd: string): void {
    this.cwd = cwd;
    this.titleEl.textContent = title;
    this.pathEl.textContent = `harni@city: ${cwd}`;
    this.log.replaceChildren();
    this.hideSpinner();
    this.hideCoach();
    this.hideSuccess();
    this.clearSlot();
    this.setStatus('auto');
    this.setWorking(false);
    this.input.value = '';
    this.kept = [];
    this.window.classList.remove('is-done');
  }

  /**
   * Keeps keys landing in the prompt. On touch screens only an `explicit` request focuses (a key
   * typed on a hardware keyboard), as focus would pop up the on-screen keyboard.
   */
  focusInput(explicit = false): void {
    if (this.focusHeld || (this.touch && !explicit)) return;
    if (document.activeElement !== this.input) this.input.focus({ preventScroll: true });
  }

  /** A tap on the terminal (touch): focus the input so the on-screen keyboard opens, also when it was hidden. */
  openKeyboard(): void {
    if (document.activeElement === this.input) this.input.blur();
    this.input.focus({ preventScroll: true });
  }

  /**
   * Keeps focus off the input until the current key event is over: the game may open the terminal
   * from the E keydown, and a focus change inside a keydown makes the browser type that key into
   * the newly focused input.
   */
  holdFocus(): void {
    this.focusHeld = true;
    if (document.activeElement === this.input) this.input.blur();
    window.setTimeout(() => {
      this.focusHeld = false;
      this.focusInput();
    }, 0);
  }

  /** Columns of monospace text that fit in the transcript (layout checks). */
  measureColumns(): number {
    const probe = h('span', { class: 'tl-probe', text: '0'.repeat(100) });
    this.log.append(probe);
    const per = probe.getBoundingClientRect().width / 100;
    probe.remove();
    return per > 0 ? Math.floor(this.log.clientWidth / per) : 0;
  }

  // ───────────── transcript ─────────────

  /** The header Claude Code prints when a session starts: mascot, version, model, cwd. */
  printHeader(): void {
    this.log.append(
      h('div', 'tl-header', [
        svg(MASCOT, 'tl-mascot'),
        h('div', 'tl-header-text', [
          h('div', null, [h('strong', { text: 'Claude Code' }), h('span', { class: 'tl-dim', text: ` v${SESSION.version}` })]),
          h('div', { class: 'tl-dim', text: `${SESSION.model} · ${SESSION.plan}` }),
          h('div', { class: 'tl-dim', text: this.cwd }),
        ]),
      ]),
    );
    this.scrollToEnd();
  }

  /** `inTurn`: part of a Claude turn — gutter-less lines and boxes are indented under the ● text. */
  printBlock(block: Block, inTurn = false): HTMLElement {
    const el = block.kind === 'box' ? this.renderBox(block, inTurn) : this.renderLine(block.line, block.cont, inTurn);
    this.log.append(el);
    this.scrollToEnd();
    return el;
  }

  /** Dim end-of-turn line, e.g. "✻ Worked for 12s". */
  printWorked(text: string): void {
    const m = /^(✻)\s(.*)$/.exec(text);
    this.log.append(h('div', 'tl tl-worked', m ? [h('span', { class: 'tl-gut tl-star', text: m[1] }), h('span', { class: 'tl-text', text: m[2] })] : text));
    this.scrollToEnd();
  }

  echo({ text, context }: Echo): void {
    const value = text.trim();
    if (context === 'shell') {
      this.log.append(h('div', 'tl tl-shell', [h('span', { class: 'hx-sh-cwd', text: this.cwd }), h('span', { class: 'hx-sh-dollar', text: '$' }), h('span', { class: 'tl-text', text: value })]));
    } else {
      const bash = value.startsWith('!');
      this.log.append(
        h('div', `tl tl-user${bash ? ' is-bash' : ''}`, [
          h('span', { class: 'tl-gut', text: bash ? '!' : '❯' }),
          h('span', { class: 'tl-text', text: bash ? value.slice(1).trimStart() : value }),
        ]),
      );
    }
    this.scrollToEnd();
  }

  /** A compact record of an answered quiz. */
  printQuizRecord(question: string, label: string, index: number): void {
    this.log.append(
      h('div', 'tl tl-quiz-q', [h('span', { class: 'tl-gut', text: '?' }), h('span', { class: 'tl-text', text: question })]),
      h('div', 'tl tl-quiz-a', [h('span', { class: 'tl-gut', text: '❯' }), h('span', { class: 'tl-text', text: `${index + 1}. ${label}` })]),
    );
    this.scrollToEnd();
  }

  markToolDone(el: HTMLElement): void {
    el.classList.remove('is-running');
  }

  private renderLine(line: Line, cont: boolean, inTurn: boolean): HTMLElement {
    const style = line.style;
    const text = stripMarker(style, line.text);
    const rule = style === 'box' ? null : ruleKind(text);
    if (rule) return h('div', `tl-rule is-${rule}`);
    const row = h('div', `tl tl-${style}${cont ? ' is-cont' : ''}${inTurn ? ' is-in' : ''}`);
    switch (style) {
      case 'claude':
        row.append(h('span', { class: 'tl-gut', text: cont ? '' : '●' }), h('span', 'tl-text', inlineFormat(text)));
        break;
      case 'tool': {
        const call = parseToolCall(text);
        row.classList.add('is-running');
        row.append(h('span', { class: 'tl-gut', text: '●' }), h('span', 'tl-text', call ? [h('strong', { text: call.name }), call.args, call.rest] : text));
        break;
      }
      case 'result':
        row.append(h('span', { class: 'tl-gut', text: cont ? '' : '⎿' }), h('span', { class: 'tl-text', text }));
        break;
      case 'diffAdd':
      case 'diffDel':
        row.append(h('span', { class: 'tl-gut', text: style === 'diffAdd' ? '+' : '-' }), h('span', { class: 'tl-text', text: text || ' ' }));
        break;
      case 'user':
        row.append(h('span', { class: 'tl-gut', text: '❯' }), h('span', { class: 'tl-text', text }));
        break;
      default:
        row.append(h('span', { class: 'tl-text', text: text || ' ' }));
    }
    return row;
  }

  private renderBox(box: BoxBlock, inTurn: boolean): HTMLElement {
    return h(
      'div',
      inTurn ? 'tl-box is-in' : 'tl-box',
      box.rows.map((row) => (row.kind === 'sep' ? h('div', 'tl-box-sep') : h('div', { class: 'tl-box-row', text: row.text || ' ' }))),
    );
  }

  // ───────────── spinner ─────────────

  showSpinner(verb: string, withTip: boolean): void {
    window.clearInterval(this.spinTimer);
    this.spinVerb.textContent = `${verb}…`;
    this.spinTip.hidden = !withTip;
    let frame = 0;
    const tick = () => {
      this.spinGlyph.textContent = SPINNER_FRAMES[frame++ % SPINNER_FRAMES.length];
    };
    tick();
    this.spinTimer = window.setInterval(tick, 110);
    this.spinner.classList.add('is-on');
    this.scrollToEnd();
  }

  hideSpinner(): void {
    window.clearInterval(this.spinTimer);
    this.spinner.classList.remove('is-on');
  }

  // ───────────── coach notes (the game's voice) ─────────────

  showCoach(text: string, tone: 'wrong' | 'info' = 'wrong'): void {
    this.coach.className = `hx-coach is-on is-${tone}`;
    this.coach.replaceChildren(h('span', { class: 'hx-coach-mark', text: tone === 'wrong' ? '✗' : '›' }), h('span', { text }));
    this.coach.classList.remove('is-pop');
    void this.coach.offsetWidth;
    this.coach.classList.add('is-pop');
    this.scrollToEnd();
  }

  hideCoach(): void {
    this.coach.classList.remove('is-on');
  }

  // ───────────── input slot ─────────────

  clearSlot(): void {
    this.promptKind = null;
    this.choiceEl = null;
    this.choiceRows = [];
    this.slot.replaceChildren();
    this.status.classList.remove('is-on');
  }

  /**
   * Shows the prompt. `inert` keeps the Claude prompt on screen while Claude works
   * (as in the real tool) without a live caret.
   */
  showPrompt(kind: PromptContext, opts: { placeholder?: boolean; seed?: number; inert?: boolean } = {}): void {
    this.clearSlot();
    this.promptKind = kind;
    this.inert = !!opts.inert;
    this.placeholderText = kind === 'claude' && opts.placeholder && !opts.inert ? PLACEHOLDERS[(opts.seed ?? 0) % PLACEHOLDERS.length] : '';
    if (kind === 'claude') {
      this.promptBox.className = `hx-pb${this.inert ? ' is-inert' : ''}`;
      this.fillPromptBox();
      this.slot.append(this.promptBox);
      this.status.classList.add('is-on');
    } else {
      this.shellLine.className = 'hx-sh';
      this.shellLine.replaceChildren(h('span', { class: 'hx-sh-cwd', text: this.cwd }), h('span', { class: 'hx-sh-dollar', text: '$' }), this.inputLine);
      this.slot.append(this.shellLine);
    }
    this.renderInput();
    this.scrollToEnd();
  }

  showContinue(): void {
    this.clearSlot();
    this.slot.append(
      h('button', { class: 'hx-continue', attrs: { type: 'button' }, data: { action: 'continue' } }, [
        h('span', { class: 'hx-continue-key', text: '↵' }),
        h('span', { text: 'Enter — дальше' }),
      ]),
    );
    this.scrollToEnd();
  }

  /** The ❯ input line between two rules; lines kept by `\` + Enter sit above it, ❯ on the first one. */
  private fillPromptBox(): void {
    const rows = this.kept.map((text, i) =>
      h('div', 'hx-pb-line', [h('span', { class: 'hx-pb-char', text: i === 0 ? '❯' : '' }), h('span', { class: 'hx-pb-text', text: text || ' ' })]),
    );
    const char = this.kept.length ? h('span', 'hx-pb-char') : this.promptChar;
    this.promptBox.replaceChildren(h('div', 'hx-pb-rule'), ...rows, h('div', 'hx-pb-line', [char, this.inputLine, this.keyEcho]), h('div', 'hx-pb-rule'));
  }

  /** `\` + Enter: the line stays in the prompt and the input continues on a new line under it. */
  keepLine(text: string): void {
    this.kept.push(text);
    if (this.promptKind === 'claude') {
      this.fillPromptBox();
      this.renderInput();
    }
  }

  /** What Enter sends: the kept lines and `last`, as one message. The prompt is empty again. */
  takeMessage(last: string): string {
    const text = [...this.kept, last].join('\n');
    this.kept = [];
    return text;
  }

  /** Forgets the kept lines (the prompt went away without sending them). */
  dropKept(): void {
    this.kept = [];
  }

  get value(): string {
    return this.input.value;
  }

  setValue(v: string): void {
    this.input.value = v;
    this.input.setSelectionRange(v.length, v.length);
    this.renderInput();
  }

  shake(): void {
    const target = this.choiceEl ?? (this.promptKind === 'claude' ? this.promptBox : this.shellLine);
    target.classList.remove('is-shake');
    void target.offsetWidth;
    target.classList.add('is-shake');
  }

  /** Shows the combo the player just pressed at the end of the prompt line. */
  flashKey(combo: string, state: 'partial' | 'wrong' | 'ok'): void {
    this.keyEcho.textContent = formatCombo(combo);
    this.keyEcho.className = `hx-key-echo is-on is-${state}`;
    window.clearTimeout(this.keyEchoTimer);
    this.keyEchoTimer = window.setTimeout(() => this.keyEcho.classList.remove('is-on'), state === 'partial' ? 1600 : 900);
  }

  private readonly onSelection = () => {
    if (document.activeElement === this.input) this.renderInput();
  };

  renderInput(): void {
    if (!this.promptKind) return;
    if (this.inert) {
      this.before.textContent = '';
      this.caret.textContent = '';
      this.after.textContent = '';
      this.placeholder.textContent = '';
      return;
    }
    const v = this.input.value;
    const pos = this.input.selectionStart ?? v.length;
    const bash = this.promptKind === 'claude' && !this.kept.length && v.startsWith('!');
    this.promptBox.classList.toggle('is-bash', bash);
    this.promptChar.textContent = bash ? '!' : '❯';
    const shown = bash ? v.slice(1) : v;
    const at = bash ? Math.max(0, pos - 1) : pos;
    this.before.textContent = shown.slice(0, at);
    this.caret.textContent = shown[at] ?? ' ';
    this.after.textContent = shown.slice(at + 1);
    this.placeholder.textContent = v || this.kept.length ? '' : this.placeholderText;
    this.caret.classList.remove('is-typing');
    void this.caret.offsetWidth;
    this.caret.classList.add('is-typing');
  }

  // ───────────── status line ─────────────

  setStatus(mode: PermissionMode): void {
    const s = modeStatus(mode);
    this.status.dataset.tone = s.tone;
    fill(
      this.statusLeft,
      h('span', { class: 'hx-status-mode', text: `${s.icon}︎ ${s.label}` }),
      s.cycles ? h('span', { class: 'hx-status-hint', text: ` ${CYCLE_HINT}` }) : null,
    );
  }

  /** Footer hint: "esc to interrupt" while Claude works, "? for shortcuts" otherwise. */
  setWorking(working: boolean): void {
    this.status.classList.toggle('is-working', working);
    if (!this.statusHint.classList.contains('is-transient')) this.statusHint.textContent = working ? 'esc to interrupt' : '? for shortcuts';
  }

  setTransient(text: string | null, ms = 2200): void {
    window.clearTimeout(this.transientTimer);
    this.statusHint.classList.toggle('is-transient', !!text);
    if (text) {
      this.statusHint.textContent = text;
      this.transientTimer = window.setTimeout(() => this.setTransient(null), ms);
    } else {
      this.statusHint.textContent = this.status.classList.contains('is-working') ? 'esc to interrupt' : '? for shortcuts';
    }
  }

  // ───────────── choice dialogs ─────────────

  showChoice(step: ChoiceStep, selected: number): void {
    this.clearSlot();
    const permission = step.style === 'permission';
    this.choiceRows = step.options.map((opt, i) =>
      h('div', { class: 'hx-opt', data: { index: String(i) }, attrs: { role: 'option' } }, [
        h('span', { class: 'hx-opt-ptr', text: '❯' }),
        h('span', { class: 'hx-opt-num', text: `${i + 1}.` }),
        h('span', { class: 'hx-opt-label', text: opt.label }),
        h('span', { class: 'hx-opt-mark', text: '✗' }),
      ]),
    );
    const body: (Node | null)[] = [];
    if (permission) {
      body.push(h('div', 'hx-perm-top'));
      const p = step.permission;
      if (p) {
        body.push(
          h('div', { class: 'hx-perm-tool', text: p.tool }),
          p.description ? h('div', { class: 'hx-perm-desc', text: p.description }) : null,
          h('div', 'tl-rule is-dashed'),
          h('div', { class: 'hx-perm-cmd', text: p.command }),
          h('div', 'tl-rule is-dashed'),
          p.note ? h('div', { class: 'hx-perm-note', text: p.note }) : null,
          h('div', 'hx-perm-gap'),
        );
      }
      body.push(h('div', { class: 'hx-choice-q', text: step.question }));
    } else {
      body.push(h('div', 'hx-choice-q', [h('span', { class: 'hx-choice-qmark', text: '?' }), h('span', { text: step.question })]));
    }
    body.push(
      h('div', { class: 'hx-choice-opts', attrs: { role: 'listbox' } }, this.choiceRows),
      h('div', { class: 'hx-choice-foot', text: permission ? 'Esc to cancel · Tab to amend' : '↑↓ выбрать · Enter ответить · 1–9 сразу' }),
    );
    this.choiceEl = h('div', `hx-choice ${permission ? 'is-permission' : 'is-quiz'}`, body);
    this.slot.append(this.choiceEl);
    this.selectOption(selected);
    this.scrollToEnd();
  }

  selectOption(i: number): void {
    this.choiceRows.forEach((r, j) => r.classList.toggle('is-sel', j === i));
  }

  markTried(i: number): void {
    this.choiceRows[i]?.classList.add('is-tried');
  }

  markAnswer(i: number): void {
    this.choiceRows[i]?.classList.add('is-answer');
  }

  // ───────────── success ─────────────

  showSuccess(info: SuccessInfo, onClose: () => void): void {
    const caption =
      info.stars === 3
        ? 'Чисто: ни одной подсказки.'
        : info.stars === 2
          ? 'С подсказками. Пройди ещё раз без них — за третью звезду.'
          : 'С подсказанным ответом. Вернись позже и попробуй сам.';
    const button = h('button', { class: 'hx-btn hx-btn--primary hx-pulse', attrs: { type: 'button' } }, [
      'Продолжить',
      h('kbd', { class: 'hx-kbd hx-kbd--inline', text: 'Enter' }),
    ]);
    button.addEventListener('click', onClose);
    button.addEventListener('mousedown', (e) => e.preventDefault());
    this.success.replaceChildren(
      h('div', 'hx-success-card', [
        h('div', 'hx-success-badge', icon('check')),
        h('span', { class: 'hx-kicker hx-kicker--ok', text: 'Терминал восстановлен' }),
        h('h3', { class: 'hx-success-title', text: info.title }),
        starsRow(info.stars, 3, 'hx-success-stars'),
        h('p', { class: 'hx-success-caption', text: caption }),
        info.best && info.best > info.stars ? h('p', 'hx-success-best', ['Рекорд остаётся: ', starsRow(info.best, 3, 'hx-stars--inline')]) : null,
        info.unlocks.length
          ? h('div', 'hx-success-unlocks', [
              h('span', { class: 'hx-kicker', text: 'Новое в справочнике' }),
              h(
                'ul',
                'hx-tags',
                info.unlocks.map((e) => h('li', { class: 'hx-tag', text: e.syntax ?? e.title, title: e.summary })),
              ),
            ])
          : null,
        button,
      ]),
    );
    this.window.classList.add('is-done');
    this.success.classList.add('is-on');
  }

  hideSuccess(): void {
    this.success.classList.remove('is-on');
    this.success.replaceChildren();
  }

  private scrollToEnd(): void {
    this.screen.scrollTop = this.screen.scrollHeight;
  }
}
