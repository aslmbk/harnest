/**
 * Static level geometry. Every placement of the plan is baked (world space) into a few batched meshes
 * that share one attribute-driven material (`render/staticMaterial.ts`). Each placement is its own range
 * in a `BatchedMesh`, so every pass (main camera, puddle reflection, shadow map) culls placement by
 * placement against its own frustum; visible ranges that touch in the buffer are drawn together, and the
 * buffer is ordered south → north, row by row, so what one view sees is mostly contiguous.
 *
 * Classes, and which pass renders them (`render/layers.ts`):
 *  - big     facades, corners, roofs, parapets without emission          → main camera only
 *  - detail  props and dressing with open or thin shapes (railings, vines, lamps, antennas…)
 *                                                                          → main, reflection, shadow
 *  - props   chunky props (crates, barrels, AC units…), flat ones (manholes) and building modules
 *            with lit parts (windows, lamps, neon)                         → main, reflection
 *  - roof    rooftop clutter with open shapes (dishes, antennas)          → main, shadow
 *            (boxy rooftop clutter goes to `big` and casts through its proxy: no puddle ever shows a
 *            roof — the mirrored rays that climb that high have left the view)
 *  - proxies the bounding box of every chunky prop                         → shadow camera only
 *  - stand-in  one flat quad per facade module, behind its relief (z = −0.26), in the wall tint
 *                                                                          → street reflection only
 *  - blocks  closed boxes of every building column                        → shadow camera only
 *
 * So the puddles mirror lit windows, neon, props and wall-coloured silhouettes at a fraction of the
 * cost, and shadows come from closed boxes (buildings, chunky props) instead of the full relief.
 * Side facades (facing east or west) whose front faces away from the camera are skipped (`cullFacing`).
 * Per-vertex data: position, normal, and the surface bytes `sc` / `se` / `sm` (see staticMaterial).
 */
import * as THREE from 'three/webgpu';
import { STORY, TILE } from '../content/types';
import type { AssetLibrary, AssetPart } from '../engine/assets';
import { LAYER, setObjectLayers } from '../render/layers';
import { EMISSIVE_SCALE, type MaterialLibrary } from '../render/materials';
import type { MatSpec } from '../render/palette';
import { emptySurface, STATIC_KIND, staticMaterial, surfaceBytes, type StaticKind, type SurfaceBytes } from '../render/staticMaterial';
import type { LevelPlan, Placement } from './levelPlan';
import { propInfo } from './propCatalog';
import { rand01 } from './rng';
import { DIRS, FACINGS, HALF } from './tiles';

/** Chunky props: their shadow is cast by their bounding box (12 triangles instead of hundreds). */
const SHADOW_BOX = new Set([
  'crate', 'crate_stack', 'barrel', 'dumpster', 'vending', 'trash_bags', 'tires', 'cable_spool', 'crt_stack', 'plant_pot',
  'ac_unit', 'roof_ac', 'water_tank', 'roof_vent', 'fuse_box', 'pipe_v', 'pipe_h', 'wall_lamp', 'awning', 'stall',
  'low_barrier', 'low_planter', 'low_crates', 'locomotive',
]);
/** Flat or self-lit props that cast no shadow. */
const SHADOW_NONE = new Set(['manhole', 'steam_vent', 'lantern', 'rail_straight', 'turntable']);
// Everything else casts with its full mesh: open or thin shapes (bench, streetlamp, vines, antenna, dish…).
/** A side facade is drawn while the camera is at most this far behind its wall plane (relief depth). */
const FACING_MARGIN = 0.35;

/** Materials whose colour gets the building tint. */
const TINTED = new Set(['M_Wall']);
const WINDOWS = new Set(['M_WindowLit', 'M_WindowLitCool']);
/** Emissive parts that blink like aircraft beacons, per asset. */
const BEACONS: Readonly<Record<string, readonly string[]>> = { antenna: ['M_NeonRed'], gantry_crane: ['M_NeonOrange'] };
const BIG_KINDS = new Set<Placement['kind']>(['facade', 'corner', 'roof', 'parapet']);
/** Facade relief stays within z ∈ [−0.25, 0.30]: the reflection stand-in sits just behind it. */
const STANDIN_Z = -0.26;

