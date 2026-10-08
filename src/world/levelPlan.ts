/**
 * Level planner (pure): turns a `LevelLayout` into placements (facade modules, roofs, railings, low blocks,
 * props, automatic dressing), colliders and light candidates. The three.js builder only instantiates
 * what is planned here, so everything about *where things go* is testable in node.
 *
 * Extension points:
 *  - `DressingRule`: add a function to `DEFAULT_DRESSING` (or pass `dressing` to `planLevel`) to place
 *    more automatic clutter (hanging cables, signage, steam…). Rules get a `DressContext`.
 *  - Facade module choice lives in `chooseGroundModule` / `chooseUpperModule`.
 */
import { STORY, TILE, type Facing, type LevelLayout, type TilePos } from '../content/types';
import { NEON_HEX, WALL_TINTS } from '../render/palette';
import { aabbFromCenter, rotatedFootprint, type Aabb, type Circle } from './collision';
import { propCollider, propColliders, propInfo, propLights, type PropLight } from './propCatalog';
import { Rng } from './rng';
import { clampStoreys, DIRS, facingToYaw, FACINGS, HALF, layoutRotToYaw, maxBuildingHeight, TileGrid } from './tiles';

export type PlacementKind = 'facade' | 'corner' | 'roof' | 'parapet' | 'low' | 'railing' | 'prop' | 'dressing';

export interface Placement {
  asset: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
  scale?: number;
  /** Building lot (index into `plan.lots`): its tint is multiplied into M_Wall. */
  lot?: number;
  /** Material swap for this instance, e.g. `{ M_WindowLit: 'M_WindowLitCool' }`. */
  remap?: Readonly<Record<string, string>>;
  /** Tall geometry that may hide the player: rendered with the dithered cut-out. */
  occluder?: boolean;
  kind: PlacementKind;
}

export interface PlanLight {
  x: number;
  y: number;
  z: number;
  color: string;
  /** Artist units (see `LIGHT_UNIT` in the builder). */
  intensity: number;
  distance: number;
  flicker?: boolean;
  /** Lower = more important. 0 layout lights, 1 sign lights, 2 prop lights, 3 dressing. */
  priority: number;
  source: string;
}

export interface BuildingLot {
  id: number;
  tint: string;
  /** Share of lit windows on upper storeys (0..1). */
  lit: number;
}

export interface FacadeFace {
  col: number;
  row: number;
  dir: Facing;
  storey: number;
  /** Module origin: bottom centre on the wall plane. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  lot: number;
  asset: string;
  /** The tile in front of the face is walkable. */
  street: boolean;
}

/** A cable hanging between two wall points (metres): drawn as a sagging tube. */
export interface CableSpan {
  a: readonly [number, number, number];
  b: readonly [number, number, number];
  /** How far the middle hangs below the straight line (m). */
  sag: number;
  /** Tube radius (m). */
  radius: number;
}

/** Where steam puffs rise from (street vents, roof vents). */
export interface SteamVent {
  x: number;
  y: number;
  z: number;
  /** 1 = a street vent, less for faint wisps. */
  strength: number;
}

/** Point at `t` (0..1) along a sagging cable: a parabola below the straight line. */
export function cablePoint(c: CableSpan, t: number): [number, number, number] {
  const sag = c.sag * 4 * t * (1 - t);
  return [c.a[0] + (c.b[0] - c.a[0]) * t, c.a[1] + (c.b[1] - c.a[1]) * t - sag, c.a[2] + (c.b[2] - c.a[2]) * t];
}

