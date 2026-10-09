/**
 * Baseline atmosphere: fog (distance + abyss height fog), ambient + one shadow-casting key light that
 * follows the player, the abyss backdrop (twinkling lights of the lower city), and rain streaks.
 */
import * as THREE from 'three/webgpu';
import {
  attribute,
  color,
  densityFogFactor,
  float,
  fog,
  fract,
  hash,
  instanceIndex,
  max,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  time,
  uniform,
  uv,
  vec3,
} from 'three/tsl';
import type { LevelMood } from '../content/types';
import { groundOverview } from './ground';
import { LAYER, setCameraLayers } from './layers';
import { NEON_HEX } from './palette';

/** Physical intensity per artist unit (layout light intensities are artist units). */
export const AMBIENT_SCALE = 1.0;
export const KEY_SCALE = 1.0;
/** Strength of the procedural city environment (IBL: reflections on metal / wet ground, soft fill). */
export const ENV_INTENSITY = 0.7;
/** Half size (m) of the key light's shadow box at the default camera distance. */
export const SHADOW_HALF = 14;

export class Atmosphere {
  readonly fogColor = uniform(new THREE.Color('#0b1a22'));
  readonly fogDensity = uniform(0.012);
  /**
   * Ambient, not hemisphere: with `DynamicLighting` every batched light type costs uniform buffers and
   * WebGPU allows 12 per stage (points 3 + spot 4 + render + object already use 9).
   */
  readonly ambient = new THREE.AmbientLight('#27455a', 1);
  readonly key = new THREE.DirectionalLight('#8fb8ff', 1);
  private readonly keyOffset = new THREE.Vector3(-9, 22, 11);
  private fogNode: THREE.Node;
  private mapMode = false;
  private moodAmbient = 1;
  /** An environment map made ahead by `prepareMood`, for the next `applyMood`. */
  private prepared: { mood: LevelMood; env: THREE.DataTexture } | null = null;
  /** Shadows shown (medium / high). Off: the map is no longer rendered and is sampled at strength 0. */
  private shadowsOn = true;
  /** The shadow map must be rendered again (level, preset, precompile). */
  private shadowDirty = true;
  /** Snapped light box of the last `follow()`, and the one the shadow map was last rendered with. */
  private readonly box = { x: NaN, z: NaN, h: NaN };
  private readonly renderedBox = { x: NaN, z: NaN, h: NaN };
  /** Roots of the shadow casters that can move (robot, entities); the static level batches never move. */
  private casterRoots: readonly THREE.Object3D[] = [];
  /** World matrices of the visible moving casters at the last check (16 numbers each). */
  private casterState = new Float64Array(256);
  private casterCount = -1;
  private checkPending = false;
  /** `renderer.info.frame` of the last shadow-map render. */
  private shadowFrame = -1;

  constructor(private readonly scene: THREE.Scene) {
    const height = smoothstep(-0.6, -24, positionWorld.y).mul(0.97);
    this.fogNode = fog(this.fogColor, max(densityFogFactor(this.fogDensity), height));
    scene.fogNode = this.fogNode;
    scene.background = new THREE.Color('#0b1a22');
    // always a shadow caster (keeps it on the regular per-light path). `castShadow` and
    // `renderer.shadowMap.enabled` are part of every lit material's pipeline key: they never change at
    // runtime. Quality turns shadows off by not rendering the map and sampling it at strength 0
    // (`setShadows`), with the same shaders.
    this.key.castShadow = true;
    const cam = this.key.shadow.camera as THREE.OrthographicCamera;
    cam.left = -SHADOW_HALF;
    cam.right = SHADOW_HALF;
    cam.top = SHADOW_HALF;
    cam.bottom = -SHADOW_HALF;
    cam.near = 1;
    cam.far = 80;
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.03;
    // rendered only when its content can change (see checkShadow()), and never once more for the
    // street reflection's camera
    this.key.shadow.autoUpdate = false;
    this.key.shadow.mapSize.set(1024, 1024);
    // buildings cast through closed stand-in blocks; props and characters with their real geometry
    setCameraLayers(this.key.shadow.camera, LAYER.SHADOW);
    scene.add(this.ambient, this.key, this.key.target);
    // the renderer calls this right after updating the world matrices and before drawing anything
    scene.onBeforeRender = (renderer, _s, camera) => this.checkShadow(renderer as unknown as THREE.Renderer, camera);
  }

  /**
   * Makes the environment map of `mood` ahead (a task of its own before a level build); the next
   * `applyMood` with this mood takes it instead of making it then. Same texture data either way.
   */
  prepareMood(mood: LevelMood): void {
    if (this.prepared?.mood === mood) return;
    this.prepared?.env.dispose();
    this.prepared = { mood, env: createCityEnvironment(mood, moodAccents(mood)) };
  }