type AnyAttr = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

class Grow<T extends Float32Array | Uint8Array | Uint32Array> {
  data: T;
  length = 0;
  constructor(
    private readonly make: (n: number) => T,
    initial = 1024,
  ) {
    this.data = make(initial);
  }
  reserve(extra: number): void {
    if (this.length + extra <= this.data.length) return;
    let n = this.data.length * 2;
    while (n < this.length + extra) n *= 2;
    const next = this.make(n);
    next.set(this.data.subarray(0, this.length));
    this.data = next;
  }
  push3(a: number, b: number, c: number): void {
    this.reserve(3);
    this.data[this.length++] = a;
    this.data[this.length++] = b;
    this.data[this.length++] = c;
  }
  push4(a: readonly number[]): void {
    this.reserve(4);
    this.data[this.length++] = a[0];
    this.data[this.length++] = a[1];
    this.data[this.length++] = a[2];
    this.data[this.length++] = a[3];
  }
  push(v: number): void {
    this.reserve(1);
    this.data[this.length++] = v;
  }
  view(): T {
    return this.data.subarray(0, this.length) as T;
  }
}

/** Growable vertex / index buffers in the static vertex format (also used to bake entities). */
export class Batch {
  readonly pos = new Grow((n) => new Float32Array(n));
  readonly nor = new Grow((n) => new Float32Array(n));
  readonly sc = new Grow((n) => new Uint8Array(n));
  readonly se = new Grow((n) => new Uint8Array(n));
  readonly sm = new Grow((n) => new Uint8Array(n));
  readonly index = new Grow((n) => new Uint32Array(n));
  vertices = 0;

  constructor(
    readonly name: string,
    readonly layers: readonly number[],
    readonly castShadow: boolean,
  ) {}

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, s: SurfaceBytes): void {
    this.pos.push3(x, y, z);
    this.nor.push3(nx, ny, nz);
    this.sc.push4(s.sc);
    this.se.push4(s.se);
    this.sm.push4(s.sm);
    this.vertices++;
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.index.push3(a, b, c);
    this.index.push3(a, c, d);
  }

  get triangles(): number {
    return this.index.length / 3;
  }

  geometry(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos.view().slice(), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(this.nor.view().slice(), 3));
    geo.setAttribute('sc', new THREE.BufferAttribute(this.sc.view().slice(), 4, true));
    geo.setAttribute('se', new THREE.BufferAttribute(this.se.view().slice(), 4, true));
    geo.setAttribute('sm', new THREE.BufferAttribute(this.sm.view().slice(), 4, true));
    const idx = this.index.view();
    geo.setIndex(this.vertices > 65535 ? new THREE.BufferAttribute(idx.slice(), 1) : new THREE.BufferAttribute(Uint16Array.from(idx), 1));
    return geo;
  }

  build(): THREE.Mesh {
    const geo = this.geometry();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, staticMaterial());
    mesh.name = this.name;
    mesh.castShadow = this.castShadow;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    setObjectLayers(mesh, ...this.layers);
    return mesh;
  }
}

export interface StaticBuild {
  group: THREE.Group;
  /** Triangles per class (main pass = big + detail + props + roof). */
  triangles: { big: number; detail: number; props: number; roof: number; proxies: number; standin: number; blocks: number };
  vertices: number;
  /** Placement ranges in the batches (big + detail). */
  ranges: number;
  /** Hide side facades whose front faces away from `camera` (perspective cameras only). */
  cullFacing(camera: THREE.Camera): void;
}

type MultiDraw = {
  _multiDrawStarts: Int32Array;
  _multiDrawCounts: Int32Array;
  _multiDrawCount: number;
  _multiDrawBytesPerElement: number;
};

