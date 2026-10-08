/**
 * Challenge runner: the pure logic of a terminal challenge (no DOM, no timers).
 * The terminal view feeds it the player's input and renders the outcomes.
 *
 * Stars: 3 = no hints, 2 = hints used, 1 = an answer was revealed (anywhere in the challenge).
 * Wrong answers never cost stars.
 */
import { matchesCommand, matchesKeys, normalizeInput, wrongReply } from '../../content/match';
import type { ChallengeDef, ChoiceStep, CommandStep, KeyStep, PermissionMode, StepDef } from '../../content/types';
import type { Stars } from '../../core/store';
import { formatCombo, isShortcutCombo, nextMode, sameMode } from './lines';

export type PromptContext = 'shell' | 'claude';

export type Outcome =
  /** The step is solved. `reply` is the picked option's feedback (choice steps). */
  | { type: 'ok'; step: StepDef; stepIndex: number; reply?: string; finished: boolean }
  /** Not right. `reply` is tailored when the content had one for this mistake. */
  | { type: 'wrong'; reply: string; tailored: boolean; optionIndex?: number }
  /** A key sequence is under way (e.g. the first Esc of Esc Esc). */
  | { type: 'partial'; pressed: readonly string[] }
  /** The player asked to leave the terminal (/exit, /quit, or exit at the shell). */
  | { type: 'exit' }
  /** Nothing to react to (empty input, typing during a key step, a finished challenge…). */
  | { type: 'ignored' };

export type HintOutcome =
  | { type: 'hint'; text: string; index: number; total: number }
  | { type: 'answer'; text: string }
  | { type: 'none' };

export interface HintState {
  shown: number;
  total: number;
  /** All hints are out; the next press reveals the answer. */
  answerNext: boolean;
  answerShown: boolean;
  /** Nothing more to reveal. */
  exhausted: boolean;
}

const MAX_PRESSED = 12;

export class ChallengeRunner {
  readonly challenge: ChallengeDef;
  private index = 0;
  private currentMode: PermissionMode;
  private hintsShown = 0;
  private answerShown = false;
  private anyHint = false;
  private anyAnswer = false;
  private pressed: string[] = [];
  private tried = new Set<number>();
  private wrongs = 0;
  /** Extra modes in the Shift+Tab cycle (bypassPermissions, when the challenge uses it). */
  private readonly extraModes: PermissionMode[];

  constructor(challenge: ChallengeDef) {
    this.challenge = challenge;
    this.currentMode = challenge.startMode ?? 'auto';
    const used = [challenge.startMode, ...challenge.steps.flatMap((s) => [s.setMode, s.kind === 'key' ? s.untilMode : undefined])];
    this.extraModes = used.includes('bypassPermissions') ? ['bypassPermissions'] : [];
  }

  get step(): StepDef | null {
    return this.challenge.steps[this.index] ?? null;
  }

  get stepIndex(): number {
    return this.index;
  }

  get stepCount(): number {
    return this.challenge.steps.length;
  }

  get finished(): boolean {
    return this.index >= this.challenge.steps.length;
  }

  get mode(): PermissionMode {
    return this.currentMode;
  }

  get stars(): Stars {
    return this.anyAnswer ? 1 : this.anyHint ? 2 : 3;
  }

  get hintUsed(): boolean {
    return this.anyHint;
  }

  get wrongCount(): number {
    return this.wrongs;
  }

  get triedOptions(): ReadonlySet<number> {
    return this.tried;
  }

  /** Command steps show their own prompt; key, choice and info steps happen inside Claude Code. */
  get context(): PromptContext {
    const step = this.step;
    return step?.kind === 'command' ? step.prompt : 'claude';
  }

  /** The session is already running when the first step is not a shell command (welcome box at start). */
  get startsInClaude(): boolean {
    const first = this.challenge.steps[0];
    return !(first?.kind === 'command' && first.prompt === 'shell');
  }

  /** Hints revealed so far for the current step. */
  get hints(): readonly string[] {
    const step = this.step;
    return step && step.kind !== 'info' ? step.hints.slice(0, this.hintsShown) : [];
  }

  /** The revealed answer of the current step, or null. */
  get answer(): string | null {
    return this.answerShown ? answerOf(this.step) : null;
  }

