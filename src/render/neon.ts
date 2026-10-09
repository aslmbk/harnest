/**
 * Neon signs generated at runtime from `signs[]` (design doc §5): canvas text → additive emissive quad.
 *
 * The canvas holds three masks of the same text: B = the glass tube (crisp glyphs), R = the white-hot
 * core (the tube eroded), G = a soft halo. The shader tints them (core almost white, tube saturated,
 * halo dim), so letters stay readable under bloom. Commands (`/init`, `claude -p`) use the UI's mono
 * font, words the display font; both are loaded before drawing (`loadSignFonts`). Optional dark backing
 * board with a thin rim, vertical stacking, and flicker bursts (the sign's light follows `level`).
 * The layout is measured here; the masks are painted in a worker (`neon.worker.ts`, same bytes as a
 * main-thread paint, which is the fallback) and cached by layout across levels. All signs share one
 * shader: the colour is a uniform.
 */
import '@fontsource-variable/tektur';
import '@fontsource-variable/jetbrains-mono';
import * as THREE from 'three/webgpu';
import { float, texture, uniform, uv, vec3 } from 'three/tsl';
import { TILE, type NeonSignDef } from '../content/types';
import { facingToYaw } from '../world/tiles';
import { EMISSIVE_SCALE, type MaterialLibrary } from './materials';
import type { FontRule, NeonWorkerReply, NeonWorkerRequest } from './neon.worker';
import { type NeonJob, neonJobKey, paintNeon } from './neonPaint';
import { NEON_HEX } from './palette';

const DISPLAY_FONT = '"Tektur Variable", "Tektur", "Segoe UI", Arial, sans-serif';
const MONO_FONT = '"JetBrains Mono Variable", "JetBrains Mono", Consolas, "Courier New", monospace';
/** Canvas pixels per metre of glyph height (clamped per sign). */
const PX_PER_M = 300;

/** Text that reads as a command gets the mono font. */
export function isCommandText(text: string): boolean {
  return /^[/@!#$>-]|claude|--?[a-z]|\.(md|json|ts)\b/i.test(text.trim());
}

/**
 * Waits (at most `timeoutMs`) until the sign fonts are ready for `texts`, so the canvases are not
 * drawn with a fallback font. Fonts come from the bundled fontsource packages (no network).
 */
export async function loadSignFonts(texts: readonly string[], timeoutMs = 2500): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const sample = `${texts.join('')}АБВабв/-abc`;
  const loads = Promise.all([
    document.fonts.load(`600 64px "Tektur Variable"`, sample),
    document.fonts.load(`700 64px "JetBrains Mono Variable"`, sample),
  ]).catch(() => undefined);
  await Promise.race([loads, new Promise((r) => setTimeout(r, timeoutMs))]);
}

export interface NeonSign {
  group: THREE.Group;
  /** Current brightness 0..1 (drives the sign's point light). */
  readonly level: number;
  update(dt: number): void;
  dispose(): void;
}

interface Drawn {
  /** The texture image: filled at once (main-thread paint) or when the worker replies. */
  canvas: HTMLCanvasElement;
  /** Resolves when `canvas` holds the sign (at once when painted here). */
  ready: Promise<void>;
  /** Canvas pixels per metre. */
  ppm: number;
  /** Text block size in metres (without the glow margin). */
  textW: number;
  textH: number;
}

let probeCtx: CanvasRenderingContext2D | null = null;

/** Layout of a sign image: font, canvas size, line positions (measured here, painted anywhere). */
function layoutText(text: string, vertical: boolean, glyphM: number): { job: NeonJob; textW: number; textH: number } {
  const px = Math.round(Math.min(220, Math.max(96, glyphM * PX_PER_M)));
  const mono = isCommandText(text);
  const font = `${mono ? 700 : 600} ${px}px ${mono ? MONO_FONT : DISPLAY_FONT}`;
  const lines = vertical ? [...text] : [text];
  const lineH = px * (vertical ? 1.0 : 1.15);
  const pad = Math.round(px * 0.55);
  const probe = (probeCtx ??= document.createElement('canvas').getContext('2d')!);
  probe.font = font;
  const widths = lines.map((l) => probe.measureText(l).width);
  const textW = Math.max(...widths, px * 0.5);
  const textH = lineH * lines.length;
  const w = Math.ceil(textW + pad * 2);
  const h = Math.ceil(textH + pad * 2);
  return { job: { font, px, lines, w, h, pad, lineH, widths }, textW, textH };
}

/** CPU-backed canvas on the main thread (the same kind the worker uses). */
const mainCanvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c.getContext('2d', { willReadFrequently: true })!;
};

function putPixels(canvas: HTMLCanvasElement, job: NeonJob, data: Uint8ClampedArray<ArrayBuffer>): void {
  canvas.getContext('2d')!.putImageData(new ImageData(data, job.w, job.h), 0, 0);
}

// ── painter worker (OffscreenCanvas); the main thread paints when it is unavailable or fails ──

