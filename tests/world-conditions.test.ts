import { describe, expect, it } from 'vitest';
import type { LevelDef, LevelLessons, NpcLesson, TerminalLesson } from '../src/content/types';
import { level1 } from '../src/content/levels/l1';
import {
  allRequiredDone,
  buildObjectives,
  evalCondition,
  isTerminalLocked,
  levelStats,
  pickDialog,
  zonesToFire,
} from '../src/world/conditions';
import { LevelSession } from '../src/world/session';

const view = (done: string[], gateOpen = false) => ({ done: new Set(done), gateOpen });

const terminal = (id: string, required: boolean, requires?: string[]): TerminalLesson => ({
  id,
  title: `T ${id}`,
  required,
  requires,
  challenge: { title: '', brief: '', cwd: '~', steps: [], unlocks: [] },
});

const lessons: LevelLessons = {
  terminals: [terminal('a', true), terminal('b', true, ['a']), terminal('c', false, ['b'])],
  npcs: [],
  chips: [{ id: 'k1', title: 'chip', text: 'tip' }],
  zones: [
    { id: 'z1', text: 'hello' },
    { id: 'z2', text: 'after a', when: { done: ['a'] }, once: false },
  ],
};

describe('evalCondition', () => {
  it('holds when every part holds', () => {
    expect(evalCondition(undefined, view([]))).toBe(true);
    expect(evalCondition({ done: ['a'] }, view(['a', 'b']))).toBe(true);
    expect(evalCondition({ done: ['a', 'c'] }, view(['a']))).toBe(false);
    expect(evalCondition({ notDone: ['b'] }, view(['a']))).toBe(true);
    expect(evalCondition({ notDone: ['b'] }, view(['b']))).toBe(false);
    expect(evalCondition({ gateOpen: true }, view([], true))).toBe(true);
    expect(evalCondition({ gateOpen: false }, view([], true))).toBe(false);
    expect(evalCondition({ done: ['a'], gateOpen: true }, view(['a'], false))).toBe(false);
  });
});

describe('pickDialog', () => {
  const npc: NpcLesson = {
    id: 'n',
    name: 'N',
    model: 'npc_tall',
    dialogs: [
      { when: { gateOpen: true }, lines: [{ text: 'gate' }] },
      { when: { done: ['a'] }, lines: [{ text: 'a done' }] },
      { lines: [{ text: 'fallback' }] },
    ],
  };
  it('plays the first dialog whose condition holds', () => {
    expect(pickDialog(npc, view([]))?.lines[0].text).toBe('fallback');
    expect(pickDialog(npc, view(['a']))?.lines[0].text).toBe('a done');
    expect(pickDialog(npc, view(['a'], true))?.lines[0].text).toBe('gate');
  });
});

describe('terminal locks, gate and objectives', () => {
  it('locks a terminal until its requirements are done', () => {
    expect(isTerminalLocked(lessons.terminals[0], new Set())).toBe(false);
    expect(isTerminalLocked(lessons.terminals[1], new Set())).toBe(true);
    expect(isTerminalLocked(lessons.terminals[1], new Set(['a']))).toBe(false);
  });

  it('opens the gate only when every required terminal is done (bonus ones do not count)', () => {
    expect(allRequiredDone(lessons, new Set(['a']))).toBe(false);
    expect(allRequiredDone(lessons, new Set(['a', 'b']))).toBe(true);
  });

  it('builds objectives with done/locked flags', () => {
    const items = buildObjectives(lessons, new Set(['a']));
    expect(items.map((i) => [i.id, i.done, i.locked, i.required])).toEqual([
      ['a', true, false, true],
      ['b', false, false, true],
      ['c', false, true, false],
    ]);
  });
});

