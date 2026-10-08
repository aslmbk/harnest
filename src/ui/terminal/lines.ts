/**
 * Pure helpers for the simulated Claude Code terminal (no DOM): line layout, what the prompt does
 * with special input, status-line labels, spinner verbs and key labels. Strings follow
 * docs/claude-code-reference.md ("Terminal look", §1.2, §1.4, §3.1).
 *
 * Content gives BARE text; the simulator adds every glyph and frame (see TermStyle in types.ts):
 *   claude  ● before the first line of a run, the rest of the run is an indented continuation
 *   tool    ● on every line
 *   result  ⎿ before the first line of a run, the rest is indented under it
 *   diffAdd / diffDel  "+" / "-" and colours
 *   box     consecutive box lines are framed together
 */
import { normalizeInput } from '../../content/match';
import { MODE_CYCLE, type PermissionMode, type StepDef, type TermLine, type TermStyle } from '../../content/types';

export interface Line {
  text: string;
  style: TermStyle;
  delayMs?: number;
}

export function normLine(line: TermLine): Line {
  if (typeof line === 'string') return { text: line, style: 'plain' };
  return { text: line.text, style: line.style ?? 'plain', delayMs: line.delayMs };
}

export function normLines(lines: readonly TermLine[] | undefined): Line[] {
  return (lines ?? []).map(normLine);
}

// ───────────────────────────── Layout ─────────────────────────────

export interface LineBlock {
  kind: 'line';
  line: Line;
  /** Continues a run of 'claude' or 'result' lines: no marker, aligned with the text column. */
  cont: boolean;
}

export interface BoxBlock {
  kind: 'box';
  rows: BoxRow[];
  delayMs?: number;
}

export type BoxRow = { kind: 'text'; text: string } | { kind: 'sep' };
export type Block = LineBlock | BoxBlock;

/** Styles whose consecutive lines form one marked run. */
const RUN_STYLES = new Set<TermStyle>(['claude', 'result']);

/** Old-style box-drawing borders are tolerated and stripped (content should not use them). */
const BOX_BORDER = /^\s*[╭╰┌└][─━\s\S]*[╮╯┐┘]\s*$/;
const BOX_SEP = /^\s*[├][\s\S]*[┤]\s*$/;

function boxRow(text: string): BoxRow | null {
  if (BOX_BORDER.test(text)) return null;
  if (BOX_SEP.test(text) || /^[─━]{3,}$/.test(text.trim())) return { kind: 'sep' };
  const inner = text.replace(/^\s*[│┃] ?/, '').replace(/\s*[│┃]\s*$/, '').replace(/\s+$/, '');
  return { kind: 'text', text: inner };
}

/**
 * Turns content lines into printable blocks: consecutive 'box' lines become one framed box,
 * and lines continuing a 'claude' / 'result' run are marked as continuations.
 */
export function groupBlocks(lines: readonly Line[]): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.style === 'box') {
      const box: BoxBlock = { kind: 'box', rows: [], delayMs: line.delayMs };
      while (i < lines.length && lines[i].style === 'box') {
        const row = boxRow(lines[i++].text);
        if (row) box.rows.push(row);
      }
      out.push(box);
      continue;
    }
    const prev = lines[i - 1];
    const cont = RUN_STYLES.has(line.style) && prev?.style === line.style;
    out.push({ kind: 'line', line, cont });
    i++;
  }
  return out;
}

/** A line that is only dashes (`- - - -`, `----`, `────`): drawn as a full-width rule. */
export function ruleKind(text: string): 'dashed' | 'solid' | null {
  const t = text.trim();
  if (/^(?:-\s?){3,}$/.test(t) || /^[╌┄┈]{3,}$/.test(t)) return 'dashed';
  if (/^[─━]{3,}$/.test(t)) return 'solid';
  return null;
}

/** Drops a marker a writer may have typed anyway (`● `, `⎿ `, `> `): the renderer draws its own. */
export function stripMarker(style: TermStyle, text: string): string {
  switch (style) {
    case 'claude':
    case 'tool':
      return text.replace(/^\s*[●⏺]\s?/, '');
    case 'result':
      return text.replace(/^\s*⎿\s*/, '');
    case 'user':
      return text.replace(/^\s*[>❯]\s?/, '');
    default:
      return text;
  }
}

export interface ToolCall {
  name: string;
  args: string;
  rest: string;
}

/** 'Read(src/pump.ts)' → { name: 'Read', args: '(src/pump.ts)', rest: '' }. */
export function parseToolCall(text: string): ToolCall | null {
  const m = /^([A-Za-z][\w.:-]*)(\([^)]*\)?)?(.*)$/.exec(text);
  if (!m) return null;
  if (!m[2] && m[3].trim() && !/^\s*[-—:·]/.test(m[3])) return null;
  return { name: m[1], args: m[2] ?? '', rest: m[3] };
}

