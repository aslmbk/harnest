// Static level geometry (src/world/staticMesh.ts): the merger writes its batches' buffers directly and
// adopts them into BatchedMesh internals. These tests pin that to what three's own `addGeometry` builds,
// and the time-sliced `prepareStatic` bake to the synchronous one. Placeholder assets (no GLB loading).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { LEVELS } from '../src/content';
import { AssetLibrary } from '../src/engine/assets';
import { MaterialLibrary } from '../src/render/materials';
import { createSteam } from '../src/render/particles';
import { Placeholders } from '../src/render/placeholders';
import { planLevel, type LevelPlan } from '../src/world/levelPlan';
import { placementSeed, prepareStatic, StaticMerger, type StaticBuild } from '../src/world/staticMesh';

interface Info {
  vertexStart: number;
  vertexCount: number;
  indexStart: number;
  indexCount: number;
  start: number;
  count: number;
}
type Batch = THREE.BatchedMesh & { _geometryInfo: Info[]; _maxVertexCount: number; _maxIndexCount: number; _maxInstanceCount: number };

const materials = new MaterialLibrary();
const assets = new AssetLibrary(materials, new Placeholders(materials));
const loaded = assets.loadAll({ useFiles: false });

function build(plan: LevelPlan, seed: number): StaticBuild {
  const tints = plan.lots.map((l) => new THREE.Color(l.tint));
  const merger = new StaticMerger();
  plan.placements.forEach((p, i) => merger.add(p, p.lot !== undefined ? tints[p.lot] : null, placementSeed(seed, i)));
  return merger.build(assets, materials, plan);
}

const batches = (b: StaticBuild) => (b.group.children as Batch[]).filter((o) => o.isBatchedMesh);

function bounds(b: THREE.BatchedMesh, i: number): number[] {
  const box = b.getBoundingBoxAt(i, new THREE.Box3())!;
  const s = b.getBoundingSphereAt(i, new THREE.Sphere())!;
  return [...box.min.toArray(), ...box.max.toArray(), ...s.center.toArray(), s.radius];
}

const bytes = (a: THREE.TypedArray, length = a.byteLength) => new Uint8Array(a.buffer, a.byteOffset, length);
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Everything a build draws and culls with: a description and the raw buffers. */
function snapshot(b: StaticBuild): { meta: string[]; data: Uint8Array[] } {
  const meta: string[] = [];
  const data: Uint8Array[] = [];
  for (const o of b.group.children as Batch[]) {
    meta.push(`${o.name}|${o.layers.mask}|${o.castShadow}|${o.receiveShadow}|${o.renderOrder}`);
    const g = o.geometry;
    for (const [name, a] of Object.entries(g.attributes) as [string, THREE.BufferAttribute][]) {
      meta.push(`${name} ${a.itemSize} ${a.normalized} ${a.array.constructor.name}`);
      data.push(bytes(a.array));
    }
    if (g.index) data.push(bytes(g.index.array));
    if (o.isBatchedMesh) o._geometryInfo.forEach((gi, i) => meta.push(JSON.stringify([gi.vertexStart, gi.vertexCount, gi.indexStart, gi.indexCount, ...bounds(o, i)])));
  }
  return { meta, data };
}

function same(a: ReturnType<typeof snapshot>, b: ReturnType<typeof snapshot>): boolean {
  return a.meta.join('|') === b.meta.join('|') && a.data.length === b.data.length && a.data.every((x, i) => sameBytes(x, b.data[i]));
}

