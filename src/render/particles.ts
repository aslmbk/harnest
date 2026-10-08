/**
 * Ambient particles, all animated on the GPU (no per-frame uploads):
 *  - steam puffs rising from street vents, manholes and roof vents (`plan.vents`);
 *  - drifting dust motes and a few fireflies around the camera target.
 * Both are camera-facing quads built in view space by the vertex stage, one draw call each.
 */
import * as THREE from 'three/webgpu';
import {
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  color,
  cos,
  float,
  fract,
  hash,
  length,
  mix,
  mx_noise_float,
  positionGeometry,
  pow,
  sin,
  smoothstep,
  time,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl';
import type { LevelMood } from '../content/types';
import type { SteamVent } from '../world/levelPlan';
import { LAYER, setObjectLayers } from './layers';

export interface Particles {
  mesh: THREE.Mesh;
  update?(dt: number): void;
  dispose(): void;
}

/** Quads (corners in `position.xy`, ±0.5) with per-particle attributes. */
function quads(count: number, attrs: Record<string, { size: number; value: (i: number) => readonly number[] }>): THREE.BufferGeometry {
  const pos = new Float32Array(count * 4 * 3);
  const uvs = new Float32Array(count * 4 * 2);
  const index = new Uint32Array(count * 6);
  const extra: Record<string, Float32Array> = {};
  for (const [name, a] of Object.entries(attrs)) extra[name] = new Float32Array(count * 4 * a.size);
  const corners = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ];
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 4; k++) {
      const v = i * 4 + k;
      pos[v * 3] = corners[k][0];
      pos[v * 3 + 1] = corners[k][1];
      uvs[v * 2] = corners[k][0] + 0.5;
      uvs[v * 2 + 1] = corners[k][1] + 0.5;
      for (const [name, a] of Object.entries(attrs)) {
        const val = a.value(i);
        for (let j = 0; j < a.size; j++) extra[name][v * a.size + j] = val[j];
      }
    }
    index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  for (const [name, a] of Object.entries(attrs)) geo.setAttribute(name, new THREE.BufferAttribute(extra[name], a.size));
  geo.setIndex(new THREE.BufferAttribute(count * 4 > 65535 ? index : Uint16Array.from(index), 1));
  return geo;
}

/**
 * Particle id for `rnd`: an integer (stored as a float, exact below 2^24), unique per particle and
 * shifted by the level seed so districts differ.
 */
function particleId(i: number, seed: number): number {
  return i + ((Math.abs(Math.round(seed)) * 7919) % 50000);
}

/**
 * Random 0..1 per particle and channel. TSL `hash` truncates its seed to an unsigned integer (a seed
 * in 0..1 would give every particle the same value), so the integer id is spread over disjoint
 * ranges, one per channel.
 */
function rnd(id: THREE.Node<'float'>, channel: number): THREE.Node<'float'> {
  return hash(id.add(channel * 131072));
}

/** Billboard: the particle centre in view space plus the quad corner scaled by `size`. */
function billboard(center: THREE.Node<'vec3'>, size: THREE.Node<'float'>) {
  const view = cameraViewMatrix.mul(vec4(center, 1));
  return cameraProjectionMatrix.mul(view.add(vec4(positionGeometry.xy.mul(size), 0, 0)));
}

/**
 * Steam puffs from vents: grow, rise, fan out, drift with the wind and fade. The camera looks down at
 * the street, so a vertical column of puffs would stack into one opaque blob: puffs are faint, few,
 * wispy (noise-eroded edges) and spread sideways as they rise, which reads as a plume from above.
 */
