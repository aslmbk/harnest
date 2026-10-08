/**
 * Level builder (three.js side): instantiates a `LevelPlan` — chunked static geometry (see
 * `staticMesh.ts`), ground, abyss, rain, neon signs, ambient particles and the light pool. Everything
 * about *where* things go is decided by the pure planner (`levelPlan.ts`).
 */
import * as THREE from 'three/webgpu';
import type { LevelDef } from '../content/types';
import type { AssetLibrary } from '../engine/assets';
import type { NestedPass } from '../engine/engine';
import type { QualityPreset } from '../engine/quality';
import { MAX_POINT_LIGHTS } from '../engine/quality';
import { createAbyss, createRain, type Rain } from '../render/atmosphere';
import { buildGroundGeometry, createGroundMaterial, createStreetReflection, type StreetReflection } from '../render/ground';
import { LAYER, setCameraLayers, setObjectLayers } from '../render/layers';
import type { MaterialLibrary } from '../render/materials';
import { createNeonSign, type NeonSign } from '../render/neon';
import { createCables } from '../render/cables';
import { createAmbientParticles, createSteam, type AmbientParticles } from '../render/particles';
import { staticRain } from '../render/staticMaterial';
import type { LevelPlan } from './levelPlan';
import { LightPool } from './lightPool';
import { placementSeed, StaticMerger, type StaticBuild } from './staticMesh';

export { LIGHT_DECAY, LIGHT_UNIT } from './lightPool';

export interface BuiltLevel {
  group: THREE.Group;
  lights: LightPool;
  signs: NeonSign[];
  rain: Rain;
  /** Abyss lights and rain (hidden in the map view). */
  backdrop: THREE.Group;
  /** Number of static placements baked into the level meshes. */
  instances: number;
  /** Triangles of the static geometry the main camera can draw (all chunks), and per class. */
  staticTriangles: number;
  staticClasses: StaticBuild['triangles'];
  staticVertices: number;
  /** Placement ranges in the static batches. */
  staticRanges: number;
  /** `focus`: the camera target (lights are picked around it); `camera`: the view camera (facing cull). */
  update(dt: number, time: number, focus: { x: number; z: number }, camera?: THREE.Camera): void;
  /** Re-apply quality (light budget, abyss density, reflection, particles). */
  applyPreset(preset: QualityPreset): void;
  /** Passes nested in the scene pass to precompile for `camera` (the puddle reflection, when on). */
  nestedPasses(camera: THREE.Camera): NestedPass[];
  dispose(): void;
}

