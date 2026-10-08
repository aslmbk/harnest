import { describe, expect, it } from 'vitest';
import { STORY, TILE } from '../src/content/types';
import { CAMERA } from '../src/engine/cameraParams';
import {
  clampStoreys,
  facingToYaw,
  layoutRotToYaw,
  maxBuildingHeight,
  ROOF_PARAPET,
  TileGrid,
  tileIndex,
  tileToWorld,
  worldToTile,
} from '../src/world/tiles';

const MAP = [
  '##3##', //
  '#...#',
  '#.o.#',
  '#,=.#',
  '     ',
];

describe('TileGrid', () => {
  const grid = new TileGrid(MAP);

  it('reads kinds and treats the outside as void', () => {
    expect(grid.width).toBe(5);
    expect(grid.height).toBe(5);
    expect(grid.kind(0, 0)).toBe('building');
    expect(grid.kind(2, 0)).toBe('building');
    expect(grid.kind(1, 1)).toBe('floor');
    expect(grid.kind(1, 3)).toBe('floorWet');
    expect(grid.kind(2, 3)).toBe('grate');
    expect(grid.kind(2, 2)).toBe('lowBlock');
    expect(grid.kind(2, 4)).toBe('void');
    expect(grid.kind(-1, 2)).toBe('void');
    expect(grid.kind(9, 9)).toBe('void');
  });

  it('knows what is walkable and solid', () => {
    expect(grid.walkable(1, 1)).toBe(true);
    expect(grid.walkable(2, 3)).toBe(true);
    expect(grid.solid(2, 2)).toBe(true);
    expect(grid.solid(0, 1)).toBe(true);
    expect(grid.solid(3, 4)).toBe(true);
    expect(grid.solid(-1, -1)).toBe(true);
  });

  it('reads explicit storeys', () => {
    expect(grid.explicitStoreys(2, 0)).toBe(3);
    expect(grid.explicitStoreys(0, 0)).toBeNull();
  });

  it('measures the distance to the nearest walkable tile to the north', () => {
    const g = new TileGrid(['...', '#.#', '#.#', '###']);
    expect(g.northWalkDistance(0, 1)).toBe(1);
    expect(g.northWalkDistance(0, 3)).toBe(3);
    expect(g.northWalkDistance(1, 3)).toBe(1);
    expect(new TileGrid(['#', '#']).northWalkDistance(0, 1)).toBeNull();
  });
});

describe('camera height clamp', () => {
  it('grows with the distance to the street to the north', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => clampStoreys(6, d))).toEqual([1, 1, 1, 1, 2, 4, 5, 5, 6]);
    expect(clampStoreys(2, 9)).toBe(2);
  });

  it('keeps roofs out of the follow camera frame and under its zoom path', () => {
    // robot at the south edge of its tile; the camera hangs on the pitch line through the look-at point
    const pitch = (CAMERA.pitchDeg * Math.PI) / 180;
    const bottomRay = pitch + (CAMERA.fov / 2) * (Math.PI / 180); // below the horizon
    const camAt = (dist: number) => ({ back: Math.cos(pitch) * dist, y: CAMERA.targetY + Math.sin(pitch) * dist });
    for (let d = 1; d <= 9; d++) {
      const n = clampStoreys(6, d);
      const top = n * STORY + ROOF_PARAPET;
      const face = (d - 1) * TILE; // the building's north face, south of the robot
      if (top > maxBuildingHeight(d)) {
        expect(n, `d=${d}: only the minimum storey may stick out`).toBe(1);
        continue;
      }
      const cam = camAt(CAMERA.distance);
      if (cam.back > face) expect(Math.atan2(cam.y - top, cam.back - face), `d=${d} in frame`).toBeGreaterThanOrEqual(bottomRay - 1e-9);
      for (let dist = CAMERA.minDistance; dist <= CAMERA.maxDistance; dist += 0.25) {
        const c = camAt(dist);
        if (c.back >= face) expect(c.y - top, `d=${d}: camera at ${dist} m clears the roof`).toBeGreaterThanOrEqual(CAMERA.near - 1e-9);
      }
    }
    // the case from l1–l3: four storeys five tiles south of a yard would reach up into the frame
    expect(4 * STORY + ROOF_PARAPET).toBeGreaterThan(maxBuildingHeight(5));
  });

  it('leaves buildings with nothing walkable to the north alone and never goes below one storey', () => {
    expect(clampStoreys(5, null)).toBe(5);
    expect(clampStoreys(0, null)).toBe(1);
  });
});

describe('coordinates', () => {
  it('converts tile ↔ world (1 tile = 2 m)', () => {
    expect(tileToWorld(3, 2)).toEqual({ x: 6, z: 4 });
    expect(worldToTile(7, 3)).toEqual({ col: 3.5, row: 1.5 });
    expect(tileIndex([3.4, 1.6])).toEqual({ col: 3, row: 2 });
  });

  it('turns facings into yaws that point the +Z front the right way', () => {
    const front = (yaw: number) => [Math.round(Math.sin(yaw)) + 0, Math.round(Math.cos(yaw)) + 0];
    expect(front(facingToYaw('S'))).toEqual([0, 1]);
    expect(front(facingToYaw('N'))).toEqual([0, -1]);
    expect(front(facingToYaw('E'))).toEqual([1, 0]);
    expect(front(facingToYaw('W'))).toEqual([-1, 0]);
  });

  it('reads layout rotation as clockwise degrees seen from above', () => {
    const front = (yaw: number) => [Math.round(Math.sin(yaw)) + 0, Math.round(Math.cos(yaw)) + 0];
    expect(front(layoutRotToYaw(0))).toEqual([0, 1]);
    expect(front(layoutRotToYaw(90))).toEqual([-1, 0]); // south → west
    expect(front(layoutRotToYaw(180))).toEqual([0, -1]);
  });

  it('measures the walkable area for the camera, ignoring buildings and void around it', () => {
    const grid = new TileGrid(['#####', '#..=#', '#.,.#', '     ']);
    expect(grid.bounds()).toEqual({ minX: -1, minZ: -1, maxX: 9, maxZ: 7 });
    expect(grid.walkBounds()).toEqual({ minX: 1, minZ: 1, maxX: 7, maxZ: 5 });
    expect(new TileGrid(['##', '  ']).walkBounds()).toEqual(new TileGrid(['##', '  ']).bounds());
  });
});
