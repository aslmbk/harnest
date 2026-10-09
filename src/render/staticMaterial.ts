/**
 * One material for all static level geometry (facades, roofs, props, dressing). Surface parameters come
 * from vertex attributes, so a whole chunk of the level is one draw call whatever its palette, and every
 * pass (main, street reflection, shadow) shares one pipeline:
 *
 *   sc  unorm8x4  base colour (sRGB; baked AO and the building tint multiplied in) · roughness
 *   se  unorm8x4  emissive colour (sRGB) · strength / EMISSIVE_RANGE
 *   sm  unorm8x4  metalness · kind / 255 · per-placement seed · occluder flag
 *
 * Kinds (`STATIC_KIND`): plain · painted wall (rain streaks, damp foot, glossier when wet) · lit window
 * (per-placement brightness, some nearly off) · beacon (slow red blink) · flicker (rare neon dropouts).
 * Upward-facing surfaces turn glossy in the rain (`staticRain`).
 */
import * as THREE from 'three/webgpu';
import {
  attribute,
  float,
  floor,
  fract,
  hash,
  max,
  mix,
  mx_noise_float,
  normalWorld,
  positionWorld,
  pow,
  sin,
  smoothstep,
  sRGBTransferEOTF,
  step,
  time,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import { applyOcclusion } from './occlusion';
import type { MatSpec } from './palette';

/** Emission strength that maps to 255 in the `se.a` channel. */
export const EMISSIVE_RANGE = 16;

export const STATIC_KIND = { plain: 0, wall: 1, window: 2, beacon: 3, flicker: 4 } as const;
export type StaticKind = (typeof STATIC_KIND)[keyof typeof STATIC_KIND];

/** Rain on the level (0..1): wet roofs and ledges. Set per level by the builder. */
export const staticRain = uniform(0);

/** Bytes of one vertex's surface data, ready for the three unorm8x4 attributes. */
export interface SurfaceBytes {
  sc: [number, number, number, number];
  se: [number, number, number, number];
  sm: [number, number, number, number];
}

const toByte = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
/** Linear → sRGB-encoded byte (8-bit storage is perceptually even in sRGB, so dark colours keep detail). */
const linToSrgbByte = (c: number) => toByte(c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/** Palette colours parsed once: `Color.set(css)` (sRGB → linear) is a regex parse, run per baked part. */
const parsed = new Map<string, THREE.Color>();
function linear(css: string): THREE.Color {
  let c = parsed.get(css);
  if (!c) parsed.set(css, (c = new THREE.Color().set(css)));
  return c;
}

/**
 * Surface bytes for a palette spec. `rgbScale` multiplies the base colour in linear space (vertex AO ×
 * building tint), per vertex.
 */
export function surfaceBytes(
  spec: MatSpec,
  kind: StaticKind,
  seed: number,
  occluder: boolean,
  emissiveScale: number,
  out: SurfaceBytes,
  rgbScale: readonly [number, number, number] = [1, 1, 1],
): SurfaceBytes {
  const c = linear(spec.color);
  out.sc[0] = linToSrgbByte(c.r * rgbScale[0]);
  out.sc[1] = linToSrgbByte(c.g * rgbScale[1]);
  out.sc[2] = linToSrgbByte(c.b * rgbScale[2]);
  out.sc[3] = toByte(spec.rough);
  if (spec.emissive && spec.strength) {
    const e = linear(spec.emissive);
    out.se[0] = linToSrgbByte(e.r);
    out.se[1] = linToSrgbByte(e.g);
    out.se[2] = linToSrgbByte(e.b);
    out.se[3] = toByte((spec.strength * emissiveScale) / EMISSIVE_RANGE);
  } else {
    out.se[0] = out.se[1] = out.se[2] = out.se[3] = 0;
  }
  out.sm[0] = toByte(spec.metal);
  out.sm[1] = kind;
  out.sm[2] = toByte(seed);
  out.sm[3] = occluder ? 255 : 0;
  return out;
}

export function emptySurface(): SurfaceBytes {
  return { sc: [0, 0, 0, 0], se: [0, 0, 0, 0], sm: [0, 0, 0, 0] };
}

/**
 * Base-colour bytes of many vertices at once: `out[3k..3k+2]` are exactly the `sc` rgb bytes that
 * `surfaceBytes(spec, …, [col[3k] * tint[0], col[3k+1] * tint[1], col[3k+2] * tint[2]])` gives (same
 * operations in the same order), for `count` vertices of vertex colour `col`.
 */
export function surfaceColorBytes(spec: MatSpec, col: ArrayLike<number>, tint: readonly [number, number, number], count: number, out: Uint8Array): Uint8Array {
  const { r, g, b } = linear(spec.color);
  const [tr, tg, tb] = tint;
  for (let k = 0, i = 0; k < count; k++, i += 3) {
    out[i] = linToSrgbByte(r * (col[i] * tr));
    out[i + 1] = linToSrgbByte(g * (col[i + 1] * tg));
    out[i + 2] = linToSrgbByte(b * (col[i + 2] * tb));
  }
  return out;
}

let shared: THREE.MeshStandardNodeMaterial | null = null;

/** The shared static-level material (created once). */
export function staticMaterial(): THREE.MeshStandardNodeMaterial {
  if (shared) return shared;
  const m = new THREE.MeshStandardNodeMaterial();
  m.name = 'M_Static';
  const sc = attribute('sc', 'vec4');
  const se = attribute('se', 'vec4');
  const sm = attribute('sm', 'vec4');
  const kind = floor(sm.y.mul(255).add(0.5));
  const isWall = step(0.5, kind).mul(step(kind, 1.5));
  const isWindow = step(1.5, kind).mul(step(kind, 2.5));
  const isBeacon = step(2.5, kind).mul(step(kind, 3.5));
  const isFlicker = step(3.5, kind).mul(step(kind, 4.5));
  const seed = sm.z;
  const p = positionWorld;

  // painted plaster: darker wet foot, vertical rain streaks, large blotches
  const streaks = mx_noise_float(vec2(p.x.add(p.z).mul(1.9), p.y.mul(0.18))).mul(0.5).add(0.5);
  const splash = smoothstep(0.0, 1.3, p.y).mul(0.4).add(0.6);
  const blotch = mx_noise_float(vec2(p.x.add(p.z).mul(0.35), p.y.mul(0.35))).mul(0.12);
  const wallTone = splash.mul(mix(0.78, 1.06, streaks)).add(blotch);
  const base = sRGBTransferEOTF(sc.rgb) as THREE.Node<'vec3'>;
  // Branches (`select` compiles to if / else) so only wall fragments pay for the noise. Each branch keeps
  // the expression it replaces: `mix(a, b, isWall)` with isWall = 0 is exactly a (a·1 + b·0), so the
  // non-wall side is a, and the wall side is the same mix as before — the same numbers either way.
  const wall = isWall.greaterThan(0.5);
  m.colorNode = base.mul(wall.select(mix(float(1), wallTone, isWall), float(1)));

  // roughness: walls glossier at the wet foot; anything facing up gets wet in the rain
  const wallRough = mix(float(0.55), float(0.92), smoothstep(0.0, 1.1, p.y));
  const rough = wall.select(mix(sc.a, wallRough, isWall), sc.a);
  const up = smoothstep(0.75, 0.95, normalWorld.y).mul(staticRain);
  m.roughnessNode = mix(rough, rough.mul(0.45).max(0.08), up);
  m.metalnessNode = sm.x;

  // emission: lit windows vary per placement (some nearly off), beacons blink, neon props drop out
  const h = hash(seed.mul(4096).add(17));
  const windowLevel = mix(float(0.2), float(0.95), h.mul(h)).mul(step(0.12, h));
  const blink = pow(max(sin(time.mul(2.2).add(seed.mul(40))), 0), 12).mul(1.4).add(0.06);
  const flickT = time.mul(9).add(seed.mul(97));
  const flick = step(0.93, hash(floor(flickT))).mul(step(0.5, fract(flickT.mul(3.7)))).oneMinus().mul(0.85).add(0.15);
  // plain and wall kinds: every factor is mix(1, x, 0) = 1, so the level is exactly 1
  const level = kind.greaterThan(1.5).select(mix(float(1), windowLevel, isWindow).mul(mix(float(1), blink, isBeacon)).mul(mix(float(1), flick, isFlicker)), float(1));
  // no emission (se.a = 0): the product is exactly 0 (finite factors), so skip it
  m.emissiveNode = se.a.greaterThan(0).select((sRGBTransferEOTF(se.rgb) as THREE.Node<'vec3'>).mul(se.a.mul(EMISSIVE_RANGE)).mul(level), vec3(0));

  applyOcclusion(m, sm.w);
  shared = m;
  return m;
}
