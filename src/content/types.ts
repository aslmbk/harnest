/**
 * Content contracts for HARNEST. Pure data types — no imports from engine or UI code.
 *
 * Coordinates are in TILE SPACE: [col, row], fractional values allowed.
 * [0, 0] is the centre of the top-left (north-west) tile; rows grow to the south.
 * World space: x = col * TILE, z = row * TILE, y is up. North is -Z; the camera sits to the
 * south of the player and looks north, so anything facing 'S' faces the camera.
 */

export const TILE = 2; // metres per tile
export const STORY = 3; // metres per building storey

export type Facing = 'N' | 'E' | 'S' | 'W';
export type TilePos = readonly [col: number, row: number];
export type NeonColor = 'pink' | 'cyan' | 'orange' | 'green' | 'yellow' | 'red' | 'violet' | 'white';
export type Mood = 'neutral' | 'happy' | 'worried' | 'thinking' | 'excited';
export type NpcModel = 'npc_tall' | 'npc_round' | 'npc_drone';

/**
 * Map legend (one char per tile, every row of a map has the same length):
 *   ' '  void      — nothing; the abyss below the city. Not walkable. Floor edges next to void get a railing.
 *   '.'  floor     — walkable street slab.
 *   ','  floorWet  — walkable, puddle-heavy.
 *   '='  grate     — walkable metal catwalk.
 *   '#'  building  — solid; storey count picked by the builder (seeded), then clamped by the camera rule.
 *   '1'..'6' building with an explicit storey count (still clamped by the camera rule).
 *   'o'  lowBlock  — solid, about 1.2 m high (barrier, planter, low wall). Never hides the player.
 */
export type TileKind = 'void' | 'floor' | 'floorWet' | 'grate' | 'building' | 'lowBlock';

export function tileKind(ch: string): TileKind {
  if (ch === '.') return 'floor';
  if (ch === ',') return 'floorWet';
  if (ch === '=') return 'grate';
  if (ch === 'o') return 'lowBlock';
  if (ch === '#' || (ch >= '1' && ch <= '6')) return 'building';
  return 'void';
}

export function isWalkable(kind: TileKind): boolean {
  return kind === 'floor' || kind === 'floorWet' || kind === 'grate';
}

// ───────────────────────────── Lessons (what the level teaches) ─────────────────────────────

/**
 * Visual style of a line in the simulated Claude Code terminal.
 * Content gives the bare text; the simulator adds every glyph and frame:
 *   - the session header (version, model, cwd) is printed by the simulator when a Claude session starts;
 *   - the player's input is echoed by the simulator — never put it in `output`.
 */
export type TermStyle =
  | 'plain'
  | 'dim' // secondary text
  | 'user' // reserved for the simulator's echo of the player's input
  | 'claude' // Claude's prose. The simulator puts ● before the first line of a run; following 'claude' lines continue it
  | 'tool' // tool call, text like "Read(src/pump.ts)" or "Bash(npm test)" — the simulator adds ●
  | 'result' // tool result, text like "Read 120 lines" — the simulator adds ⎿ before the first line of a run
  | 'ok'
  | 'warn'
  | 'err'
  | 'accent' // Claude orange
  | 'diffAdd' // text is the code line only — the simulator adds "+" and colour
  | 'diffDel' // text is the code line only — the simulator adds "-" and colour
  | 'code' // file content, shell output, JSON
  | 'box'; // consecutive 'box' lines are framed together by the simulator (a plan, a notice) — no box-drawing characters in text

/** A plain string is shorthand for `{ text, style: 'plain' }`. */
export type TermLine = string | { text: string; style?: TermStyle; delayMs?: number };

/**
 * Permission mode shown in the status line under the prompt (strings verified in docs/claude-code-reference.md §3.1):
 *   auto              ⏵⏵ auto mode on (shift+tab to cycle)      — what an interactive session starts in
 *   manual            ⏸ manual mode on (shift+tab to cycle)     — 'default' is the config value of the same mode
 *   acceptEdits       ⏵⏵ accept edits on (shift+tab to cycle)
 *   plan              ⏸ plan mode on (shift+tab to cycle)
 *   dontAsk           ⏵⏵ don't ask on
 *   bypassPermissions ⏵⏵ bypass permissions on
 * Shift+Tab cycles: auto → manual → acceptEdits → plan → auto.
 */
export type PermissionMode = 'auto' | 'manual' | 'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'bypassPermissions';

/** The order Shift+Tab cycles through. */
export const MODE_CYCLE: readonly PermissionMode[] = ['auto', 'manual', 'acceptEdits', 'plan'];