export interface LevelPlan {
  grid: TileGrid;
  /** Storeys per tile (0 = not a building), row-major. */
  storeys: Int8Array;
  /** Lot per tile (−1 = not a building), row-major. */
  lotOf: Int16Array;
  lots: BuildingLot[];
  faces: FacadeFace[];
  placements: Placement[];
  boxes: Aabb[];
  circles: Circle[];
  lights: PlanLight[];
  cables: CableSpan[];
  vents: SteamVent[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export interface DressContext {
  readonly layout: LevelLayout;
  readonly grid: TileGrid;
  readonly rng: Rng;
  readonly faces: readonly FacadeFace[];
  storeysAt(col: number, row: number): number;
  /** True when (x, z) is within `r` metres of a gameplay spot (spawn, terminal, NPC, chip, gate, exit). */
  nearSpot(x: number, z: number, r: number): boolean;
  /** True when a neon sign is within `r` metres of (x, y, z). */
  nearSign(x: number, y: number, z: number, r: number): boolean;
  /** True when a prop or a piece of street dressing already stands within `r` metres of (x, z). */
  occupied(x: number, z: number, r: number): boolean;
  add(p: Placement): void;
  addLight(l: PlanLight): void;
  addCable(c: CableSpan): void;
}

export type DressingRule = (ctx: DressContext) => void;

export interface PlanOptions {
  /** North-facing walls are never seen by the fixed camera. Default true. */
  skipNorthFaces?: boolean;
  dressing?: readonly DressingRule[];
}

export const GROUND_MODULES = ['fac_g_plain', 'fac_g_door', 'fac_g_shutter', 'fac_g_window', 'fac_g_vent'] as const;
export const UPPER_MODULES = [
  'fac_u_plain',
  'fac_u_window',
  'fac_u_window_lit',
  'fac_u_balcony',
  'fac_u_ac',
  'fac_u_pipes',
] as const;
export const LOW_BLOCKS = ['low_barrier', 'low_planter', 'low_crates'] as const;

const CORNERS: readonly { a: Facing; b: Facing; dc: number; dr: number; yaw: number }[] = [
  { a: 'S', b: 'E', dc: 1, dr: 1, yaw: 0 },
  { a: 'E', b: 'N', dc: 1, dr: -1, yaw: Math.PI / 2 },
  { a: 'N', b: 'W', dc: -1, dr: -1, yaw: Math.PI },
  { a: 'W', b: 'S', dc: -1, dr: 1, yaw: -Math.PI / 2 },
];

export function chooseGroundModule(rng: Rng, street: boolean): string {
  return street
    ? rng.weighted([
        ['fac_g_door', 3],
        ['fac_g_shutter', 3],
        ['fac_g_window', 3],
        ['fac_g_plain', 2],
        ['fac_g_vent', 1],
      ])
    : rng.weighted([
        ['fac_g_plain', 4],
        ['fac_g_vent', 2],
        ['fac_g_window', 1],
      ]);
}

export function chooseUpperModule(rng: Rng, lit: number): string {
  return rng.weighted([
    ['fac_u_plain', 3],
    ['fac_u_window', 4 * (1 - lit)],
    ['fac_u_window_lit', 6 * lit],
    ['fac_u_balcony', 1.5],
    ['fac_u_ac', 2],
    ['fac_u_pipes', 1.5],
  ]);
}

/** World pose of a terminal kiosk. When it stands on a tile centre with a wall behind it, it backs onto the wall. */
export function terminalPose(grid: TileGrid, spot: { at: TilePos; facing: Facing }): { x: number; z: number; yaw: number } {
  const [col, row] = spot.at;
  let x = col * TILE;
  let z = row * TILE;
  if (Number.isInteger(col) && Number.isInteger(row)) {
    const back = DIRS[opposite(spot.facing)];
    if (grid.solid(col + back.dc, row + back.dr)) {
      const shift = HALF - 0.3 - 0.25; // half depth of the kiosk + gap to the padded wall
      x += back.dc * shift;
      z += back.dr * shift;
    }
  }
  return { x, z, yaw: facingToYaw(spot.facing) };
}

export function opposite(f: Facing): Facing {
  return f === 'N' ? 'S' : f === 'S' ? 'N' : f === 'E' ? 'W' : 'E';
}

/** World position of a gameplay spot. */
export function spotToWorld(at: TilePos): { x: number; z: number } {
  return { x: at[0] * TILE, z: at[1] * TILE };
}

/** Where the player stands to use a terminal (in front of the screen). */
export function terminalFront(pose: { x: number; z: number; yaw: number }, dist = 0.95): { x: number; z: number } {
  return { x: pose.x + Math.sin(pose.yaw) * dist, z: pose.z + Math.cos(pose.yaw) * dist };
}

export function terminalCollider(pose: { x: number; z: number; yaw: number }): Aabb {
  const [sx, , sz] = propInfo('terminal').size;
  return rotatedFootprint(pose.x, pose.z, pose.yaw, sx, sz);
}

export function npcCollider(model: string, at: TilePos): Circle {
  const spec = propCollider(model);
  return { x: at[0] * TILE, z: at[1] * TILE, r: spec?.kind === 'circle' ? spec.r : 0.42 };
}

/** The closed gate: a 4 m wide, 0.5 m deep box across the passage. */
export function gateCollider(gate: LevelLayout['gate']): Aabb {
  const { x, z } = spotToWorld(gate.at);
  return gate.axis === 'x' ? aabbFromCenter(x, z, 4, 0.5) : aabbFromCenter(x, z, 0.5, 4);
}

export function planLevel(layout: LevelLayout, options: PlanOptions = {}): LevelPlan {
  const grid = new TileGrid(layout.map);
  const { width, height } = grid;
  const rng = new Rng(layout.mood.seed);
  const idx = (c: number, r: number) => r * width + c;
  const skipNorth = options.skipNorthFaces ?? true;

  // ── lots: connected building components split into building-sized pieces ──
  const lotOf = new Int16Array(width * height).fill(-1);
  const lots: BuildingLot[] = [];
  const lotStoreys: number[] = [];
  const component = new Int32Array(width * height).fill(-1);
  let compCount = 0;
  const lotKeys = new Map<string, number>();
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (!grid.isBuilding(c, r) || component[idx(c, r)] >= 0) continue;
      const comp = compCount++;
      const cells: [number, number][] = [];
      const stack: [number, number][] = [[c, r]];
      component[idx(c, r)] = comp;
      while (stack.length) {
        const [cc, rr] = stack.pop()!;
        cells.push([cc, rr]);
        for (const f of FACINGS) {
          const nc = cc + DIRS[f].dc;
          const nr = rr + DIRS[f].dr;
          if (grid.isBuilding(nc, nr) && component[idx(nc, nr)] < 0) {
            component[idx(nc, nr)] = comp;
            stack.push([nc, nr]);
          }
        }
      }
      const crng = rng.fork(1, comp);
      const w = crng.int(2, 4);
      const h = crng.int(2, 3);
      const ox = crng.int(0, w - 1);
      const oz = crng.int(0, h - 1);
      for (const [cc, rr] of cells) {
        const key = `${comp}:${Math.floor((cc + ox) / w)}:${Math.floor((rr + oz) / h)}`;
        let lot = lotKeys.get(key);
        if (lot === undefined) {
          lot = lots.length;
          lotKeys.set(key, lot);
          const lrng = rng.fork(2, lot);
          let tint = lrng.int(0, WALL_TINTS.length - 1);
          if (lot > 0 && WALL_TINTS[tint] === lots[lot - 1].tint) tint = (tint + 1) % WALL_TINTS.length;
          lots.push({ id: lot, tint: WALL_TINTS[tint], lit: lrng.range(0.15, 0.55) });
          // taller toward the north edge of the map
          const northness = 1 - rr / Math.max(1, height - 1);
          lotStoreys.push(Math.round(lrng.range(2, 4) + northness * 2));
        }
        lotOf[idx(cc, rr)] = lot;
      }
    }
  }

