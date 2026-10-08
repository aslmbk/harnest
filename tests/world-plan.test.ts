import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/content';
import type { LevelLayout } from '../src/content/types';
import { checkLayout } from '../src/world/layoutCheck';
import { gameplaySpots, GROUND_MODULES, planLevel, terminalPose, UPPER_MODULES, type Placement } from '../src/world/levelPlan';
import { propInfo } from '../src/world/propCatalog';
import { clampStoreys, DIRS, FACINGS, maxBuildingHeight, TileGrid } from '../src/world/tiles';

const base: LevelLayout = {
  map: [
    '######', //
    '#5223#',
    '#....#',
    '#.o..#',
    '#....#',
    '      ',
  ],
  spawn: { at: [2, 4], facing: 'N' },
  gate: { at: [3, 2], axis: 'x' },
  exit: [3, 2],
  terminals: {},
  npcs: {},
  chips: {},
  zones: {},
  props: [{ asset: 'barrel', at: [4, 4] }, { asset: 'wall_lamp', at: [1, 2.4], y: 2.5 }, { asset: 'crate', at: [4, 3], solid: false }],
  signs: [{ text: '/init', at: [3, 1.6], y: 3.5, facing: 'S', color: 'cyan', light: true }],
  lights: [{ at: [3, 3], y: 3, color: '#ffffff', intensity: 5, distance: 8 }],
  mood: {
    fogColor: '#000000',
    fogDensity: 0.5,
    ambient: '#223344',
    ambientIntensity: 0.5,
    keyLight: { color: '#ffffff', intensity: 1 },
    accentA: 'orange',
    accentB: 'cyan',
    rain: 0,
    seed: 7,
  },
};

const byKind = (ps: Placement[], kind: Placement['kind']) => ps.filter((p) => p.kind === kind);