  applyMood(mood: LevelMood): void {
    this.fogColor.value.set(mood.fogColor);
    (this.scene.background as THREE.Color).set(mood.fogColor);
    this.fogDensity.value = 0.004 + mood.fogDensity * 0.018;
    const prepared = this.prepared?.mood === mood ? this.prepared.env : null;
    if (!prepared) this.prepared?.env.dispose();
    this.prepared = null;
    const env = prepared ?? createCityEnvironment(mood, moodAccents(mood));
    (this.scene.environment as THREE.Texture | null)?.dispose();
    this.scene.environment = env;
    this.scene.environmentIntensity = ENV_INTENSITY;
    this.ambient.color.set(mood.ambient);
    this.moodAmbient = mood.ambientIntensity * AMBIENT_SCALE;
    this.ambient.intensity = this.mapMode ? 3 : this.moodAmbient;
    this.key.color.set(mood.keyLight.color);
    this.key.intensity = mood.keyLight.intensity * KEY_SCALE;
  }

  /**
   * Shadows on / off and the map size, without touching a shader: off stops rendering the map and
   * samples it at strength 0 (the shadow term is then exactly 1); the map size is a uniform plus a
   * reallocation. Never toggle `renderer.shadowMap.enabled` or `key.castShadow` instead.
   */
  setShadows(enabled: boolean, mapSize: number): void {
    this.shadowsOn = enabled;
    this.key.shadow.intensity = enabled ? 1 : 0;
    if (enabled && this.key.shadow.mapSize.x !== mapSize) {
      this.key.shadow.mapSize.set(mapSize, mapSize);
      this.key.shadow.map?.dispose();
      this.key.shadow.map = null;
    }
    this.shadowDirty = true;
  }

  /** Renders the shadow map at the next frame, even with shadows off (the precompile frame builds its pipelines). */
  primeShadow(): void {
    this.shadowDirty = true;
    this.key.shadow.needsUpdate = true;
  }

  /**
   * The shadow casters that can move (the robot, the level's entities). Their world matrices and
   * visibility are compared every frame; the static level batches in the map never move.
   */
  setMovingCasters(roots: readonly THREE.Object3D[]): void {
    this.casterRoots = roots;
    this.shadowDirty = true;
  }

  /**
   * Keep the key light and its shadow frustum on what the camera sees: centred a little north of the
   * camera target, `half` metres either way (the frame of the follow camera is ≈ 26 × 15 m). A tighter
   * box means fewer casters and sharper shadows. Snapped to shadow texels so shadows do not shimmer.
   */
  follow(x: number, z: number, half = SHADOW_HALF): void {
    const h = Math.max(6, Math.min(20, Math.round(half)));
    const cam = this.key.shadow.camera as THREE.OrthographicCamera;
    if (cam.right !== h) {
      cam.left = -h;
      cam.right = h;
      cam.top = h;
      cam.bottom = -h;
      cam.updateProjectionMatrix();
    }
    const texel = (2 * h) / this.key.shadow.mapSize.x;
    const sx = Math.round(x / texel) * texel;
    const sz = Math.round((z - 2) / texel) * texel;
    this.key.target.position.set(sx, 0, sz);
    this.key.position.set(sx + this.keyOffset.x, this.keyOffset.y, sz + this.keyOffset.z);
    this.key.target.updateMatrixWorld();
    this.box.x = sx;
    this.box.z = sz;
    this.box.h = h;
    this.checkPending = true;
  }

  /**
   * First render of a frame (world matrices are current): asks for a shadow-map render only when its
   * content can differ from the last one: the light box moved or resized, the map size or the level
   * changed, or a moving caster moved, appeared or disappeared. Otherwise the kept map is exactly what
   * a new render would produce.
   */
  private checkShadow(renderer: THREE.Renderer, camera: THREE.Camera): void {
    const shadow = this.key.shadow;
    const frame = renderer.info.frame;
    if (camera === shadow.camera) {
      this.shadowFrame = frame;
      return;
    }
    if (!this.checkPending) {
      // a later render of the same frame (the street reflection). When the map was reallocated during
      // its render (a map size change) three keeps `needsUpdate` and renders it once more for the
      // next camera: nested in the reflection, in a new render context, so every caster would build
      // again. The map already holds this frame's shadows: drop the repeat.
      if (shadow.needsUpdate && this.shadowFrame === frame) shadow.needsUpdate = false;
      return;
    }
    this.checkPending = false;
    if (!this.shadowsOn) return;
    const b = this.box;
    const r = this.renderedBox;
    const moved = this.trackCasters();
    if (!moved && !this.shadowDirty && b.x === r.x && b.z === r.z && b.h === r.h) return;
    this.shadowDirty = false;
    r.x = b.x;
    r.z = b.z;
    r.h = b.h;
    this.key.shadow.needsUpdate = true;
  }

