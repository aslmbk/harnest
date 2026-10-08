/**
 * Level logic over lesson data: conditions, dialog choice, terminal locks, gate and objectives. Pure.
 */
import type { LevelStats, ObjectiveItem } from '../core/events';
import type { LevelProgress } from '../core/store';
import type { Condition, DialogDef, LevelDef, LevelLessons, NpcLesson, TerminalLesson, ZoneLesson } from '../content/types';

/** What conditions can look at. */
export interface ProgressView {
  done: ReadonlySet<string>;
  gateOpen: boolean;
}

export function evalCondition(cond: Condition | undefined, p: ProgressView): boolean {
  if (!cond) return true;
  if (cond.done && !cond.done.every((id) => p.done.has(id))) return false;
  if (cond.notDone && cond.notDone.some((id) => p.done.has(id))) return false;
  if (cond.gateOpen !== undefined && cond.gateOpen !== p.gateOpen) return false;
  return true;
}

/** The first dialog whose condition holds (the last one is the unconditional fallback). */
export function pickDialog(npc: NpcLesson, p: ProgressView): DialogDef | undefined {
  return npc.dialogs.find((d) => evalCondition(d.when, p)) ?? npc.dialogs.at(-1);
}

/** A terminal is locked until every terminal in `requires` is done. */
export function isTerminalLocked(t: TerminalLesson, done: ReadonlySet<string>): boolean {
  return (t.requires ?? []).some((id) => !done.has(id));
}

/** The gate opens when every required terminal is done. */
export function allRequiredDone(lessons: LevelLessons, done: ReadonlySet<string>): boolean {
  return lessons.terminals.filter((t) => t.required).every((t) => done.has(t.id));
}

export function buildObjectives(lessons: LevelLessons, done: ReadonlySet<string>): ObjectiveItem[] {
  return lessons.terminals.map((t) => ({
    id: t.id,
    label: t.title,
    done: done.has(t.id),
    required: t.required,
    locked: !done.has(t.id) && isTerminalLocked(t, done),
  }));
}

/** True when `pos` (tile coords) is inside the zone spot. */
export function inZone(spot: { at: readonly [number, number]; radius: number }, pos: { col: number; row: number }): boolean {
  return Math.hypot(pos.col - spot.at[0], pos.row - spot.at[1]) <= spot.radius;
}

/** Zones the player is inside of and that may fire now. */
export function zonesToFire(
  zones: readonly ZoneLesson[],
  spots: Readonly<Record<string, { at: readonly [number, number]; radius: number }>>,
  pos: { col: number; row: number },
  fired: ReadonlySet<string>,
  p: ProgressView,
): ZoneLesson[] {
  const out: ZoneLesson[] = [];
  for (const z of zones) {
    const spot = spots[z.id];
    if (!spot) continue;
    if ((z.once ?? true) && fired.has(z.id)) continue;
    if (!inZone(spot, pos)) continue;
    if (!evalCondition(z.when, p)) continue;
    out.push(z);
  }
  return out;
}

export function levelStats(level: LevelDef, progress: Readonly<LevelProgress>, timeSec: number): LevelStats {
  const terminals = level.lessons.terminals;
  return {
    stars: terminals.reduce((sum, t) => sum + (progress.terminals[t.id] ?? 0), 0),
    maxStars: terminals.length * 3,
    chips: level.lessons.chips.filter((c) => progress.chips.includes(c.id)).length,
    maxChips: level.lessons.chips.length,
    timeSec: Math.round(timeSec),
  };
}