  // ── storeys with the camera clamp ──
  const storeys = new Int8Array(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (!grid.isBuilding(c, r)) continue;
      const requested = grid.explicitStoreys(c, r) ?? lotStoreys[lotOf[idx(c, r)]];
      storeys[idx(c, r)] = clampStoreys(Math.min(6, requested), grid.northWalkDistance(c, r));
    }
  }
  const storeysAt = (c: number, r: number) => (grid.inBounds(c, r) ? storeys[idx(c, r)] : 0);

  const placements: Placement[] = [];
  const faces: FacadeFace[] = [];
  const boxes: Aabb[] = [];
  const circles: Circle[] = [];
  const lights: PlanLight[] = [];
  const cables: CableSpan[] = [];
  const vents: SteamVent[] = [];
  const ventOf = (p: Placement) => {
    const v = VENTS[p.asset];
    if (v) vents.push({ x: p.x, y: p.y + v.y * (p.scale ?? 1), z: p.z, strength: v.strength });
  };

  // ── facades, corners, roofs ──
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const n = storeysAt(c, r);
      if (n === 0) continue;
      const lot = lotOf[idx(c, r)];
      const lotInfo = lots[lot];
      const exposedFrom = (f: Facing) => storeysAt(c + DIRS[f].dc, r + DIRS[f].dr);
      for (const f of FACINGS) {
        const from = exposedFrom(f);
        if (from >= n || (skipNorth && f === 'N')) continue;
        const nb = grid.neighbour(c, r, f);
        const street = grid.walkable(nb.col, nb.row);
        for (let s = from; s < n; s++) {
          const frng = rng.fork(3, c, r, FACINGS.indexOf(f), s);
          const asset = s === 0 ? chooseGroundModule(frng, street) : chooseUpperModule(frng, lotInfo.lit);
          const face: FacadeFace = {
            col: c,
            row: r,
            dir: f,
            storey: s,
            x: c * TILE + DIRS[f].dc * HALF,
            y: s * STORY,
            z: r * TILE + DIRS[f].dr * HALF,
            yaw: facingToYaw(f),
            lot,
            asset,
            street,
          };
          faces.push(face);
          const remap = asset === 'fac_u_window_lit' && frng.chance(0.3) ? { M_WindowLit: 'M_WindowLitCool' } : undefined;
          placements.push({ asset, x: face.x, y: face.y, z: face.z, rotY: face.yaw, lot, remap, occluder: true, kind: 'facade' });
        }
      }
      for (const k of CORNERS) {
        const lo = Math.max(exposedFrom(k.a), exposedFrom(k.b));
        for (let s = lo; s < n; s++) {
          placements.push({
            asset: 'fac_corner',
            x: c * TILE + k.dc * HALF,
            y: s * STORY,
            z: r * TILE + k.dr * HALF,
            rotY: k.yaw,
            lot,
            occluder: true,
            kind: 'corner',
          });
        }
      }
      const top = n * STORY;
      placements.push({ asset: 'roof_cap', x: c * TILE, y: top, z: r * TILE, rotY: 0, lot, occluder: true, kind: 'roof' });
      for (const f of FACINGS) {
        if (exposedFrom(f) >= n) continue;
        placements.push({
          asset: 'roof_parapet',
          x: c * TILE + DIRS[f].dc * HALF,
          y: top,
          z: r * TILE + DIRS[f].dr * HALF,
          rotY: facingToYaw(f),
          lot,
          occluder: true,
          kind: 'parapet',
        });
      }
    }
  }

  // ── low blocks and railings ──
  grid.forEach((c, r, kind) => {
    if (kind === 'lowBlock') {
      const lrng = rng.fork(4, c, r);
      placements.push({
        asset: lrng.pick(LOW_BLOCKS),
        x: c * TILE,
        y: 0,
        z: r * TILE,
        rotY: lrng.pick([0, Math.PI]),
        kind: 'low',
      });
    }
    if (grid.walkable(c, r)) {
      for (const f of FACINGS) {
        const nb = grid.neighbour(c, r, f);
        if (!grid.isVoid(nb.col, nb.row)) continue;
        placements.push({
          asset: 'railing',
          x: c * TILE + DIRS[f].dc * HALF,
          y: 0,
          z: r * TILE + DIRS[f].dr * HALF,
          rotY: facingToYaw(f),
          kind: 'railing',
        });
      }
    }
  });

  // ── explicit props ──
  layout.props.forEach((p, i) => {
    const x = p.at[0] * TILE;
    const z = p.at[1] * TILE;
    const yaw = layoutRotToYaw(p.rot);
    const scale = p.scale ?? 1;
    const placement: Placement = { asset: p.asset, x, y: p.y ?? 0, z, rotY: yaw, scale, kind: 'prop' };
    placements.push(placement);
    // a wall-mounted prop made solid (a free-standing pipe as a post, a crane leg): its footprint box
    // sits in front of the mount plane, where its mesh is
    const depth = propInfo(p.asset).mount === 'wall' ? propInfo(p.asset).size[2] : 0;
    const forced = { kind: 'box', offset: [0, depth / 2] } as const;
    const own = propColliders(p.asset);
    const specs = p.solid === false ? [] : own.length ? own : p.solid ? [forced] : [];
    for (const spec of specs) addCollider(spec, p.asset, x, z, yaw, scale, boxes, circles);
    propLights(p.asset).forEach((l, k) => lights.push(propLight(l, placement, 2, `prop:${p.asset}#${i}${k ? `.${k}` : ''}`)));
    ventOf(placement);
  });

  // ── sign lights ──
  layout.signs.forEach((s, i) => {
    if (!s.light) return;
    const n = DIRS[s.facing];
    lights.push({
      x: s.at[0] * TILE + n.dc * 0.9,
      y: s.y - 0.3,
      z: s.at[1] * TILE + n.dr * 0.9,
      color: NEON_HEX[s.color],
      intensity: 4,
      distance: 7,
      flicker: s.flicker,
      priority: 1,
      source: `sign:${s.text}#${i}`,
    });
  });

  // ── layout lights ──
  layout.lights.forEach((l, i) => {
    lights.push({
      x: l.at[0] * TILE,
      y: l.y,
      z: l.at[1] * TILE,
      color: l.color,
      intensity: l.intensity,
      distance: l.distance,
      flicker: l.flicker,
      priority: 0,
      source: `light#${i}`,
    });
  });

  // ── automatic dressing ──
  const spots = gameplaySpots(layout);
  const signs = layout.signs.map((s) => ({ x: s.at[0] * TILE, y: s.y, z: s.at[1] * TILE }));
  const ctx: DressContext = {
    layout,
    grid,
    rng: rng.fork(5),
    faces,
    storeysAt,
    nearSpot: (x, z, rad) => spots.some((s) => Math.hypot(s.x - x, s.z - z) < rad + s.r),
    nearSign: (x, y, z, rad) => signs.some((s) => Math.hypot(s.x - x, s.y - y, s.z - z) < rad),
    occupied: (x, z, rad) =>
      placements.some((p) => (p.kind === 'prop' || p.kind === 'dressing' || p.kind === 'low') && p.y < 0.5 && Math.hypot(p.x - x, p.z - z) < rad),
    add: (p) => {
      placements.push(p);
      const info = propInfo(p.asset);
      if ((info.mount ?? 'ground') === 'ground' && p.y < 0.5) {
        for (const spec of propColliders(p.asset)) addCollider(spec, p.asset, p.x, p.z, p.rotY, p.scale ?? 1, boxes, circles);
      }
      for (const l of propLights(p.asset)) lights.push(propLight(l, p, 3, `dress:${p.asset}`));
      ventOf(p);
    },
    addLight: (l) => lights.push(l),
    addCable: (c) => cables.push(c),
  };
  for (const rule of options.dressing ?? DEFAULT_DRESSING) rule(ctx);

  lights.sort((a, b) => a.priority - b.priority);
  return { grid, storeys, lotOf, lots, faces, placements, boxes, circles, lights, cables, vents, bounds: grid.bounds() };
}

