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
import { emptySurface, STATIC_KIND, staticMaterial, surfaceBytes, surfaceColorBytes, type StaticKind, type SurfaceBytes } from '../render/staticMaterial';
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

type CullInternals = MultiDraw & {
  _instanceInfo: { visible: boolean; active: boolean; geometryIndex: number }[];
  _geometryInfo: { start: number; count: number }[];
  _indirectTexture: THREE.DataTexture;
  _visibilityChanged: boolean;
};

const IDENTITY = new THREE.Matrix4();
/**
 * The three release whose BatchedMesh internals `batchOver` (adopting prebuilt buffers) and
 * `StaticBatch.cull` reproduce (checked field by field in tests/world-static.test.ts). Another release
 * takes three's own paths (`addGeometry` / `addInstance`, `onBeforeRender`): slower, never wrong.
 */
const INTERNALS_REVISION = '186';
const KNOWN_INTERNALS = THREE.REVISION === INTERNALS_REVISION;
const _projView = new THREE.Matrix4();
const _frustum = new THREE.Frustum();

/**
 * A BatchedMesh whose visible ranges are merged when they follow each other in the index buffer:
 * one draw per run of neighbouring placements instead of one per placement. All instance matrices are
 * identity (the geometry is already in world space), so a merged draw needs no per-range data.
 * Relies on three r186 internals (the draw list `onBeforeRender` fills in for the backend); if they are
 * gone, nothing is merged: still correct, just one draw per visible placement. The per-instance culling
 * is three's, minus work an identity matrix makes redundant (`cull`).
 */
class StaticBatch extends THREE.BatchedMesh {
  /** Every instance matrix is the identity (`addInstance` sets it; nothing here moves an instance). */
  private identity = true;
  /** Bounding sphere per geometry, cached for `cull`. */
  private readonly spheres: THREE.Sphere[] = [];

  override setMatrixAt(instanceId: number, matrix: THREE.Matrix4): this {
    if (!matrix.equals(IDENTITY)) this.identity = false;
    return super.setMatrixAt(instanceId, matrix);
  }

  override setGeometryAt(geometryId: number, geometry: THREE.BufferGeometry): number {
    this.spheres.length = 0;
    return super.setGeometryAt(geometryId, geometry);
  }

