/**
 * Tile grid queries and tile ↔ world conversion. Pure (no three.js).
 *
 * Tile (col, row) is centred at world (col·TILE, row·TILE) and covers ±TILE/2 around it.
 * Rows grow to the south (+Z); the camera looks north (−Z).
 */
import { isWalkable, STORY, TILE, tileKind, type Facing, type TileKind, type TilePos } from '../content/types';
import { CAMERA } from '../engine/cameraParams';

export const HALF = TILE / 2;

/** Unit offsets (in tiles) per facing: N = −row, S = +row, E = +col, W = −col. */
export const DIRS: Record<Facing, { dc: number; dr: number }> = {
  N: { dc: 0, dr: -1 },
  E: { dc: 1, dr: 0 },
  S: { dc: 0, dr: 1 },
  W: { dc: -1, dr: 0 },
};

export const FACINGS: readonly Facing[] = ['N', 'E', 'S', 'W'];

/** three.js yaw for something whose front (+Z) should face `f`. */
export function facingToYaw(f: Facing): number {
  switch (f) {
    case 'S':
      return 0;
    case 'E':
      return Math.PI / 2;
    case 'N':
      return Math.PI;
    case 'W':
      return -Math.PI / 2;
  }
}

/** Layout yaw (degrees, clockwise seen from above, 0 = front faces south) → three.js yaw. */
export function layoutRotToYaw(deg = 0): number {
  return (-deg * Math.PI) / 180;
}

export function tileToWorld(col: number, row: number): { x: number; z: number } {
  return { x: col * TILE, z: row * TILE };
}

export function worldToTile(x: number, z: number): { col: number; row: number } {
  return { col: x / TILE, row: z / TILE };
}

/** Integer tile containing a (fractional) tile position. */
export function tileIndex(pos: TilePos | { col: number; row: number }): { col: number; row: number } {
  const [col, row] = 'col' in pos ? [pos.col, pos.row] : pos;
  return { col: Math.round(col), row: Math.round(row) };
}

/** Parapet on top of the last storey (`roof_parapet`, 0.4 m high). */
export const ROOF_PARAPET = 0.4;

const DEG = Math.PI / 180;

/**
 * Camera rule (design doc §4a): the highest point (parapet, roof props) a building may reach `distanceTiles`
 * south of the nearest walkable tile in the same column, derived from the follow camera rig. With the robot
 * at the south edge of that walkable tile: (a) at the design distance and pitch the building's north face
 * stays below the bottom plane of the view frustum, so it never pushes into the frame (the camera is only
 * ~14 m up; a roof just under it fills the screen); (b) zooming out slides the camera south along its
 * pitch line, which must pass over the roof, not through it. Rows ≤ 4 tiles away fit no storey at all.
 */
export function maxBuildingHeight(distanceTiles: number): number {
  const pitch = CAMERA.pitchDeg * DEG;
  const face = (distanceTiles - 1) * TILE; // robot at its tile's south edge → the building's north face
  const camY = CAMERA.targetY + Math.sin(pitch) * CAMERA.distance;
  const camBack = Math.cos(pitch) * CAMERA.distance; // how far south of the robot the camera hangs
  const underFrame = camY - (camBack - face) * Math.tan(pitch + (CAMERA.fov * DEG) / 2);
  const underCamera = CAMERA.targetY + face * Math.tan(pitch) - CAMERA.near;
  return Math.min(underFrame, underCamera);
}

/** Storeys after the camera clamp (never below 1). `distanceTiles` null = nothing walkable to the north. */
export function clampStoreys(requested: number, distanceTiles: number | null): number {
  if (distanceTiles === null) return Math.max(1, requested);
  const allowed = Math.floor((maxBuildingHeight(distanceTiles) - ROOF_PARAPET) / STORY + 1e-6);
  return Math.max(1, Math.min(requested, allowed));
}

export class TileGrid {
  readonly width: number;
  readonly height: number;
  private readonly rows: readonly string[];
  private readonly kinds: TileKind[];

  constructor(map: readonly string[]) {
    this.rows = map;
    this.height = map.length;
    this.width = map.reduce((w, r) => Math.max(w, r.length), 0);
    this.kinds = new Array(this.width * this.height);
    for (let r = 0; r < this.height; r++) {
      for (let c = 0; c < this.width; c++) this.kinds[r * this.width + c] = tileKind(map[r][c] ?? ' ');
    }
  }

  inBounds(col: number, row: number): boolean {
    return col >= 0 && row >= 0 && col < this.width && row < this.height;
  }

  char(col: number, row: number): string {
    if (!this.inBounds(col, row)) return ' ';
    return this.rows[row][col] ?? ' ';
  }

  /** Kind of an integer tile; outside the map is void. */
  kind(col: number, row: number): TileKind {
    if (!this.inBounds(col, row)) return 'void';
    return this.kinds[row * this.width + col];
  }

  walkable(col: number, row: number): boolean {
    return isWalkable(this.kind(col, row));
  }

  /** Blocks movement: buildings, low blocks, void and everything outside the map. */
  solid(col: number, row: number): boolean {
    return !this.walkable(col, row);
  }

  isBuilding(col: number, row: number): boolean {
    return this.kind(col, row) === 'building';
  }

  isVoid(col: number, row: number): boolean {
    return this.kind(col, row) === 'void';
  }

  /** Storey count written in the map ('1'..'6'), or null for '#'. */
  explicitStoreys(col: number, row: number): number | null {
    const ch = this.char(col, row);
    return ch >= '1' && ch <= '6' ? Number(ch) : null;
  }

  /** Tiles from this tile to the nearest walkable tile to the north in the same column, or null. */
  northWalkDistance(col: number, row: number): number | null {
    for (let r = row - 1; r >= 0; r--) if (this.walkable(col, r)) return row - r;
    return null;
  }

  /** Walkable tile at a fractional tile position (rounded). */
  walkableAt(pos: TilePos): boolean {
    const { col, row } = tileIndex(pos);
    return this.walkable(col, row);
  }

  neighbour(col: number, row: number, f: Facing): { col: number; row: number } {
    return { col: col + DIRS[f].dc, row: row + DIRS[f].dr };
  }

  forEach(fn: (col: number, row: number, kind: TileKind) => void): void {
    for (let r = 0; r < this.height; r++) for (let c = 0; c < this.width; c++) fn(c, r, this.kinds[r * this.width + c]);
  }

  /** World-space bounds of the whole map. */
  bounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
    return { minX: -HALF, minZ: -HALF, maxX: (this.width - 1) * TILE + HALF, maxZ: (this.height - 1) * TILE + HALF };
  }

  /** World-space bounds of the walkable tiles (where the camera may follow the robot). */
  walkBounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
    let c0 = Infinity;
    let c1 = -Infinity;
    let r0 = Infinity;
    let r1 = -Infinity;
    this.forEach((c, r, k) => {
      if (!isWalkable(k)) return;
      c0 = Math.min(c0, c);
      c1 = Math.max(c1, c);
      r0 = Math.min(r0, r);
      r1 = Math.max(r1, r);
    });
    if (c0 === Infinity) return this.bounds();
    return { minX: c0 * TILE - HALF, maxX: c1 * TILE + HALF, minZ: r0 * TILE - HALF, maxZ: r1 * TILE + HALF };
  }
}