function addCollider(
  spec: NonNullable<ReturnType<typeof propCollider>>,
  asset: string,
  x: number,
  z: number,
  yaw: number,
  scale: number,
  boxes: Aabb[],
  circles: Circle[],
): void {
  const info = propInfo(asset);
  if (spec.kind === 'circle') {
    const [ox, oz] = spec.offset ?? [0, 0];
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    circles.push({ x: x + (ox * c + oz * s) * scale, z: z + (-ox * s + oz * c) * scale, r: spec.r * scale });
  } else {
    const [sx, sz] = spec.size ?? [info.size[0], info.size[2]];
    const [ox, oz] = spec.offset ?? [0, 0];
    boxes.push(rotatedFootprint(x, z, yaw, sx * scale, sz * scale, ox * scale, oz * scale));
  }
}

function propLight(light: PropLight, p: Placement, priority: number, source: string): PlanLight {
  const s = p.scale ?? 1;
  const [lx, ly, lz] = light.at;
  const c = Math.cos(p.rotY);
  const sn = Math.sin(p.rotY);
  return {
    x: p.x + (lx * c + lz * sn) * s,
    y: p.y + ly * s,
    z: p.z + (-lx * sn + lz * c) * s,
    color: light.color,
    intensity: light.intensity,
    distance: light.distance,
    flicker: light.flicker,
    priority,
    source,
  };
}