interface Painter {
  worker: Worker;
  pending: Map<number, (data: Uint8ClampedArray<ArrayBuffer> | null) => void>;
}
let painter: Painter | null | undefined;
let jobSeq = 0;

/** The page's @font-face rules of the sign fonts, with absolute URLs (for the worker's FontFaceSet). */
function signFontRules(): FontRule[] {
  const families = new Set(['Tektur Variable', 'JetBrains Mono Variable']);
  const rules: FontRule[] = [];
  for (const sheet of [...document.styleSheets]) {
    let list: CSSRuleList;
    try {
      list = sheet.cssRules;
    } catch {
      continue; // cross-origin sheet
    }
    const base = sheet.href ?? document.baseURI;
    for (const rule of [...list]) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const st = rule.style;
      const family = st.getPropertyValue('font-family').trim().replace(/^["']|["']$/g, '');
      if (!families.has(family)) continue;
      const src = st.getPropertyValue('src').replace(/url\((["']?)([^"')]+)\1\)/g, (_m, _q, u: string) => `url("${new URL(u, base).href}")`);
      const d = (name: string) => st.getPropertyValue(name).trim() || undefined;
      rules.push({
        family,
        src,
        descriptors: {
          style: d('font-style'),
          weight: d('font-weight'),
          stretch: d('font-stretch'),
          unicodeRange: d('unicode-range'),
          display: d('font-display') as FontDisplay | undefined,
        },
      });
    }
  }
  return rules;
}

function getPainter(): Painter | null {
  if (painter !== undefined) return painter;
  painter = null;
  try {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof document === 'undefined') return null;
    const rules = signFontRules();
    if (!rules.length) return null;
    const worker = new Worker(new URL('./neon.worker.ts', import.meta.url), { type: 'module' });
    const state: Painter = { worker, pending: new Map() };
    worker.onmessage = (e: MessageEvent<NeonWorkerReply>) => {
      const msg = e.data;
      const done = state.pending.get(msg.id);
      state.pending.delete(msg.id);
      if (msg.type === 'error') console.warn('[neon] worker paint failed, painting on the main thread:', msg.message);
      else performance.measure('neon:worker', { start: performance.now() - msg.ms, duration: msg.ms });
      done?.(msg.type === 'done' ? msg.data : null);
    };
    worker.onerror = (e) => {
      console.warn('[neon] painter worker failed, painting on the main thread', e.message);
      e.preventDefault();
      painter = null;
      for (const done of state.pending.values()) done(null);
      state.pending.clear();
      worker.terminate();
    };
    const fonts: NeonWorkerRequest = { type: 'fonts', rules };
    worker.postMessage(fonts);
    painter = state;
  } catch (err) {
    console.warn('[neon] no painter worker', err);
    painter = null;
  }
  return painter;
}

function paintInWorker(p: Painter, job: NeonJob): Promise<Uint8ClampedArray<ArrayBuffer> | null> {
  const id = ++jobSeq;
  return new Promise((resolve) => {
    p.pending.set(id, resolve);
    const msg: NeonWorkerRequest = { type: 'paint', id, job };
    p.worker.postMessage(msg);
  });
}

/** Painted sign images by layout (signs repeat across levels and restarts); the most recent few are kept. */
const imageCache = new Map<string, { canvas: HTMLCanvasElement; ready: Promise<void> }>();
const IMAGE_CACHE_MAX = 24;
const inflight = new Set<Promise<void>>();

/** Resolves when every sign image requested so far is painted (await it before precompiling a level). */
export async function neonTexturesReady(): Promise<void> {
  while (inflight.size) await Promise.all([...inflight]);
}

function drawText(text: string, vertical: boolean, glyphM: number): Drawn {
  const { job, textW, textH } = layoutText(text, vertical, glyphM);
  const ppm = job.px / glyphM;
  const key = neonJobKey(job);
  let image = imageCache.get(key);
  if (image) {
    imageCache.delete(key); // most recent last
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = job.w;
    canvas.height = job.h;
    // a backing store now (transparent black): the level precompile uploads the texture before the
    // worker's pixels arrive, and Chrome skips (with a warning) an upload from a canvas without one. The
    // GPU texture holds zeros either way until `ready` uploads the painted image.
    canvas.getContext('2d');
    let ready: Promise<void>;
    const p = getPainter();
    if (p) {
      const painted = paintInWorker(p, job).then((data) => putPixels(canvas, job, data ?? paintNeon(job, mainCanvas)));
      inflight.add(painted);
      void painted.finally(() => inflight.delete(painted));
      ready = painted;
    } else {
      putPixels(canvas, job, paintNeon(job, mainCanvas));
      ready = Promise.resolve();
    }
    image = { canvas, ready };
  }
  imageCache.set(key, image);
  while (imageCache.size > IMAGE_CACHE_MAX) imageCache.delete(imageCache.keys().next().value!);
  return { canvas: image.canvas, ready: image.ready, ppm, textW: textW / ppm, textH: textH / ppm };
}

/**
 * Lays out the sign images of a level and starts painting them ahead (a task of its own before the
 * level build, which then finds them in the image cache instead of measuring text). Same images, same
 * cache order either way.
 */
export function prepareNeonSigns(defs: readonly NeonSignDef[]): void {
  for (const def of defs) drawText(def.text, !!def.vertical, def.size ?? 0.6);
}

export function createNeonSign(def: NeonSignDef, materials: MaterialLibrary, seed: number): NeonSign {
  const glyph = def.size ?? 0.6;
  const vertical = !!def.vertical;
  const t0 = performance.now();
  const { canvas, ready, ppm, textW, textH } = drawText(def.text, vertical, glyph);
  performance.measure('neon:draw', { start: t0, detail: def.text });
  const tex = new THREE.CanvasTexture(canvas);
  // painted in the worker: upload again once the pixels are in
  void ready.then(() => {
    tex.needsUpdate = true;
  });
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  const width = canvas.width / ppm;
  const height = canvas.height / ppm;

  const flicker = uniform(1);
  // the colour is a uniform (not a constant), so every sign shares one shader / pipeline
  const neon = uniform(new THREE.Color(NEON_HEX[def.color]));
  const t = texture(tex, uv());
  const core = t.r;
  const halo = t.g;
  const tubeMask = t.b;
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.name = `neon:${def.text}`;
  mat.transparent = true;
  mat.depthWrite = false;
  mat.blending = THREE.AdditiveBlending;
  mat.fog = false;
  mat.side = THREE.DoubleSide;
  const k = EMISSIVE_SCALE;
  // tube: saturated colour; core: towards white; halo: dim, below the bloom threshold
  const tube = neon.mul(tubeMask.mul(3.4 * k));
  const hot = vec3(1, 1, 1).mul(0.55).add(neon.mul(0.45)).mul(core.mul(2.6 * k));
  const glow = neon.mul(halo.mul(halo).mul(0.75 * k));
  mat.colorNode = tube.add(hot).add(glow).mul(flicker.mul(0.94).add(0.06)).mul(float(1));

  const group = new THREE.Group();
  group.name = `sign:${def.text}`;
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
  quad.position.z = 0.05;
  quad.renderOrder = 5;
  group.add(quad);

  let board: THREE.Mesh | null = null;
  let rim: THREE.Mesh | null = null;
  if (def.frame ?? true) {
    const bw = textW + glyph * (vertical ? 0.5 : 0.6);
    const bh = textH + glyph * (vertical ? 0.35 : 0.3);
    board = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.06), materials.get('M_PlasticDark'));
    board.castShadow = false;
    board.receiveShadow = true;
    group.add(board);
    // a thin tube along the board edge, in the sign's colour but dimmer
    const rimMat = new THREE.MeshBasicNodeMaterial();
    rimMat.name = `neon-rim:${def.text}`;
    rimMat.fog = false;
    rimMat.colorNode = neon.mul(flicker.mul(1.1 * k).add(0.05));
    const shape = new THREE.Shape();
    const ow = bw / 2 + 0.015;
    const oh = bh / 2 + 0.015;
    const iw = bw / 2 - 0.02;
    const ih = bh / 2 - 0.02;
    shape.moveTo(-ow, -oh).lineTo(ow, -oh).lineTo(ow, oh).lineTo(-ow, oh).lineTo(-ow, -oh);
    const hole = new THREE.Path();
    hole.moveTo(-iw, -ih).lineTo(-iw, ih).lineTo(iw, ih).lineTo(iw, -ih).lineTo(-iw, -ih);
    shape.holes.push(hole);
    rim = new THREE.Mesh(new THREE.ShapeGeometry(shape), rimMat);
    rim.position.z = 0.032;
    group.add(rim);
  }

  group.position.set(def.at[0] * TILE, def.y, def.at[1] * TILE);
  group.rotation.y = facingToYaw(def.facing);

  // flicker: short bursts of dropouts at random intervals
  let rng = (seed * 7919 + 13) % 233280;
  const rand = () => ((rng = (rng * 9301 + 49297) % 233280) / 233280);
  let nextBurst = 1 + rand() * 4;
  let burst = 0;
  let hold = 0;
  let level = 1;

  return {
    group,
    get level() {
      return level;
    },
    update(dt) {
      if (!def.flicker) return;
      nextBurst -= dt;
      if (nextBurst <= 0) {
        burst = 0.2 + rand() * 0.6;
        nextBurst = 2.5 + rand() * 6;
      }
      if (burst > 0) {
        burst -= dt;
        hold -= dt;
        if (hold <= 0) {
          level = rand() < 0.5 ? 0.06 + rand() * 0.2 : 1;
          hold = 0.03 + rand() * 0.09;
        }
      } else {
        level = 1;
      }
      flicker.value = level;
    },
    dispose() {
      tex.dispose();
      mat.dispose();
      quad.geometry.dispose();
      board?.geometry.dispose();
      if (rim) {
        rim.geometry.dispose();
        (rim.material as THREE.Material).dispose();
      }
    },
  };
}
