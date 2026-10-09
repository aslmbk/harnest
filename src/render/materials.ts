/**
 * Material library keyed by glTF material name (design doc §7.6). Every mesh coming from a GLB or a
 * placeholder gets a shared `MeshStandardNodeMaterial` chosen by its material name:
 *  - palette names → palette values (emissive ones keep their strength so bloom picks them up);
 *  - special names → TSL materials (wall grime, lit-window variety, chip pulse…);
 *  - unknown names → a generic conversion that keeps colour / metal / rough / emissive.
 * Materials with per-entity state (terminal screen, gate light, NPC paint and face, tracks, eyes) are
 * created per entity with the `create*` functions and swapped in with `replaceMaterial`.
 * `vertexColors` is on everywhere: geometry with COLOR_0 gets it multiplied into the base colour.
 */
import * as THREE from 'three/webgpu';
import {
  abs,
  atan,
  attribute,
  clamp,
  color,
  float,
  floor,
  fract,
  fwidth,
  hash,
  length,
  materialColor,
  materialEmissive,
  max,
  mix,
  mx_noise_float,
  positionWorld,
  sin,
  smoothstep,
  step,
  texture,
  time,
  uniform,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import { damp, freeze } from '../engine/freeze'; // [freeze]
import { applyOcclusion } from './occlusion';
import { PALETTE, type MatSpec } from './palette';

/** Global multiplier on authored emission strengths (bloom tuning). */
export const EMISSIVE_SCALE = 0.85;

export interface MaterialOptions {
  /** Tall geometry: add the dithered occlusion cut-out. */
  occluder?: boolean;
}

type StdMat = THREE.MeshStandardNodeMaterial;

const DEFAULT_SPEC: MatSpec = { color: '#7a7f86', metal: 0.2, rough: 0.7 };

function standard(name: string, spec: MatSpec): StdMat {
  const m = new THREE.MeshStandardNodeMaterial();
  m.name = name;
  m.color.set(spec.color);
  m.metalness = spec.metal;
  m.roughness = spec.rough;
  if (spec.emissive && spec.strength) {
    m.emissive.set(spec.emissive);
    m.emissiveIntensity = spec.strength * EMISSIVE_SCALE;
  }
  m.vertexColors = true;
  return m;
}

/** Painted plaster: darker wet base, vertical rain streaks. Tinted per building through instance colour. */
function wallMaterial(spec: MatSpec): StdMat {
  const m = standard('M_Wall', spec);
  const p = positionWorld;
  const streaks = mx_noise_float(vec2(p.x.add(p.z).mul(1.9), p.y.mul(0.18))).mul(0.5).add(0.5);
  const splash = smoothstep(0.0, 1.3, p.y).mul(0.4).add(0.6);
  const blotch = mx_noise_float(vec2(p.x.add(p.z).mul(0.35), p.y.mul(0.35))).mul(0.12);
  m.colorNode = materialColor.mul(splash.mul(mix(0.78, 1.06, streaks)).add(blotch));
  m.roughnessNode = mix(float(0.55), float(0.92), smoothstep(0.0, 1.1, p.y));
  return m;
}

/**
 * Lit windows: every placement gets its own brightness (some nearly off), from the per-placement
 * `seed` vertex attribute of the merged level geometry (0 elsewhere → one fixed level).
 */
function windowMaterial(name: string, spec: MatSpec, salt: number): StdMat {
  const m = standard(name, spec);
  const h = hash(attribute('seed', 'float').mul(4096).add(salt));
  const level = mix(float(0.25), float(1.25), h).mul(step(0.12, h));
  m.emissiveNode = materialEmissive.mul(level);
  return m;
}

function pulsing(name: string, spec: MatSpec, speed: number, depth: number): StdMat {
  const m = standard(name, spec);
  m.emissiveNode = materialEmissive.mul(sin(time.mul(speed)).mul(depth).add(1 - depth));
  return m;
}

const SPECIAL: Record<string, (spec: MatSpec) => StdMat> = {
  M_Wall: wallMaterial,
  M_WindowLit: (s) => windowMaterial('M_WindowLit', s, 17),
  M_WindowLitCool: (s) => windowMaterial('M_WindowLitCool', s, 53),
  M_ChipGlow: (s) => pulsing('M_ChipGlow', s, 4, 0.3),
  M_HarniScreen: (s) => pulsing('M_HarniScreen', s, 2.4, 0.2),
};

export class MaterialLibrary {
  private readonly cache = new Map<string, StdMat>();
  private readonly learned = new Map<string, MatSpec>();

  /** Shared material for a contract name (or a learned / unknown one). */
  get(name: string, opts: MaterialOptions = {}): StdMat {
    const key = opts.occluder ? `${name}|occ` : name;
    let m = this.cache.get(key);
    if (!m) {
      m = this.create(name);
      if (opts.occluder) applyOcclusion(m);
      this.cache.set(key, m);
    }
    return m;
  }

  has(name: string): boolean {
    return name in PALETTE || this.learned.has(name);
  }

  /** Surface values of a material name: the palette, else what a GLB said, else a neutral grey. */
  spec(name: string): MatSpec {
    return PALETTE[name] ?? this.learned.get(name) ?? DEFAULT_SPEC;
  }

  /** Remembers the look of a material we have no contract entry for (read from a GLB). */
  learn(source: THREE.Material): void {
    if (!source.name || source.name in PALETTE || this.learned.has(source.name)) return;
    const s = source as THREE.MeshStandardMaterial;
    const spec: MatSpec = {
      color: s.color ? `#${s.color.getHexString()}` : '#808080',
      metal: s.metalness ?? 0,
      rough: s.roughness ?? 0.8,
    };
    if (s.emissive && (s.emissive.r > 0 || s.emissive.g > 0 || s.emissive.b > 0)) {
      spec.emissive = `#${s.emissive.getHexString()}`;
      spec.strength = s.emissiveIntensity ?? 1;
    }
    this.learned.set(source.name, spec);
  }

  private create(name: string): StdMat {
    const spec = this.spec(name);
    return (SPECIAL[name] ?? ((s: MatSpec) => standard(name, s)))(spec);
  }

  dispose(): void {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
  }
}

/** Swap every mesh material named `name` (by `userData.matName`) under `root`. */
export function replaceMaterial(root: THREE.Object3D, name: string, material: THREE.Material): number {
  let count = 0;
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.userData.matName === name) {
      (o as THREE.Mesh).material = material;
      count++;
    }
  });
  return count;
}