describe('static merger', () => {
  it('runs on the three release whose BatchedMesh internals it adopts', () => {
    // a three upgrade: re-check batchOver / StaticBatch.cull against the new BatchedMesh.js, then bump
    // INTERNALS_REVISION in src/world/staticMesh.ts (until then the merger takes three's slower paths)
    expect(THREE.REVISION).toBe('186');
  });
  it.each(LEVELS.map((l) => l.id))('%s: adopted batches equal what BatchedMesh.addGeometry builds', async (id) => {
    await loaded;
    const def = LEVELS.find((l) => l.id === id)!;
    const built = build(planLevel(def.layout), def.layout.mood.seed);
    expect(batches(built).length).toBeGreaterThan(0);
    for (const b of batches(built)) {
      const g = b.geometry;
      const names = Object.keys(g.attributes);
      // the buffers are allocated to the exact size: no slack, no regrowth
      const used = b._geometryInfo.reduce((n, gi) => Math.max(n, gi.vertexStart + gi.vertexCount), 0);
      expect(g.getAttribute('position').count).toBe(used);
      expect(g.index!.count).toBe(b._geometryInfo.reduce((n, gi) => Math.max(n, gi.indexStart + gi.indexCount), 0));
      const ref = new THREE.BatchedMesh(b._maxInstanceCount, b._maxVertexCount, b._maxIndexCount, b.material as THREE.Material) as Batch;
      for (const gi of b._geometryInfo) {
        const geo = new THREE.BufferGeometry();
        for (const name of names) {
          const a = g.getAttribute(name) as THREE.BufferAttribute;
          geo.setAttribute(name, new THREE.BufferAttribute(a.array.slice(gi.vertexStart * a.itemSize, (gi.vertexStart + gi.vertexCount) * a.itemSize), a.itemSize, a.normalized));
        }
        const idx = Array.from(g.index!.array.subarray(gi.indexStart, gi.indexStart + gi.indexCount), (v) => v - gi.vertexStart);
        expect(Math.min(...idx)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...idx)).toBeLessThan(gi.vertexCount);
        geo.setIndex(idx);
        ref.addInstance(ref.addGeometry(geo));
      }
      const rg = ref.geometry;
      expect(Object.keys(rg.attributes)).toEqual(names);
      for (const name of names) {
        const a = g.getAttribute(name) as THREE.BufferAttribute;
        const r = rg.getAttribute(name) as THREE.BufferAttribute;
        expect(a.array.constructor).toBe(r.array.constructor);
        expect(a.normalized).toBe(r.normalized);
        expect(sameBytes(bytes(a.array), bytes(r.array, a.array.byteLength))).toBe(true);
      }
      expect(g.index!.array.constructor).toBe(rg.index!.array.constructor);
      expect(Array.from(g.index!.array)).toEqual(Array.from(rg.index!.array.subarray(0, g.index!.count)));
      b._geometryInfo.forEach((gi, i) => {
        const r = ref._geometryInfo[i];
        expect([gi.vertexStart, gi.vertexCount, gi.indexStart, gi.indexCount, gi.start, gi.count]).toEqual([r.vertexStart, r.vertexCount, r.indexStart, r.indexCount, r.start, r.count]);
        // precomputed bounds = the ones BatchedMesh computes lazily from the data
        expect(bounds(b, i)).toEqual(bounds(ref, i));
      });
    }
  });

  it('prepareStatic (time-sliced) gives the same batches as the synchronous build', async () => {
    await loaded;
    for (const def of LEVELS.slice(0, 2)) {
      const sync = snapshot(build(planLevel(def.layout), def.layout.mood.seed));
      const plan = planLevel(def.layout);
      await prepareStatic(plan, def.layout.mood.seed, assets, materials, 1);
      const merge = performance.getEntriesByName('static:merge').length;
      const prepared = build(plan, def.layout.mood.seed);
      const m = performance.getEntriesByName('static:merge')[merge] as PerformanceMeasure;
      expect((m.detail as { prepared: boolean }).prepared).toBe(true);
      expect(same(snapshot(prepared), sync)).toBe(true);
      // a bake is used once; other placements than the prepared ones fall back to the synchronous bake
      const again = build(plan, def.layout.mood.seed + 1);
      expect(same(snapshot(again), sync)).toBe(false);
    }
  });
});

describe('static batch culling', () => {
  it("culls exactly like BatchedMesh.onBeforeRender (main, mirrored and shadow cameras)", async () => {
    await loaded;
    const def = LEVELS[0];
    const plan = planLevel(def.layout);
    const built = build(plan, def.layout.mood.seed);
    const { minX, maxX, minZ, maxZ } = plan.bounds;
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    const cams: THREE.Camera[] = [];
    for (let k = 0; k < 24; k++) {
      const cam = new THREE.PerspectiveCamera(30 + rnd() * 40, 16 / 9, 0.5, 200);
      cam.position.set(minX + rnd() * (maxX - minX), 4 + rnd() * 30, minZ + rnd() * (maxZ - minZ));
      cam.lookAt(minX + rnd() * (maxX - minX), 0, minZ + rnd() * (maxZ - minZ));
      cam.updateMatrixWorld();
      if (k % 3 === 2) {
        // the puddle reflection: a camera mirrored below the street
        cam.matrixWorld.premultiply(new THREE.Matrix4().makeScale(1, -1, 1));
        cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
      }
      cams.push(cam);
    }
    const sun = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.5, 120);
    sun.position.set((minX + maxX) / 2 + 30, 50, (minZ + maxZ) / 2 + 20);
    sun.lookAt((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    sun.updateMatrixWorld();
    cams.push(sun);
    type Lists = { _multiDrawStarts: Int32Array; _multiDrawCounts: Int32Array; _multiDrawCount: number; _indirectTexture: THREE.DataTexture };
    const lists = (b: Batch) => {
      const x = b as unknown as Lists;
      const n = x._multiDrawCount;
      return [n, ...x._multiDrawStarts.subarray(0, n), ...x._multiDrawCounts.subarray(0, n), ...(x._indirectTexture.image.data as Uint32Array).subarray(0, n)];
    };
    let partial = 0;
    for (const cam of cams) {
      built.cullFacing(cam);
      for (const b of batches(built)) {
        THREE.BatchedMesh.prototype.onBeforeRender.call(b, null!, null!, cam, b.geometry, b.material as THREE.Material, null!);
        const three = lists(b);
        (b as unknown as { cull(c: THREE.Camera, g: THREE.BufferGeometry): void }).cull(cam, b.geometry);
        expect(lists(b)).toEqual(three);
        if (three[0] > 0 && three[0] < b._geometryInfo.length) partial++;
      }
    }
    expect(partial).toBeGreaterThan(10);
  });
});

describe('steam', () => {
  it('switches quality without rebuilding', () => {
    expect(createSteam([], 1)).toBeNull();
    const steam = createSteam([{ x: 0, y: 0, z: 0, strength: 1 }], 1)!;
    const material = steam.mesh.material;
    steam.setQuality('low');
    steam.setQuality('high');
    expect(steam.mesh.material).toBe(material);
    steam.dispose();
  });
});
