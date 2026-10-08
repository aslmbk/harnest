/**
 * Renderer, scene, render loop (clamped dt), resize with a DPR cap, quality presets (+ auto by frame
 * time) and post-processing. Game logic plugs in through `start(update)`.
 */
import * as THREE from 'three/webgpu';
import { DynamicLighting } from 'three/addons/lighting/DynamicLighting.js';
import type { Quality, Store } from '../core/store';
import { reflectionControl } from '../render/ground';
import { PostFX } from '../render/post';
import { CameraRig } from './cameraRig';
import { AutoQuality, MAX_POINT_LIGHTS, QUALITY_PRESETS, type QualityLevel, type QualityPreset } from './quality';

export interface FrameStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  frames: number;
}

export type Backend = 'webgpu' | 'webgl2';

/** A pass rendered nested in the scene pass (the puddle reflection): its camera and render target. */
export interface NestedPass {
  camera: THREE.Camera;
  target: THREE.RenderTarget;
}

/**
 * three r186 puts the matrices of an `InstancedMesh` with ≤ 1024 instances into a uniform buffer whose
 * name (`NodeBuffer_<node id>`) and array size end up in the shader, so every instanced mesh compiles
 * its own pipeline (hundreds per level, ~40 ms each on D3D12). Reporting a zero uniform-buffer limit
 * sends instancing down the instanced-attribute path instead: one shader per material + vertex layout.
 * The limit is only consulted for instancing / skinning / range nodes; we use no skinning.
 */
function shareInstancingShaders(renderer: THREE.WebGPURenderer): void {
  const caps = (renderer.backend as unknown as { capabilities?: { getUniformBufferLimit?: () => number } }).capabilities;
  if (caps && typeof caps.getUniformBufferLimit === 'function') caps.getUniformBufferLimit = () => 0;
  else console.warn('[engine] cannot share instancing shaders (three internals changed)');
}