/** Props that breathe steam: height of the opening above the prop origin, and how much. */
const VENTS: Readonly<Record<string, { y: number; strength: number }>> = {
  steam_vent: { y: 0.06, strength: 1 },
  manhole: { y: 0.03, strength: 0.45 },
  roof_vent: { y: 0.9, strength: 0.35 },
};

/** Places that automatic clutter must keep clear of (metres). */
export function gameplaySpots(layout: LevelLayout): { x: number; z: number; r: number }[] {
  const out: { x: number; z: number; r: number }[] = [];
  const add = (at: TilePos, r: number) => out.push({ x: at[0] * TILE, z: at[1] * TILE, r });
  add(layout.spawn.at, 2);
  add(layout.exit, 2);
  add(layout.gate.at, 3);
  for (const t of Object.values(layout.terminals)) add(t.at, 2.4);
  for (const n of Object.values(layout.npcs)) add(n.at, 2);
  for (const c of Object.values(layout.chips)) add(c.at, 1.5);
  return out;
}

// ───────────────────────────── default dressing rules ─────────────────────────────

/** Wall clutter on plain modules: AC units, pipes, vines, wall lamps, fuse boxes. */
export const dressWalls: DressingRule = (ctx) => {
  for (const f of ctx.faces) {
    if (f.dir === 'N') continue;
    const r = ctx.rng.fork(10, f.col, f.row, f.storey, FACINGS.indexOf(f.dir));
    const along = (d: number) => ({ x: f.x + Math.cos(f.yaw) * d, z: f.z - Math.sin(f.yaw) * d });
    if (f.storey >= 1 && f.asset === 'fac_u_plain') {
      const roll = r.next();
      if (roll < 0.35) {
        const p = along(r.range(-0.4, 0.4));
        if (!ctx.nearSign(p.x, f.y + 1.3, p.z, 1.4)) {
          ctx.add({ asset: 'ac_unit', x: p.x, y: f.y + 1.1, z: p.z, rotY: f.yaw, kind: 'dressing', occluder: true });
        }
      } else if (roll < 0.6) {
        const p = along(r.pick([-0.75, 0.75]));
        ctx.add({ asset: 'pipe_v', x: p.x, y: f.y, z: p.z, rotY: f.yaw, kind: 'dressing', occluder: true });
      } else if (roll < 0.68 && f.storey <= 2) {
        const p = along(r.range(-0.3, 0.3));
        ctx.add({ asset: 'vines', x: p.x, y: f.y + 0.3, z: p.z, rotY: f.yaw, kind: 'dressing', occluder: true });
      }
    }
    if (f.storey === 0 && f.street) {
      const roll = r.next();
      if ((f.asset === 'fac_g_door' || f.asset === 'fac_g_shutter') && roll < 0.3) {
        if (!ctx.nearSign(f.x, f.y + 2.7, f.z, 1.2)) {
          ctx.add({ asset: 'wall_lamp', x: f.x, y: f.y + 2.65, z: f.z, rotY: f.yaw, kind: 'dressing' });
        }
      } else if (f.asset === 'fac_g_plain' && roll < 0.35) {
        const p = along(r.range(-0.4, 0.4));
        ctx.add({ asset: 'fuse_box', x: p.x, y: f.y + 1.0, z: p.z, rotY: f.yaw, kind: 'dressing' });
      } else if (f.asset === 'fac_g_plain' && roll < 0.55) {
        const p = along(r.pick([-0.75, 0.75]));
        ctx.add({ asset: 'pipe_v', x: p.x, y: f.y, z: p.z, rotY: f.yaw, kind: 'dressing' });
      }
    }
  }
};

