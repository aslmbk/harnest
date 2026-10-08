/**
 * Neon signs generated at runtime from `signs[]` (design doc §5): canvas text → additive emissive quad.
 *
 * The canvas holds three masks of the same text: B = the glass tube (crisp glyphs), R = the white-hot
 * core (the tube eroded), G = a soft halo. The shader tints them (core almost white, tube saturated,
 * halo dim), so letters stay readable under bloom. Commands (`/init`, `claude -p`) use the UI's mono
 * font, words the display font; both are loaded before drawing (`loadSignFonts`). Optional dark backing
 * board with a thin rim, vertical stacking, and flicker bursts (the sign's light follows `level`).
 */
import '@fontsource-variable/tektur';
import '@fontsource-variable/jetbrains-mono';
import * as THREE from 'three/webgpu';
import { color, float, texture, uniform, uv, vec3 } from 'three/tsl';
import { TILE, type NeonSignDef } from '../content/types';
import { facingToYaw } from '../world/tiles';
import { EMISSIVE_SCALE, type MaterialLibrary } from './materials';
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
  canvas: HTMLCanvasElement;
  /** Canvas pixels per metre. */
  ppm: number;
  /** Text block size in metres (without the glow margin). */
  textW: number;
  textH: number;
}

function drawText(text: string, vertical: boolean, glyphM: number): Drawn {
  const px = Math.round(Math.min(220, Math.max(96, glyphM * PX_PER_M)));
  const mono = isCommandText(text);
  const font = `${mono ? 700 : 600} ${px}px ${mono ? MONO_FONT : DISPLAY_FONT}`;
  const lines = vertical ? [...text] : [text];
  const lineH = px * (vertical ? 1.0 : 1.15);
  const pad = Math.round(px * 0.55);
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = font;
  const textW = Math.max(...lines.map((l) => probe.measureText(l).width), px * 0.5);
  const textH = lineH * lines.length;
  const w = Math.ceil(textW + pad * 2);
  const h = Math.ceil(textH + pad * 2);

  const layer = (paint: (ctx: CanvasRenderingContext2D) => void) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    ctx.lineJoin = 'round';
    paint(ctx);
    return ctx.getImageData(0, 0, w, h).data;
  };
  const each = (ctx: CanvasRenderingContext2D, fn: (l: string, x: number, y: number) => void) =>
    lines.forEach((l, i) => fn(l, w / 2, pad + lineH * (i + 0.5) + px * 0.04));

  const tube = layer((ctx) => each(ctx, (l, x, y) => ctx.fillText(l, x, y)));
  const core = layer((ctx) =>
    each(ctx, (l, x, y) => {
      ctx.fillText(l, x, y);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = px * 0.075;
      ctx.strokeText(l, x, y);
    }),
  );
  const halo = layer((ctx) => {
    ctx.filter = `blur(${Math.round(px * 0.2)}px)`;
    ctx.lineWidth = px * 0.12;
    each(ctx, (l, x, y) => {
      ctx.fillText(l, x, y);
      ctx.strokeText(l, x, y);
    });
  });

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = core[i];
    img.data[i + 1] = halo[i];
    img.data[i + 2] = tube[i];
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const ppm = px / glyphM;
  return { canvas, ppm, textW: textW / ppm, textH: textH / ppm };
}

export function createNeonSign(def: NeonSignDef, materials: MaterialLibrary, seed: number): NeonSign {
  const glyph = def.size ?? 0.6;
  const vertical = !!def.vertical;
  const { canvas, ppm, textW, textH } = drawText(def.text, vertical, glyph);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  const width = canvas.width / ppm;
  const height = canvas.height / ppm;

  const flicker = uniform(1);
  const neon = color(NEON_HEX[def.color]);
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