// ───────────────────────────── Input ─────────────────────────────

const LAUNCH = /^claude ["']([^"']+)["']$/i;

/**
 * `claude "task"` at the shell opens an interactive session and sends the task as its first prompt
 * (reference §1.1). For a shell step whose example has that form: the task to echo after ❯ — taken
 * from the player's input, else from the example. Null for any other step.
 */
export function launchPrompt(step: StepDef, input: string): string | null {
  if (step.kind !== 'command' || step.prompt !== 'shell') return null;
  const example = LAUNCH.exec(normalizeInput(step.example));
  if (!example) return null;
  return (LAUNCH.exec(normalizeInput(input)) ?? example)[1].trim();
}

/**
 * `\` + Enter adds a new line instead of sending (reference §1.2). For a Claude-prompt step whose
 * example ends with a backslash: the accepted line without it, which stays in the prompt. Null when
 * the step does not teach this or the line does not end with `\`.
 */
export function continuedLine(step: StepDef, input: string): string | null {
  if (step.kind !== 'command' || step.prompt !== 'claude' || !step.example.trimEnd().endsWith('\\')) return null;
  const line = input.trimEnd();
  return line.endsWith('\\') ? line.slice(0, -1).trimEnd() : null;
}

// ───────────────────────────── Status line ─────────────────────────────

export type ModeTone = 'auto' | 'manual' | 'accept' | 'plan' | 'dontAsk' | 'bypass';

export interface ModeStatus {
  icon: string;
  label: string;
  tone: ModeTone;
  /** Shown with "(shift+tab to cycle)". */
  cycles: boolean;
}

export const CYCLE_HINT = '(shift+tab to cycle)';

/** 'default' is the config value of Manual mode. */
export function canonicalMode(mode: PermissionMode): PermissionMode {
  return mode === 'default' ? 'manual' : mode;
}

export function sameMode(a: PermissionMode, b: PermissionMode): boolean {
  return canonicalMode(a) === canonicalMode(b);
}

export function modeStatus(mode: PermissionMode): ModeStatus {
  switch (canonicalMode(mode)) {
    case 'manual':
      return { icon: '⏸', label: 'manual mode on', tone: 'manual', cycles: true };
    case 'acceptEdits':
      return { icon: '⏵⏵', label: 'accept edits on', tone: 'accept', cycles: true };
    case 'plan':
      return { icon: '⏸', label: 'plan mode on', tone: 'plan', cycles: true };
    case 'dontAsk':
      return { icon: '⏵⏵', label: "don't ask on", tone: 'dontAsk', cycles: false };
    case 'bypassPermissions':
      return { icon: '⏵⏵', label: 'bypass permissions on', tone: 'bypass', cycles: false };
    default:
      return { icon: '⏵⏵', label: 'auto mode on', tone: 'auto', cycles: true };
  }
}

/** Full status-line text, as Claude Code prints it under the prompt. */
export function statusText(mode: PermissionMode): string {
  const s = modeStatus(mode);
  return `${s.icon} ${s.label}${s.cycles ? ` ${CYCLE_HINT}` : ''}`;
}

/**
 * Shift+Tab: auto → manual → acceptEdits → plan (→ bypassPermissions when the challenge enables it) → auto.
 * A mode outside the cycle (dontAsk) goes back to the start of the cycle.
 */
export function nextMode(mode: PermissionMode, extra: readonly PermissionMode[] = []): PermissionMode {
  const cycle: PermissionMode[] = [...MODE_CYCLE];
  if (extra.includes('bypassPermissions')) cycle.push('bypassPermissions');
  const i = cycle.indexOf(canonicalMode(mode));
  return i < 0 ? cycle[0] : cycle[(i + 1) % cycle.length];
}

// ───────────────────────────── Spinner and session ─────────────────────────────

export const SPINNER_FRAMES = ['·', '✢', '*', '✶', '✻', '✽', '✻', '✶', '*', '✢'];

export const SPINNER_VERBS = [
  'Thinking',
  'Accomplishing',
  'Architecting',
  'Baking',
  'Brewing',
  'Churning',
  'Cogitating',
  'Combobulating',
  'Crafting',
  'Noodling',
  'Percolating',
  'Pondering',
  'Puzzling',
  'Reticulating',
  'Simmering',
  'Spelunking',
  'Tinkering',
  'Wrangling',
];