/**
 * A BatchedMesh whose visible ranges are merged when they follow each other in the index buffer:
 * one draw per run of neighbouring placements instead of one per placement. All instance matrices are
 * identity (the geometry is already in world space), so a merged draw needs no per-range data.
 * Relies on three r186 internals (the draw list `onBeforeRender` fills in for the backend); if they are
 * gone, nothing is merged: still correct, just one draw per visible placement.
 */
class StaticBatch extends THREE.BatchedMesh {
  override onBeforeRender(...args: Parameters<THREE.BatchedMesh['onBeforeRender']>): void {
    super.onBeforeRender(...args);
    const md = this as unknown as Partial<MultiDraw>;
    const n = md._multiDrawCount;
    if (typeof n !== 'number' || n < 2 || !md._multiDrawStarts || !md._multiDrawCounts || !md._multiDrawBytesPerElement) return;
    const starts = md._multiDrawStarts;
    const counts = md._multiDrawCounts;
    const bpe = md._multiDrawBytesPerElement;
    let w = 0;
    for (let i = 1; i < n; i++) {
      if (starts[w] + counts[w] * bpe === starts[i]) counts[w] += counts[i];
      else {
        w++;
        starts[w] = starts[i];
        counts[w] = counts[i];
      }
    }
    md._multiDrawCount = w + 1;
  }
}

type BatchClass = 'big' | 'detail' | 'props' | 'roof';

const CLASS_LAYERS: Record<BatchClass, readonly number[]> = {
  big: [LAYER.MAIN],
  detail: [LAYER.MAIN, LAYER.REFLECT, LAYER.SHADOW],
  props: [LAYER.MAIN, LAYER.REFLECT],
  roof: [LAYER.MAIN, LAYER.SHADOW],
};

interface Piece {
  cls: BatchClass;
  batch: Batch;
  /** Sort key: south → north by tile row, then west → east, then bottom → top. */
  row: number;
  x: number;
  y: number;
  /** Side facades: +1 faces east (+X), −1 faces west; 0 = not culled by facing. */
  facing: number;
  wallX: number;
}

export class StaticMerger {
  private readonly items: { p: Placement; tint: THREE.Color | null; seed: number }[] = [];

  add(p: Placement, tint: THREE.Color | null, seed: number): void {
    this.items.push({ p, tint, seed });
  }

  get count(): number {
    return this.items.length;
  }

