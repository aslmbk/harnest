/**
 * 2D collision on the ground plane (x, z): a moving circle sliding along boxes and circles. Pure.
 */
import { TILE } from '../content/types';
import { HALF, type TileGrid } from './tiles';

export interface Aabb {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface Circle {
  x: number;
  z: number;
  r: number;
}

/** Anything the player can bump into. */
export interface CollisionSource {
  /** Push every box overlapping the query rectangle into `out`. */
  boxes?(minX: number, minZ: number, maxX: number, maxZ: number, out: Aabb[]): void;
  /** Push every circle near the query rectangle into `out`. */
  circles?(minX: number, minZ: number, maxX: number, maxZ: number, out: Circle[]): void;
}

export function aabbFromCenter(x: number, z: number, sx: number, sz: number): Aabb {
  return { minX: x - sx / 2, minZ: z - sz / 2, maxX: x + sx / 2, maxZ: z + sz / 2 };
}

/** Axis-aligned box of a `sx × sz` footprint centred at (ox, oz) in local space, rotated by `yaw` and moved to (x, z). */
export function rotatedFootprint(x: number, z: number, yaw: number, sx: number, sz: number, ox = 0, oz = 0): Aabb {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // three.js yaw: local (lx, lz) → world (lx·c + lz·s, −lx·s + lz·c)
  const cx = x + ox * c + oz * s;
  const cz = z - ox * s + oz * c;
  const hx = (Math.abs(c) * sx + Math.abs(s) * sz) / 2;
  const hz = (Math.abs(s) * sx + Math.abs(c) * sz) / 2;
  return { minX: cx - hx, minZ: cz - hz, maxX: cx + hx, maxZ: cz + hz };
}

export function overlaps(a: Aabb, minX: number, minZ: number, maxX: number, maxZ: number): boolean {
  return a.maxX > minX && a.minX < maxX && a.maxZ > minZ && a.minZ < maxZ;
}

/** Solid tiles as boxes. Buildings are padded so facade details do not poke into the robot. */
export class TileCollider implements CollisionSource {
  constructor(
    private readonly grid: TileGrid,
    private readonly buildingPad = 0.2,
  ) {}

  boxes(minX: number, minZ: number, maxX: number, maxZ: number, out: Aabb[]): void {
    const c0 = Math.floor((minX + HALF) / TILE) - 1;
    const c1 = Math.floor((maxX + HALF) / TILE) + 1;
    const r0 = Math.floor((minZ + HALF) / TILE) - 1;
    const r1 = Math.floor((maxZ + HALF) / TILE) + 1;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (!this.grid.solid(c, r)) continue;
        const pad = this.grid.isBuilding(c, r) ? this.buildingPad : 0;
        const box = {
          minX: c * TILE - HALF - pad,
          minZ: r * TILE - HALF - pad,
          maxX: c * TILE + HALF + pad,
          maxZ: r * TILE + HALF + pad,
        };
        if (overlaps(box, minX, minZ, maxX, maxZ)) out.push(box);
      }
    }
  }
}

/** A mutable set of boxes and circles (props, NPCs, terminals, the closed gate). */
export class ColliderSet implements CollisionSource {
  private readonly boxList = new Map<string, Aabb>();
  private readonly circleList = new Map<string, Circle>();
  private seq = 0;

  addBox(box: Aabb, key = `b${this.seq++}`): string {
    this.boxList.set(key, box);
    return key;
  }

  addCircle(circle: Circle, key = `c${this.seq++}`): string {
    this.circleList.set(key, circle);
    return key;
  }

  remove(key: string): void {
    this.boxList.delete(key);
    this.circleList.delete(key);
  }

  has(key: string): boolean {
    return this.boxList.has(key) || this.circleList.has(key);
  }

  clear(): void {
    this.boxList.clear();
    this.circleList.clear();
  }

  allBoxes(): Aabb[] {
    return [...this.boxList.values()];
  }

  allCircles(): Circle[] {
    return [...this.circleList.values()];
  }

  boxes(minX: number, minZ: number, maxX: number, maxZ: number, out: Aabb[]): void {
    for (const b of this.boxList.values()) if (overlaps(b, minX, minZ, maxX, maxZ)) out.push(b);
  }

  circles(minX: number, minZ: number, maxX: number, maxZ: number, out: Circle[]): void {
    for (const c of this.circleList.values()) {
      if (c.x + c.r > minX && c.x - c.r < maxX && c.z + c.r > minZ && c.z - c.r < maxZ) out.push(c);
    }
  }
}

export interface MoveResult {
  x: number;
  z: number;
  /** True when a collider changed the motion. */
  blocked: boolean;
}

const _boxes: Aabb[] = [];
const _circles: Circle[] = [];