  get hintState(): HintState {
    const step = this.step;
    const total = step && step.kind !== 'info' ? step.hints.length : 0;
    const hasAnswer = answerOf(step) !== null;
    const answerNext = this.hintsShown >= total && hasAnswer && !this.answerShown;
    return {
      shown: this.hintsShown,
      total,
      answerNext,
      answerShown: this.answerShown,
      exhausted: this.hintsShown >= total && (!hasAnswer || this.answerShown),
    };
  }

  /** Enter in the prompt (command and info steps; text typed during a key step). */
  submit(raw: string): Outcome {
    const step = this.step;
    if (!step) return { type: 'ignored' };
    const input = normalizeInput(raw);
    switch (step.kind) {
      case 'command': {
        if (!input) return { type: 'ignored' };
        if (matchesCommand(step, input)) return this.solve();
        const tailored = wrongReply(step, input);
        if (tailored === undefined && isExitInput(input, step.prompt)) return { type: 'exit' };
        return this.miss(tailored ?? commandNudge(step, input), tailored !== undefined);
      }
      case 'info':
        if (input && isExitInput(input, 'claude')) return { type: 'exit' };
        return this.solve();
      case 'key':
        if (input && isExitInput(input, 'claude')) return { type: 'exit' };
        return this.miss(
          input
            ? 'Здесь ничего писать не нужно — нажми сочетание клавиш.'
            : 'Здесь нужно сочетание клавиш. Подумай, какое подходит к задаче.',
          false,
        );
      case 'choice':
        return { type: 'ignored' };
    }
  }

  /** True when the current key step uses this combo (e.g. to decide whether Enter is an answer). */
  expectsKey(combo: string): boolean {
    const step = this.step;
    return step?.kind === 'key' && step.keys.some((k) => k.toLowerCase() === combo.toLowerCase());
  }

  /**
   * A key combo in canonical form (comboFromEvent). Shift+Tab cycles the permission mode at any
   * Claude prompt, like the real tool; otherwise only key steps react.
   */
  press(combo: string): Outcome {
    const step = this.step;
    if (!step) return { type: 'ignored' };
    const shiftTab = combo.toLowerCase() === 'shift+tab';
    if (shiftTab && this.context === 'claude') this.cycleMode();
    if (step.kind !== 'key') return { type: 'ignored' };
    if (step.untilMode && shiftTab) {
      // Mode-cycling step: solved when the status line reaches the target; overshooting keeps cycling.
      if (sameMode(this.currentMode, step.untilMode)) return this.solve();
      this.pressed = [];
      return { type: 'partial', pressed: [combo] };
    }
    this.pressed.push(combo);
    if (this.pressed.length > MAX_PRESSED) this.pressed.shift();
    if (matchesKeys(step, this.pressed)) return this.solve();
    if (sequencePrefix(step.keys, this.pressed) > 0) return { type: 'partial', pressed: [...this.pressed] };
    if (!isShortcutCombo(combo)) return { type: 'ignored' };
    return this.miss(keyNudge(step, combo), false);
  }

  /** Picks option `index` of a choice step. Wrong options can be retried. */
  choose(index: number): Outcome {
    const step = this.step;
    if (!step || step.kind !== 'choice') return { type: 'ignored' };
    const option = step.options[index];
    if (!option) return { type: 'ignored' };
    if (option.correct) return this.solve(option.reply);
    this.tried.add(index);
    this.wrongs++;
    return {
      type: 'wrong',
      reply: option.reply ?? 'Не этот вариант. Подумай ещё раз.',
      tailored: option.reply !== undefined,
      optionIndex: index,
    };
  }

  /**
   * The option Esc picks in a permission dialog: the one marked `esc`, else the last "No…" option;
   * -1 when there is none (or the step is not a permission dialog).
   */
  escIndex(): number {
    const step = this.step;
    if (!step || step.kind !== 'choice' || step.style !== 'permission') return -1;
    const marked = step.options.findIndex((o) => o.esc);
    if (marked >= 0) return marked;
    for (let i = step.options.length - 1; i >= 0; i--) if (/^no\b/i.test(step.options[i].label)) return i;
    return -1;
  }

