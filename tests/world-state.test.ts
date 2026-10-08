import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/core/events';
import { StateMachine, TRANSITIONS } from '../src/world/stateMachine';

describe('StateMachine', () => {
  it('walks the main flow', () => {
    const log: string[] = [];
    const sm = new StateMachine((from, to) => log.push(`${from}>${to}`));
    const path: GameState[] = ['menu', 'loading', 'intro', 'playing', 'dialog', 'playing', 'terminal', 'playing', 'levelComplete', 'loading', 'intro', 'playing', 'levelComplete', 'ending', 'menu'];
    for (const s of path) expect(sm.go(s), `→ ${s}`).toBe(true);
    expect(log[0]).toBe('boot>menu');
    expect(sm.state).toBe('menu');
  });

  it('refuses transitions that are not in the table', () => {
    const sm = new StateMachine(() => {});
    expect(sm.go('playing')).toBe(false);
    expect(sm.state).toBe('boot');
    sm.go('menu');
    expect(sm.go('terminal')).toBe(false);
    expect(sm.go('menu')).toBe(false); // no self-transition
  });

  it('pauses only from playing and resumes to playing', () => {
    const sm = new StateMachine(() => {});
    sm.go('loading');
    sm.go('intro');
    sm.go('playing');
    sm.go('terminal');
    // the UI closes the terminal / dialog overlay on 'paused' and would not reopen it on resume
    expect(sm.go('paused')).toBe(false);
    sm.go('playing');
    sm.go('dialog');
    expect(sm.go('paused')).toBe(false);
    sm.go('playing');
    expect(sm.go('paused')).toBe(true);
    expect(sm.resumeTo).toBe('playing');
    expect(sm.go('dialog')).toBe(false);
    expect(sm.go('terminal')).toBe(false);
    expect(sm.go(sm.resumeTo)).toBe(true);
    expect(sm.state).toBe('playing');
  });

  it('can reach every state from boot', () => {
    const seen = new Set<GameState>(['boot']);
    const queue: GameState[] = ['boot'];
    while (queue.length) {
      for (const next of TRANSITIONS[queue.shift()!]) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect(seen.size).toBe(Object.keys(TRANSITIONS).length);
  });
});