/**
 * Rooftop clutter: tanks, vents, antennas, dishes, AC boxes, the odd crate or barrel. The camera rule
 * holds for it too (design doc §4a): nothing may rise above the height clamp, so roofs right behind a
 * street stay bare. Some roofs get a second, smaller item in the opposite corner.
 */
export const dressRoofs: DressingRule = (ctx) => {
  const items: readonly (readonly [string, number])[] = [
    ['water_tank', 2],
    ['roof_vent', 3],
    ['antenna', 1.5],
    ['dish', 1.5],
    ['roof_ac', 3],
  ];
  const small: readonly (readonly [string, number])[] = [
    ['roof_vent', 3],
    ['crate', 1.5],
    ['barrel', 1.5],
    ['dish', 1],
  ];
  ctx.grid.forEach((c, r) => {
    const n = ctx.storeysAt(c, r);
    if (n === 0) return;
    const rr = ctx.rng.fork(11, c, r);
    if (!rr.chance(0.42)) return;
    const y = n * STORY + 0.15;
    const dist = ctx.grid.northWalkDistance(c, r);
    const fits = (asset: string) => dist === null || y + propInfo(asset).size[1] <= maxBuildingHeight(dist);
    const corner = rr.int(0, 3);
    const sx = corner & 1 ? 1 : -1;
    const sz = corner & 2 ? 1 : -1;
    const first = rr.weighted(items);
    if (fits(first)) {
      ctx.add({
        asset: first,
        x: c * TILE + sx * rr.range(0, 0.35),
        y,
        z: r * TILE + sz * rr.range(0, 0.35),
        rotY: (rr.int(0, 3) * Math.PI) / 2,
        kind: 'dressing',
        occluder: true,
      });
    }
    if (!rr.chance(0.3)) return;
    const second = rr.weighted(small);
    if (!fits(second)) return;
    ctx.add({
      asset: second,
      x: c * TILE - sx * rr.range(0.45, 0.6),
      y,
      z: r * TILE - sz * rr.range(0.45, 0.6),
      rotY: rr.range(0, Math.PI * 2),
      kind: 'dressing',
      occluder: true,
    });
  });
};