interface StepBase {
  id: string;
  /** What the player must achieve. Shown in the task panel. Must NOT contain the literal answer. */
  task: string;
  /** Printed to the terminal after the step is solved (simulated Claude Code output). */
  output?: TermLine[];
  /** One or two sentences: why this matters in real work. Shown after success. */
  explain?: string;
  /** Switch the status-line mode after this step succeeds. */
  setMode?: PermissionMode;
}

/** The player types a line and presses Enter. */
export interface CommandStep extends StepBase {
  kind: 'command';
  /** 'shell' shows the OS prompt `$`; 'claude' shows the Claude Code prompt `>`. */
  prompt: 'shell' | 'claude';
  /**
   * Regex sources. Each is anchored (^…$) and tested case-insensitively against the
   * normalised input (trimmed, whitespace collapsed, curly quotes straightened). See match.ts.
   */
  accept: string[];
  /** Canonical answer. Must match `accept`. Revealed only after all hints are used. */
  example: string;
  /** Progressive hints: nudge → stronger → almost the answer. At least 2. */
  hints: string[];
  /** Tailored replies for common mistakes (same regex rules as `accept`). */
  wrong?: { match: string; reply: string }[];
}

/** The player presses a key combo (or a sequence of combos). */
export interface KeyStep extends StepBase {
  kind: 'key';
  /** Canonical combos in order, e.g. ['Shift+Tab'] or ['Escape', 'Escape']. Format: see comboFromEvent() in match.ts. */
  keys: string[];
  /** Human-readable label of the answer, e.g. 'Shift+Tab'. */
  example: string;
  hints: string[];
  /**
   * Mode-cycling step: with keys ['Shift+Tab'], every press moves the status line one step along
   * MODE_CYCLE and the step is solved when the mode becomes `untilMode` (overshooting just keeps cycling).
   */
  untilMode?: PermissionMode;
}

export interface ChoiceOption {
  label: string;
  correct?: boolean;
  /** Feedback shown when this option is picked (why it is right or wrong). */
  reply?: string;
  /** In a 'permission' dialog: pressing Esc picks this option (in Claude Code, Esc = No). */
  esc?: boolean;
}

/** The tool block of a Claude Code permission dialog (reference §1.4). */
export interface PermissionBlock {
  /** Header, e.g. 'Bash command'. */
  tool: string;
  /** What Claude says the action is for, e.g. 'Run the test suite'. */
  description?: string;
  /** The command or action, shown between dashed rules, e.g. 'npm test'. */
  command: string;
  /** Line under the command, e.g. 'This command requires approval'. */
  note?: string;
}

/** The player picks one option: a Claude Code permission dialog or a "what would you do" question. */
export interface ChoiceStep extends StepBase {
  kind: 'choice';
  /** 'permission' renders like Claude Code's numbered permission prompt; 'quiz' like a plain question. */
  style: 'permission' | 'quiz';
  question: string;
  /** Lines printed above the dialog (e.g. what Claude did before asking). */
  context?: TermLine[];
  /** For style 'permission': the tool block drawn above the question. */
  permission?: PermissionBlock;
  options: ChoiceOption[];
  hints: string[];
}

/** Non-interactive beat: prints `output`, waits for Enter. */
export interface InfoStep extends StepBase {
  kind: 'info';
}

export type StepDef = CommandStep | KeyStep | ChoiceStep | InfoStep;

export interface ChallengeDef {
  title: string;
  /** The situation: what is broken and why Claude Code helps. 1–3 sentences. */
  brief: string;
  /** Fake working directory shown in the terminal, e.g. '~/city/lift-controller'. */
  cwd: string;
  /** Mode the Claude session starts in. Default 'auto' (as in the real tool). */
  startMode?: PermissionMode;
  steps: StepDef[];
  /** Codex entry ids unlocked when the challenge is completed. */
  unlocks: string[];
}

export interface TerminalLesson {
  /** Unique within the level, e.g. 't1'. */
  id: string;
  /** Label over the kiosk, e.g. 'Насосная станция'. */
  title: string;
  /** Required terminals must all be completed to open the gate. */
  required: boolean;
  /** Terminal ids that must be completed first; until then this terminal is locked. */
  requires?: string[];
  challenge: ChallengeDef;
}

/** Condition over the current level's progress. All listed parts must hold. */
export interface Condition {
  done?: string[]; // terminal ids completed
  notDone?: string[]; // terminal ids not completed yet
  gateOpen?: boolean;
}

export interface DialogLine {
  text: string;
  /** Defaults to the NPC's name. Use 'ХАРНИ' for the player's own lines. */
  speaker?: string;
  mood?: Mood;
}

export interface DialogDef {
  /** The first dialog whose condition holds is played. Put the most specific first, the fallback last. */
  when?: Condition;
  lines: DialogLine[];
}

export interface NpcLesson {
  id: string;
  name: string;
  model: NpcModel;
  /** CSS colour of the NPC's face screen / accent. */
  tint?: string;
  dialogs: DialogDef[];
}