const WORKED_VERBS = ['Worked', 'Worked', 'Worked', 'Baked', 'Brewed', 'Churned', 'Sautéed'];

/** The tip line Claude Code shows under the spinner (quoted in the reference). */
export const SPINNER_TIP = 'Tip: Use /config to change your default permission mode (including Plan Mode)';

export function pickVerb(seed: number): string {
  const i = Math.abs(Math.floor(seed)) % SPINNER_VERBS.length;
  return SPINNER_VERBS[i];
}

/** End-of-turn line, e.g. '✻ Worked for 31s'. */
export function workedLine(seconds: number, seed: number): string {
  const verb = WORKED_VERBS[Math.abs(Math.floor(seed)) % WORKED_VERBS.length];
  return `✻ ${verb} for ${Math.max(1, Math.round(seconds))}s`;
}

/** Simulated duration of a turn, from how much work the output shows. */
export function turnSeconds(blocks: readonly Block[]): number {
  let s = 2;
  for (const b of blocks) {
    if (b.kind === 'box') s += 3;
    else if (b.line.style === 'tool') s += 5;
    else if (b.line.style === 'claude') s += 2;
    else s += 0.5;
  }
  return Math.min(95, s);
}

/** The session header printed when a Claude session starts (layout UNVERIFIED, kept compact). */
export const SESSION = {
  version: '2.1.289',
  model: 'Opus 5.5',
  plan: 'Claude Max',
};

// ───────────────────────────── Keys ─────────────────────────────

const KEY_LABELS: Record<string, string> = {
  Escape: 'Esc',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Space: 'Space',
  Delete: 'Del',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
};

/** 'Ctrl++' → ['Ctrl', '+']; 'Shift+Tab' → ['Shift', 'Tab']. */
export function splitCombo(combo: string): string[] {
  if (combo === '+') return ['+'];
  if (combo.endsWith('++')) return [...combo.slice(0, -2).split('+').filter(Boolean), '+'];
  return combo.split('+');
}

/** Human label of a canonical combo: 'Escape' → 'Esc', 'Shift+Tab' stays. */
export function formatCombo(combo: string): string {
  return splitCombo(combo)
    .map((p) => KEY_LABELS[p] ?? p)
    .join('+');
}

export function formatKeys(keys: readonly string[]): string {
  return keys.map(formatCombo).join(' ');
}

const TYPING_KEYS = new Set(['Space', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Dead', 'Process', 'Unidentified']);

/**
 * True for combos that are clearly "a shortcut" (Esc, Tab, Ctrl+…, F-keys), false for typing:
 * single characters (also AltGr = Ctrl+Alt+char), Space, Backspace, caret movement, dead keys and IME.
 */
export function isShortcutCombo(combo: string): boolean {
  const parts = splitCombo(combo);
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1));
  const altGr = mods.has('Ctrl') && mods.has('Alt');
  if (key.length === 1) return !altGr && (mods.has('Ctrl') || mods.has('Alt') || mods.has('Meta'));
  if (TYPING_KEYS.has(key) && !mods.has('Ctrl') && !mods.has('Alt') && !mods.has('Meta')) return false;
  return true;
}

/** Shortcuts offered as on-screen key caps (the step's own keys are always added). */
export const KEYCAP_POOL = [
  'Escape',
  'Tab',
  'Shift+Tab',
  'Enter',
  'ArrowUp',
  'Ctrl+C',
  'Ctrl+D',
  'Ctrl+L',
  'Ctrl+R',
  'Ctrl+O',
  'Ctrl+B',
  'Ctrl+T',
  'Ctrl+G',
  'Ctrl+S',
  'Alt+P',
  'Alt+T',
  '?',
  '!',
  '@',
  '/',
];

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * On-screen key caps for a key step: its distinct keys plus deterministic distractors,
 * in a fixed order so the answer is not always first.
 */
export function keycapPalette(stepKeys: readonly string[], seed: string, size = 6): string[] {
  const own: string[] = [];
  for (const k of stepKeys) if (!own.some((o) => o.toLowerCase() === k.toLowerCase())) own.push(k);
  const pool = KEYCAP_POOL.filter((k) => !own.some((o) => o.toLowerCase() === k.toLowerCase()));
  let h = hashString(seed);
  const picks: string[] = [];
  while (own.length + picks.length < size && pool.length) {
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    picks.push(pool.splice(h % pool.length, 1)[0]);
  }
  const order = (k: string) => {
    const i = KEYCAP_POOL.findIndex((p) => p.toLowerCase() === k.toLowerCase());
    return i < 0 ? KEYCAP_POOL.length : i;
  };
  return [...own, ...picks].sort((a, b) => order(a) - order(b));
}