export class Engine {
  readonly renderer: THREE.WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly rig = new CameraRig();
  readonly backend: Backend;
  readonly stats: FrameStats = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, frames: 0 };
  preset: QualityPreset;
  /** Called after a preset is applied (lights budget, abyss density…). */
  readonly presetListeners = new Set<(p: QualityPreset) => void>();
  /** Called after each rendered frame. */
  readonly frameListeners = new Set<(stats: FrameStats) => void>();
  private post: PostFX;
  /** While true the loop still updates the game but does not render (pipelines compiling). */
  private paused = false;
  private forceFrame = false;
  private auto: AutoQuality | null = null;
  private forced: QualityLevel | null;
  private last = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  /** The host has no size (hidden tab, collapsed pane): nothing is drawn until it gets one. */
  private blank = false;

  private constructor(
    private readonly host: HTMLElement,
    renderer: THREE.WebGPURenderer,
    private readonly store: Store,
    forced: QualityLevel | null,
  ) {
    this.renderer = renderer;
    this.forced = forced;
    this.backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
    this.scene.name = 'harnest';
    this.preset = QUALITY_PRESETS[this.pickInitial()];
    this.post = new PostFX(renderer, this.scene, this.rig.active, this.preset);
    this.applyPreset(this.preset, true);
    this.resize();
    addEventListener('resize', () => this.resize());
    this.watchPixelRatio();
    // no frames run while the tab is hidden: the first one back would count the whole time away
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.last = performance.now();
    });
    store.subscribe((d) => {
      if (this.forced) return;
      const want = d.settings.quality;
      if (want === 'auto' && !this.auto) this.setQuality('auto');
      else if (want !== 'auto' && want !== this.preset.level) this.setQuality(want);
    });
  }

  static async create(host: HTMLElement, store: Store, forced: QualityLevel | null): Promise<Engine> {
    const renderer = new THREE.WebGPURenderer({ antialias: false, powerPreference: 'high-performance' });
    // Point / spot / hemisphere lights go into uniform arrays walked by a loop: shaders stay small and
    // the light budget can change without recompiling every material (the shadow-casting key light
    // keeps the regular per-light path).
    renderer.lighting = new DynamicLighting({ maxPointLights: MAX_POINT_LIGHTS, maxSpotLights: 2, maxHemisphereLights: 1, maxDirectionalLights: 1 });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    host.appendChild(renderer.domElement);
    renderer.domElement.tabIndex = -1;
    await renderer.init();
    shareInstancingShaders(renderer);
    return new Engine(host, renderer, store, forced);
  }

  private pickInitial(): QualityLevel {
    if (this.forced) return this.forced;
    const q = this.store.settings.quality;
    if (q !== 'auto') return q;
    this.auto = new AutoQuality('medium');
    return 'medium';
  }

  /** Quality from the settings or the URL (`auto` picks by frame time). */
  setQuality(q: Quality): void {
    if (q === 'auto') {
      this.auto = new AutoQuality(this.preset.level);
      return;
    }
    this.auto = null;
    this.applyPreset(QUALITY_PRESETS[q]);
  }

  private applyPreset(p: QualityPreset, initial = false): void {
    this.preset = p;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, p.dprCap));
    this.renderer.shadowMap.enabled = p.shadows;
    if (!initial) this.post.setPreset(p);
    for (const fn of this.presetListeners) fn(p);
    if (!initial) console.info(`[engine] quality → ${p.level}`);
  }

  resize(): void {
    const rawW = this.host.clientWidth || innerWidth;
    const rawH = this.host.clientHeight || innerHeight;
    // A hidden tab or a collapsed pane reports 0×0, and WebGPU refuses a 0-sized swapchain or depth
    // texture: keep a 1×1 canvas, skip rendering, and re-measure every frame until there is room.
    this.blank = rawW < 1 || rawH < 1;
    const w = Math.max(1, rawW);
    const h = Math.max(1, rawH);
    // the device pixel ratio changes with the browser zoom and from one screen to another
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this.preset.dprCap));
    this.renderer.setSize(w, h);
    this.rig.setAspect(w / h);
  }

  /** Dragging the window to a screen with another pixel ratio fires no resize event. */
  private watchPixelRatio(): void {
    const mq = matchMedia(`(resolution: ${devicePixelRatio || 1}dppx)`);
    mq.addEventListener(
      'change',
      () => {
        this.resize();
        this.watchPixelRatio();
      },
      { once: true },
    );
  }

  /** Switch between the game camera and the map camera. */
  syncCamera(): void {
    this.post.setCamera(this.rig.active);
  }

  start(update: (dt: number, time: number) => void): void {
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => {
      const now = performance.now();
      const raw = now - this.last;
      this.last = now;
      const dt = Math.min(Math.max(raw / 1000, 0), 1 / 20);
      update(dt, now / 1000);
      if (this.paused && !this.forceFrame) return;
      if (this.blank) {
        this.resize();
        if (this.blank) return;
      }
      this.post.render();
      this.trackStats(raw);
      if (this.frameListeners.size) for (const fn of [...this.frameListeners]) fn(this.stats);
    });
  }

  private trackStats(frameMs: number): void {
    const s = this.stats;
    s.frames++;
    s.frameMs = s.frameMs * 0.9 + frameMs * 0.1;
    s.drawCalls = this.renderer.info.render.drawCalls;
    s.triangles = this.renderer.info.render.triangles;
    this.fpsAcc += frameMs;
    this.fpsFrames++;
    if (this.fpsAcc >= 500) {
      s.fps = Math.round((this.fpsFrames * 1000) / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    if (this.auto && document.visibilityState === 'visible') {
      const next = this.auto.sample(frameMs);
      if (next) this.applyPreset(QUALITY_PRESETS[next]);
    }
  }

  /**
   * Pre-builds every pipeline of the scene before a level is shown: the scene pass and the passes nested
   * in it (`nested`, e.g. the puddle reflection) asynchronously, so the page keeps animating; then one
   * real frame with everything in view builds what cannot be precompiled (shadow-map materials), and
   * the GPU is let finish compiling, so the first seconds of play do not stutter. Rendering pauses
   * meanwhile, and culling is off so off-screen objects compile too.
   */
  async compile(onProgress?: (ratio: number) => void, nested?: (camera: THREE.Camera) => readonly NestedPass[]): Promise<void> {
    const t0 = performance.now();
    this.paused = true;
    reflectionControl.paused = true;
    const culled: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      if (o.frustumCulled) {
        o.frustumCulled = false;
        culled.push(o);
      }
    });
    const camera = this.rig.active;
    const layers = camera.layers.mask;
    let count = 0;
    let lastLog = t0;
    const progress = (from: number, span: number) => (loaded: number, total: number) => {
      count += loaded === total ? total : 0;
      onProgress?.(from + (span * loaded) / Math.max(1, total));
      const now = performance.now();
      if (now - lastLog > 2000) {
        lastLog = now;
        console.info(`[engine] compiling pipelines ${loaded}/${total}…`);
      }
    };
    try {
      if (!this.post.ready) await this.nextFrame(true);
      // every layer, so the reflection stand-ins and shadow blocks compile too
      camera.layers.enableAll();
      await this.post.compileAsync(progress(0, 0.8));
      camera.layers.mask = layers;
      const passes = nested?.(camera) ?? [];
      for (const [i, p] of passes.entries()) await this.post.compilePass(p.camera, p.target, progress(0.8 + (0.15 * i) / passes.length, 0.15 / passes.length));
      // one real frame (nothing culled), then wait until the GPU has run it: shader compilation that
      // only happens on first use is paid for behind the loading screen
      reflectionControl.paused = false;
      await this.nextFrame(true);
      await this.gpuIdle();
      onProgress?.(1);
    } catch (err) {
      console.warn('[engine] precompile failed', err);
    } finally {
      for (const o of culled) o.frustumCulled = true;
      camera.layers.mask = layers;
      this.paused = false;
      reflectionControl.paused = false;
    }
    console.info(`[engine] ${count} render objects precompiled in ${Math.round(performance.now() - t0)} ms`);
  }

  /** Resolves when the GPU has finished the work submitted so far (WebGPU; at once on WebGL2). */
  private async gpuIdle(): Promise<void> {
    const device = (this.renderer.backend as unknown as { device?: { queue: { onSubmittedWorkDone(): Promise<undefined> } } }).device;
    if (device) await device.queue.onSubmittedWorkDone();
  }

  /** Resolves after the next rendered frame (`force` renders even while paused). */
  nextFrame(force = false): Promise<void> {
    return new Promise((resolve) => {
      const fn = () => {
        this.frameListeners.delete(fn);
        this.forceFrame = false;
        resolve();
      };
      if (force) this.forceFrame = true;
      this.frameListeners.add(fn);
    });
  }
}
