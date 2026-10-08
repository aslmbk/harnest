/**
 * Typed event bus: the only channel between the game (3D world), the UI (DOM overlay) and audio.
 * The game owns the state machine; the UI and audio are reactive.
 */
import type { DialogLine } from '../content/types';
import type { Stars } from './store';

export type GameState =
  | 'boot' // assets loading for the first time
  | 'menu' // main menu
  | 'loading' // a level is being built
  | 'intro' // level intro card is shown
  | 'playing' // the player drives the robot
  | 'dialog' // an NPC dialog is open
  | 'terminal' // the terminal simulator is open
  | 'paused' // pause menu or another UI overlay
  | 'levelComplete' // level summary is shown
  | 'ending'; // the game is finished

export type InteractKind = 'npc' | 'terminal' | 'gate';

export interface ObjectiveItem {
  id: string; // terminal id
  label: string;
  done: boolean;
  required: boolean;
  locked: boolean;
}

export interface LevelStats {
  stars: number; // sum over terminals
  maxStars: number;
  chips: number;
  maxChips: number;
  timeSec: number;
}

export type SfxName =
  | 'uiMove'
  | 'uiSelect'
  | 'uiBack'
  | 'key' // a typed character in the terminal
  | 'stepOk'
  | 'stepWrong'
  | 'hint'
  | 'challengeDone'
  | 'chip'
  | 'gateOpen'
  | 'talk' // dialog blip
  | 'interact'
  | 'locked'
  | 'levelComplete';

export interface GameEvents {
  // ───── game → UI / audio ─────
  'state:changed': { from: GameState; to: GameState };
  'loading:progress': { ratio: number; label?: string };
  'renderer:info': { backend: 'webgpu' | 'webgl2' };
  /** A level is built and current. Sent before the state becomes 'intro'. */
  'level:ready': { levelId: string };
  /** Nearest thing the player can interact with (E), or null when there is none. */
  'interact:prompt': { kind: InteractKind; id: string; label: string; locked: boolean } | null;
  /** The game entered 'dialog'. The UI plays the lines, then emits 'ui:dialogDone'. */
  'dialog:start': { npcId: string; name: string; lines: DialogLine[] };
  /** The game entered 'terminal'. The UI runs the challenge, then emits 'ui:terminalClosed'. */
  'terminal:open': { levelId: string; terminalId: string };
  'toast': { text: string; kind?: 'info' | 'success' | 'warn' | 'bark'; speaker?: string };
  /** A chip was picked up (the store is already updated). The UI shows its tip card. */
  'chip:collected': { levelId: string; chipId: string };
  'objectives:changed': { levelId: string; items: ObjectiveItem[]; gateOpen: boolean };
  'gate:opened': { levelId: string };
  /** The game entered 'levelComplete'. The UI shows the summary, then emits 'ui:nextLevel'. */
  'level:completed': { levelId: string; stats: LevelStats; isLast: boolean };
  /** Player speed 0..1, sent when it changes noticeably (for the motor sound). */
  'player:motion': { speed: number };

  // ───── UI → game ─────
  /** Start or continue. No levelId = continue from the save (or level 1). newGame wipes progress first. */
  'ui:play': { levelId?: string; newGame?: boolean };
  'ui:introDone': Record<string, never>;
  'ui:dialogDone': { npcId: string };
  /** The UI started showing line `index` of the current dialog (0 for the first line). */
  'ui:dialogLine': { npcId: string; index: number };
  /** The store is NOT updated by the UI; the game records completion and stars. */
  'ui:terminalClosed': { terminalId: string; completed: boolean; stars?: Stars };
  'ui:pause': Record<string, never>;
  'ui:resume': Record<string, never>;
  'ui:restartLevel': Record<string, never>;
  'ui:quitToMenu': Record<string, never>;
  'ui:nextLevel': Record<string, never>;

  // ───── anyone → audio ─────
  'sfx': { name: SfxName };
}

type Handler<T> = (payload: T) => void;

export class EventBus<E extends object> {
  private handlers = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(type: K, fn: Handler<E[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => this.off(type, fn);
  }

  once<K extends keyof E>(type: K, fn: Handler<E[K]>): () => void {
    const off = this.on(type, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }

  off<K extends keyof E>(type: K, fn: Handler<E[K]>): void {
    this.handlers.get(type)?.delete(fn as Handler<never>);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        (fn as Handler<E[K]>)(payload);
      } catch (err) {
        console.error(`[bus] handler for "${String(type)}" failed`, err);
      }
    }
  }
}

export type GameBus = EventBus<GameEvents>;