describe('planLevel', () => {
  const plan = planLevel(base, { dressing: [] });
  const grid = new TileGrid(base.map);
  const st = (c: number, r: number) => (grid.inBounds(c, r) ? plan.storeys[r * grid.width + c] : 0);

  it('keeps explicit storeys where nothing walkable is to the north', () => {
    expect(st(1, 1)).toBe(5);
    expect(st(2, 1)).toBe(2);
    expect(st(4, 1)).toBe(3);
  });

  it('clamps building height by the distance to the street to the north', () => {
    const map = ['3333', '....', '6666', '6..6', '6666', '6666', '6666', '6666'];
    const p = planLevel({ ...base, map, spawn: { at: [1, 1], facing: 'N' } }, { dressing: [] });
    const g = new TileGrid(map);
    const s = (c: number, r: number) => p.storeys[r * g.width + c];
    expect(s(0, 0)).toBe(3); // nothing walkable to the north
    expect(s(1, 2)).toBe(1); // right behind the street
    expect(s(0, 3)).toBe(1); // 2 tiles from the street
    expect(s(1, 4)).toBe(1); // right behind the inner street
    expect(s(0, 4)).toBe(1); // 3 tiles from the street: in the camera frame whatever its height
    expect(s(0, 6)).toBe(2); // 5 tiles from the street
    expect(s(0, 7)).toBe(4); // 6 tiles from the street
    expect(s(1, 7)).toBe(1); // 4 tiles from the inner street
    g.forEach((c, r, kind) => {
      if (kind === 'building') expect(s(c, r)).toBe(clampStoreys(g.explicitStoreys(c, r)!, g.northWalkDistance(c, r)));
    });
  });

  it('puts one facade module on every exposed visible face of every storey', () => {
    const facades = byKind(plan.placements, 'facade');
    const key = (x: number, y: number, z: number) => `${x.toFixed(2)}|${y.toFixed(2)}|${z.toFixed(2)}`;
    const placed = new Map<string, number>();
    for (const p of facades) placed.set(key(p.x, p.y, p.z), (placed.get(key(p.x, p.y, p.z)) ?? 0) + 1);
    let expected = 0;
    grid.forEach((c, r, kind) => {
      if (kind !== 'building') return;
      for (const f of FACINGS) {
        if (f === 'N') continue;
        const from = st(c + DIRS[f].dc, r + DIRS[f].dr);
        for (let s = from; s < st(c, r); s++) {
          expected++;
          const k = key(c * 2 + DIRS[f].dc, s * 3, r * 2 + DIRS[f].dr);
          expect(placed.get(k), `face ${c},${r} ${f} storey ${s}`).toBe(1);
        }
      }
    });
    expect(facades.length).toBe(expected);
    for (const p of facades) {
      const ground = p.y === 0;
      expect((ground ? GROUND_MODULES : UPPER_MODULES) as readonly string[]).toContain(p.asset);
      expect(p.occluder).toBe(true);
    }
  });

  it('caps every building with a roof and parapets on exposed roof edges', () => {
    const roofs = byKind(plan.placements, 'roof');
    let buildings = 0;
    grid.forEach((c, r, k) => k === 'building' && buildings++);
    expect(roofs.length).toBe(buildings);
    const tall = roofs.find((p) => p.x === 2 && p.z === 2)!;
    expect(tall.y).toBe(15);
    expect(byKind(plan.placements, 'parapet').length).toBeGreaterThan(0);
  });

  it('puts corners on convex corners', () => {
    // the 5-storey tile (1,1) towers over its neighbours: it has corners up to the top
    const corners = byKind(plan.placements, 'corner').filter((p) => Math.abs(p.x - 3) < 1e-6 && Math.abs(p.z - 3) < 1e-6);
    expect(corners.length).toBeGreaterThan(0);
  });

  it('fences every walkable/void edge with a railing and fills low blocks', () => {
    const railings = byKind(plan.placements, 'railing');
    let edges = 0;
    grid.forEach((c, r) => {
      if (!grid.walkable(c, r)) return;
      for (const f of FACINGS) if (grid.isVoid(c + DIRS[f].dc, r + DIRS[f].dr)) edges++;
    });
    expect(railings.length).toBe(edges);
    expect(railings.every((p) => p.z === 9)).toBe(true); // south edge of row 4
    const low = byKind(plan.placements, 'low');
    expect(low).toHaveLength(1);
    expect(low[0]).toMatchObject({ x: 4, z: 6 });
  });

  it('adds props with catalog colliders and lights, honouring solid: false', () => {
    expect(byKind(plan.placements, 'prop')).toHaveLength(3);
    const barrel = propInfo('barrel').collider;
    expect(plan.circles).toEqual([{ x: 8, z: 8, r: barrel?.kind === 'circle' ? barrel.r : -1 }]);
    expect(plan.boxes).toHaveLength(0); // the crate is not solid, the wall lamp is wall-mounted
    const sources = plan.lights.map((l) => l.source.split(':')[0].split('#')[0]);
    expect(sources).toEqual(['light', 'sign', 'prop']); // sorted by priority
  });

  it('puts the box of a wall-mounted prop made solid in front of its mount plane, like its mesh', () => {
    const post = planLevel({ ...base, props: [{ asset: 'pipe_v', at: [4, 4], scale: 2, solid: true }] }, { dressing: [] });
    const [sx, , sz] = propInfo('pipe_v').size;
    expect(post.boxes).toHaveLength(1);
    const b = post.boxes[0];
    expect([b.minX, b.maxX, b.minZ, b.maxZ].map((v) => +v.toFixed(6))).toEqual([8 - sx, 8 + sx, 8, 8 + 2 * sz]);
  });

  it('is deterministic for a seed', () => {
    const again = planLevel(base, { dressing: [] });
    expect(again.placements).toEqual(plan.placements);
    const other = planLevel({ ...base, mood: { ...base.mood, seed: 8 } }, { dressing: [] });
    expect(other.placements.map((p) => p.asset)).not.toEqual(plan.placements.map((p) => p.asset));
  });

  it('gives every building lot a tint', () => {
    for (let i = 0; i < plan.lotOf.length; i++) {
      const lot = plan.lotOf[i];
      if (lot >= 0) expect(plan.lots[lot].tint).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('backs a terminal on a tile centre onto the wall behind it', () => {
    const pose = terminalPose(grid, { at: [2, 2], facing: 'S' });
    expect(pose.z).toBeLessThan(4);
    expect(pose.yaw).toBe(0);
    const free = terminalPose(grid, { at: [2.5, 3], facing: 'E' });
    expect(free).toMatchObject({ x: 5, z: 6 });
  });
});

describe.each(LEVELS.map((l) => [l.id, l] as const))('level %s plan', (_id, level) => {
  const plan = planLevel(level.layout);

  it('keeps automatic street clutter on walkable tiles and away from gameplay spots', () => {
    const spots = gameplaySpots(level.layout);
    for (const p of plan.placements) {
      if (p.kind !== 'dressing' || (propInfo(p.asset).mount ?? 'ground') !== 'ground' || p.y > 0.1) continue;
      expect(plan.grid.walkable(Math.round(p.x / 2), Math.round(p.z / 2)), `${p.asset} at ${p.x},${p.z}`).toBe(true);
      for (const s of spots) expect(Math.hypot(s.x - p.x, s.z - p.z), `${p.asset} near a spot`).toBeGreaterThan(s.r);
    }
  });

  it('keeps rooftop clutter under the camera height clamp', () => {
    const roofProps = plan.placements.filter((p) => p.kind === 'dressing' && propInfo(p.asset).mount === 'roof');
    expect(roofProps.length).toBeGreaterThan(0);
    for (const p of roofProps) {
      const dist = plan.grid.northWalkDistance(Math.round(p.x / 2), Math.round(p.z / 2));
      if (dist === null) continue;
      expect(p.y + propInfo(p.asset).size[1], `${p.asset} at ${p.x},${p.z}`).toBeLessThanOrEqual(maxBuildingHeight(dist));
    }
  });

  it('stays within the light budget order (layout lights first)', () => {
    const pr = plan.lights.map((l) => l.priority);
    expect([...pr].sort((a, b) => a - b)).toEqual(pr);
  });

  it('lets the robot reach every terminal, NPC, chip, zone and the exit — and the gate blocks the exit', () => {
    expect(checkLayout(level, plan)).toEqual([]);
  });
});
