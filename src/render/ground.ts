/**
 * Wet street ground (TSL): 1 m slabs with grooves and per-slab tone, puddles from noise (glossy and dark,
 * they catch the neon and the headlamp), metal grates for '=' tiles. One mesh per level built from the
 * tile grid, plus the terrace edge going down into the abyss.
 *
 * Puddles mirror the scene through a planar reflection on medium / high (`createStreetReflection`) and
 * the procedural city environment everywhere; rain rings ruffle them.
 */
import * as THREE from 'three/webgpu';
import {
  abs,
  attribute,
  color,
  cos,
  float,
  floor,
  fract,
  hash,
  length,
  max,
  min,
  mix,
  mx_noise_float,
  positionWorld,
  reflector,
  smoothstep,
  step,
  time,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import { TILE } from '../content/types';
import { LAYER, setCameraLayers } from './layers';
import type { TileGrid } from '../world/tiles';
import { HALF } from '../world/tiles';

/** Value of the `kind` vertex attribute. */
export const GROUND_KIND = { floor: 0, wet: 1, grate: 2, solid: 3 } as const;

/**
 * Far plane of the mirrored view (m). The longest path a puddle shows is camera → far edge of the view →
 * up to a facade top: about 47 m at the default zoom, 56 m zoomed out (24 m, pitch 52°, FOV 35°).
 */
const REFLECT_FAR = 70;

/**
 * `paused`: set while pipelines precompile, the reflection must not render the scene synchronously then.
 * `force`: set for the precompile frame, the reflection renders even when quality has it off, so its
 * pipelines exist when quality turns it on.
 */
export const reflectionControl = { paused: false, force: false };

/** Resolution scale a reflection made while quality has it off starts with (the medium preset's). */
const IDLE_SCALE = 0.35;

interface ReflectionState {
  /** Rendered every frame (medium / high); off on low: not rendered, the ground samples black. */
  enabled: boolean;
  /** The render target holds a picture while off: cleared to black at the next frame. */
  stale: boolean;
  /** What the ground samples until the reflection first renders (see `createStreetReflection`). */
  placeholder: THREE.RenderTarget;
}
const reflectionStates = new WeakMap<StreetReflection, ReflectionState>();

/**
 * 1 in the map view: puddles off. Seen straight down, a mirror-like puddle reflects the black zenith
 * and reads as a hole in the floor, which is exactly what a layout check must not show.
 */
export const groundOverview = uniform(0);

export type StreetReflection = ReturnType<typeof reflector>;

/**
 * Planar mirror of the scene at y = 0. The scene is rendered once more per frame from below at a
 * fraction of the resolution; the ground mixes it into puddles and wet slabs. `samples` should match the
 * scene pass MSAA so both passes share the same pipelines. A `resolutionScale` of 0 (low quality) makes
 * it idle: nothing is rendered and the ground reads black from it (no reflection), with the same ground
 * shader, so quality can turn it on and off with `setReflectionQuality` without a recompile.
 */
export function createStreetReflection(resolutionScale: number, samples: number): StreetReflection {
  // Its own stand-in texture until the first reflection render, like three's default (an empty 1×1
  // target, never drawn: the precompile frames render the reflection before any frame is shown). Three's
  // default is one render target shared by every reflector, and the renderer keeps every bind group that
  // ever sampled it listed on it (r186 untracks a bind group only from the texture it holds at the end):
  // through the ground's bind group each disposed level stayed reachable (≈ 60 MB per load).
  const placeholder = new THREE.RenderTarget();
  const params: NonNullable<Parameters<typeof reflector>[0]> & { defaultTexture: THREE.Texture } = {
    resolutionScale: resolutionScale > 0 ? resolutionScale : IDLE_SCALE,
    samples,
    bounces: false,
    defaultTexture: placeholder.texture,
  };
  const r = reflector(params);
  r.target.rotateX(-Math.PI / 2);
  r.target.name = 'street-reflection';
  const state: ReflectionState = { enabled: resolutionScale > 0, stale: false, placeholder };
  reflectionStates.set(r, state);
  const base = r.reflector;
  const update = base.updateBefore.bind(base);
  base.updateBefore = (frame) => {
    if (reflectionControl.paused || !frame.camera) return undefined;
    if (!state.enabled) {
      if (!reflectionControl.force) {
        if (state.stale) {
          state.stale = false;
          clearTarget(frame.renderer as THREE.Renderer, base.getRenderTarget(base.getVirtualCamera(frame.camera)));
        }
        return undefined;
      }
      state.stale = true;
    }
    // the mirrored camera renders the cheap reflection set (stand-ins, props, lit windows), not the
    // full-detail facades of the main camera
    setCameraLayers(base.getVirtualCamera(frame.camera), LAYER.REFLECT);
    // …and only as deep as a puddle can show: the mirrored view copies the main camera's projection,
    // whose far plane reaches the lower city, so it would otherwise draw every facade up to the horizon
    const cam = frame.camera as THREE.PerspectiveCamera;
    if (cam.isPerspectiveCamera !== true || cam.far <= REFLECT_FAR) return update(frame);
    const far = cam.far;
    cam.far = REFLECT_FAR;
    cam.updateProjectionMatrix();
    try {
      return update(frame);
    } finally {
      cam.far = far;
      cam.updateProjectionMatrix();
    }
  };
  return r;
}

/** Frees a reflection's render targets and its placeholder texture (with the level). */
export function disposeStreetReflection(r: StreetReflection): void {
  r.reflector.dispose();
  const placeholder = reflectionStates.get(r)?.placeholder;
  placeholder?.texture.dispose(); // sampled, never rendered to: the target's own dispose does not free it
  placeholder?.dispose();
}

/**
 * Quality for an existing reflection: `scale` > 0 renders it at that resolution scale, 0 stops
 * rendering it (the ground then reads black from it, as if it had no reflection). No shader changes.
 */
export function setReflectionQuality(r: StreetReflection, scale: number): void {
  const state = reflectionStates.get(r);
  if (!state) return;
  if (scale > 0) {
    r.reflector.resolutionScale = scale;
    state.enabled = true;
  } else if (state.enabled) {
    state.enabled = false;
    state.stale = true;
  }
}

/**
 * MSAA samples of an existing reflection: its render targets (one per viewing camera) and the ones it
 * creates later. Same shaders; the pipelines of the reflection pass must be precompiled for the new count.
 */
export function setReflectionSamples(r: StreetReflection, samples: number): void {
  const base = r.reflector as unknown as { samples: number; renderTargets: Map<THREE.Camera, THREE.RenderTarget> };
  base.samples = samples;
  for (const target of base.renderTargets.values()) target.samples = samples;
}

/** Clears a render target to the renderer's clear colour (black), from inside a frame. */
function clearTarget(renderer: THREE.Renderer, target: THREE.RenderTarget): void {
  const prevTarget = renderer.getRenderTarget();
  const prevMrt = renderer.getMRT();
  renderer.setMRT(null);
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.setRenderTarget(prevTarget);
  renderer.setMRT(prevMrt);
}

/**
 * @param rain 0..1 — damp film over everything (darker, glossier slabs, water in the grooves), how much
 *   of the street is covered by puddles ('floorWet' tiles always get plenty) and how hard it rains
 *   into them (expanding ripple rings that also ruffle the reflection).
 * @param reflection optional planar reflection mixed into the water.
 * @param seed level seed: moves the puddle pattern, so every district has its own (a uniform: the seed
 *   does not change the shader).
 */
export function createGroundMaterial(rain: number, reflection: StreetReflection | null = null, seed = 0): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  m.name = 'M_Ground';
  const kind = attribute('kind', 'float');
  const isWet = step(0.5, kind).mul(step(kind, 1.5));
  const isGrate = step(1.5, kind).mul(step(kind, 2.5));
  const notGrate = isGrate.oneMinus();
  const p = positionWorld.xz;
  const q = p.add(uniform(new THREE.Vector2((seed * 7.31) % 97, (seed * 3.77) % 89)));

  // slabs: 1 m, grooves, per-slab tone
  const cell = floor(p);
  const f = fract(p);
  const edge = min(min(f.x, f.x.oneMinus()), min(f.y, f.y.oneMinus()));
  const groove = smoothstep(0.0, 0.035, edge);
  const slabHash = hash(cell.x.add(512).add(cell.y.add(512).mul(1024)));
  const tone = mix(float(0.72), float(1.1), slabHash);

  // puddles: patchy, a metre or two across, in wetter and drier stretches; 'floorWet' tiles are mostly
  // water; sunken slabs collect a small pool of their own
  const region = mx_noise_float(q.mul(0.09));
  const n = mx_noise_float(q.mul(0.42)).add(mx_noise_float(q.mul(1.6)).mul(0.22)).add(region.mul(0.22));
  const threshold = float(0.5 - rain * 0.18).sub(isWet.mul(0.5));
  const puddle = smoothstep(threshold, threshold.add(0.07), n).mul(notGrate);
  const sunk = step(0.86, hash(cell.x.add(77).add(cell.y.mul(311)))).mul(smoothstep(0.42, 0.2, length(f.sub(0.5)))).mul(rain);
  // in the rain the grooves hold water too
  const water = max(max(puddle, sunk.mul(notGrate)), groove.oneMinus().mul(rain * 0.85).mul(notGrate)).mul(groundOverview.oneMinus());

  // rain rings: one ring per 0.7 m cell (and a finer second layer), expanding and fading
  const ripples = (size: number, speed: number, salt: number) => {
    const g = p.div(size);
    const c = floor(g);
    const h1 = hash(c.x.add(c.y.mul(57.3)).add(salt));
    const h2 = hash(c.x.mul(13.1).add(c.y).add(salt + 9));
    const centre = c.add(vec2(h1, h2).mul(0.4).add(0.3));
    const phase = fract(time.mul(speed).add(hash(c.x.add(c.y.mul(91.7)).add(salt + 3))));
    const d = length(g.sub(centre));
    const ring = smoothstep(0.045, 0.0, abs(d.sub(phase.mul(0.28)))).mul(float(1).sub(phase)).mul(step(d, 0.3));
    return { ring, dir: g.sub(centre).div(d.max(1e-3)).mul(ring) };
  };
  const r1 = ripples(0.7, 0.85, 0);
  const r2 = ripples(0.43, 1.15, 31);
  const ring = r1.ring.add(r2.ring.mul(0.7)).mul(water).mul(rain);
  const ringDir = r1.dir.add(r2.dir.mul(0.7)).mul(water).mul(rain);

  // grate: 0.25 m bars, dark holes
  const g = fract(p.mul(4));
  const bar = max(step(0.78, g.x), step(0.78, g.y));
  const frame = smoothstep(0.0, 0.06, edge);

  const damp = 1 - rain * 0.35;
  const concrete = color('#3d4146').mul(tone).mul(mix(float(0.5), float(1), groove)).mul(damp);
  const metal = mix(color('#050607'), color('#3b4046'), bar).mul(frame.mul(0.6).add(0.4));
  const base = mix(concrete.mul(mix(float(1), float(0.5), water)), metal, isGrate);

  const dryRough = mix(float(0.5), float(0.72), slabHash).add(groove.oneMinus().mul(0.2));
  const slabRough = mix(dryRough, float(0.3), rain * 0.75);
  const rough = mix(mix(slabRough, float(0.05), water).add(ring.mul(0.25)), float(0.38), isGrate);

  m.colorNode = base;
  m.roughnessNode = rough;
  m.metalnessNode = isGrate.mul(bar).mul(0.85);
  // holes under the grate bars get no ambient light (cheap depth cue)
  m.aoNode = mix(float(1), bar.mul(0.6).add(0.4), isGrate);

  // a thin oily film on some puddles: faint rainbow sheen
  const oil = smoothstep(0.35, 0.75, mx_noise_float(q.mul(0.21).add(13.1))).mul(puddle);
  const film = cos(vec3(0, 2.1, 4.2).add(n.mul(9)).add(time.mul(0.05))).mul(0.5).add(0.5);
  let emissive = film.mul(oil).mul(0.03).add(vec3(ring.mul(0.025)));

  if (reflection) {
    // a slow wobble (wind on the water), a slab-scale tilt and the rain rings break the perfect mirror
    const wob = vec2(mx_noise_float(p.mul(2.3).add(time.mul(0.35))), mx_noise_float(p.mul(2.3).add(vec2(17.3, 5.1)).sub(time.mul(0.35))));
    reflection.uvNode = reflection.uvNode!.add(wob.mul(0.004).add(vec2(slabHash.sub(0.5).mul(0.003), 0)).add(ringDir.mul(0.012)));
    // stylised: puddles mirror strongly, damp slabs a little (real water would be ~3 % at this angle)
    const strength = water.mul(0.78).add(groove.mul(rain * 0.16)).mul(notGrate).mul(ring.mul(0.6).add(1));
    emissive = emissive.add(reflection.rgb.mul(strength));
  }
  m.emissiveNode = emissive;
  return m;
}

