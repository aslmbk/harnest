/**
 * Game state machine (design: boot → menu → loading → intro → playing ⇄ dialog / terminal / paused →
 * levelComplete → next level or ending). Pure: it only validates and records transitions.
 */
import type { GameState } from '../core/events';

export const TRANSITIONS: Readonly<Record<GameState, readonly GameState[]>> = {
  boot: ['menu', 'loading'],
  menu: ['loading'],
  loading: ['intro', 'playing', 'menu'],
  intro: ['playing', 'loading', 'menu'],
  playing: ['dialog', 'terminal', 'paused', 'levelComplete', 'loading', 'menu'],
  // no pause from a dialog or the terminal: the UI closes those overlays on 'paused' and does not reopen
  // them on resume, so the game would be left in a dialog / terminal nobody can see or close
  dialog: ['playing', 'loading', 'menu'],
  terminal: ['playing', 'loading', 'menu'],
  paused: ['playing', 'loading', 'menu'],
  levelComplete: ['loading', 'ending', 'menu'],
  ending: ['menu', 'loading'],
};

/** States in which the paused overlay may be opened (and resumed back to). */
export const PAUSABLE: readonly GameState[] = ['playing'];

export class StateMachine {
  private current: GameState = 'boot';
  private resumeState: GameState = 'playing';
  /** Time (ms, caller's clock) of the last transition. */
  changedAt = 0;

  constructor(private readonly onChange: (from: GameState, to: GameState) => void) {}

  get state(): GameState {
    return this.current;
  }

  /** State to return to on resume. */
  get resumeTo(): GameState {
    return this.resumeState;
  }

  canGo(to: GameState): boolean {
    return to !== this.current && TRANSITIONS[this.current].includes(to);
  }

  /** Performs the transition if it is allowed. Returns false (and changes nothing) otherwise. */
  go(to: GameState, now = 0): boolean {
    if (!this.canGo(to)) return false;
    const from = this.current;
    if (to === 'paused') this.resumeState = PAUSABLE.includes(from) ? from : 'playing';
    this.current = to;
    this.changedAt = now;
    this.onChange(from, to);
    return true;
  }

  is(...states: GameState[]): boolean {
    return states.includes(this.current);
  }
}