/** Collectible memory chip: a short optional tip. */
export interface ChipLesson {
  id: string;
  title: string;
  text: string;
  unlocks?: string[]; // codex entry ids
}

/** Walk-in trigger: the robot "thinks aloud" (shown as a toast / speech bubble). */
export interface ZoneLesson {
  id: string;
  text: string;
  speaker?: string; // default 'ХАРНИ'
  once?: boolean; // default true
  when?: Condition;
}

export interface LevelLessons {
  terminals: TerminalLesson[];
  npcs: NpcLesson[];
  chips: ChipLesson[];
  zones: ZoneLesson[];
}

// ───────────────────────────── Layout (where things are) ─────────────────────────────

export interface PropPlacement {
  /** Kit asset id = root node name in a kit GLB, e.g. 'barrel'. */
  asset: string;
  at: TilePos;
  /** Metres above the ground (wall-mounted or rooftop props). Default 0. */
  y?: number;
  /** Yaw in degrees, clockwise seen from above. 0 = the asset's front faces south (toward the camera). */
  rot?: number;
  scale?: number;
  /** Override the catalog's default collider on/off. */
  solid?: boolean;
}

export interface NeonSignDef {
  /** Rendered at runtime with a neon material. Short: a command ('/init'), a word ('ЛАПША'). */
  text: string;
  at: TilePos;
  /** Height of the sign centre, metres. */
  y: number;
  /** Direction the sign faces. Normally 'S' (toward the camera). */
  facing: Facing;
  color: NeonColor;
  /** Glyph height in metres. Default 0.6. */
  size?: number;
  vertical?: boolean;
  flicker?: boolean;
  /** Dark backing board behind the glyphs. Default true. */
  frame?: boolean;
  /** Also spawn a real point light (budgeted by the engine). Default false. */
  light?: boolean;
}

export interface LightDef {
  at: TilePos;
  y: number;
  color: string;
  intensity: number;
  distance: number;
  flicker?: boolean;
}

export interface LevelMood {
  fogColor: string;
  /** 0..1, relative. */
  fogDensity: number;
  ambient: string;
  ambientIntensity: number;
  keyLight: { color: string; intensity: number };
  /** Dominant neon colours of the district; used by automatic dressing. */
  accentA: NeonColor;
  accentB: NeonColor;
  /** 0 = dry, 1 = heavy rain. */
  rain: number;
  /** Seed for automatic dressing (facade variety, clutter). */
  seed: number;
}

export interface LevelLayout {
  /** Rows north → south, see the legend above. */
  map: string[];
  spawn: { at: TilePos; facing: Facing };
  /** The exit gate. axis 'x': the gate spans east–west and blocks a north–south passage; 'z' the opposite. */
  gate: { at: TilePos; axis: 'x' | 'z' };
  /** Reaching this tile (gate open) completes the level. */
  exit: TilePos;
  /** Keyed by lesson ids. Terminal `facing` is the direction the screen faces (the player stands on that side). */
  terminals: Record<string, { at: TilePos; facing: Facing }>;
  npcs: Record<string, { at: TilePos; facing: Facing }>;
  chips: Record<string, { at: TilePos }>;
  /** radius in tiles. */
  zones: Record<string, { at: TilePos; radius: number }>;
  props: PropPlacement[];
  signs: NeonSignDef[];
  lights: LightDef[];
  mood: LevelMood;
}

// ───────────────────────────── Level ─────────────────────────────

export interface LevelMeta {
  /** District name, e.g. 'Переулок Загрузки'. */
  title: string;
  /** Topic in one line, e.g. 'Первые шаги с Claude Code'. */
  subtitle: string;
  /** Short bullet list of what the player will learn. */
  topics: string[];
  /** Intro card paragraphs (story + goal). */
  intro: string[];
  /** Level-complete paragraphs (recap). */
  outro: string[];
}

export interface LevelDef {
  /** Stable id, e.g. 'l1'. */
  id: string;
  /** 1-based order. */
  index: number;
  meta: LevelMeta;
  lessons: LevelLessons;
  layout: LevelLayout;
}

// ───────────────────────────── Codex (the player's cheat sheet) ─────────────────────────────

export type CodexCategory = 'cli' | 'slash' | 'keys' | 'files' | 'concepts';

export interface CodexEntry {
  id: string;
  category: CodexCategory;
  /** e.g. '/init' or 'Режим планирования'. */
  title: string;
  /** Exact syntax when there is one, e.g. 'claude -p "запрос"'. */
  syntax?: string;
  /** One sentence. */
  summary: string;
  /** Optional longer explanation, 1–3 short paragraphs. */
  details?: string;
  /** Level index where it is first taught. */
  level: number;
}
