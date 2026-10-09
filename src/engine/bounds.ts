/**
 * Bounding spheres of big geometries, computed ahead in time slices.
 *
 * The renderer computes a geometry's bounding sphere the first time it projects the object (the sort
 * depth, `Renderer._projectObject`; frustum culling, `Frustum.intersectsObject`). For a level that is the
 * precompile's first `compileAsync`, in its synchronous part: the static batches' buffers (≈ 1.4 M
 * vertices) are walked twice in one task of 50–150 ms while the loading screen should animate.
 * `precomputeSpheres` does the same work beforehand, split into slices, and stores the very sphere
 * `BufferGeometry.computeBoundingSphere` would (same operations in the same float arithmetic; min, max
 * and the radius maximum do not depend on the order), so the projection then finds it and nothing
 * drawn changes.
 */
import * as THREE from 'three/webgpu';

/** Geometries smaller than this are left to the renderer (cheap, and fewer objects to walk). */
export const SPHERE_MIN_VERTICES = 16384;
/** Longest stretch of work between two yields (ms). */
const SLICE_MS = 8;
/** Vertices between two clock reads. */
const CHECK_EVERY = 8192;

type Projected = THREE.Object3D & { geometry?: THREE.BufferGeometry; isMesh?: boolean; isLine?: boolean; isLineLoop?: boolean; isPoints?: boolean };

/**
 * The geometries the renderer will compute a bounding sphere for when it next projects `root` (visible
 * meshes, lines and points: the objects `_projectObject` reaches), without one yet, with at least
 * `minVertices` positions, and whose sphere `computeBoundingSphere` gets from the positions alone.
 */
export function pendingSpheres(root: THREE.Object3D, minVertices = SPHERE_MIN_VERTICES): THREE.BufferGeometry[] {
  const out = new Set<THREE.BufferGeometry>();
  const visit = (o: Projected) => {
    if (!o.visible) return;
    const geo = o.geometry;
    if ((o.isMesh || (o.isLine && !o.isLineLoop) || o.isPoints) && geo?.isBufferGeometry && geo.boundingSphere === null) {
      const pos = geo.attributes.position as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
      if (pos && !('isGLBufferAttribute' in pos) && geo.morphAttributes.position === undefined && pos.count >= minVertices) out.add(geo);
    }
    for (const c of o.children) visit(c as Projected);
  };
  visit(root as Projected);
  return [...out];
}

/** A plain float attribute: `getX/getY/getZ(i)` read `array[i * itemSize + 0/1/2]` as they are. */
function plainFloat(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): attr is THREE.BufferAttribute {
  return (attr as THREE.BufferAttribute).isBufferAttribute === true && attr.array instanceof Float32Array && !attr.normalized && attr.itemSize >= 3;
}

/**
 * `BufferGeometry.computeBoundingSphere` (three r186) for a geometry without morph positions, with a
 * `pause()` between slices. Returns null when the positions changed meanwhile or the radius is NaN
 * (left to the renderer, which then also reports it).
 */
export async function sliceSphere(geo: THREE.BufferGeometry, pause: () => Promise<void>, sliceMs = SLICE_MS): Promise<THREE.Sphere | null> {
  const attr = geo.attributes.position as THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
  const version = (attr as THREE.BufferAttribute).version;
  const n = attr.count;
  const v = new THREE.Vector3();
  const fast = plainFloat(attr);
  const a = attr.array as ArrayLike<number>;
  const s = attr.itemSize;
  let start = performance.now();
  // runs `step(i)` over every vertex, pausing when a slice is used up; false when the positions changed
  const walk = async (step: (i: number) => void): Promise<boolean> => {
    for (let i0 = 0; i0 < n; i0 += CHECK_EVERY) {
      const i1 = Math.min(n, i0 + CHECK_EVERY);
      for (let i = i0; i < i1; i++) step(i);
      if (i1 < n && performance.now() - start > sliceMs) {
        await pause();
        start = performance.now();
        if (geo.attributes.position !== attr || (attr as THREE.BufferAttribute).version !== version) return false;
      }
    }
    return true;
  };
  // Box3.setFromBufferAttribute: makeEmpty, then expandByPoint (Vector3.min / max) per vertex
  const box = new THREE.Box3();
  const { min, max } = box;
  const expand = fast
    ? (i: number) => {
        const x = a[i * s];
        const y = a[i * s + 1];
        const z = a[i * s + 2];
        min.x = Math.min(min.x, x);
        min.y = Math.min(min.y, y);
        min.z = Math.min(min.z, z);
        max.x = Math.max(max.x, x);
        max.y = Math.max(max.y, y);
        max.z = Math.max(max.z, z);
      }
    : (i: number) => {
        box.expandByPoint(v.fromBufferAttribute(attr, i));
      };
  if (!(await walk(expand))) return null;
  const center = new THREE.Vector3();
  box.getCenter(center);
  // the largest Vector3.distanceToSquared from the centre
  let maxRadiusSq = 0;
  const cx = center.x;
  const cy = center.y;
  const cz = center.z;
  const reach = fast
    ? (i: number) => {
        const dx = cx - a[i * s];
        const dy = cy - a[i * s + 1];
        const dz = cz - a[i * s + 2];
        maxRadiusSq = Math.max(maxRadiusSq, dx * dx + dy * dy + dz * dz);
      }
    : (i: number) => {
        maxRadiusSq = Math.max(maxRadiusSq, center.distanceToSquared(v.fromBufferAttribute(attr, i)));
      };
  if (!(await walk(reach))) return null;
  const radius = Math.sqrt(maxRadiusSq);
  return Number.isNaN(radius) ? null : new THREE.Sphere(center, radius);
}

/** Resolves in a new task (`scheduler.yield` where there is one). */
export function yieldToMain(): Promise<void> {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof s?.yield === 'function') return s.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Computes, in slices, the bounding spheres the renderer would compute in its next projection of `root`
 * (see the module comment). Returns how many it stored.
 */
export async function precomputeSpheres(root: THREE.Object3D, pause: () => Promise<void> = yieldToMain): Promise<number> {
  let done = 0;
  const pending = pendingSpheres(root);
  // the first slice in a task of its own too, not at the end of the caller's (a level build)
  if (pending.length > 0) await pause();
  for (const geo of pending) {
    const sphere = await sliceSphere(geo, pause);
    if (sphere && geo.boundingSphere === null) {
      geo.boundingSphere = sphere;
      done++;
    }
    await pause();
  }
  return done;
}