/** Ground quads for every non-void tile, plus a skirt down the terrace edge where the map meets the void. */
export function buildGroundGeometry(grid: TileGrid, skirtDepth = 3): { top: THREE.BufferGeometry; skirt: THREE.BufferGeometry } {
  const pos: number[] = [];
  const nor: number[] = [];
  const kind: number[] = [];
  const index: number[] = [];
  grid.forEach((c, r, k) => {
    if (k === 'void') return;
    const x0 = c * TILE - HALF;
    const x1 = c * TILE + HALF;
    const z0 = r * TILE - HALF;
    const z1 = r * TILE + HALF;
    const v = pos.length / 3;
    pos.push(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1);
    nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    const kv = k === 'floorWet' ? GROUND_KIND.wet : k === 'grate' ? GROUND_KIND.grate : k === 'floor' ? GROUND_KIND.floor : GROUND_KIND.solid;
    kind.push(kv, kv, kv, kv);
    index.push(v, v + 2, v + 1, v, v + 3, v + 2);
  });
  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  top.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  top.setAttribute('kind', new THREE.Float32BufferAttribute(kind, 1));
  top.setIndex(index);
  top.computeBoundingSphere();

  // skirt: vertical faces on edges between non-void and void, facing the void
  const sp: number[] = [];
  const sn: number[] = [];
  const si: number[] = [];
  const quad = (ax: number, az: number, bx: number, bz: number, nx: number, nz: number) => {
    const v = sp.length / 3;
    sp.push(ax, 0, az, bx, 0, bz, bx, -skirtDepth, bz, ax, -skirtDepth, az);
    for (let i = 0; i < 4; i++) sn.push(nx, 0, nz);
    // winding so the face points along (nx, nz): (v0, v1, v2) faces −(edge × n)
    const cross = (bx - ax) * nz - (bz - az) * nx;
    if (cross > 0) si.push(v, v + 2, v + 1, v, v + 3, v + 2);
    else si.push(v, v + 1, v + 2, v, v + 2, v + 3);
  };
  grid.forEach((c, r, k) => {
    if (k === 'void') return;
    const x0 = c * TILE - HALF;
    const x1 = c * TILE + HALF;
    const z0 = r * TILE - HALF;
    const z1 = r * TILE + HALF;
    if (grid.isVoid(c, r + 1)) quad(x0, z1, x1, z1, 0, 1);
    if (grid.isVoid(c, r - 1)) quad(x1, z0, x0, z0, 0, -1);
    if (grid.isVoid(c + 1, r)) quad(x1, z1, x1, z0, 1, 0);
    if (grid.isVoid(c - 1, r)) quad(x0, z0, x0, z1, -1, 0);
  });
  const skirt = new THREE.BufferGeometry();
  skirt.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  skirt.setAttribute('normal', new THREE.Float32BufferAttribute(sn, 3));
  skirt.setIndex(si);
  skirt.computeBoundingSphere();
  return { top, skirt };
}
