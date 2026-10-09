/**
 * [freeze] Deterministic render mode for visual-regression shots: `?freeze=<seconds>`.
 *
 * While active, the simulation clock is pinned: the TSL `time` uniform and every JS clock read
 * `freeze.time`, the game loop runs with dt = 0 (time accumulators, blinks, flicker bursts stand still),
 * exponential smoothing settles at once (camera, light fades, faces, screen colours), animation phases
 * that would start at `Math.random()` start at a fixed value, and the automatic quality switch is off.
 * A frame then depends only on the scene and the camera, not on how long the page has run.
 * Without the parameter nothing here changes behaviour.
 */
import type * as THREE from 'three/webgpu';

export const freeze = { active: false, time: 0 };

export function enableFreeze(seconds: number): void {
  freeze.active = true;
  freeze.time = seconds;
  console.info(`[freeze] simulation clock pinned at ${seconds}s`);
}

/** Exponential smoothing factor for a step of `dt` seconds; 1 (settled at once) while frozen. */
export function damp(k: number, dt: number): number {
  return freeze.active ? 1 : 1 - Math.exp(-k * dt);
}

/** `Math.random()` for animation phases; a fixed 0.5 while frozen. */
export function phaseRandom(): number {
  return freeze.active ? 0.5 : Math.random();
}

/** Wall-clock seconds for time-driven JS animation; the pinned time while frozen. */
export function clockSeconds(): number {
  return freeze.active ? freeze.time : performance.now() / 1000;
}

/** Pins the clock behind the TSL `time` / `deltaTime` uniforms (three r186 `NodeFrame`). */
export function pinNodeTime(renderer: THREE.WebGPURenderer): void {
  const frame = (renderer as unknown as { _nodes?: { nodeFrame?: { time: number; deltaTime: number } } })._nodes?.nodeFrame;
  if (!frame) return;
  frame.time = freeze.time;
  frame.deltaTime = 0;
}
