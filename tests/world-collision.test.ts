import { describe, expect, it } from 'vitest';
import { ColliderSet, isFree, moveCircle, nearestFreeSpot, rotatedFootprint, TileCollider } from '../src/world/collision';
import { TileGrid } from '../src/world/tiles';

const R = 0.45;

describe('moveCircle', () => {
  it('stops at the wall', () => {
    const set = new ColliderSet();
    set.addBox({ minX: 2, minZ: -5, maxX: 3, maxZ: 5 });
    const res = moveCircle([set], 0, 0, 3, 0, R);
    expect(res.blocked).toBe(true);
    expect(res.x).toBeCloseTo(2 - R, 3);
    expect(res.z).toBeCloseTo(0, 6);
  });

  it('slides along a wall when moving diagonally', () => {
    const set = new ColliderSet();
    set.addBox({ minX: 1, minZ: -10, maxX: 2, maxZ: 10 });
    const res = moveCircle([set], 0, 0, 2, -2, R);
    expect(res.x).toBeCloseTo(1 - R, 3);
    expect(res.z).toBeCloseTo(-2, 3);
  });

  it('does not tunnel through a thin collider on a long step', () => {
    const set = new ColliderSet();
    set.addBox({ minX: 1, minZ: -5, maxX: 1.05, maxZ: 5 });
    const res = moveCircle([set], 0, 0, 5, 0, R);
    expect(res.x).toBeLessThan(1);
  });

  it('pushes a circle out of a box it starts inside of', () => {
    const set = new ColliderSet();
    set.addBox({ minX: -1, minZ: -1, maxX: 1, maxZ: 3 });
    const res = moveCircle([set], 0.8, 0, 0, 0, R);
    expect(res.x).toBeCloseTo(1 + R, 3);
  });

  it('keeps circles apart', () => {
    const set = new ColliderSet();
    set.addCircle({ x: 1, z: 0, r: 0.4 });
    const res = moveCircle([set], 0, 0, 1, 0, R);
    expect(Math.hypot(res.x - 1, res.z)).toBeGreaterThanOrEqual(R + 0.4 - 1e-4);
  });

  it('can remove colliders (an opening gate)', () => {
    const set = new ColliderSet();
    const key = set.addBox({ minX: 1, minZ: -2, maxX: 1.4, maxZ: 2 }, 'gate');
    expect(moveCircle([set], 0, 0, 3, 0, R).x).toBeLessThan(1);
    set.remove(key);
    expect(moveCircle([set], 0, 0, 3, 0, R).x).toBeCloseTo(3);
  });
});

describe('TileCollider', () => {
  const grid = new TileGrid([
    '#####', //
    '#...#',
    '#...#',
    '     ',
  ]);
  const tiles = new TileCollider(grid, 0.2);

  it('keeps the robot inside walkable tiles and away from padded buildings', () => {
    // start in the middle of tile (2, 1) = world (4, 2), drive north into the building row
    const north = moveCircle([tiles], 4, 2, 0, -5, R);
    expect(north.z).toBeCloseTo(1 + 0.2 + R, 3); // building edge z = 1, pad 0.2
    // drive south into the void row (row 3 starts at z = 5): no pad on void
    const south = moveCircle([tiles], 4, 4, 0, 5, R);
    expect(south.z).toBeCloseTo(5 - R, 3);
  });

  it('reports free and blocked spots', () => {
    expect(isFree([tiles], 4, 3, R)).toBe(true);
    expect(isFree([tiles], 4, 0.5, R)).toBe(false);
  });
});

describe('nearestFreeSpot (debug teleport)', () => {
  // row 0 buildings, rows 1–2 street, row 3 void; a barrel on the street at (6, 4)
  const grid = new TileGrid(['####', '....', '....', '    ']);
  const props = new ColliderSet();
  props.addCircle({ x: 6, z: 4, r: 0.4 });
  const sources = [new TileCollider(grid), props];
  const free = (p: { x: number; z: number } | null) => !!p && grid.walkable(Math.round(p.x / 2), Math.round(p.z / 2)) && isFree(sources, p.x, p.z, R);

  it('keeps a free spot as it is', () => {
    expect(nearestFreeSpot(grid, sources, 2, 3, R)).toEqual({ x: 2, z: 3 });
  });

  it('pulls a spot on a building, in the void or off the map onto the nearest walkable ground', () => {
    for (const [x, z] of [
      [2, 0], // inside a building
      [4, 6.5], // over the void
      [-9, 3], // off the map to the west
      [3, 1.1], // in the building padding
    ]) {
      const p = nearestFreeSpot(grid, sources, x, z, R);
      expect(free(p), `${x},${z} → ${JSON.stringify(p)}`).toBe(true);
      expect(Math.hypot(p!.x - x, p!.z - z)).toBeLessThan(Math.max(3, Math.abs(x) + 2));
    }
  });

  it('steps off a prop', () => {
    const p = nearestFreeSpot(grid, sources, 6, 4, R);
    expect(free(p)).toBe(true);
    expect(Math.hypot(p!.x - 6, p!.z - 4)).toBeLessThan(1.2);
  });

  it('gives up on a map with nothing walkable', () => {
    expect(nearestFreeSpot(new TileGrid(['##', '##']), [], 1, 1, R)).toBeNull();
  });
});

describe('rotatedFootprint', () => {
  it('swaps extents at 90°', () => {
    const box = rotatedFootprint(0, 0, Math.PI / 2, 2, 1);
    expect(box.maxX - box.minX).toBeCloseTo(1);
    expect(box.maxZ - box.minZ).toBeCloseTo(2);
  });

  it('rotates offsets with the prop', () => {
    // local offset +Z by 1 with yaw 90° → world +X
    const box = rotatedFootprint(10, 10, Math.PI / 2, 0.5, 0.5, 0, 1);
    expect((box.minX + box.maxX) / 2).toBeCloseTo(11);
    expect((box.minZ + box.maxZ) / 2).toBeCloseTo(10);
  });
});