// ───────────────────────────── per-entity materials ─────────────────────────────
// glTF UVs of the screen-like parts (terminal screen, NPC faces, eye lenses) run u → the viewer's right,
// v → down (v = 0 at the top edge). The procedural faces below flip v to work "upright".

export type ScreenState = 'locked' | 'available' | 'done';

export interface TerminalScreen {
  material: StdMat;
  /** One texture per state, drawn at creation: upload them with the level (`Renderer.initTexture`). */
  readonly pages: readonly THREE.Texture[];
  setState(state: ScreenState): void;
  update(dt: number): void;
  dispose(): void;
}

const SCREEN_W = 528;
const SCREEN_H = 400;
const SCREEN_FONT = '"JetBrains Mono Variable", "JetBrains Mono", Consolas, "Courier New", monospace';
const SCREEN_COLORS: Record<ScreenState, string> = { locked: '#8ea2bb', available: '#ff9a3c', done: '#5dff7a' };

/** Greedy word wrap to `max` characters per line (the font is monospace). */
function wrapWords(text: string, max: number, lines: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of text.split(/\s+/)) {
    if (!w) continue;
    if (cur && `${cur} ${w}`.length > max) {
      out.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(cur);
  if (out.length > lines) {
    out.length = lines;
    out[lines - 1] = `${out[lines - 1].slice(0, max - 1)}…`;
  }
  return out.map((l) => (l.length > max ? `${l.slice(0, max - 1)}…` : l));
}

/**
 * Draws one screen page: R = text and frame, B = the cursor block (blinks in the shader).
 * Readable from the close-up camera; at play distance it reads as "a terminal with text".
 */
function drawScreen(canvas: HTMLCanvasElement, state: ScreenState, title: string, node: number): void {
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  const R = '#ff0000';
  const B = '#0000ff';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.strokeStyle = R;
  ctx.fillStyle = R;
  ctx.lineWidth = 4;
  ctx.strokeRect(22, 22, SCREEN_W - 44, SCREEN_H - 44);
  const x = 44;
  if (state === 'locked') {
    // padlock + caption
    const cx = SCREEN_W / 2;
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(cx, 150, 46, Math.PI, 0);
    ctx.lineTo(cx + 46, 178);
    ctx.moveTo(cx - 46, 178);
    ctx.lineTo(cx - 46, 150);
    ctx.stroke();
    ctx.fillRect(cx - 70, 170, 140, 104);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(cx, 212, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(cx - 6, 214, 12, 34);
    ctx.fillStyle = R;
    ctx.font = `700 40px ${SCREEN_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('ЗАКРЫТО', cx, 340);
    return;
  }
  ctx.font = `700 30px ${SCREEN_FONT}`;
  ctx.fillText(`УЗЕЛ ${String(node).padStart(2, '0')}`, x, 72);
  ctx.fillRect(x, 88, SCREEN_W - x * 2, 4);
  ctx.font = `700 38px ${SCREEN_FONT}`;
  wrapWords(title, 18, 2).forEach((l, i) => ctx.fillText(l, x, 146 + i * 46));
  ctx.font = `700 32px ${SCREEN_FONT}`;
  ctx.fillText(state === 'done' ? '✓ исправно' : '! нужен ремонт', x, 282);
  ctx.fillText('>', x, 336);
  ctx.fillStyle = B;
  ctx.fillRect(x + 30, 308, 20, 34);
}

const SCREEN_STATES: readonly ScreenState[] = ['locked', 'available', 'done'];

/** Pages drawn ahead by `prepareTerminalScreens`, taken (once) by the screens created next. */
const preparedPages = new Map<string, HTMLCanvasElement>();
const pageKey = (state: ScreenState, title: string, node: number) => `${state}|${node}|${title}`;

function drawPage(state: ScreenState, title: string, node: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SCREEN_W;
  canvas.height = SCREEN_H;
  drawScreen(canvas, state, title, node);
  return canvas;
}

/**
 * Draws the pages of the terminal screens a level will create (a task of its own before the level
 * build, which then only wraps them in textures). Same pages either way.
 */
export function prepareTerminalScreens(screens: readonly { title: string; node: number }[]): void {
  preparedPages.clear();
  for (const { title, node } of screens) for (const s of SCREEN_STATES) preparedPages.set(pageKey(s, title, node), drawPage(s, title, node));
}

/**
 * One screen page as a texture. A state change assigns another page to the screen's texture node: r186
 * rebinds on that (`NodeSampledTexture.update` sees another texture, and the `Sampler.texture` setter
 * resets the binding's version and generation), whatever the pages' versions.
 */
function screenPage(state: ScreenState, title: string, node: number): THREE.CanvasTexture {
  const key = pageKey(state, title, node);
  const canvas = preparedPages.get(key) ?? drawPage(state, title, node);
  preparedPages.delete(key);
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false; // glTF UVs: v = 0 at the top
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * CRT screen on the terminal kiosk: a canvas page per state (locked: padlock; available / done: node
 * number, lesson title, status, prompt) tinted in the shader — locked dim blue-grey, available orange
 * with a pulse, done green — plus scanlines, a rolling refresh band, a blinking cursor and a short
 * glitch when the state changes.
 */
export function createTerminalScreen(seed: number, title = '', node = 1): TerminalScreen {
  // every page is drawn now (and uploaded with the level): a state change only swaps the texture, no
  // drawing or upload during play
  const pages = new Map(SCREEN_STATES.map((s) => [s, screenPage(s, title, node)] as const));
  const page = (s: ScreenState) => pages.get(s)!;
  const tint = uniform(new THREE.Color(SCREEN_COLORS.locked));
  const level = uniform(0.45);
  const pulse = uniform(0);
  const glitch = uniform(0);
  // per-terminal values are uniforms, not constants: every terminal then shares one shader / pipeline
  const phase = uniform(seed);
  const m = new THREE.MeshStandardNodeMaterial();
  m.name = 'M_TerminalScreen';
  m.roughness = 0.18;
  m.metalness = 0;
  const u = uv();
  const row = floor(u.y.mul(60));
  const jitter = hash(row.add(floor(time.mul(30)))).sub(0.5).mul(glitch).mul(0.06);
  const t = texture(page('locked'), vec2(u.x.add(jitter), u.y));
  const text = t.r;
  const cursor = t.b.mul(step(0.5, fract(time.mul(1.6).add(phase))));
  const scan = sin(u.y.mul(SCREEN_H * Math.PI)).mul(0.14).add(0.86);
  const band = smoothstep(0.12, 0.0, abs(fract(time.mul(0.23).add(phase)).sub(u.y))).mul(0.25).add(1);
  const edge = smoothstep(0.0, 0.05, u.x).mul(smoothstep(1.0, 0.95, u.x)).mul(smoothstep(0.0, 0.06, u.y)).mul(smoothstep(1.0, 0.94, u.y));
  const beat = sin(time.mul(3.4)).mul(0.5).add(0.5).mul(pulse).mul(0.35).add(1);
  const glow = text.add(cursor).add(0.06).mul(scan).mul(band).mul(edge).mul(beat).mul(level);
  m.colorNode = vec3(0.015, 0.018, 0.022);
  m.emissiveNode = tint.mul(glow).mul(glitch.mul(1.5).add(1)).mul(1.7 * EMISSIVE_SCALE);

  let state: ScreenState | null = null;
  const target = { color: new THREE.Color(), level: 0.45, pulse: 0 };
  const setState = (s: ScreenState) => {
    if (s === state) return;
    const first = state === null;
    state = s;
    t.value = page(s);
    target.color.set(SCREEN_COLORS[s]);
    target.level = s === 'locked' ? 0.45 : s === 'done' ? 0.85 : 1;
    target.pulse = s === 'available' ? 1 : 0;
    if (first) {
      tint.value.copy(target.color);
      level.value = target.level;
      pulse.value = target.pulse;
    } else glitch.value = 1;
  };
  setState('locked');
  return {
    material: m,
    pages: [...pages.values()],
    setState,
    update(dt) {
      const k = damp(5, dt); // [freeze] same curve; settles at once while frozen
      tint.value.lerp(target.color, k);
      level.value += (target.level - level.value) * k;
      pulse.value += (target.pulse - pulse.value) * k;
      glitch.value = freeze.active ? 0 : Math.max(0, glitch.value - dt * 2.2); // [freeze]
    },
    dispose() {
      for (const p of pages.values()) p.dispose();
      m.dispose();
    },
  };
}

export interface GateLight {
  material: StdMat;
  /** 0 = closed (red, pulsing), 1 = open (green). */
  open: { value: number };
}

export function createGateLight(): GateLight {
  const open = uniform(0);
  const m = standard('M_GateLight', PALETTE.M_GateLight);
  const pulse = sin(time.mul(5)).mul(0.35).add(0.65);
  const level = mix(pulse, float(1), open);
  m.emissiveNode = mix(color('#ff3b30'), color('#5dff7a'), open).mul(level).mul(6 * EMISSIVE_SCALE);
  return { material: m, open };
}

export function createNpcPaint(tint: string): StdMat {
  const m = standard('M_NpcPaint', PALETTE.M_NpcPaint);
  m.color.multiply(new THREE.Color(tint));
  return m;
}

export interface NpcFace {
  material: StdMat;
  /** 0..1 eyes open (blink). */
  eyeOpen: { value: number };
  /** 0..1 happy arcs instead of round eyes. */
  eyeHappy: { value: number };
  /** Upper lid slant (+ worried: the outer corners drop). */
  eyeSlant: { value: number };
  /** Eye size multiplier (excited > 1). */
  eyeSize: { value: number };
  /** Glance offset (x, y) in face heights / 0.06. */
  look: { value: THREE.Vector2 };
  /** Mouth curvature (+ smile, − frown). */
  mouthCurve: { value: number };
  /** Mouth half width (face heights). */
  mouthWidth: { value: number };
  /** Lopsided mouth (thinking). */
  mouthTilt: { value: number };
  /** 0..1 open mouth (talking, excited). */
  mouthOpen: { value: number };
}

/**
 * The NPC's face screen: a dot-matrix LED face (eyes and mouth are soft shapes sampled once per LED) in
 * the NPC's tint. `aspect` = screen width / height in metres, so the LEDs stay round. When the LEDs get
 * smaller than about a pixel the dots fade into flat light (no moiré at play distance).
 */
export function createNpcFace(tint: string, aspect = 1.3): NpcFace {
  const eyeOpen = uniform(1);
  const eyeHappy = uniform(0);
  const eyeSlant = uniform(0);
  const eyeSize = uniform(1);
  const look = uniform(new THREE.Vector2());
  const mouthCurve = uniform(0.6);
  const mouthWidth = uniform(0.17);
  const mouthTilt = uniform(0);
  const mouthOpen = uniform(0);
  // tint and aspect are uniforms (not constants), so every NPC face shares one shader / pipeline
  const faceTint = uniform(new THREE.Color(tint));
  const faceAspect = uniform(aspect);
  const m = new THREE.MeshStandardNodeMaterial();
  m.name = 'M_NpcFace';
  m.roughness = 0.6;
  m.metalness = 0;
  // upright face coordinates: y ∈ [−0.5, 0.5] (face heights), x ∈ [−aspect/2, aspect/2]
  const u = uv();
  const fp = vec2(u.x.sub(0.5).mul(faceAspect), float(0.5).sub(u.y));
  const ROWS = 15;
  const cell = 1 / ROWS;
  const g = fp.div(cell);
  const center = floor(g).add(0.5).mul(cell);
  const dot = smoothstep(0.46, 0.3, length(fract(g).sub(0.5)));
  // LEDs below ~1.5 px: blend the dot grid into its average coverage
  const fine = smoothstep(0.35, 0.7, fwidth(g.y));
  const led = mix(dot, float(0.55), fine);

  const eye = (p: THREE.Node<'vec2'>, sx: number) => {
    // ellipse; happy cuts it into an arc, the slant lowers the lid toward the outer corner
    const q = p.sub(vec2(0.24 * sx, 0.09)).sub(look.mul(0.06));
    const rx = eyeSize.mul(0.125);
    const ry = eyeSize.mul(0.16).mul(eyeOpen.max(0.12));
    const e = smoothstep(1.0, 0.75, length(vec2(q.x.div(rx), q.y.div(ry))));
    const cut = smoothstep(1.0, 0.75, length(vec2(q.x.div(rx.mul(1.15)), q.y.add(eyeHappy.mul(0.1)).div(ry.mul(1.1)))));
    const lid = step(q.y, float(0.12).sub(eyeSlant.mul(q.x.mul(sx).mul(0.9).add(0.06))));
    return e.mul(float(1).sub(cut.mul(eyeHappy))).mul(lid);
  };
  const p = center;
  const eyes = max(eye(p, -1), eye(p, 1));
  // mouth: a curved line that opens into a lens shape
  const mx = p.x.sub(mouthTilt.mul(0.08));
  const across = clamp(mx.div(mouthWidth), -1, 1);
  const my = float(-0.24).add(mouthCurve.mul(mx.mul(mx))).add(mouthTilt.mul(mx).mul(0.6));
  const thick = float(0.045).add(mouthOpen.mul(0.09).mul(float(1).sub(across.mul(across))));
  const mouth = smoothstep(thick, thick.mul(0.55), abs(p.y.sub(my))).mul(smoothstep(1.06, 0.94, abs(mx.div(mouthWidth))));
  const lit = clamp(eyes.add(mouth), 0, 1);
  m.colorNode = vec3(0.012, 0.016, 0.02);
  m.emissiveNode = faceTint.mul(lit.mul(2.2).add(0.035)).mul(led).mul(2 * EMISSIVE_SCALE);
  return { material: m, eyeOpen, eyeHappy, eyeSlant, eyeSize, look, mouthCurve, mouthWidth, mouthTilt, mouthOpen };
}

export interface TrackMaterial {
  material: StdMat;
  /** Tread offset in loops (distance / loop length). */
  offset: { value: number };
}

/** Tread ribs per loop of the robot's belt (2.218 m long → a rib every ≈5 cm). */
export const TREADS_PER_LOOP = 44;

/**
 * Rubber track: chevron ribs scrolling along UV.x (the belt's U runs once around the loop in the
 * direction it travels when driving forward, so the pattern moves with +offset).
 */
export function createTrack(): TrackMaterial {
  const offset = uniform(0);
  const m = standard('M_Track', PALETTE.M_Track);
  const v = uv().y;
  const t = fract(uv().x.sub(offset).mul(TREADS_PER_LOOP).add(abs(v.sub(0.5)).mul(0.6)));
  const ridge = smoothstep(0.04, 0.14, t).mul(smoothstep(0.6, 0.48, t));
  const across = smoothstep(0.0, 0.1, v).mul(smoothstep(1.0, 0.9, v));
  m.colorNode = mix(color('#0b0b0c'), color('#3c3c42'), ridge.mul(across.mul(0.7).add(0.3)));
  m.roughnessNode = mix(float(0.95), float(0.6), ridge);
  return { material: m, offset };
}

export interface EyeGlow {
  material: StdMat;
  /** Overall brightness. */
  glow: { value: number };
  /** 0..1 lids open (blink). */
  open: { value: number };
  /** 0..1 happy arc (the lower lid rises in the middle). */
  happy: { value: number };
  /** 0..1 worried (the upper lid drops toward the outer side). */
  worried: { value: number };
}

/**
 * Lens of one eye pod: a glowing iris with a ring and a glint, closed by lids drawn in the shader
 * (blink, happy arc, worried slant). `side` +1 = EyeL (its outer side is +X), −1 = EyeR.
 */
export function createEyeGlow(side: 1 | -1 = 1): EyeGlow {
  const glow = uniform(1);
  const open = uniform(1);
  const happy = uniform(0);
  const worried = uniform(0);
  const outerSign = uniform(side); // a uniform, so both eyes share one shader / pipeline
  const m = standard('M_EyeGlow', PALETTE.M_EyeGlow);
  m.color.set('#0b0d10');
  m.roughness = 0.12;
  const p = vec2(uv().x.sub(0.5), float(0.5).sub(uv().y)).mul(2); // unit disc, y up
  const r = length(p);
  const outer = p.x.mul(outerSign);
  const soft = 0.07;
  const lidV = smoothstep(open.add(soft), open.sub(soft), abs(p.y));
  // happy: everything below an arch (highest in the middle) is covered
  const arch = happy.mul(float(0.35).sub(p.x.mul(p.x).mul(1.2))).sub(float(1).sub(happy).mul(2));
  const happyCut = smoothstep(arch.add(soft), arch.sub(soft), p.y);
  // worried: the upper lid slants down toward the outer side
  const top = float(1.05).sub(worried.mul(outer.mul(0.55).add(0.55)));
  const worriedCut = smoothstep(top.sub(soft), top.add(soft), p.y);
  const visible = lidV.mul(float(1).sub(happyCut)).mul(float(1).sub(worriedCut));
  // camera-lens eye: dark pupil, bright iris with fine radial ribs, dimmer outer ring, a glint
  const ribs = sin(atan(p.y, p.x).mul(18)).mul(0.12).add(0.88);
  const iris = smoothstep(0.24, 0.32, r).mul(smoothstep(0.8, 0.72, r)).mul(ribs);
  const ring = smoothstep(0.72, 0.8, r).mul(smoothstep(0.95, 0.88, r)).mul(0.45);
  const pupil = smoothstep(0.32, 0.2, r).mul(0.22);
  const glint = smoothstep(0.15, 0.06, length(p.sub(vec2(-0.34, 0.38)))).mul(1.4);
  const lens = iris.add(ring).add(pupil).add(glint);
  m.emissiveNode = color(PALETTE.M_EyeGlow.emissive ?? '#ffe9c4').mul(lens.mul(visible).mul(1.15).add(0.02)).mul(glow);
  return { material: m, glow, open, happy, worried };
}