  override onBeforeRender(...args: Parameters<THREE.BatchedMesh['onBeforeRender']>): void {
    const [, , camera, geometry, material] = args;
    const x = this as unknown as Partial<CullInternals>;
    const known = Array.isArray(x._instanceInfo) && Array.isArray(x._geometryInfo) && !!x._indirectTexture && !!x._multiDrawStarts;
    const plain = !(camera as THREE.ArrayCamera).isArrayCamera && !(material as THREE.MeshBasicMaterial).wireframe;
    if (KNOWN_INTERNALS && known && this.identity && plain && this.perObjectFrustumCulled && !this.sortObjects) this.cull(camera, geometry);
    else super.onBeforeRender(...args);
    // a merged draw uses the first range's instance (matrix) for all of them: identity matrices only
    if (!this.identity) return;
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

  /**
   * `BatchedMesh.onBeforeRender` (r186, the unsorted, frustum-culled branch) without the per-instance
   * matrix read and sphere transform: with an identity instance matrix `Sphere.applyMatrix4` returns the
   * sphere unchanged (x·1 + 0·y + 0·z + 0, w = 1, radius × 1), so every frustum test, and with it the
   * draw list, is exactly three's. The spheres are three's own (`getBoundingSphereAt`), cached.
   */
  private cull(camera: THREE.Camera, geometry: THREE.BufferGeometry): void {
    const x = this as unknown as CullInternals;
    const index = geometry.getIndex();
    const bytesPerElement = index === null ? 1 : index.array.BYTES_PER_ELEMENT;
    const infos = x._geometryInfo;
    const spheres = this.spheres;
    if (spheres.length !== infos.length) {
      spheres.length = 0;
      for (let g = 0; g < infos.length; g++) spheres.push(this.getBoundingSphereAt(g, new THREE.Sphere()) ?? new THREE.Sphere());
    }
    _projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(this.matrixWorld);
    _frustum.setFromProjectionMatrix(_projView, camera.coordinateSystem, camera.reversedDepth);
    const instances = x._instanceInfo;
    const starts = x._multiDrawStarts;
    const counts = x._multiDrawCounts;
    const indirect = x._indirectTexture.image.data as Uint32Array;
    let n = 0;
    for (let i = 0, l = instances.length; i < l; i++) {
      const inst = instances[i];
      if (!inst.visible || !inst.active || !_frustum.intersectsSphere(spheres[inst.geometryIndex])) continue;
      const info = infos[inst.geometryIndex];
      starts[n] = info.start * bytesPerElement;
      counts[n] = info.count;
      indirect[n] = i;
      n++;
    }
    x._indirectTexture.needsUpdate = true;
    x._multiDrawCount = n;
    x._multiDrawBytesPerElement = bytesPerElement;
    x._visibilityChanged = false;
  }
}

type BatchClass = 'big' | 'detail' | 'props' | 'roof';

const CLASS_LAYERS: Record<BatchClass, readonly number[]> = {
  big: [LAYER.MAIN],
  detail: [LAYER.MAIN, LAYER.REFLECT, LAYER.SHADOW],
  props: [LAYER.MAIN, LAYER.REFLECT],
  roof: [LAYER.MAIN, LAYER.SHADOW],
};

/** One placement's range in a class buffer (one BatchedMesh geometry + instance). */
interface Piece {
  cls: BatchClass;
  /** Index of the placement in `StaticMerger.items`. */
  item: number;
  /** Sort key: south → north by tile row, then west → east, then bottom → top. */
  row: number;
  x: number;
  y: number;
  /** Side facades: +1 faces east (+X), −1 faces west; 0 = not culled by facing. */
  facing: number;
  wallX: number;
  vertices: number;
  indices: number;
  /** Every vertex of the piece is used by a triangle. */
  allUsed: boolean;
  /** Where the piece starts in its class buffers (set once the pieces are sorted). */
  vertexStart: number;
  indexStart: number;
}

/**
 * The final vertex / index arrays of one batch class, filled in place (no growing, no copies). The
 * unorm8x4 surface attributes are written one vertex (4 bytes) at a time through 32-bit views.
 */
interface ClassBuffers {
  pos: Float32Array;
  nor: Float32Array;
  sc: Uint8Array;
  se: Uint8Array;
  sm: Uint8Array;
  sc32: Uint32Array;
  se32: Uint32Array;
  sm32: Uint32Array;
  index: Uint16Array | Uint32Array;
}

function classBuffers(vcount: number, icount: number): ClassBuffers {
  const sc = new Uint8Array(vcount * 4);
  const se = new Uint8Array(vcount * 4);
  const sm = new Uint8Array(vcount * 4);
  return {
    pos: new Float32Array(vcount * 3),
    nor: new Float32Array(vcount * 3),
    sc,
    se,
    sm,
    sc32: new Uint32Array(sc.buffer),
    se32: new Uint32Array(se.buffer),
    sm32: new Uint32Array(sm.buffer),
    // BatchedMesh's rule for its index buffer
    index: vcount > 65535 ? new Uint32Array(icount) : new Uint16Array(icount),
  };
}

/** Byte order of this machine: a vertex's 4 surface bytes as one 32-bit word that stores them in order. */
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 0x04;
function pack4(b: readonly number[]): number {
  return LITTLE_ENDIAN ? (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0 : ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
}

/**
 * Source data of an asset part, read once per geometry: component values exactly as the attribute
 * getters return them (`getX` …, denormalised), so the bake below does the same arithmetic as
 * `appendPart` on the same numbers.
 */
interface PartData {
  count: number;
  pos: Float32Array | Float64Array;
  nor: Float32Array | Float64Array | null;
  col: Float64Array | null;
  index: ArrayLike<number> | null;
  indexCount: number;
  /** Every vertex is used by a triangle (its bounds are those of its vertices). */
  allUsed: boolean;
}
const partData = new WeakMap<THREE.BufferGeometry, PartData>();

/** xyz of every vertex: the array itself when `getX` would return its elements unchanged, else a copy. */
function xyzOf(a: AnyAttr): Float32Array | Float64Array {
  if (!(a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute && !a.normalized && a.itemSize === 3 && a.array instanceof Float32Array) return a.array;
  const out = new Float64Array(a.count * 3);
  for (let k = 0; k < a.count; k++) {
    out[k * 3] = a.getX(k);
    out[k * 3 + 1] = a.getY(k);
    out[k * 3 + 2] = a.getZ(k);
  }
  return out;
}

function getPartData(g: THREE.BufferGeometry): PartData {
  let d = partData.get(g);
  if (d) return d;
  const p = g.getAttribute('position') as AnyAttr;
  const nor = g.getAttribute('normal') as AnyAttr | undefined;
  const col = g.getAttribute('color') as AnyAttr | undefined;
  let colors: Float64Array | null = null;
  if (col) {
    colors = new Float64Array(p.count * 3);
    for (let k = 0; k < p.count; k++) {
      colors[k * 3] = col.getX(k);
      colors[k * 3 + 1] = col.getY(k);
      colors[k * 3 + 2] = col.getZ(k);
    }
  }
  let allUsed = true;
  if (g.index) {
    const used = new Uint8Array(p.count);
    const idx = g.index.array;
    for (let k = 0; k < g.index.count; k++) used[idx[k]] = 1;
    allUsed = used.every((u) => u === 1);
  }
  d = {
    count: p.count,
    pos: xyzOf(p),
    nor: nor ? xyzOf(nor) : null,
    col: colors,
    index: g.index ? g.index.array : null,
    indexCount: g.index ? g.index.count : p.count,
    allUsed,
  };
  partData.set(g, d);
  return d;
}

/**
 * `appendPart` straight into the final class buffers at vertex `vAt` / index `iAt` (indices offset by
 * `vAt`, the part's first vertex in the buffer). Same arithmetic as `appendPart` + `BatchedMesh.addGeometry`:
 *  - position: `Vector3.applyMatrix4` — for an affine `m` (compose: e3 = e7 = e11 = 0, e15 = 1) the
 *    perspective divide is by exactly 1, so it is left out;
 *  - normal: `applyMatrix3(nm).normalize()` (× 1 / length, length 0 → 1);
 *  - surface bytes (`surf`, from `surfaceBytes`): constant per part, except the base colour when the
 *    part has vertex colours (`colors`: the packed `sc` word of every vertex, see `colorWords`).
 */
function bakePart(out: ClassBuffers, vAt: number, iAt: number, d: PartData, e: readonly number[], ne: readonly number[], surf: SurfaceBytes, colors: Uint32Array | null): void {
  const count = d.count;
  const vEnd = vAt + count;
  if (colors) out.sc32.set(colors, vAt);
  else out.sc32.fill(pack4(surf.sc), vAt, vEnd);
  out.se32.fill(pack4(surf.se), vAt, vEnd);
  out.sm32.fill(pack4(surf.sm), vAt, vEnd);
  bakePositions(out.pos, vAt * 3, d.pos, count, e);
  if (d.nor) bakeNormals(out.nor, vAt * 3, d.nor, count, ne);
  else for (let o = vAt * 3, l = vEnd * 3; o < l; o += 3) out.nor[o + 1] = 1; // (0, 1, 0); the buffer starts zeroed
  const index = out.index;
  const src = d.index;
  if (src) for (let k = 0; k < d.indexCount; k++) index[iAt + k] = src[k] + vAt;
  else for (let k = 0; k < d.indexCount; k++) index[iAt + k] = k + vAt;
}

function bakePositions(pos: Float32Array, o: number, P: Float32Array | Float64Array, count: number, e: readonly number[]): void {
  const e0 = e[0], e1 = e[1], e2 = e[2], e4 = e[4], e5 = e[5], e6 = e[6], e8 = e[8], e9 = e[9], e10 = e[10], e12 = e[12], e13 = e[13], e14 = e[14];
  for (let i = 0, l = count * 3; i < l; i += 3, o += 3) {
    const x = P[i];
    const y = P[i + 1];
    const z = P[i + 2];
    pos[o] = e0 * x + e4 * y + e8 * z + e12;
    pos[o + 1] = e1 * x + e5 * y + e9 * z + e13;
    pos[o + 2] = e2 * x + e6 * y + e10 * z + e14;
  }
}

function bakeNormals(nor: Float32Array, o: number, N: Float32Array | Float64Array, count: number, ne: readonly number[]): void {
  const n0 = ne[0], n1 = ne[1], n2 = ne[2], n3 = ne[3], n4 = ne[4], n5 = ne[5], n6 = ne[6], n7 = ne[7], n8 = ne[8];
  for (let i = 0, l = count * 3; i < l; i += 3, o += 3) {
    const a = N[i];
    const b = N[i + 1];
    const c = N[i + 2];
    const tx = n0 * a + n3 * b + n6 * c;
    const ty = n1 * a + n4 * b + n7 * c;
    const tz = n2 * a + n5 * b + n8 * c;
    const inv = 1 / (Math.sqrt(tx * tx + ty * ty + tz * tz) || 1);
    nor[o] = tx * inv;
    nor[o + 1] = ty * inv;
    nor[o + 2] = tz * inv;
  }
}

/** Placement transform, exactly as every bake of it computes it. */
function placementMatrix(p: Placement, m: THREE.Matrix4, nm: THREE.Matrix3, q: THREE.Quaternion, v: THREE.Vector3, n: THREE.Vector3): void {
  const s = p.scale ?? 1;
  q.setFromAxisAngle(UP, p.rotY);
  m.compose(v.set(p.x, p.y, p.z), q, n.set(s, s, s));
  nm.getNormalMatrix(m);
}
const UP = new THREE.Vector3(0, 1, 0);

type GeometryInfo = {
  vertexStart: number;
  vertexCount: number;
  reservedVertexCount: number;
  indexStart: number;
  indexCount: number;
  reservedIndexCount: number;
  start: number;
  count: number;
  boundingBox: THREE.Box3 | null;
  boundingSphere: THREE.Sphere | null;
  active: boolean;
};
type BatchInternals = {
  _geometryInfo: GeometryInfo[];
  _geometryCount: number;
  _nextVertexStart: number;
  _nextIndexStart: number;
  _geometryInitialized: boolean;
  _visibilityChanged: boolean;
};

/**
 * Bounds of a piece exactly as `BatchedMesh.getBoundingBoxAt` / `getBoundingSphereAt` compute them lazily:
 * over the positions the piece's indices use (Math.min / Math.max, then the box centre and the largest
 * squared distance), without their per-index getter calls. When every vertex of the piece is used, the
 * vertex range itself is that set, and min / max do not depend on the order.
 */
function pieceBounds(pos: Float32Array, index: Uint16Array | Uint32Array, pc: Piece): { box: THREE.Box3; sphere: THREE.Sphere } {
  let x0 = Infinity;
  let y0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let z1 = -Infinity;
  const byVertex = pc.allUsed;
  const start = byVertex ? pc.vertexStart : pc.indexStart;
  const end = start + (byVertex ? pc.vertices : pc.indices);
  for (let i = start; i < end; i++) {
    const o = (byVertex ? i : index[i]) * 3;
    x0 = Math.min(x0, pos[o]);
    y0 = Math.min(y0, pos[o + 1]);
    z0 = Math.min(z0, pos[o + 2]);
    x1 = Math.max(x1, pos[o]);
    y1 = Math.max(y1, pos[o + 1]);
    z1 = Math.max(z1, pos[o + 2]);
  }
  const box = new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
  const sphere = new THREE.Sphere();
  box.getCenter(sphere.center);
  const { x: cx, y: cy, z: cz } = sphere.center;
  let r2 = 0;
  for (let i = start; i < end; i++) {
    const o = (byVertex ? i : index[i]) * 3;
    const dx = cx - pos[o];
    const dy = cy - pos[o + 1];
    const dz = cz - pos[o + 2];
    r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
  }
  sphere.radius = Math.sqrt(r2);
  return { box, sphere };
}

/**
 * A StaticBatch over prebuilt buffers: the same object `addGeometry` + `addInstance` per piece would make
 * (same attributes in the same order, same index type, same ranges and bounds), without allocating and
 * copying a second set of buffers. Relies on r186 BatchedMesh internals (`INTERNALS_REVISION`); on another
 * three release, or when they are not there, it falls back to `addGeometry` on views of the buffers (one
 * more copy, same result).
 */
function batchOver(c: ClassBake, material: THREE.Material): { batch: StaticBatch; ids: number[] } {
  const { buf, list, vcount, icount } = c;
  const batch = new StaticBatch(list.length, vcount, icount, material);
  const x = batch as unknown as Partial<BatchInternals>;
  const ids: number[] = [];
  const adopt =
    KNOWN_INTERNALS &&
    Array.isArray(x._geometryInfo) &&
    x._geometryInfo.length === 0 &&
    x._geometryCount === 0 &&
    x._geometryInitialized === false &&
    typeof x._nextVertexStart === 'number' &&
    typeof x._nextIndexStart === 'number';
  if (adopt) {
    const internals = x as BatchInternals;
    const g = batch.geometry;
    // the order and the types `_initializeGeometry` would give (from the pieces' geometry)
    g.setAttribute('position', new THREE.BufferAttribute(buf.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(buf.nor, 3));
    g.setAttribute('sc', new THREE.BufferAttribute(buf.sc, 4, true));
    g.setAttribute('se', new THREE.BufferAttribute(buf.se, 4, true));
    g.setAttribute('sm', new THREE.BufferAttribute(buf.sm, 4, true));
    g.setIndex(new THREE.BufferAttribute(buf.index, 1));
    internals._geometryInitialized = true;
    list.forEach((pc, i) => {
      internals._geometryInfo.push({
        vertexStart: pc.vertexStart,
        vertexCount: pc.vertices,
        reservedVertexCount: pc.vertices,
        indexStart: pc.indexStart,
        indexCount: pc.indices,
        reservedIndexCount: pc.indices,
        start: pc.indexStart,
        count: pc.indices,
        boundingBox: c.bounds[i].box,
        boundingSphere: c.bounds[i].sphere,
        active: true,
      });
      ids.push(batch.addInstance(internals._geometryCount++));
    });
    internals._nextVertexStart = vcount;
    internals._nextIndexStart = icount;
    internals._visibilityChanged = true;
  } else {
    for (const pc of list) {
      const geo = new THREE.BufferGeometry();
      const v0 = pc.vertexStart;
      const v1 = v0 + pc.vertices;
      geo.setAttribute('position', new THREE.BufferAttribute(buf.pos.subarray(v0 * 3, v1 * 3), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(buf.nor.subarray(v0 * 3, v1 * 3), 3));
      geo.setAttribute('sc', new THREE.BufferAttribute(buf.sc.subarray(v0 * 4, v1 * 4), 4, true));
      geo.setAttribute('se', new THREE.BufferAttribute(buf.se.subarray(v0 * 4, v1 * 4), 4, true));
      geo.setAttribute('sm', new THREE.BufferAttribute(buf.sm.subarray(v0 * 4, v1 * 4), 4, true));
      const idx = new Uint32Array(pc.indices);
      for (let k = 0; k < pc.indices; k++) idx[k] = buf.index[pc.indexStart + k] - v0;
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      ids.push(batch.addInstance(batch.addGeometry(geo)));
    }
  }
  return { batch, ids };
}

interface Item {
  p: Placement;
  tint: THREE.Color | null;
  seed: number;
}

/** One batch class, baked: its pieces in buffer order, the filled buffers and every piece's bounds. */
interface ClassBake {
  cls: BatchClass;
  list: Piece[];
  buf: ClassBuffers;
  vcount: number;
  icount: number;
  bounds: { box: THREE.Box3; sphere: THREE.Sphere }[];
}

/** Everything `StaticMerger.build` turns into meshes. */
interface Baked {
  pieces: Piece[];
  classes: ClassBake[];
  standin: Batch;
  proxies: Batch;
  blocks: Batch | null;
}

/**
 * The bake of a level's static geometry, as a generator that yields between pieces, so it can run in one
 * go (`StaticMerger.build`) or in slices with the event loop running in between (`prepareStatic`). Two
 * passes: the first sizes every piece (and bakes the small stand-in and proxy batches), the second writes
 * each piece once, in place, into arrays allocated at their final size, which the batches then use as
 * they are.
 */
function* bakeLevel(items: readonly Item[], assets: AssetLibrary, materials: MaterialLibrary, plan: LevelPlan | null): Generator<void, Baked> {
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
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const surf = emptySurface();
  const wallSpec = materials.spec('M_Wall');

  // ── pass 1: classes and sizes ──
  for (let it = 0; it < items.length; it++) {
    if ((it & 127) === 127) yield;
    const { p, tint, seed } = items[it];
    placementMatrix(p, m, nm, q, v, n);
    const big = BIG_KINDS.has(p.kind);
    // side facades: the front (+Z) turned by rotY points along (sin, 0, cos)
    const fx = Math.sin(p.rotY);
    const facing = p.kind === 'facade' && Math.abs(fx) > 0.9 ? Math.sign(fx) : 0;
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
    if (parts.length) {
      const cls = big ? (glowing ? 'props' : 'big') : propClass;
      let vertices = 0;
      let indices = 0;
      let allUsed = true;
      for (const part of parts) {
        const d = getPartData(part.geometry);
        vertices += d.count;
        indices += d.indexCount;
        allUsed &&= d.allUsed;
      }
      pieces.push({ cls, item: it, row: Math.round(p.z / TILE), x: p.x, y: p.y, facing: cls === 'big' ? facing : 0, wallX: p.x, vertices, indices, allUsed, vertexStart: 0, indexStart: 0 });
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

  // stable sort: ties keep the plan order
  pieces.sort((a, b) => b.row - a.row || a.x - b.x || a.y - b.y);
  // ── pass 2: every piece written once, in place, in buffer order ──
  // packed `sc` words of a vertex-coloured part per (palette spec, tint): facade modules repeat a lot
  const colorCache = new Map<PartData, Map<MatSpec, Map<THREE.Color | null, Uint32Array>>>();
  const colorWords = (d: PartData, spec: MatSpec, tint: THREE.Color | null, rough: number): Uint32Array => {
    let bySpec = colorCache.get(d);
    if (!bySpec) colorCache.set(d, (bySpec = new Map()));
    let byTint = bySpec.get(spec);
    if (!byTint) bySpec.set(spec, (byTint = new Map()));
    let words = byTint.get(tint);
    if (!words) {
      const rgb = surfaceColorBytes(spec, d.col!, tint ? [tint.r, tint.g, tint.b] : [1, 1, 1], d.count, new Uint8Array(d.count * 3));
      words = new Uint32Array(d.count);
      const b = [0, 0, 0, rough];
      for (let k = 0; k < d.count; k++) {
        b[0] = rgb[k * 3];
        b[1] = rgb[k * 3 + 1];
        b[2] = rgb[k * 3 + 2];
        words[k] = pack4(b);
      }
      byTint.set(tint, words);
    }
    return words;
  };
  const classes: ClassBake[] = [];
  for (const cls of ['big', 'detail', 'props', 'roof'] as const) {
    const list = pieces.filter((pc) => pc.cls === cls && pc.vertices > 0);
    if (!list.length) continue;
    let vcount = 0;
    let icount = 0;
    for (const pc of list) {
      pc.vertexStart = vcount;
      pc.indexStart = icount;
      vcount += pc.vertices;
      icount += pc.indices;
    }
    const buf = classBuffers(vcount, icount);
    const bounds: ClassBake['bounds'] = [];
    for (const pc of list) {
      yield;
      const { p, tint, seed } = items[pc.item];
      placementMatrix(p, m, nm, q, v, n);
      const big = BIG_KINDS.has(p.kind);
      const flickers = !big && rand01(seed * 1e6, 41) < 0.3;
      let vAt = pc.vertexStart;
      let iAt = pc.indexStart;
      for (const part of assets.parts(p.asset)) {
        const matName = p.remap?.[part.matName] ?? part.matName;
        const spec = materials.spec(matName);
        const kind: StaticKind = TINTED.has(part.matName)
          ? STATIC_KIND.wall
          : WINDOWS.has(matName)
            ? STATIC_KIND.window
            : BEACONS[p.asset]?.includes(matName)
              ? STATIC_KIND.beacon
              : flickers && matName.startsWith('M_Neon')
                ? STATIC_KIND.flicker
                : STATIC_KIND.plain;
        const partTint = TINTED.has(part.matName) ? tint : null;
        const d = getPartData(part.geometry);
        const scale: [number, number, number] = partTint ? [partTint.r, partTint.g, partTint.b] : [1, 1, 1];
        surfaceBytes(spec, kind, seed, !!p.occluder, EMISSIVE_SCALE, surf, scale);
        // sc[3] (roughness) is the same byte with or without vertex colours
        bakePart(buf, vAt, iAt, d, m.elements, nm.elements, surf, d.col ? colorWords(d, spec, partTint, surf.sc[3]) : null);
        vAt += d.count;
        iAt += d.indexCount;
      }
      bounds.push(pieceBounds(buf.pos, buf.index, pc));
    }
    classes.push({ cls, list, buf, vcount, icount, bounds });
  }
  const blocks = plan ? addShadowBlocks(new Batch('static:blocks', [LAYER.SHADOW], true), plan, wallSpec, surf) : null;
  return { pieces, classes, standin, proxies, blocks };
}

function bakeNow<T>(gen: Generator<void, T>): T {
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
  }
}

/** Lets the event loop run (input, the loading screen's frames) between two slices of work. */
function yieldToEventLoop(): Promise<void> {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (s?.yield) return s.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Prepared bakes by plan, taken by the `StaticMerger.build` that gets the same placements. */
const prepared = new WeakMap<LevelPlan, { items: readonly Item[]; baked: Baked }>();

/** The merger items `world/builder.ts` adds for a plan: lot tint and `placementSeed` per placement. */
function planItems(plan: LevelPlan, levelSeed: number): Item[] {
  const tints = plan.lots.map((l) => new THREE.Color(l.tint));
  return plan.placements.map((p, i) => ({ p, tint: p.lot !== undefined ? tints[p.lot] : null, seed: placementSeed(levelSeed, i) }));
}

const sameItems = (a: readonly Item[], b: readonly Item[]) =>
  a.length === b.length &&
  a.every((x, i) => {
    const y = b[i];
    return x.p === y.p && x.seed === y.seed && (x.tint === y.tint || (!!x.tint && !!y.tint && x.tint.equals(y.tint)));
  });

/**
 * Optional, before `buildLevel`: bakes the level's static geometry in slices of about `sliceMs` with the
 * event loop running in between, so the loading screen stays alive (the bake is the longest synchronous
 * step of a level build). `StaticMerger.build` then only wraps the result in meshes when it is handed
 * the same placements, tints and seeds (checked); otherwise it bakes synchronously, as without this.
 */
export async function prepareStatic(plan: LevelPlan, levelSeed: number, assets: AssetLibrary, materials: MaterialLibrary, sliceMs = 8): Promise<void> {
  const t0 = performance.now();
  const items = planItems(plan, levelSeed);
  const gen = bakeLevel(items, assets, materials, plan);
  let busy = 0;
  let longest = 0;
  let slices = 0;
  let baked: Baked | null = null;
  while (!baked) {
    const s0 = performance.now();
    for (;;) {
      const r = gen.next();
      if (r.done) {
        baked = r.value;
        break;
      }
      if (performance.now() - s0 >= sliceMs) break;
    }
    const d = performance.now() - s0;
    busy += d;
    longest = Math.max(longest, d);
    slices++;
    if (!baked) await yieldToEventLoop();
  }
  prepared.set(plan, { items, baked });
  performance.measure('static:prepare', { start: t0, detail: { slices, busyMs: Math.round(busy), longestSliceMs: Math.round(longest) } });
}

export class StaticMerger {
  private readonly items: Item[] = [];

  add(p: Placement, tint: THREE.Color | null, seed: number): void {
    this.items.push({ p, tint, seed });
  }

  get count(): number {
    return this.items.length;
  }

  /** Bakes the placements (or takes the matching `prepareStatic` bake) and wraps them in batched meshes. */
  build(assets: AssetLibrary, materials: MaterialLibrary, plan: LevelPlan | null = null): StaticBuild {
    const t0 = performance.now();
    const items = this.items;
    const ready = plan ? prepared.get(plan) : undefined;
    if (plan && ready) prepared.delete(plan); // its buffers become the batches': used once
    const usePrepared = !!ready && sameItems(ready.items, items);
    const { pieces, classes, standin, proxies, blocks } = ready && usePrepared ? ready.baked : bakeNow(bakeLevel(items, assets, materials, plan));

    const group = new THREE.Group();
    group.name = 'static';
    const triangles = { big: 0, detail: 0, props: 0, roof: 0, proxies: 0, standin: 0, blocks: 0 };
    let vertices = 0;
    const sided: { batch: StaticBatch; id: number; facing: number; wallX: number; shown: boolean }[] = [];
    for (const c of classes) {
      const { cls, list, vcount, icount } = c;
      const { batch, ids } = batchOver(c, staticMaterial());
      batch.name = `static:${cls}`;
      batch.sortObjects = false; // keep the buffer order (south → north) so neighbours merge
      batch.perObjectFrustumCulled = true;
      list.forEach((pc, i) => {
        if (pc.facing) sided.push({ batch, id: ids[i], facing: pc.facing, wallX: pc.wallX, shown: true });
      });
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
      ['blocks', blocks],
    ];
    for (const [key, b] of extra) {
      if (!b || b.vertices === 0) continue;
      group.add(b.build());
      triangles[key] = b.triangles;
      vertices += b.vertices;
    }
    const pos = new THREE.Vector3();
    performance.measure('static:merge', { start: t0, detail: { placements: items.length, vertices, prepared: usePrepared } });
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

/**
 * Shadow casters for the buildings: the outer walls of every building column (no tops, no bottoms).
 * The shadow pass renders back faces, so a wall facing away from the key light is what casts; faces
 * between two columns are skipped where the neighbour is at least as tall.
 */
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
