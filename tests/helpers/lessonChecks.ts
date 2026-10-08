/**
 * Reusable vitest checks for one level's lessons (no layout needed).
 *   describeLessons('l2', 2, meta, lessons, codex, [...ids of codex entries from earlier levels]);
 */
import { describe, expect, it } from 'vitest';
import { compilePattern, matchesCommand, normalizeInput } from '../../src/content/match';
import { MODE_CYCLE, type CodexEntry, type LevelLessons, type LevelMeta, type TermLine } from '../../src/content/types';

/** Widest line the simulated terminal shows without wrapping. */
export const MAX_OUTPUT_COLS = 76;

/** Key combos the browser lets the game capture (see comboFromEvent in match.ts). */
export const ALLOWED_KEYS = new Set(['Shift+Tab', 'Escape', 'Enter', 'Tab', 'Ctrl+C', 'Ctrl+B', 'Ctrl+R', 'Ctrl+O', 'Ctrl+G', 'Ctrl+D', '?']);

const lineText = (line: TermLine): string => (typeof line === 'string' ? line : line.text);
const ids = (list: { id: string }[]): string[] => list.map((x) => x.id);

export function describeLessons(
  name: string,
  levelIndex: number,
  meta: LevelMeta,
  lessons: LevelLessons,
  codex: CodexEntry[],
  earlierCodexIds: string[] = [],
): void {
  describe(`lessons ${name}`, () => {
    const terminalIds = ids(lessons.terminals);
    const codexIds = new Set([...ids(codex), ...earlierCodexIds]);

    it('has complete meta', () => {
      expect(meta.title.trim()).not.toBe('');
      expect(meta.subtitle.trim()).not.toBe('');
      expect(meta.topics.length).toBeGreaterThanOrEqual(3);
      expect(meta.intro.length).toBeGreaterThanOrEqual(1);
      expect(meta.outro.length).toBeGreaterThanOrEqual(1);
    });

    it('has a sound terminal graph', () => {
      expect(new Set(terminalIds).size).toBe(terminalIds.length);
      expect(lessons.terminals.filter((t) => t.required).length).toBeGreaterThanOrEqual(3);
      for (const t of lessons.terminals) {
        for (const dep of t.requires ?? []) {
          expect(terminalIds, `${t.id} requires unknown ${dep}`).toContain(dep);
          expect(dep).not.toBe(t.id);
        }
        expect(t.challenge.unlocks.length, `${t.id}: unlocks nothing`).toBeGreaterThan(0);
        for (const id of t.challenge.unlocks) expect(codexIds, `${t.id}: unknown codex id ${id}`).toContain(id);
      }
    });

    it('has well-formed codex entries', () => {
      expect(new Set(ids(codex)).size).toBe(codex.length);
      for (const entry of codex) {
        expect(earlierCodexIds, `codex id ${entry.id} already exists in an earlier level`).not.toContain(entry.id);
        expect(entry.level).toBe(levelIndex);
        expect(entry.title.trim()).not.toBe('');
        expect(entry.summary.trim()).not.toBe('');
      }
    });

    it('has NPCs, chips and zones in shape', () => {
      expect(lessons.npcs.length).toBeGreaterThanOrEqual(2);
      expect(lessons.chips.length).toBeGreaterThanOrEqual(4);
      expect(new Set(ids(lessons.npcs)).size).toBe(lessons.npcs.length);
      expect(new Set(ids(lessons.chips)).size).toBe(lessons.chips.length);
      expect(new Set(ids(lessons.zones)).size).toBe(lessons.zones.length);
      for (const npc of lessons.npcs) {
        expect(npc.dialogs.length).toBeGreaterThan(0);
        expect(npc.dialogs.at(-1)?.when, `npc ${npc.id}: the last dialog must be an unconditional fallback`).toBeUndefined();
        for (const dialog of npc.dialogs) {
          expect(dialog.lines.length).toBeGreaterThan(0);
          for (const id of [...(dialog.when?.done ?? []), ...(dialog.when?.notDone ?? [])]) expect(terminalIds).toContain(id);
          for (const line of dialog.lines) expect(line.text.length, `npc ${npc.id}: line too long`).toBeLessThanOrEqual(200);
        }
      }
      for (const chip of lessons.chips) {
        expect(chip.text.length, `chip ${chip.id}: text too long`).toBeLessThanOrEqual(220);
        for (const id of chip.unlocks ?? []) expect(codexIds, `chip ${chip.id}: unknown codex id ${id}`).toContain(id);
      }
      for (const zone of lessons.zones) {
        for (const id of [...(zone.when?.done ?? []), ...(zone.when?.notDone ?? [])]) expect(terminalIds).toContain(id);
      }
    });

    describe.each(lessons.terminals.map((t) => [t.id, t] as const))('terminal %s', (_tid, terminal) => {
      const steps = terminal.challenge.steps;

      it('has 3–8 steps with unique ids', () => {
        expect(steps.length).toBeGreaterThanOrEqual(3);
        expect(steps.length).toBeLessThanOrEqual(8);
        expect(new Set(ids(steps)).size).toBe(steps.length);
        expect(steps.some((s) => s.kind !== 'info'), 'only info steps').toBe(true);
      });

      it('has solvable, well-formed steps', () => {
        for (const step of steps) {
          const where = `${terminal.id}/${step.id}`;
          expect(step.task.trim().length, `${where}: empty task`).toBeGreaterThan(0);
          expect(step.task.length, `${where}: task too long`).toBeLessThanOrEqual(240);
          for (const line of [...(step.output ?? []), ...(step.kind === 'choice' ? (step.context ?? []) : [])]) {
            const text = lineText(line);
            expect(text.length, `${where}: output line wider than ${MAX_OUTPUT_COLS}: "${text}"`).toBeLessThanOrEqual(MAX_OUTPUT_COLS);
            expect(/^[●⎿╭╰│]/.test(text.trim()), `${where}: glyphs are added by the simulator: "${text}"`).toBe(false);
          }
          if (step.kind === 'command') {
            expect(step.hints.length, `${where}: needs at least 2 hints`).toBeGreaterThanOrEqual(2);
            expect(matchesCommand(step, step.example), `${where}: example "${step.example}" does not match accept`).toBe(true);
            for (const src of step.accept) expect(() => compilePattern(src), `${where}: bad regex ${src}`).not.toThrow();
            for (const w of step.wrong ?? []) {
              expect(compilePattern(w.match).test(normalizeInput(step.example)), `${where}: a wrong pattern matches the example`).toBe(false);
            }
          } else if (step.kind === 'key') {
            expect(step.keys.length, `${where}: no keys`).toBeGreaterThan(0);
            expect(step.hints.length, `${where}: needs at least 1 hint`).toBeGreaterThanOrEqual(1);
            for (const key of step.keys) expect(ALLOWED_KEYS, `${where}: key ${key} cannot be captured in a browser`).toContain(key);
            if (step.untilMode) {
              expect(step.keys, `${where}: untilMode needs keys ['Shift+Tab']`).toEqual(['Shift+Tab']);
              expect(MODE_CYCLE, `${where}: untilMode is not in the Shift+Tab cycle`).toContain(step.untilMode);
            }
          } else if (step.kind === 'choice') {
            expect(step.options.length, `${where}: needs at least 2 options`).toBeGreaterThanOrEqual(2);
            expect(step.options.filter((o) => o.correct).length, `${where}: needs a correct option`).toBeGreaterThanOrEqual(1);
            expect(step.hints.length, `${where}: needs at least 1 hint`).toBeGreaterThanOrEqual(1);
            for (const option of step.options) {
              expect(option.label.length, `${where}: option label too long`).toBeLessThanOrEqual(90);
              if (!option.correct) expect(option.reply, `${where}: a wrong option needs a reply`).toBeTruthy();
            }
            if (step.style === 'permission') expect(step.permission, `${where}: a permission dialog needs its tool block`).toBeDefined();
          }
        }
      });
    });
  });
}