  build(assets: AssetLibrary, materials: MaterialLibrary, plan: LevelPlan | null = null): StaticBuild {
    const standin = new Batch('static:standin', [LAYER.REFLECT], false);
    const proxies = new Batch('static:proxies', [LAYER.SHADOW], true);
    const boxes = new Map<string, THREE.Box3>();
    const assetBox = (id: string) => {
      let box = boxes.get(id);
      if (!box) {
        box = new THREE.Box3();
        for (const part of assets.parts(id)) {
          part.geometry.computeBoundingBox();
          if (part.geometry.boundingBox) box.union(part.geometry.boundingBox);
        }
        boxes.set(id, box);
      }
      return box;
    };
    const pieces: Piece[] = [];
    const m = new THREE.Matrix4();
    const nm = new THREE.Matrix3();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    const surf = emptySurface();
    const wallSpec = materials.spec('M_Wall');

    for (const { p, tint, seed } of this.items) {
      const s = p.scale ?? 1;
      q.setFromAxisAngle(up, p.rotY);
      m.compose(v.set(p.x, p.y, p.z), q, n.set(s, s, s));
      nm.getNormalMatrix(m);
      const big = BIG_KINDS.has(p.kind);
      const flickers = !big && rand01(seed * 1e6, 41) < 0.3;
      // side facades: the front (+Z) turned by rotY points along (sin, 0, cos)
      const fx = Math.sin(p.rotY);
      const facing = p.kind === 'facade' && Math.abs(fx) > 0.9 ? Math.sign(fx) : 0;
      const own: Partial<Record<BatchClass, Batch>> = {};
      const piece = (cls: BatchClass): Batch => {
        let b = own[cls];
        if (!b) {
          b = own[cls] = new Batch(cls, [], false);
          pieces.push({ cls, batch: b, row: Math.round(p.z / TILE), x: p.x, y: p.y, facing: cls === 'big' ? facing : 0, wallX: p.x });
        }
        return b;
      };
      const shadowBox = !big && SHADOW_BOX.has(p.asset);
      const noShadow = shadowBox || SHADOW_NONE.has(p.asset);
      const onRoof = !big && standsOnRoof(p, plan);
      const propClass: BatchClass = onRoof ? (noShadow ? 'big' : 'roof') : noShadow ? 'props' : 'detail';
      const parts = assets.parts(p.asset);
      const isLit = (name: string) => {
        const spec = materials.spec(p.remap?.[name] ?? name);
        return !!(spec.emissive && spec.strength);
      };
      // a building module with lit parts (windows, lamps) is mirrored whole, so the puddles show the
      // window frames and bars, not just bright rectangles
      const glowing = big && parts.some((part) => isLit(part.matName));
      for (const part of parts) {
        const matName = p.remap?.[part.matName] ?? part.matName;
        const spec = materials.spec(matName);
        const b = piece(big ? (glowing ? 'props' : 'big') : propClass);
        const kind: StaticKind = TINTED.has(part.matName)
          ? STATIC_KIND.wall
          : WINDOWS.has(matName)
            ? STATIC_KIND.window
            : BEACONS[p.asset]?.includes(matName)
              ? STATIC_KIND.beacon
              : flickers && matName.startsWith('M_Neon')
                ? STATIC_KIND.flicker
                : STATIC_KIND.plain;
        appendPart(b, part, m, nm, spec, kind, TINTED.has(part.matName) ? tint : null, seed, !!p.occluder, surf, v, n);
      }
      if (shadowBox) addBox(proxies, assetBox(p.asset), m, wallSpec, surf, v);
      if (p.kind === 'facade') {
        // reflection stand-in: the module's footprint in the wall tint, stretched to meet its neighbours at corners
        const tr = tint ? tint.r : 1;
        const tg = tint ? tint.g : 1;
        const tb = tint ? tint.b : 1;
        surfaceBytes(wallSpec, STATIC_KIND.wall, seed, false, EMISSIVE_SCALE, surf, [tr * 0.8, tg * 0.8, tb * 0.8]);
        const base = standin.vertices;
        n.set(0, 0, 1).applyMatrix3(nm).normalize();
        for (const [lx, ly] of [
          [-1 + STANDIN_Z, 0],
          [1 - STANDIN_Z, 0],
          [1 - STANDIN_Z, STORY],
          [-1 + STANDIN_Z, STORY],
        ]) {
          v.set(lx, ly, STANDIN_Z).applyMatrix4(m);
          standin.vertex(v.x, v.y, v.z, n.x, n.y, n.z, surf);
        }
        standin.quad(base, base + 1, base + 2, base + 3);
      }
    }

    const group = new THREE.Group();
    group.name = 'static';
    const triangles = { big: 0, detail: 0, props: 0, roof: 0, proxies: 0, standin: 0, blocks: 0 };
    let vertices = 0;
    const sided: { batch: THREE.BatchedMesh; id: number; facing: number; wallX: number; shown: boolean }[] = [];
    pieces.sort((a, b) => b.row - a.row || a.x - b.x || a.y - b.y);
    for (const cls of ['big', 'detail', 'props', 'roof'] as const) {
      const list = pieces.filter((pc) => pc.cls === cls && pc.batch.vertices > 0);
      if (!list.length) continue;
      const vcount = list.reduce((a, pc) => a + pc.batch.vertices, 0);
      const icount = list.reduce((a, pc) => a + pc.batch.index.length, 0);
      const batch = new StaticBatch(list.length, vcount, icount, staticMaterial());
      batch.name = `static:${cls}`;
      batch.sortObjects = false; // keep the buffer order (south → north) so neighbours merge
      batch.perObjectFrustumCulled = true;
      for (const pc of list) {
        const geo = pc.batch.geometry();
        const id = batch.addInstance(batch.addGeometry(geo));
        geo.dispose();
        if (pc.facing) sided.push({ batch, id, facing: pc.facing, wallX: pc.wallX, shown: true });
      }
      batch.computeBoundingBox();
      batch.computeBoundingSphere();
      batch.castShadow = CLASS_LAYERS[cls].includes(LAYER.SHADOW);
      batch.receiveShadow = true;
      batch.matrixAutoUpdate = false;
      setObjectLayers(batch, ...CLASS_LAYERS[cls]);
      group.add(batch);
      triangles[cls] = icount / 3;
      vertices += vcount;
    }
    const extra: [keyof typeof triangles, Batch | null][] = [
      ['standin', standin],
      ['proxies', proxies],
      ['blocks', plan ? addShadowBlocks(new Batch('static:blocks', [LAYER.SHADOW], true), plan, wallSpec, surf) : null],
    ];
    for (const [key, b] of extra) {
      if (!b || b.vertices === 0) continue;
      group.add(b.build());
      triangles[key] = b.triangles;
      vertices += b.vertices;
    }
    const pos = new THREE.Vector3();
    return {
      group,
      triangles,
      vertices,
      ranges: pieces.length,
      cullFacing(camera) {
        const persp = (camera as THREE.PerspectiveCamera).isPerspectiveCamera === true;
        camera.getWorldPosition(pos);
        for (const sd of sided) {
          const show = !persp || (sd.facing > 0 ? pos.x > sd.wallX - FACING_MARGIN : pos.x < sd.wallX + FACING_MARGIN);
          if (show !== sd.shown) {
            sd.shown = show;
            sd.batch.setVisibleAt(sd.id, show);
          }
        }
      },
    };
  }
}

