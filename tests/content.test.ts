import { describe, expect, it } from 'vitest';
import { CODEX, LEVELS } from '../src/content';
import { compilePattern, matchesCommand, normalizeInput } from '../src/content/match';
import { isWalkable, tileKind, type LevelDef, type TilePos } from '../src/content/types';

function tileAt(level: LevelDef, [col, row]: TilePos): string {
  return level.layout.map[Math.round(row)]?.[Math.round(col)] ?? ' ';
}

function ids(list: { id: string }[]): string[] {
  return list.map((x) => x.id);
}

describe('codex', () => {
  it('has unique ids', () => {
    expect(new Set(ids(CODEX)).size).toBe(CODEX.length);
  });
});

describe('levels', () => {
  it('have unique ids and ascending indexes', () => {
    expect(new Set(ids(LEVELS)).size).toBe(LEVELS.length);
    LEVELS.forEach((level, i) => {
      if (i > 0) expect(level.index).toBeGreaterThan(LEVELS[i - 1].index);
    });
  });
});

describe.each(LEVELS.map((level) => [level.id, level] as const))('level %s', (_id, level) => {
  const { lessons, layout } = level;
  const codexIds = new Set(ids(CODEX));
  const terminalIds = ids(lessons.terminals);

  it('has a rectangular map', () => {
    const width = layout.map[0].length;
    for (const row of layout.map) expect(row.length).toBe(width);
  });

  it('gives every lesson object a spot, and every spot a lesson', () => {
    expect(Object.keys(layout.terminals).sort()).toEqual([...terminalIds].sort());
    expect(Object.keys(layout.npcs).sort()).toEqual(ids(lessons.npcs).sort());
    expect(Object.keys(layout.chips).sort()).toEqual(ids(lessons.chips).sort());
    expect(Object.keys(layout.zones).sort()).toEqual(ids(lessons.zones).sort());
  });

  it('puts spawn, exit, gate and all spots on walkable tiles', () => {
    const spots: [string, TilePos][] = [
      ['spawn', layout.spawn.at],
      ['exit', layout.exit],
      ['gate', layout.gate.at],
      ...Object.entries(layout.terminals).map(([k, v]) => [`terminal ${k}`, v.at] as [string, TilePos]),
      ...Object.entries(layout.npcs).map(([k, v]) => [`npc ${k}`, v.at] as [string, TilePos]),
      ...Object.entries(layout.chips).map(([k, v]) => [`chip ${k}`, v.at] as [string, TilePos]),
      ...Object.entries(layout.zones).map(([k, v]) => [`zone ${k}`, v.at] as [string, TilePos]),
    ];
    for (const [name, at] of spots) {
      expect(isWalkable(tileKind(tileAt(level, at))), `${name} at [${at}] is not on a walkable tile`).toBe(true);
    }
  });

  it('has valid terminal dependencies and at least one required terminal', () => {
    expect(new Set(terminalIds).size).toBe(terminalIds.length);
    expect(lessons.terminals.some((t) => t.required)).toBe(true);
    for (const t of lessons.terminals) {
      for (const dep of t.requires ?? []) {
        expect(terminalIds, `${t.id} requires unknown ${dep}`).toContain(dep);
        expect(dep).not.toBe(t.id);
      }
    }
  });

  it('unlocks only existing codex entries', () => {
    const unlocks = [
      ...lessons.terminals.flatMap((t) => t.challenge.unlocks),
      ...lessons.chips.flatMap((c) => c.unlocks ?? []),
    ];
    for (const id of unlocks) expect(codexIds, `unknown codex id ${id}`).toContain(id);
  });

  it('has conditions that reference existing terminals', () => {
    const conditions = [
      ...lessons.npcs.flatMap((n) => n.dialogs.map((d) => d.when)),
      ...lessons.zones.map((z) => z.when),
    ];
    for (const when of conditions) {
      for (const id of [...(when?.done ?? []), ...(when?.notDone ?? [])]) expect(terminalIds).toContain(id);
    }
    for (const npc of lessons.npcs) {
      expect(npc.dialogs.at(-1)?.when, `npc ${npc.id}: the last dialog must be an unconditional fallback`).toBeUndefined();
    }
  });

  describe.each(lessons.terminals.map((t) => [t.id, t] as const))('terminal %s', (_tid, terminal) => {
    const steps = terminal.challenge.steps;

    it('has steps with unique ids', () => {
      expect(steps.length).toBeGreaterThan(0);
      expect(new Set(ids(steps)).size).toBe(steps.length);
    });

    it('has solvable, well-formed steps', () => {
      for (const step of steps) {
        const where = `${terminal.id}/${step.id}`;
        expect(step.task.trim().length, `${where}: empty task`).toBeGreaterThan(0);
        if (step.kind === 'command') {
          expect(step.hints.length, `${where}: needs at least 2 hints`).toBeGreaterThanOrEqual(2);
          expect(matchesCommand(step, step.example), `${where}: example "${step.example}" does not match accept`).toBe(true);
          for (const w of step.wrong ?? []) {
            expect(compilePattern(w.match).test(normalizeInput(step.example)), `${where}: wrong pattern matches the example`).toBe(false);
          }
        } else if (step.kind === 'key') {
          expect(step.keys.length, `${where}: no keys`).toBeGreaterThan(0);
          expect(step.hints.length, `${where}: needs at least 1 hint`).toBeGreaterThanOrEqual(1);
        } else if (step.kind === 'choice') {
          expect(step.options.length, `${where}: needs at least 2 options`).toBeGreaterThanOrEqual(2);
          expect(step.options.filter((o) => o.correct).length, `${where}: needs a correct option`).toBeGreaterThanOrEqual(1);
        }
      }
    });
  });
});