  /** Reveals the next hint, then the answer. */
  hint(): HintOutcome {
    const step = this.step;
    if (!step || step.kind === 'info') return { type: 'none' };
    if (this.hintsShown < step.hints.length) {
      const text = step.hints[this.hintsShown++];
      this.anyHint = true;
      return { type: 'hint', text, index: this.hintsShown, total: step.hints.length };
    }
    const answer = answerOf(step);
    if (answer === null || this.answerShown) return { type: 'none' };
    this.answerShown = true;
    this.anyAnswer = true;
    this.anyHint = true;
    return { type: 'answer', text: answer };
  }

  /** Shift+Tab: cycles the permission mode, as Claude Code does on every press. */
  cycleMode(): PermissionMode {
    this.currentMode = nextMode(this.currentMode, this.extraModes);
    return this.currentMode;
  }

  private solve(reply?: string): Outcome {
    const step = this.step!;
    const stepIndex = this.index;
    if (step.setMode) this.currentMode = step.setMode;
    this.index++;
    this.hintsShown = 0;
    this.answerShown = false;
    this.pressed = [];
    this.tried = new Set();
    this.wrongs = 0;
    return { type: 'ok', step, stepIndex, reply, finished: this.finished };
  }

  private miss(reply: string, tailored: boolean): Outcome {
    this.wrongs++;
    return { type: 'wrong', reply, tailored };
  }
}

/** The text revealed as "the answer" of a step, or null when the step has none. */
export function answerOf(step: StepDef | null): string | null {
  if (!step) return null;
  switch (step.kind) {
    case 'command':
    case 'key':
      return step.example;
    case 'choice': {
      const i = step.options.findIndex((o) => o.correct);
      return i < 0 ? null : `${i + 1}. ${step.options[i].label}`;
    }
    default:
      return null;
  }
}

/** `/exit` (alias `/quit`) leaves the terminal at any prompt — the task panel promises it; `exit` also works in the shell. */
export function isExitInput(input: string, prompt: PromptContext): boolean {
  const v = normalizeInput(input).toLowerCase();
  return v === '/exit' || v === '/quit' || (prompt === 'shell' && v === 'exit');
}

/** Length of the longest proper prefix of `keys` that the pressed sequence currently ends with. */
export function sequencePrefix(keys: readonly string[], pressed: readonly string[]): number {
  for (let n = Math.min(keys.length - 1, pressed.length); n > 0; n--) {
    const tail = pressed.slice(-n);
    if (tail.every((k, i) => k.toLowerCase() === keys[i].toLowerCase())) return n;
  }
  return 0;
}

function expectsSlash(step: Pick<CommandStep, 'accept'>): boolean {
  return step.accept.every((src) => /^\^?(?:\(\?:|\()*\\?\//.test(src));
}

function expectsProse(step: Pick<CommandStep, 'accept'>): boolean {
  return step.accept.some((src) => /^\.(?:\+|\*|\{\d+,?\d*\})$/.test(src));
}

/** A kind, generic nudge when the content has no tailored reply for this input. */
export function commandNudge(step: Pick<CommandStep, 'accept' | 'prompt'>, input: string): string {
  const slash = input.startsWith('/');
  if (step.prompt === 'shell') {
    if (slash) return 'Слэш-команды работают внутри Claude Code, а здесь пока обычная оболочка.';
    if (/[а-яё]/i.test(input)) return 'Оболочка не понимает обычную речь — ей нужна команда.';
    return 'Оболочка ждёт другую команду. Перечитай задачу — подсказка всегда рядом.';
  }
  if (expectsSlash(step) && !slash) return 'Здесь нужна слэш-команда — она начинается с «/».';
  if (expectsProse(step) && !slash) return 'Сформулируй чуть подробнее — целым вопросом или просьбой.';
  if (expectsProse(step) && slash) return 'Команда тут не нужна — просто напиши Claude обычными словами.';
  if (slash) return 'Эта команда сейчас не поможет. Какая подходит к задаче?';
  return 'Не совсем то. Перечитай задачу — или возьми подсказку.';
}

export function keyNudge(_step: KeyStep, combo: string): string {
  return `Это ${formatCombo(combo)}. Здесь нужно другое сочетание.`;
}

export function isChoice(step: StepDef | null): step is ChoiceStep {
  return step?.kind === 'choice';
}
