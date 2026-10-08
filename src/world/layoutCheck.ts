/**
 * Layout checker (pure): can the robot actually reach everything? Runs the real collision against the
 * planned level (tiles, props, automatic dressing, terminals, NPCs) on a fine grid from the spawn.
 * Used by tests for every level; handy while authoring a layout (see `checkLayout`).
 */
import type { LevelDef } from '../content/types';
import { ColliderSet, isFree, TileCollider, type CollisionSource } from './collision';
import { gateCollider, npcCollider, planLevel, spotToWorld, terminalCollider, terminalFront, terminalPose, type LevelPlan } from './levelPlan';

export const PLAYER_RADIUS = 0.45;

export interface LayoutIssue {
  what: string;
  message: string;
}

export interface Reach {
  cell: number;
  cols: number;
  rows: number;
  originX: number;
  originZ: number;
  reached: Uint8Array;
}

/** Static colliders of a level as the game sees them (gate excluded). */
export function levelColliders(level: LevelDef, plan: LevelPlan): ColliderSet {
  const set = new ColliderSet();
  for (const b of plan.boxes) set.addBox(b);
  for (const c of plan.circles) set.addCircle(c);
  for (const [id, spot] of Object.entries(level.layout.terminals)) set.addBox(terminalCollider(terminalPose(plan.grid, spot)), `terminal:${id}`);
  for (const npc of level.lessons.npcs) {
    const spot = level.layout.npcs[npc.id];
    if (spot) set.addCircle(npcCollider(npc.model, spot.at), `npc:${npc.id}`);
  }
  return set;
}

/** Flood fill of reachable robot positions from `start` (world metres). */
export function floodReach(sources: readonly CollisionSource[], plan: LevelPlan, start: { x: number; z: number }, cell = 0.25): Reach {
  const { minX, minZ, maxX, maxZ } = plan.bounds;
  const cols = Math.ceil((maxX - minX) / cell) + 1;
  const rows = Math.ceil((maxZ - minZ) / cell) + 1;
  const reached = new Uint8Array(cols * rows); // 0 unknown, 1 reached, 2 blocked
  const at = (i: number) => ({ x: minX + (i % cols) * cell, z: minZ + Math.floor(i / cols) * cell });
  const startCol = Math.round((start.x - minX) / cell);
  const startRow = Math.round((start.z - minZ) / cell);
  const queue: number[] = [startRow * cols + startCol];
  reached[queue[0]] = 1;
  while (queue.length) {
    const i = queue.pop()!;
    const c = i % cols;
    const r = Math.floor(i / cols);
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const j = nr * cols + nc;
      if (reached[j]) continue;
      const p = at(j);
      if (isFree(sources, p.x, p.z, PLAYER_RADIUS)) {
        reached[j] = 1;
        queue.push(j);
      } else {
        reached[j] = 2;
      }
    }
  }
  return { cell, cols, rows, originX: minX, originZ: minZ, reached };
}

export function reachedNear(reach: Reach, x: number, z: number, radius: number): boolean {
  const c0 = Math.floor((x - radius - reach.originX) / reach.cell);
  const c1 = Math.ceil((x + radius - reach.originX) / reach.cell);
  const r0 = Math.floor((z - radius - reach.originZ) / reach.cell);
  const r1 = Math.ceil((z + radius - reach.originZ) / reach.cell);
  for (let r = Math.max(0, r0); r <= Math.min(reach.rows - 1, r1); r++) {
    for (let c = Math.max(0, c0); c <= Math.min(reach.cols - 1, c1); c++) {
      if (reach.reached[r * reach.cols + c] !== 1) continue;
      const px = reach.originX + c * reach.cell;
      const pz = reach.originZ + r * reach.cell;
      if (Math.hypot(px - x, pz - z) <= radius) return true;
    }
  }
  return false;
}

/** Everything that is wrong with a level layout, as readable messages. Empty = fine. */
export function checkLayout(level: LevelDef, plan: LevelPlan = planLevel(level.layout)): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const { layout } = level;
  const statics = levelColliders(level, plan);
  const tiles = new TileCollider(plan.grid);
  const spawn = spotToWorld(layout.spawn.at);

  if (!isFree([tiles, statics], spawn.x, spawn.z, PLAYER_RADIUS)) issues.push({ what: 'spawn', message: 'spawn overlaps a collider' });

  const open = floodReach([tiles, statics], plan, spawn);
  const need = (what: string, x: number, z: number, radius: number) => {
    if (!reachedNear(open, x, z, radius)) issues.push({ what, message: `${what} cannot be reached from the spawn` });
  };
  for (const [id, spot] of Object.entries(layout.terminals)) {
    const front = terminalFront(terminalPose(plan.grid, spot));
    need(`terminal ${id}`, front.x, front.z, 0.6);
  }
  for (const [id, spot] of Object.entries(layout.npcs)) {
    const p = spotToWorld(spot.at);
    need(`npc ${id}`, p.x, p.z, 1.5);
  }
  for (const [id, spot] of Object.entries(layout.chips)) {
    const p = spotToWorld(spot.at);
    need(`chip ${id}`, p.x, p.z, 0.6);
  }
  for (const [id, spot] of Object.entries(layout.zones)) {
    const p = spotToWorld(spot.at);
    need(`zone ${id}`, p.x, p.z, spot.radius * 2);
  }
  const exit = spotToWorld(layout.exit);
  need('exit', exit.x, exit.z, 1.0);

  // with the gate closed, the exit must be out of reach
  const gate = new ColliderSet();
  gate.addBox(gateCollider(layout.gate));
  const closed = floodReach([tiles, statics, gate], plan, spawn);
  if (reachedNear(closed, exit.x, exit.z, 0.8)) issues.push({ what: 'gate', message: 'the exit is reachable while the gate is closed' });
  return issues;
}
