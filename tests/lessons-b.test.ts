/**
 * Lesson content checks for level 4 («Квартал Инструментов») and level 5 («Башня Ядра»).
 */
import { describe, expect, it } from 'vitest';
import type { CodexEntry, LevelLessons } from '../src/content/types';
import { describeLessons } from './helpers/lessonChecks';
import { codex as codex4 } from '../src/content/levels/l4/codex';
import { lessons as lessons4, meta as meta4 } from '../src/content/levels/l4/lessons';
import { codex as codex5 } from '../src/content/levels/l5/codex';
import { lessons as lessons5, meta as meta5 } from '../src/content/levels/l5/lessons';

// Codex ids of levels 1–3, whichever of them exist yet (they are written in parallel).
const earlier = import.meta.glob<{ codex?: CodexEntry[] }>('../src/content/levels/{l1,l2,l3}/codex.ts', { eager: true });
const earlierIds = Object.values(earlier).flatMap((m) => (m.codex ?? []).map((e) => e.id));

describeLessons('l4', 4, meta4, lessons4, codex4, earlierIds);
describeLessons('l5', 5, meta5, lessons5, codex5, [...earlierIds, ...codex4.map((e) => e.id)]);

interface TerminalSpec {
  id: string;
  required: boolean;
  requires: string[];
  steps: [min: number, max: number];
}

function describeShape(name: string, lessons: LevelLessons, codex: CodexEntry[], spec: TerminalSpec[]): void {
  describe(`lesson shape ${name}`, () => {
    it('has the planned terminals', () => {
      expect(lessons.terminals.map((t) => t.id)).toEqual(spec.map((s) => s.id));
      for (const s of spec) {
        const t = lessons.terminals.find((x) => x.id === s.id)!;
        expect(t.required, `${s.id}: required`).toBe(s.required);
        expect([...(t.requires ?? [])].sort(), `${s.id}: requires`).toEqual([...s.requires].sort());
        const steps = t.challenge.steps;
        expect(steps.length, `${s.id}: step count`).toBeGreaterThanOrEqual(s.steps[0]);
        expect(steps.length, `${s.id}: step count`).toBeLessThanOrEqual(s.steps[1]);
        expect(steps.filter((x) => x.kind === 'info').length, `${s.id}: too many info steps`).toBeLessThanOrEqual(2);
        for (const step of steps) {
          if (step.kind !== 'command') continue;
          const n = step.wrong?.length ?? 0;
          expect(n, `${s.id}/${step.id}: wants 2–4 wrong entries`).toBeGreaterThanOrEqual(2);
          expect(n, `${s.id}/${step.id}: wants 2–4 wrong entries`).toBeLessThanOrEqual(4);
          expect(step.hints.length, `${s.id}/${step.id}: hints`).toBeLessThanOrEqual(3);
        }
      }
    });

    it('unlocks every codex entry, and each chip unlocks one entry of its own', () => {
      const fromTerminals = lessons.terminals.flatMap((t) => t.challenge.unlocks);
      const fromChips = lessons.chips.flatMap((c) => c.unlocks ?? []);
      for (const chip of lessons.chips) expect(chip.unlocks, `chip ${chip.id}`).toHaveLength(1);
      for (const id of fromChips) expect(fromTerminals, `chip entry ${id} is also taught by a terminal`).not.toContain(id);
      expect(new Set(fromChips).size).toBe(fromChips.length);
      expect(new Set(fromTerminals).size).toBe(fromTerminals.length);
      const own = codex.map((e) => e.id);
      for (const id of own) expect([...fromTerminals, ...fromChips], `codex ${id} is never unlocked`).toContain(id);
      for (const id of own) expect(id).toMatch(/^(?:cli|slash|key|file|concept)-[a-z0-9]+(?:-[a-z0-9]+)*$/);
    });

    it('keeps NPCs, chips and zones short', () => {
      expect(lessons.npcs).toHaveLength(2);
      expect(lessons.chips).toHaveLength(4);
      expect(lessons.zones.length).toBeGreaterThanOrEqual(2);
      expect(lessons.zones.length).toBeLessThanOrEqual(3);
      for (const zone of lessons.zones) expect(zone.text.length, `zone ${zone.id}`).toBeLessThanOrEqual(90);
      for (const npc of lessons.npcs) {
        for (const dialog of npc.dialogs) {
          expect(dialog.lines.length, `npc ${npc.id}: 3–6 lines`).toBeGreaterThanOrEqual(3);
          expect(dialog.lines.length, `npc ${npc.id}: 3–6 lines`).toBeLessThanOrEqual(6);
        }
      }
    });
  });
}

describeShape('l4', lessons4, codex4, [
  { id: 't1', required: true, requires: [], steps: [4, 7] },
  { id: 't2', required: true, requires: ['t1'], steps: [4, 7] },
  { id: 't3', required: true, requires: ['t2'], steps: [4, 7] },
  { id: 't4', required: false, requires: [], steps: [4, 7] },
]);

describeShape('l5', lessons5, codex5, [
  { id: 't1', required: true, requires: [], steps: [4, 7] },
  { id: 't2', required: true, requires: ['t1'], steps: [4, 7] },
  { id: 't3', required: true, requires: ['t2'], steps: [4, 7] },
  { id: 't4', required: true, requires: ['t1', 't2', 't3'], steps: [7, 8] },
  { id: 't5', required: false, requires: [], steps: [4, 7] },
]);
