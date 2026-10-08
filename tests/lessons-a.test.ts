/**
 * Lesson content checks for level 1 («Переулок Загрузки»), level 2 («Рынок Памяти») and level 3 («Депо Планов»).
 */
import { describe, expect, it } from 'vitest';
import type { CodexEntry, LevelLessons, LevelMeta, TermLine } from '../src/content/types';
import { describeLessons } from './helpers/lessonChecks';
import { codex as codex1 } from '../src/content/levels/l1/codex';
import { lessons as lessons1, meta as meta1 } from '../src/content/levels/l1/lessons';
import { codex as codex2 } from '../src/content/levels/l2/codex';
import { lessons as lessons2, meta as meta2 } from '../src/content/levels/l2/lessons';
import { codex as codex3 } from '../src/content/levels/l3/codex';
import { lessons as lessons3, meta as meta3 } from '../src/content/levels/l3/lessons';
import { codex as codex4 } from '../src/content/levels/l4/codex';
import { codex as codex5 } from '../src/content/levels/l5/codex';

const idsOf = (list: CodexEntry[]): string[] => list.map((e) => e.id);
const later = [...idsOf(codex4), ...idsOf(codex5)];

describeLessons('l1', 1, meta1, lessons1, codex1, later);
describeLessons('l2', 2, meta2, lessons2, codex2, [...idsOf(codex1), ...later]);
describeLessons('l3', 3, meta3, lessons3, codex3, [...idsOf(codex1), ...idsOf(codex2), ...later]);

interface TerminalSpec {
  id: string;
  required: boolean;
  requires: string[];
}

const textOf = (line: TermLine): string => (typeof line === 'string' ? line : line.text);

/** Shape and UI limits agreed for levels 1–3. */
function describeShape(name: string, meta: LevelMeta, lessons: LevelLessons, codex: CodexEntry[], spec: TerminalSpec[]): void {
  describe(`lesson shape ${name}`, () => {
    it('has the planned terminals with 4–7 steps', () => {
      expect(lessons.terminals.map((t) => t.id)).toEqual(spec.map((s) => s.id));
      for (const s of spec) {
        const t = lessons.terminals.find((x) => x.id === s.id)!;
        expect(t.required, `${s.id}: required`).toBe(s.required);
        expect([...(t.requires ?? [])].sort(), `${s.id}: requires`).toEqual([...s.requires].sort());
        expect(t.title.length, `${s.id}: title`).toBeLessThanOrEqual(24);
        const steps = t.challenge.steps;
        expect(steps.length, `${s.id}: step count`).toBeGreaterThanOrEqual(4);
        expect(steps.length, `${s.id}: step count`).toBeLessThanOrEqual(7);
        expect(steps.filter((x) => x.kind === 'info').length, `${s.id}: too many info steps`).toBeLessThanOrEqual(2);
      }
    });

    it('keeps every string within the UI limits', () => {
      expect(meta.subtitle.length, 'subtitle').toBeLessThanOrEqual(45);
      expect(meta.topics.length).toBeGreaterThanOrEqual(3);
      expect(meta.topics.length).toBeLessThanOrEqual(5);
      for (const t of lessons.terminals) {
        for (const step of t.challenge.steps) {
          const where = `${t.id}/${step.id}`;
          expect(step.task.length, `${where}: task`).toBeLessThanOrEqual(140);
          if (step.explain) expect(step.explain.length, `${where}: explain`).toBeLessThanOrEqual(200);
          for (const line of step.output ?? []) expect(textOf(line).trim(), `${where}: a dash-only line renders as a rule`).not.toMatch(/^-{3,}$/);
          if (step.kind !== 'info') for (const hint of step.hints) expect(hint.length, `${where}: hint "${hint}"`).toBeLessThanOrEqual(100);
          if (step.kind === 'command') {
            const n = step.wrong?.length ?? 0;
            expect(n, `${where}: wants 2–4 wrong entries`).toBeGreaterThanOrEqual(2);
            expect(n, `${where}: wants 2–4 wrong entries`).toBeLessThanOrEqual(4);
            expect(step.hints.length, `${where}: hints`).toBeLessThanOrEqual(3);
          }
          if (step.kind === 'choice') {
            expect(step.question.length, `${where}: question`).toBeLessThanOrEqual(80);
            for (const o of step.options) expect(o.label.length, `${where}: option "${o.label}"`).toBeLessThanOrEqual(60);
            if (step.permission) expect(step.permission.command.length, `${where}: permission command`).toBeLessThanOrEqual(70);
          }
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
      const own = idsOf(codex);
      for (const id of own) expect([...fromTerminals, ...fromChips], `codex ${id} is never unlocked`).toContain(id);
      for (const id of [...fromTerminals, ...fromChips]) expect(own, `${id} is not an entry of this level`).toContain(id);
      for (const id of own) expect(id).toMatch(/^(?:cli|slash|key|file|concept)-[a-z0-9]+(?:-[a-z0-9]+)*$/);
    });

    it('keeps NPCs, chips and zones short', () => {
      expect(lessons.npcs).toHaveLength(2);
      expect(lessons.chips).toHaveLength(4);
      expect(lessons.chips.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4']);
      expect(lessons.zones.map((z) => z.id)).toEqual(['z1', 'z2', 'z3']);
      for (const zone of lessons.zones) expect(zone.text.length, `zone ${zone.id}`).toBeLessThanOrEqual(90);
      for (const chip of lessons.chips) expect(chip.text.length, `chip ${chip.id}`).toBeLessThanOrEqual(200);
      for (const npc of lessons.npcs) {
        for (const dialog of npc.dialogs) {
          expect(dialog.lines.length, `npc ${npc.id}: 3–6 lines`).toBeGreaterThanOrEqual(3);
          expect(dialog.lines.length, `npc ${npc.id}: 3–6 lines`).toBeLessThanOrEqual(6);
          for (const line of dialog.lines) expect(line.text.length, `npc ${npc.id}: "${line.text}"`).toBeLessThanOrEqual(160);
        }
      }
    });
  });
}

const chain = (bonus: string[]): TerminalSpec[] => [
  { id: 't1', required: true, requires: [] },
  { id: 't2', required: true, requires: ['t1'] },
  { id: 't3', required: true, requires: ['t2'] },
  ...bonus.map((id) => ({ id, required: false, requires: [] })),
];

describeShape('l1', meta1, lessons1, codex1, chain(['t4']));
describeShape('l2', meta2, lessons2, codex2, chain(['t4']));
describeShape('l3', meta3, lessons3, codex3, chain(['t4', 't5']));

describe('level 1 codex', () => {
  it('has the entries the rest of the game relies on', () => {
    for (const id of ['cli-claude', 'slash-init', 'slash-help']) expect(idsOf(codex1)).toContain(id);
  });
});
