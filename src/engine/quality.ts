/**
 * Quality presets and the automatic picker (by frame time). Pure: the engine applies the preset.
 */
import type { Quality } from '../core/store';

export type QualityLevel = Exclude<Quality, 'auto'>;

export interface QualityPreset {
  level: QualityLevel;
  /** Device pixel ratio cap. */
  dprCap: number;
  /** MSAA samples of the scene pass (0 = off). */
  msaa: number;
  shadows: boolean;
  shadowMapSize: number;
  /** Render scale of the bloom chain. */
  bloomScale: number;
  /** Point light budget for level lights (the headlamp is extra). */
  maxPointLights: number;
  /** Twinkling lights of the lower city. */
  abyssLights: number;
  /** Rain streak count (scaled by the level's rain amount). */
  rainDrops: number;
  /** Resolution scale of the planar street reflection (0 = off: puddles reflect the environment only). */
  reflection: number;
}

export const QUALITY_PRESETS: Readonly<Record<QualityLevel, QualityPreset>> = {
  low: {
    level: 'low',
    dprCap: 1,
    msaa: 0,
    shadows: false,
    shadowMapSize: 512,
    bloomScale: 0.25,
    maxPointLights: 6,
    abyssLights: 140,
    rainDrops: 500,
    reflection: 0,
  },
  medium: {
    level: 'medium',
    dprCap: 1.25,
    msaa: 4,
    shadows: true,
    shadowMapSize: 1024,
    bloomScale: 0.5,
    maxPointLights: 14,
    abyssLights: 320,
    rainDrops: 1200,
    reflection: 0.35,
  },
  high: {
    level: 'high',
    dprCap: 2,
    msaa: 4,
    shadows: true,
    shadowMapSize: 2048,
    bloomScale: 0.5,
    maxPointLights: 24,
    abyssLights: 520,
    rainDrops: 2000,
    reflection: 0.5,
  },
};

/** Size of the point-light uniform arrays (≥ every preset's budget; the budget changes without recompiles). */
export const MAX_POINT_LIGHTS = 24;

const ORDER: readonly QualityLevel[] = ['low', 'medium', 'high'];

export function stepQuality(level: QualityLevel, dir: -1 | 1): QualityLevel {
  const i = Math.min(ORDER.length - 1, Math.max(0, ORDER.indexOf(level) + dir));
  return ORDER[i];
}

/**
 * Picks a preset from measured frame times. Starts at `start`, waits `warmup` seconds, then judges
 * windows of `window` seconds: too slow → one step down; very fast twice in a row → one step up, but
 * never back up to a level it already dropped from (no ping-pong).
 */
/** Frames longer than this (ms) are stalls, not frame rate. */
const HITCH_MS = 250;

export class AutoQuality {
  level: QualityLevel;
  private acc = 0;
  private frames = 0;
  private elapsed = 0;
  private warm = 0;
  private fastWindows = 0;
  private ceiling: QualityLevel = 'high';
  private changes = 0;

  constructor(
    start: QualityLevel = 'medium',
    private readonly opts = { warmup: 2.5, window: 2, slowMs: 21, fastMs: 11, maxChanges: 4 },
  ) {
    this.level = start;
  }

  /** Feed one frame. Returns the new level when it changes, else null. */
  sample(frameMs: number): QualityLevel | null {
    const dt = frameMs / 1000;
    if (this.warm < this.opts.warmup) {
      this.warm += dt;
      return null;
    }
    if (this.changes >= this.opts.maxChanges) return null;
    if (frameMs > HITCH_MS) {
      // a stall (back from a hidden tab, a shader compile, a GC) says nothing about the steady frame
      // rate, and it would close the window early with an average made of the stall: start over
      this.acc = 0;
      this.frames = 0;
      this.elapsed = 0;
      return null;
    }
    this.acc += Math.min(frameMs, 100);
    this.frames++;
    this.elapsed += dt;
    if (this.elapsed < this.opts.window) return null;
    const avg = this.acc / this.frames;
    this.acc = 0;
    this.frames = 0;
    this.elapsed = 0;
    if (avg > this.opts.slowMs && this.level !== 'low') {
      this.ceiling = stepQuality(this.level, -1);
      return this.change(this.ceiling);
    }
    if (avg < this.opts.fastMs && this.level !== this.ceiling) {
      if (++this.fastWindows >= 2) return this.change(stepQuality(this.level, 1));
    } else {
      this.fastWindows = 0;
    }
    return null;
  }

  private change(level: QualityLevel): QualityLevel | null {
    if (level === this.level) return null;
    this.level = level;
    this.fastWindows = 0;
    this.warm = this.opts.warmup - 1; // short settle time after a change
    this.changes++;
    return level;
  }
}