/** Push a circle out of every overlapping collider. Returns the corrected position. */
export function resolveCircle(sources: readonly CollisionSource[], x: number, z: number, r: number, iterations = 4): MoveResult {
  let blocked = false;
  for (let it = 0; it < iterations; it++) {
    _boxes.length = 0;
    _circles.length = 0;
    for (const s of sources) {
      s.boxes?.(x - r, z - r, x + r, z + r, _boxes);
      s.circles?.(x - r, z - r, x + r, z + r, _circles);
    }
    let moved = false;
    for (const b of _boxes) {
      const cx = Math.min(Math.max(x, b.minX), b.maxX);
      const cz = Math.min(Math.max(z, b.minZ), b.maxZ);
      const dx = x - cx;
      const dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-12) {
        const d = Math.sqrt(d2);
        const push = r - d + 1e-5;
        x += (dx / d) * push;
        z += (dz / d) * push;
      } else {
        // centre inside the box: leave along the shallowest side
        const left = x - b.minX;
        const right = b.maxX - x;
        const top = z - b.minZ;
        const bottom = b.maxZ - z;
        const m = Math.min(left, right, top, bottom);
        if (m === left) x = b.minX - r - 1e-5;
        else if (m === right) x = b.maxX + r + 1e-5;
        else if (m === top) z = b.minZ - r - 1e-5;
        else z = b.maxZ + r + 1e-5;
      }
      moved = true;
    }
    for (const c of _circles) {
      const dx = x - c.x;
      const dz = z - c.z;
      const min = r + c.r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2);
      if (d > 1e-6) {
        x = c.x + (dx / d) * (min + 1e-5);
        z = c.z + (dz / d) * (min + 1e-5);
      } else {
        z = c.z + min + 1e-5;
      }
      moved = true;
    }
    if (!moved) break;
    blocked = true;
  }
  return { x, z, blocked };
}

/**
 * Move a circle by (dx, dz) and slide along whatever it hits. Sub-steps long moves so thin colliders
 * cannot be tunnelled through.
 */
export function moveCircle(sources: readonly CollisionSource[], x: number, z: number, dx: number, dz: number, r: number): MoveResult {
  const len = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(len / (r * 0.5)));
  let blocked = false;
  for (let i = 0; i < steps; i++) {
    const res = resolveCircle(sources, x + dx / steps, z + dz / steps, r);
    x = res.x;
    z = res.z;
    blocked ||= res.blocked;
  }
  return { x, z, blocked };
}

/** True when a circle at (x, z) overlaps nothing. */
export function isFree(sources: readonly CollisionSource[], x: number, z: number, r: number): boolean {
  const res = resolveCircle(sources, x, z, r, 1);
  return !res.blocked;
}

/**
 * Where a circle of radius `r` can stand nearest to (x, z) (teleports): the point itself when it is free
 * and on a walkable tile; off the walkable area, the closest point of the nearest walkable tile; then the
 * point pushed out of whatever it overlaps; else the nearest free point on rings around it (0.25 m steps
 * up to `maxDist` metres). Null when nothing that close is free.
 */
export function nearestFreeSpot(
  grid: TileGrid,
  sources: readonly CollisionSource[],
  x: number,
  z: number,
  r: number,
  maxDist = 8,
): { x: number; z: number } | null {
  const onWalk = (px: number, pz: number) => grid.walkable(Math.round(px / TILE), Math.round(pz / TILE));
  const ok = (px: number, pz: number) => onWalk(px, pz) && isFree(sources, px, pz, r);
  if (ok(x, z)) return { x, z };
  if (!onWalk(x, z)) {
    // the inset keeps the circle clear of padded building tiles on either side
    const inset = Math.max(0, HALF - r - 0.2);
    let best = Infinity;
    let bx = x;
    let bz = z;
    grid.forEach((c, row) => {
      if (!grid.walkable(c, row)) return;
      const px = Math.min(Math.max(x, c * TILE - inset), c * TILE + inset);
      const pz = Math.min(Math.max(z, row * TILE - inset), row * TILE + inset);
      const d = Math.hypot(px - x, pz - z);
      if (d < best) {
        best = d;
        bx = px;
        bz = pz;
      }
    });
    if (best === Infinity) return null;
    x = bx;
    z = bz;
    if (ok(x, z)) return { x, z };
  }
  const pushed = resolveCircle(sources, x, z, r, 8);
  if (ok(pushed.x, pushed.z)) return { x: pushed.x, z: pushed.z };
  const step = 0.25;
  for (let d = step; d <= maxDist + 1e-9; d += step) {
    const n = Math.max(8, Math.ceil((2 * Math.PI * d) / step));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const px = x + Math.cos(a) * d;
      const pz = z + Math.sin(a) * d;
      if (ok(px, pz)) return { x: px, z: pz };
    }
  }
  return null;
}