  /** Records the moving casters' world matrices; true when anything differs from the last record. */
  private trackCasters(): boolean {
    const layers = this.key.shadow.camera.layers;
    let n = 0;
    let changed = false;
    const visit = (o: THREE.Object3D): void => {
      if (!o.visible) return;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.castShadow && o.layers.test(layers)) {
        const off = n * 16;
        if (off + 16 > this.casterState.length) {
          const grown = new Float64Array(this.casterState.length * 2);
          grown.set(this.casterState);
          this.casterState = grown;
        }
        const st = this.casterState;
        const e = o.matrixWorld.elements;
        for (let i = 0; i < 16; i++) {
          if (st[off + i] !== e[i]) {
            st[off + i] = e[i];
            changed = true;
          }
        }
        n++;
      }
      for (const c of o.children) visit(c);
    };
    for (const root of this.casterRoots) if (root.parent) visit(root);
    if (n !== this.casterCount) changed = true;
    this.casterCount = n;
    return changed;
  }

  /** Map view: no fog, flat bright ambient, no puddles. */
  setMapMode(on: boolean): void {
    this.mapMode = on;
    this.scene.fogNode = on ? null : this.fogNode;
    this.ambient.intensity = on ? 3 : this.moodAmbient;
    groundOverview.value = on ? 1 : 0;
  }
}

/** The glow colours of a mood's environment map. */
function moodAccents(mood: LevelMood): string[] {
  return [NEON_HEX[mood.accentA], NEON_HEX[mood.accentB], '#ffb866', '#ffd9a3'];
}

/**
 * Procedural night-city environment (equirectangular, HDR) for image-based lighting: near-black zenith,
 * a fog-coloured band at the horizon, the warm haze of the lower city below it, and a few bright neon /
 * window glows near the horizon. Metals and the wet street reflect it, so they read at night instead
 * of turning black. Deterministic per seed.
 */
export function createCityEnvironment(mood: LevelMood, accents: readonly string[]): THREE.DataTexture {
  const W = 128;
  const H = 64;
  const data = new Float32Array(W * H * 4);
  const fog = new THREE.Color(mood.fogColor);
  const amb = new THREE.Color(mood.ambient);
  const warm = new THREE.Color('#ff9a4a');
  let r = (mood.seed * 7919 + 17) % 233280;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  const glows = Array.from({ length: 22 }, () => ({
    az: rnd() * Math.PI * 2,
    el: -0.12 + rnd() * 0.32,
    size: 0.03 + rnd() * 0.07,
    power: 1.5 + rnd() * 4,
    color: new THREE.Color(accents[Math.floor(rnd() * accents.length)] ?? '#ffb066'),
  }));
  const c = new THREE.Color();
  const glow = new THREE.Color();
  for (let y = 0; y < H; y++) {
    // DataTexture rows start at v = 0, which three's equirect lookup maps to the nadir
    const el = ((y + 0.5) / H - 0.5) * Math.PI;
    for (let x = 0; x < W; x++) {
      const az = ((x + 0.5) / W) * Math.PI * 2;
      if (el >= 0) {
        // sky: fog band at the horizon, dark above
        const band = Math.exp(-el * 6);
        c.copy(fog).multiplyScalar(0.5 + 2.2 * band).lerp(amb, 0.25 * band);
      } else {
        // below: the lower city haze, warmest a little under the horizon
        const haze = Math.exp(-Math.abs(el + 0.18) * 5);
        c.copy(fog).multiplyScalar(1.2 + 1.5 * haze).lerp(warm, 0.35 * haze);
      }
      for (const g of glows) {
        const dAz = Math.atan2(Math.sin(az - g.az), Math.cos(az - g.az));
        const d2 = (dAz * dAz) / (g.size * g.size * 4) + ((el - g.el) * (el - g.el)) / (g.size * g.size);
        if (d2 < 9) c.add(glow.copy(g.color).multiplyScalar(g.power * Math.exp(-d2)));
      }
      const i = (y * W + x) * 4;
      data[i] = c.r;
      data[i + 1] = c.g;
      data[i + 2] = c.b;
      data[i + 3] = 1;
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Twinkling lights of the lower city below and beyond the terrace. Built once with `count` lights (the
 * most any preset shows); `setAbyssCount` then draws the first n, which are exactly the lights a build
 * with n would make (one random sequence, consumed light by light).
 */
export function createAbyss(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, count: number, seed: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'abyss';

  const lights = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), abyssLightMaterial(), count);
  lights.name = 'abyss-lights';
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  const palette = ['#ffb066', '#ffb066', '#ffd9a3', '#5fe0ff', '#ff5aa0', '#fff2d6', '#ff8a1f'];
  let r = seed * 9301 + 49297;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const spanX = bounds.maxX - bounds.minX + 140;
  for (let i = 0; i < count; i++) {
    const depth = 10 + rnd() * 70;
    p.set(cx + (rnd() - 0.5) * spanX, -depth, bounds.minZ - 50 + rnd() * (bounds.maxZ - bounds.minZ + 140));
    const size = 0.25 + rnd() * 0.8;
    s.set(size, size * (0.6 + rnd()), size);
    m.compose(p, q, s);
    lights.setMatrixAt(i, m);
    c.set(palette[Math.floor(rnd() * palette.length)]).multiplyScalar(1 - (depth / 80) * 0.7);
    lights.setColorAt(i, c);
  }
  lights.instanceMatrix.needsUpdate = true;
  if (lights.instanceColor) lights.instanceColor.needsUpdate = true;
  lights.computeBoundingSphere();
  lights.frustumCulled = false;
  group.add(lights);
  return group;
}

/** Draws only the first `n` lights of an abyss from `createAbyss` (no new buffer or shader). */
export function setAbyssCount(abyss: THREE.Group, n: number): void {
  const lights = abyss.children[0] as THREE.InstancedMesh;
  lights.count = Math.max(0, Math.min(Math.round(n), lights.instanceMatrix.count));
}

function abyssLightMaterial(): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial();
  m.name = 'M_AbyssLight';
  m.fog = false;
  const h = hash(instanceIndex.toFloat().add(7));
  const twinkle = sin(time.mul(h.mul(1.6).add(0.4)).add(h.mul(40))).mul(0.35).add(0.75);
  m.colorNode = vec3(float(3.2).mul(twinkle));
  return m;
}