export function buildLevel(level: LevelDef, plan: LevelPlan, assets: AssetLibrary, materials: MaterialLibrary, preset: QualityPreset): BuiltLevel {
  const { layout } = level;
  const group = new THREE.Group();
  group.name = `level:${level.id}`;
  staticRain.value = layout.mood.rain;

  // ── ground (with the planar street reflection on medium / high) and terrace edge ──
  const { top, skirt } = buildGroundGeometry(plan.grid, 4);
  let reflection: StreetReflection | null = null;
  const makeGround = (p: QualityPreset) => {
    if (reflection) {
      group.remove(reflection.target);
      reflection.reflector.dispose();
      reflection = null;
    }
    if (p.reflection > 0) {
      reflection = createStreetReflection(p.reflection, p.msaa);
      group.add(reflection.target);
    }
    return createGroundMaterial(layout.mood.rain, reflection, layout.mood.seed);
  };
  let reflectionKey = `${preset.reflection}|${preset.msaa}`;
  const ground = new THREE.Mesh(top, makeGround(preset));
  ground.name = 'ground';
  ground.receiveShadow = true;
  group.add(ground);
  const edge = new THREE.Mesh(skirt, materials.get('M_ConcreteDark'));
  edge.name = 'terrace-edge';
  edge.receiveShadow = true;
  group.add(edge);

  // ── static geometry: chunks with one shared material ──
  const merger = new StaticMerger();
  const tints = plan.lots.map((l) => new THREE.Color(l.tint));
  plan.placements.forEach((p, i) => merger.add(p, p.lot !== undefined ? tints[p.lot] : null, placementSeed(layout.mood.seed, i)));
  const merged = merger.build(assets, materials, plan);
  group.add(merged.group);

  // ── neon signs ──
  const signs = layout.signs.map((def, i) => createNeonSign(def, materials, layout.mood.seed + i * 31));
  for (const s of signs) group.add(s.group);

  // ── hanging cables, steam, ambient motes ──
  const cables = createCables(plan.cables, materials);
  if (cables) group.add(cables);
  const steam = createSteam(plan.vents, layout.mood.seed);
  if (steam) group.add(steam.mesh);
  let motes: AmbientParticles | null = null;
  let motesDensity = -1;
  const makeMotes = (p: QualityPreset) => {
    const density = p.level === 'low' ? 0.4 : p.level === 'medium' ? 0.7 : 1;
    if (density === motesDensity) return;
    motesDensity = density;
    if (motes) {
      group.remove(motes.mesh);
      motes.dispose();
    }
    motes = createAmbientParticles(plan.bounds, layout.mood, density);
    group.add(motes.mesh);
  };
  makeMotes(preset);

  // ── lights: a budgeted pool picked around the camera ──
  const lights = new LightPool(plan.lights, preset.maxPointLights, MAX_POINT_LIGHTS);
  for (const c of lights.candidates) {
    const m = /^sign:.*#(\d+)$/.exec(c.def.source);
    if (m) c.follows = signs[Number(m[1])] ?? null;
  }
  group.add(lights.group);

  // ── abyss and rain (main camera only: the puddles need not mirror them) ──
  const backdrop = new THREE.Group();
  backdrop.name = 'backdrop';
  group.add(backdrop);
  let abyss = createAbyss(plan.bounds, preset.abyssLights, layout.mood.seed);
  setObjectLayers(abyss.children[0], LAYER.MAIN);
  backdrop.add(abyss);
  const rain = createRain(QUALITY_RAIN_MAX);
  rain.setAmount(layout.mood.rain * (preset.rainDrops / QUALITY_RAIN_MAX));
  setObjectLayers(rain.mesh, LAYER.MAIN);
  backdrop.add(rain.mesh);

  let abyssCount = preset.abyssLights;
  let first = true;

  return {
    group,
    lights,
    signs,
    rain,
    backdrop,
    instances: merger.count,
    staticTriangles: merged.triangles.big + merged.triangles.detail + merged.triangles.props + merged.triangles.roof,
    staticClasses: merged.triangles,
    staticVertices: merged.vertices,
    staticRanges: merged.ranges,
    update(dt, time, focus, camera) {
      for (const s of signs) s.update(dt);
      if (camera) merged.cullFacing(camera);
      (motes as AmbientParticles | null)?.center.value.set(focus.x, 0, focus.z);
      lights.update(dt, time, focus, first);
      first = false;
    },
    nestedPasses(camera) {
      if (!reflection) return [];
      const base = reflection.reflector;
      const mirrored = base.getVirtualCamera(camera);
      setCameraLayers(mirrored, LAYER.REFLECT);
      return [{ camera: mirrored, target: base.getRenderTarget(mirrored) }];
    },
    applyPreset(p) {
      lights.setBudget(p.maxPointLights);
      rain.setAmount(layout.mood.rain * (p.rainDrops / QUALITY_RAIN_MAX));
      const key = `${p.reflection}|${p.msaa}`;
      if (key !== reflectionKey) {
        reflectionKey = key;
        const old = ground.material as THREE.Material;
        ground.material = makeGround(p);
        old.dispose();
      }
      if (p.abyssLights !== abyssCount) {
        abyssCount = p.abyssLights;
        backdrop.remove(abyss);
        disposeOwned(abyss);
        abyss = createAbyss(plan.bounds, p.abyssLights, layout.mood.seed);
        setObjectLayers(abyss.children[0], LAYER.MAIN);
        backdrop.add(abyss);
      }
      makeMotes(p);
    },
    dispose() {
      for (const s of signs) s.dispose();
      disposeOwned(abyss);
      disposeOwned(rain.mesh);
      if (cables) disposeOwned(cables, false);
      steam?.dispose();
      (motes as AmbientParticles | null)?.dispose();
      lights.dispose();
      // static geometry belongs to the level; the static material is shared
      for (const o of merged.group.children) {
        if ((o as THREE.BatchedMesh).isBatchedMesh) (o as THREE.BatchedMesh).dispose();
        else (o as THREE.Mesh).geometry.dispose();
      }
      top.dispose();
      skirt.dispose();
      (ground.material as THREE.Material).dispose();
      (reflection as StreetReflection | null)?.reflector.dispose();
    },
  };
}

/** Rain geometry is built once at the largest size; quality only changes how many drops show. */
const QUALITY_RAIN_MAX = 2000;

/** Dispose geometry (and material) of meshes created for this level only (abyss lights, rain). */
function disposeOwned(root: THREE.Object3D, materials = true): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    if (materials) (mesh.material as THREE.Material).dispose();
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) (mesh as THREE.InstancedMesh).dispose();
  });
}