/** Appends one asset part, transformed by `m`, with its surface bytes. */
export function appendPart(
  b: Batch,
  part: AssetPart,
  m: THREE.Matrix4,
  nm: THREE.Matrix3,
  spec: MatSpec,
  kind: StaticKind,
  tint: THREE.Color | null,
  seed: number,
  occluder: boolean,
  surf: SurfaceBytes,
  v: THREE.Vector3,
  n: THREE.Vector3,
): void {
  const g = part.geometry;
  const p = g.getAttribute('position') as AnyAttr;
  const nor = g.getAttribute('normal') as AnyAttr | undefined;
  const col = g.getAttribute('color') as AnyAttr | undefined;
  const base = b.vertices;
  const tr = tint ? tint.r : 1;
  const tg = tint ? tint.g : 1;
  const tb = tint ? tint.b : 1;
  const scale: [number, number, number] = [tr, tg, tb];
  surfaceBytes(spec, kind, seed, occluder, EMISSIVE_SCALE, surf, scale);
  const count = p.count;
  b.pos.reserve(count * 3);
  b.nor.reserve(count * 3);
  for (let k = 0; k < count; k++) {
    if (col) {
      scale[0] = col.getX(k) * tr;
      scale[1] = col.getY(k) * tg;
      scale[2] = col.getZ(k) * tb;
      surfaceBytes(spec, kind, seed, occluder, EMISSIVE_SCALE, surf, scale);
    }
    v.fromBufferAttribute(p, k).applyMatrix4(m);
    if (nor) n.fromBufferAttribute(nor, k).applyMatrix3(nm).normalize();
    else n.set(0, 1, 0);
    b.vertex(v.x, v.y, v.z, n.x, n.y, n.z, surf);
  }
  if (g.index) {
    const idx = g.index;
    b.index.reserve(idx.count);
    for (let k = 0; k < idx.count; k++) b.index.push(idx.getX(k) + base);
  } else {
    b.index.reserve(count);
    for (let k = 0; k < count; k++) b.index.push(k + base);
  }
}