export interface Rain {
  mesh: THREE.Mesh;
  /** World point the rain volume follows (the camera target). */
  center: { value: THREE.Vector3 };
  setAmount(amount: number): void;
}

/** Rain streaks around the camera target: one draw call, wrapped in world space so drops do not slide. */
export function createRain(maxDrops: number): Rain {
  const W = 30;
  const H = 16;
  const D = 26;
  const pos: number[] = [];
  const seedAttr: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (let i = 0; i < maxDrops; i++) {
    const v = pos.length / 3;
    const len = 0.32 + ((i * 7919) % 100) / 260;
    pos.push(-0.009, 0, 0, 0.009, 0, 0, 0.009, len, 0, -0.009, len, 0);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    for (let k = 0; k < 4; k++) seedAttr.push(i);
    index.push(v, v + 1, v + 2, v, v + 2, v + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('drop', new THREE.Float32BufferAttribute(seedAttr, 1));
  geo.setIndex(index);

  const center = uniform(new THREE.Vector3());
  const amount = uniform(1);
  const drop = attribute('drop', 'float');
  const hx = hash(drop);
  const hz = hash(drop.add(131072)); // disjoint integer ranges per channel (hash truncates to uint)
  const hy = hash(drop.add(262144));
  const wrap = (h: THREE.Node<'float'>, c: THREE.Node<'float'>, size: number) => fract(h.sub(c.div(size))).sub(0.5).mul(size).add(c);
  const x = wrap(hx, center.x, W);
  const z = wrap(hz, center.z, D);
  const y = fract(hy.sub(time.mul(1.15))).mul(H).sub(2);
  const visible = hash(drop.add(393216)).lessThan(amount);
  const m = new THREE.MeshBasicNodeMaterial();
  m.name = 'M_Rain';
  m.transparent = true;
  m.depthWrite = false;
  m.blending = THREE.AdditiveBlending;
  m.positionNode = positionLocal.add(vec3(x, y, z)).add(vec3(positionLocal.y.mul(-0.12), 0, 0));
  const fade = smoothstep(0, 1, uv().y).mul(visible.select(float(1), float(0)));
  m.colorNode = color('#9fc6d8').mul(fade.mul(0.3));
  m.opacityNode = fade;
  const mesh = new THREE.Mesh(geo, m);
  mesh.name = 'rain';
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  return {
    mesh,
    center,
    setAmount(a: number) {
      amount.value = Math.max(0, Math.min(1, a));
      mesh.visible = a > 0.01;
    },
  };
}