export function createSteam(vents: readonly SteamVent[], seed: number): Particles | null {
  if (!vents.length) return null;
  const list: { v: SteamVent; k: number }[] = [];
  for (const v of vents) {
    const n = Math.round(4 + 5 * v.strength);
    for (let k = 0; k < n; k++) list.push({ v, k });
  }
  const geo = quads(list.length, {
    vent: { size: 4, value: (i) => [list[i].v.x, list[i].v.y, list[i].v.z, list[i].v.strength] },
    pid: { size: 1, value: (i) => [particleId(i, seed)] },
  });
  const vent = attribute('vent', 'vec4');
  const id = attribute('pid', 'float');
  const strength = vent.w;
  const life = fract(time.mul(rnd(id, 0).mul(0.08).add(0.13)).add(rnd(id, 1)));
  // rises fast, then slows down as it cools
  const rise = pow(life, 0.8).mul(rnd(id, 2).mul(0.6).add(0.9)).mul(strength.mul(0.8).add(0.4));
  // fans out around the vent and drifts with the wind (+X)
  const angle = rnd(id, 3).mul(Math.PI * 2);
  const spread = life.mul(rnd(id, 4).mul(0.35).add(0.25));
  const wind = life.mul(0.8);
  const centre = vent.xyz.add(vec3(cos(angle).mul(spread).add(wind), rise, sin(angle).mul(spread)));
  const size = mix(float(0.25), float(1.3), pow(life, 0.6)).mul(strength.mul(0.4).add(0.6));
  const m = new THREE.MeshBasicNodeMaterial();
  m.name = 'M_Steam';
  m.transparent = true;
  m.depthWrite = false;
  m.fog = false;
  m.vertexNode = billboard(centre, size);
  // wispy edge: the radius is eroded by slowly churning noise, different for every puff
  const q = uv().sub(0.5).mul(2);
  const churn = mx_noise_float(vec3(q.mul(1.7), rnd(id, 5).mul(40).add(time.mul(0.3))));
  const shape = smoothstep(1, 0.15, length(q).add(churn.mul(0.45)));
  // densest in mid-life, when the puff has left the vent: from above the plume reads as a trail, not a ball
  const fade = pow(sin(life.mul(Math.PI)), 1.5);
  m.colorNode = mix(color('#a4b6c0'), color('#d2c4b6'), rnd(id, 6)).mul(0.5);
  m.opacityNode = shape.mul(shape).mul(fade).mul(strength.mul(0.15).add(0.05));
  const mesh = new THREE.Mesh(geo, m);
  mesh.name = 'steam';
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  setObjectLayers(mesh, LAYER.MAIN);
  return {
    mesh,
    dispose() {
      geo.dispose();
      m.dispose();
    },
  };
}

export interface AmbientParticles extends Particles {
  /** World point the motes stay around (the camera target). */
  center: { value: THREE.Vector3 };
}

/**
 * Dust motes drifting in the lamp light, and a few fireflies (more of them in dry districts). They
 * live in a box around the camera target, wrapped in world space so they do not slide with the camera.
 */
export function createAmbientParticles(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, mood: LevelMood, density: number): AmbientParticles {
  const W = 26;
  const D = 22;
  const count = Math.round(220 * density);
  const fireflies = 0.06 + 0.16 * (1 - mood.rain);
  const geo = quads(count, {
    pid: { size: 1, value: (i) => [particleId(i, mood.seed)] },
  });
  const center = uniform(new THREE.Vector3((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2));
  const id = attribute('pid', 'float');
  const wrap = (h: THREE.Node<'float'>, c: THREE.Node<'float'>, size: number) => fract(h.sub(c.div(size))).sub(0.5).mul(size).add(c);
  const drift = time.mul(0.05);
  const phase = rnd(id, 7).mul(Math.PI * 2);
  const x = wrap(rnd(id, 0).add(sin(time.mul(0.11).add(phase)).mul(0.02)).add(drift.mul(0.3)), center.x, W);
  const z = wrap(rnd(id, 1).add(cos(time.mul(0.09).add(phase.mul(1.7))).mul(0.02)), center.z, D);
  const y = rnd(id, 2).mul(4.2).add(0.25).add(sin(time.mul(0.35).add(phase.mul(2.3))).mul(0.25));
  const isFly = rnd(id, 3).lessThan(fireflies);
  const size = isFly.select(float(0.07), rnd(id, 4).mul(0.025).add(0.018));
  const m = new THREE.MeshBasicNodeMaterial();
  m.name = 'M_Motes';
  m.transparent = true;
  m.depthWrite = false;
  m.blending = THREE.AdditiveBlending;
  m.fog = false;
  m.vertexNode = billboard(vec3(x, y, z), size);
  const r = length(uv().sub(0.5)).mul(2);
  const dot = smoothstep(1, 0, r);
  const tw = sin(time.mul(rnd(id, 5).mul(1.8).add(0.6)).add(rnd(id, 6).mul(Math.PI * 2))).mul(0.5).add(0.5);
  const fly = color('#c9ff6e').mul(pow(tw, 3).mul(3.2).add(0.15));
  const dust = color('#ffd7a8').mul(tw.mul(0.22).add(0.08));
  m.colorNode = isFly.select(fly, dust).mul(dot);
  const mesh = new THREE.Mesh(geo, m);
  mesh.name = 'motes';
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;
  setObjectLayers(mesh, LAYER.MAIN);
  return {
    mesh,
    center,
    dispose() {
      geo.dispose();
      m.dispose();
    },
  };
}