/** Walls facing each other across a north–south street: `[west building col, east building col]` per row. */
function facingWallPairs(ctx: DressContext, maxGap: number): { c1: number; c2: number; r: number }[] {
  const { grid } = ctx;
  const out: { c1: number; c2: number; r: number }[] = [];
  for (let r = 0; r < grid.height; r++) {
    for (let c1 = 0; c1 < grid.width - 2; c1++) {
      if (!grid.isBuilding(c1, r) || !grid.walkable(c1 + 1, r)) continue;
      let c2 = c1 + 1;
      while (c2 < grid.width && grid.walkable(c2, r)) c2++;
      const gap = c2 - c1 - 1;
      if (c2 < grid.width && grid.isBuilding(c2, r) && gap >= 1 && gap <= maxGap) out.push({ c1, c2, r });
    }
  }
  return out;
}

/**
 * Hanging cables between facing walls across north–south streets (they run left–right on screen, so
 * the sag reads). One to three per span, above the ground floor and below both roofs.
 */
export const dressCables: DressingRule = (ctx) => {
  for (const { c1, c2, r } of facingWallPairs(ctx, 4)) {
    const rr = ctx.rng.fork(13, c1, r);
    if (!rr.chance(0.5)) continue;
    const top = Math.min(ctx.storeysAt(c1, r), ctx.storeysAt(c2, r)) * STORY;
    if (top < 4.6) continue;
    const x1 = c1 * TILE + HALF + 0.04;
    const x2 = c2 * TILE - HALF - 0.04;
    const count = rr.int(1, top > 8 ? 3 : 2);
    for (let k = 0; k < count; k++) {
      const y1 = rr.range(3.8, Math.min(top - 0.5, 9.5));
      const y2 = Math.min(top - 0.4, Math.max(3.6, y1 + rr.range(-0.9, 0.9)));
      const z1 = r * TILE + rr.range(-0.75, 0.75);
      const z2 = Math.min(r * TILE + 0.85, Math.max(r * TILE - 0.85, z1 + rr.range(-0.5, 0.5)));
      const mid = [(x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2] as const;
      if (ctx.nearSign(mid[0], mid[1], mid[2], 1.6) || ctx.nearSign(x1, y1, z1, 1.2) || ctx.nearSign(x2, y2, z2, 1.2)) continue;
      ctx.addCable({ a: [x1, y1, z1], b: [x2, y2, z2], sag: 0.15 + (x2 - x1) * rr.range(0.035, 0.08), radius: rr.range(0.012, 0.022) });
    }
  }
};

/**
 * Strings of paper lanterns across narrow north–south alleys, low enough to light the street (each
 * lantern is a light candidate; the light budget keeps only the nearest ones).
 */
export const dressLanternStrings: DressingRule = (ctx) => {
  for (const { c1, c2, r } of facingWallPairs(ctx, 3)) {
    const rr = ctx.rng.fork(14, c1, r);
    if (!rr.chance(0.28)) continue;
    const top = Math.min(ctx.storeysAt(c1, r), ctx.storeysAt(c2, r)) * STORY;
    if (top < 4.2) continue;
    const x1 = c1 * TILE + HALF + 0.04;
    const x2 = c2 * TILE - HALF - 0.04;
    const z = r * TILE + rr.range(-0.5, 0.5);
    const y = rr.range(3.5, Math.min(4.3, top - 0.4));
    if (ctx.nearSign((x1 + x2) / 2, y, z, 1.8)) continue;
    const span: CableSpan = { a: [x1, y, z], b: [x2, y + rr.range(-0.25, 0.25), z], sag: 0.35 + (x2 - x1) * 0.04, radius: 0.012 };
    ctx.addCable(span);
    const n = Math.max(1, Math.round((x2 - x1) / rr.range(1.0, 1.4)) - 1);
    for (let i = 1; i <= n; i++) {
      const [x, ly, lz] = cablePoint(span, i / (n + 1));
      ctx.add({ asset: 'lantern', x, y: ly, z: lz, rotY: rr.range(0, Math.PI * 2), scale: rr.range(0.85, 1.05), kind: 'dressing' });
    }
  }
};

/** Steam vents and manholes in the street (walk-through), away from gameplay spots and walls. */
export const dressVents: DressingRule = (ctx) => {
  ctx.grid.forEach((c, r, kind) => {
    if (kind !== 'floor' && kind !== 'floorWet') return;
    const rr = ctx.rng.fork(15, c, r);
    const roll = rr.next();
    if (roll > 0.07) return;
    const x = c * TILE + rr.range(-0.4, 0.4);
    const z = r * TILE + rr.range(-0.4, 0.4);
    if (ctx.nearSpot(x, z, 0.6) || ctx.occupied(x, z, 1.1)) return;
    ctx.add({ asset: roll < 0.045 ? 'steam_vent' : 'manhole', x, y: 0, z, rotY: rr.int(0, 3) * (Math.PI / 2), kind: 'dressing' });
  });
};

/** Street clutter leaning on walls, only where the street is at least two tiles wide. */
export const dressStreets: DressingRule = (ctx) => {
  const items: readonly (readonly [string, number])[] = [
    ['barrel', 3],
    ['crate', 3],
    ['trash_bags', 3],
    ['tires', 1],
    ['cable_spool', 1],
    ['crate_stack', 1],
  ];
  ctx.grid.forEach((c, r) => {
    if (!ctx.grid.walkable(c, r)) return;
    const rr = ctx.rng.fork(12, c, r);
    if (!rr.chance(0.1)) return;
    const walls = (['N', 'E', 'W'] as Facing[]).filter((f) => ctx.grid.isBuilding(c + DIRS[f].dc, r + DIRS[f].dr));
    if (walls.length === 0) return;
    const wall = rr.pick(walls);
    const away = DIRS[opposite(wall)];
    if (!ctx.grid.walkable(c + away.dc, r + away.dr)) return;
    const asset = rr.weighted(items);
    const size = propInfo(asset).size;
    const depth = Math.max(size[0], size[2]);
    const inset = HALF - 0.22 - depth / 2;
    const lateral = rr.range(-0.4, 0.4);
    const d = DIRS[wall];
    const x = c * TILE + d.dc * inset + (d.dc === 0 ? lateral : 0);
    const z = r * TILE + d.dr * inset + (d.dr === 0 ? lateral : 0);
    if (ctx.nearSpot(x, z, 1.2)) return;
    ctx.add({ asset, x, y: 0, z, rotY: facingToYaw(opposite(wall)) + rr.range(-0.3, 0.3), kind: 'dressing' });
  });
};

export const DEFAULT_DRESSING: readonly DressingRule[] = [dressWalls, dressRoofs, dressStreets, dressCables, dressLanternStrings, dressVents];

/** Convenience for tests and tools: footprint box of a planned prop. */
export function placementFootprint(p: Placement): Aabb {
  const info = propInfo(p.asset);
  return aabbFromCenter(p.x, p.z, info.size[0] * (p.scale ?? 1), info.size[2] * (p.scale ?? 1));
}
