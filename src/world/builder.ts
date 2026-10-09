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
import { MAX_POINT_LIGHTS, QUALITY_PRESETS } from '../engine/quality';
import { createAbyss, createRain, setAbyssCount, type Rain } from '../render/atmosphere';
import {
  buildGroundGeometry,
  createGroundMaterial,
  createStreetReflection,
  disposeStreetReflection,
  setReflectionQuality,
  setReflectionSamples,
  type StreetReflection,
} from '../render/ground';
import { LAYER, setCameraLayers, setObjectLayers } from '../render/layers';
import type { MaterialLibrary } from '../render/materials';
import { createNeonSign, type NeonSign } from '../render/neon';
import { createCables } from '../render/cables';
import { createAmbientParticles, createSteam, type AmbientParticles } from '../render/particles';
import { staticRain } from '../render/staticMaterial';
import type { LevelPlan } from './levelPlan';
import { LightPool } from './lightPool';
import { freeze } from '../engine/freeze'; // [freeze]
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
  /**
   * Re-apply quality (light budget, abyss density, reflection, particles). Compile-free: it only changes
   * uniforms, counts, draw ranges and render-target sizes, never a material, a mesh or a shader.
   */
  applyPreset(preset: QualityPreset): void;
  /** MSAA samples of the street reflection's targets (to match a new scene-pass count; its pipelines need a precompile). */
  setMsaa(samples: number): void;
  /** Passes nested in the scene pass to precompile for `camera` (the puddle reflection, also while quality has it off). */
  nestedPasses(camera: THREE.Camera): NestedPass[];
  dispose(): void;
}

/** Abyss lights are built for the largest preset; quality draws a prefix of them. */
const MAX_ABYSS_LIGHTS = Math.max(...Object.values(QUALITY_PRESETS).map((p) => p.abyssLights));

/**
 * @param preset quality to start with; `preset.msaa` must be the engine's session sample count (the
 *   street reflection's render target is created with it).
 * @param mirror false: no street reflection at all (the top-down map view).
 */
export function buildLevel(level: LevelDef, plan: LevelPlan, assets: AssetLibrary, materials: MaterialLibrary, preset: QualityPreset, mirror = true): BuiltLevel {
  const { layout } = level;
  const group = new THREE.Group();
  group.name = `level:${level.id}`;
  staticRain.value = layout.mood.rain;

  // ── ground (with the planar street reflection) and terrace edge ──
  // One ground material for the whole level: the reflection exists on every preset (idle on low, where
  // the ground reads black from it), so a quality change never rebuilds the ground shader.
  const { top, skirt } = buildGroundGeometry(plan.grid, 4);
  const reflection: StreetReflection | null = mirror ? createStreetReflection(preset.reflection, preset.msaa) : null;
  if (reflection) group.add(reflection.target);
  const ground = new THREE.Mesh(top, createGroundMaterial(layout.mood.rain, reflection, layout.mood.seed));
  ground.name = 'ground';
  ground.receiveShadow = true;
  group.add(ground);
  const edge = new THREE.Mesh(skirt, materials.get('M_ConcreteDark'));
  edge.name = 'terrace-edge';
  edge.receiveShadow = true;
  group.add(edge);

  // ── neon signs: created first, their images paint in a worker while the static geometry merges ──
  const signs = layout.signs.map((def, i) => createNeonSign(def, materials, layout.mood.seed + i * 31));

  // ── static geometry: chunks with one shared material ──
  const merger = new StaticMerger();
  const tints = plan.lots.map((l) => new THREE.Color(l.tint));
  plan.placements.forEach((p, i) => merger.add(p, p.lot !== undefined ? tints[p.lot] : null, placementSeed(layout.mood.seed, i)));
  const merged = merger.build(assets, materials, plan);
  group.add(merged.group);

  for (const s of signs) group.add(s.group);

  // ── hanging cables, steam, ambient motes ──
  const cables = createCables(plan.cables, materials);
  if (cables) group.add(cables);
  const steam = createSteam(plan.vents, layout.mood.seed);
  if (steam) group.add(steam.mesh);
  steam?.setQuality(preset.level);
  // built at full density; quality draws the first particles only (each particle depends on its index
  // alone, so the first n are exactly the particles a build with n would make)
  const motes: AmbientParticles = createAmbientParticles(plan.bounds, layout.mood, 1);
  group.add(motes.mesh);
  const motesFull = (motes.mesh.geometry.index?.count ?? 0) / 6;
  const setMotes = (p: QualityPreset) => {
    const density = p.level === 'low' ? 0.4 : p.level === 'medium' ? 0.7 : 1;
    motes.mesh.geometry.setDrawRange(0, Math.round(motesFull * density) * 6);
  };
  setMotes(preset);

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
  const abyss = createAbyss(plan.bounds, MAX_ABYSS_LIGHTS, layout.mood.seed);
  setAbyssCount(abyss, preset.abyssLights);
  setObjectLayers(abyss.children[0], LAYER.MAIN);
  backdrop.add(abyss);
  const rain = createRain(QUALITY_RAIN_MAX);
  rain.setAmount(layout.mood.rain * (preset.rainDrops / QUALITY_RAIN_MAX));
  setObjectLayers(rain.mesh, LAYER.MAIN);
  backdrop.add(rain.mesh);

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
      motes.center.value.set(focus.x, 0, focus.z);
      lights.update(dt, time, focus, first || freeze.active); // [freeze] no fades, no history
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
      if (reflection) setReflectionQuality(reflection, p.reflection);
      setAbyssCount(abyss, p.abyssLights);
      setMotes(p);
      steam?.setQuality(p.level);
    },
    setMsaa(samples) {
      if (reflection) setReflectionSamples(reflection, samples);
    },
    dispose() {
      for (const s of signs) s.dispose();
      disposeOwned(abyss);
      disposeOwned(rain.mesh);
      if (cables) disposeOwned(cables, false);
      steam?.dispose();
      motes.dispose();
      lights.dispose();
      // static geometry belongs to the level; the static material is shared
      for (const o of merged.group.children) {
        if ((o as THREE.BatchedMesh).isBatchedMesh) (o as THREE.BatchedMesh).dispose();
        else (o as THREE.Mesh).geometry.dispose();
      }
      top.dispose();
      skirt.dispose();
      (ground.material as THREE.Material).dispose();
      if (reflection) disposeStreetReflection(reflection);
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