/** A closed box (outward winding) around `box` placed by `m`: a prop's shadow proxy. */
function addBox(b: Batch, box: THREE.Box3, m: THREE.Matrix4, spec: MatSpec, surf: SurfaceBytes, v: THREE.Vector3): void {
  if (box.isEmpty()) return;
  surfaceBytes(spec, STATIC_KIND.plain, 0, false, EMISSIVE_SCALE, surf);
  const { min, max } = box;
  const base = b.vertices;
  for (let i = 0; i < 8; i++) {
    v.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).applyMatrix4(m);
    b.vertex(v.x, v.y, v.z, 0, 1, 0, surf);
  }
  // faces: −x, +x, −y, +y, −z, +z (counter-clockwise seen from outside)
  b.quad(base + 0, base + 4, base + 6, base + 2);
  b.quad(base + 1, base + 3, base + 7, base + 5);
  b.quad(base + 0, base + 1, base + 5, base + 4);
  b.quad(base + 2, base + 6, base + 7, base + 3);
  b.quad(base + 0, base + 2, base + 3, base + 1);
  b.quad(base + 4, base + 5, base + 7, base + 6);
}

/**
 * Shadow casters for the buildings: the outer walls of every building column (no tops, no bottoms).
 * The shadow pass renders back faces, so a wall facing away from the key light is what casts; faces
 * between two columns are skipped where the neighbour is at least as tall.
 */
/**
 * Rooftop clutter: a prop standing on a building's roof (by the tile under it), or a rooftop prop when
 * there is no plan. A crate hanging from a crane over the yard is not on a roof (it shows in the puddles).
 */
function standsOnRoof(p: Placement, plan: LevelPlan | null): boolean {
  const mount = propInfo(p.asset).mount ?? 'ground';
  if (mount === 'wall' || mount === 'hanging') return false;
  if (!plan) return mount === 'roof' || p.y > 2;
  const c = Math.round(p.x / TILE);
  const r = Math.round(p.z / TILE);
  const storeys = plan.grid.inBounds(c, r) ? plan.storeys[r * plan.grid.width + c] : 0;
  return storeys > 0 && p.y >= storeys * STORY - 0.05;
}

function addShadowBlocks(b: Batch, plan: LevelPlan, spec: MatSpec, surf: SurfaceBytes): Batch {
  const { grid, storeys } = plan;
  const height = (c: number, r: number) => {
    if (!grid.inBounds(c, r)) return 0;
    const s = storeys[r * grid.width + c];
    return s > 0 ? s * STORY + 0.55 : 0;
  };
  surfaceBytes(spec, STATIC_KIND.plain, 0, false, EMISSIVE_SCALE, surf);
  grid.forEach((c, r) => {
    const h = height(c, r);
    if (h <= 0) return;
    const cx = c * TILE;
    const cz = r * TILE;
    for (const f of FACINGS) {
      const d = DIRS[f];
      const lo = height(c + d.dc, r + d.dr);
      if (lo >= h) continue;
      // the face on side f: bottom edge from −t to +t, then up to the column's height
      const ox = cx + d.dc * HALF;
      const oz = cz + d.dr * HALF;
      const tx = -d.dr; // tangent along the face
      const tz = d.dc;
      const base = b.vertices;
      b.vertex(ox - tx * HALF, lo, oz - tz * HALF, d.dc, 0, d.dr, surf);
      b.vertex(ox + tx * HALF, lo, oz + tz * HALF, d.dc, 0, d.dr, surf);
      b.vertex(ox + tx * HALF, h, oz + tz * HALF, d.dc, 0, d.dr, surf);
      b.vertex(ox - tx * HALF, h, oz - tz * HALF, d.dc, 0, d.dr, surf);
      // with t = (−dr, dc) this order winds counter-clockwise seen from outside (front face out)
      b.quad(base, base + 3, base + 2, base + 1);
    }
  });
  return b;
}

/** Deterministic per-placement seed. */
export function placementSeed(levelSeed: number, i: number): number {
  return rand01(levelSeed, i, 7331);
}