describe('zones', () => {
  const spots = { z1: { at: [2, 2] as const, radius: 1.5 }, z2: { at: [8, 8] as const, radius: 1 } };
  it('fires zones the player is inside of, once by default, when their condition holds', () => {
    expect(zonesToFire(lessons.zones, spots, { col: 2.5, row: 3 }, new Set(), view([])).map((z) => z.id)).toEqual(['z1']);
    expect(zonesToFire(lessons.zones, spots, { col: 2.5, row: 3 }, new Set(['z1']), view([]))).toEqual([]);
    expect(zonesToFire(lessons.zones, spots, { col: 8, row: 8 }, new Set(), view([]))).toEqual([]);
    expect(zonesToFire(lessons.zones, spots, { col: 8, row: 8 }, new Set(['z2']), view(['a'])).map((z) => z.id)).toEqual(['z2']);
  });
});

describe('levelStats', () => {
  it('sums stars and chips of this level', () => {
    const level = { ...level1, lessons } as LevelDef;
    const stats = levelStats(level, { terminals: { a: 3, b: 2 }, chips: ['k1', 'other'], completed: false }, 61.4);
    expect(stats).toEqual({ stars: 5, maxStars: 9, chips: 1, maxChips: 1, timeSec: 61 });
  });
});

describe('LevelSession', () => {
  const level = { ...level1, lessons, layout: { ...level1.layout, zones: { z1: { at: [2, 2], radius: 1.5 }, z2: { at: [8, 8], radius: 1 } } } } as LevelDef;

  it('restores saved progress: done terminals, chips and an open gate', () => {
    const s = new LevelSession(level, { terminals: { a: 3, b: 1, ghost: 2 }, chips: ['k1', 'ghost'], completed: false });
    expect([...s.done].sort()).toEqual(['a', 'b']);
    expect([...s.chips]).toEqual(['k1']);
    expect(s.gateOpen).toBe(true);
  });

  it('asks to open the gate exactly when the last required terminal completes', () => {
    const s = new LevelSession(level);
    expect(s.gateOpen).toBe(false);
    expect(s.isLocked('b')).toBe(true);
    expect(s.completeTerminal('a')).toEqual({ fresh: true, openGate: false });
    expect(s.isLocked('b')).toBe(false);
    expect(s.completeTerminal('b')).toEqual({ fresh: true, openGate: true });
    s.gateOpen = true;
    expect(s.completeTerminal('c')).toEqual({ fresh: true, openGate: false });
    expect(s.completeTerminal('a')).toEqual({ fresh: false, openGate: false });
    expect(s.completeTerminal('nope')).toEqual({ fresh: false, openGate: false });
  });

  it('collects each chip once', () => {
    const s = new LevelSession(level);
    expect(s.collectChip('k1')).toBe(true);
    expect(s.collectChip('k1')).toBe(false);
    expect(s.collectChip('unknown')).toBe(false);
  });

  it('completes only at the exit and only with the gate open', () => {
    const s = new LevelSession(level);
    const exit = level.layout.exit;
    expect(s.atExit({ col: exit[0], row: exit[1] })).toBe(false);
    s.gateOpen = true;
    expect(s.atExit({ col: exit[0] + 0.5, row: exit[1] + 0.3 })).toBe(true);
    expect(s.atExit({ col: exit[0], row: exit[1] + 3 })).toBe(false);
  });

  it('fires a zone once', () => {
    const s = new LevelSession(level);
    expect(s.enterZones({ col: 2, row: 2 }).map((z) => z.id)).toEqual(['z1']);
    expect(s.enterZones({ col: 2, row: 2 })).toEqual([]);
  });

  it('fires a repeating zone on every entry, not on every frame inside it', () => {
    const repeating = { ...level, lessons: { ...lessons, zones: [{ id: 'z1', text: 'again', once: false }] } } as LevelDef;
    const s = new LevelSession(repeating);
    expect(s.enterZones({ col: 2, row: 2 }).map((z) => z.id)).toEqual(['z1']);
    expect(s.enterZones({ col: 2.5, row: 2 })).toEqual([]);
    expect(s.enterZones({ col: 6, row: 6 })).toEqual([]);
    expect(s.enterZones({ col: 2, row: 2 }).map((z) => z.id)).toEqual(['z1']);
  });
});
