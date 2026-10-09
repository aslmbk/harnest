/**
 * Renderer, scene, render loop (clamped dt), resize with a DPR cap, quality presets (+ auto: a timed
 * probe behind the loading screen, then frame time during play) and post-processing. Game logic plugs
 * in through `start(update)`.
 *
 * Quality switches never compile: presets differ only in parameters outside every pipeline key (see
 * `quality.ts`). MSAA is the one exception and only changes at a level build (`settleMsaa`).
 */
import * as THREE from 'three/webgpu';
import { DynamicLighting } from 'three/addons/lighting/DynamicLighting.js';
import type { Quality, Store } from '../core/store';
import { reflectionControl } from '../render/ground';
import { PostFX } from '../render/post';
import { CameraRig } from './cameraRig';
import { precomputeSpheres } from './bounds';
import { dryRender, dryRenderSupported } from './dryRender';
import { freeze, pinNodeTime } from './freeze';
import { AutoQuality, chooseQuality, chooseUntimedQuality, MAX_POINT_LIGHTS, QUALITY_PRESETS, type QualityLevel, type QualityPreset } from './quality';

/** localStorage key: the preset the automatic quality settled on last time (seeds the next session's MSAA). */
const AUTO_LEVEL_KEY = 'harnest.autoQuality';

export interface FrameStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  frames: number;
}

export type Backend = 'webgpu' | 'webgl2';

/** Precompile switches for A/B measurements (URL `?dryframe=0`, `?forceframe=0`, `?parcompile=0`, see `params.ts`). */
export interface EngineOptions {
  /** Dry frames (`dryRender.ts`): the boot frame and before the level's real precompile frame. Default on. */
  dryFrame: boolean;
  /** The real precompile frame at the end of `compile` (and its wait for the GPU). Default on. */
  forcedFrame: boolean;
  /** A precompile's pipelines compile side by side (`PostFX.parallelCompile`). Default on. */
  parallelCompile: boolean;
}

const DEFAULT_OPTIONS: EngineOptions = { dryFrame: true, forcedFrame: true, parallelCompile: true };

/** One probe measurement (ms per frame): the cost that decides, and its GPU / CPU parts. */
interface ProbeCost {
  cost: number;
  gpu: number;
  cpu: number;
}

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

/**
 * `DynamicLightsNode` recognises the lights it can batch by `light.constructor.name`. The production
 * minifier renames three's classes, so in a build no light was batched: every visible light got its own
 * shader code keyed by its id, and each lamp the light pool switched on or off (or a budget change)
 * recompiled every lit material — a multi-second freeze. Pinning the real names restores the dev
 * behaviour (shaders depend only on which light types exist). No-op in dev, where names survive.
 */
function keepLightClassNames(): void {
  const classes: Record<string, { name: string }> = {
    AmbientLight: THREE.AmbientLight,
    DirectionalLight: THREE.DirectionalLight,
    PointLight: THREE.PointLight,
    SpotLight: THREE.SpotLight,
    HemisphereLight: THREE.HemisphereLight,
  };
  for (const [name, cls] of Object.entries(classes)) {
    if (cls.name !== name) Object.defineProperty(cls, 'name', { value: name, configurable: true });
  }
}

export class Engine {
  readonly renderer: THREE.WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly rig = new CameraRig();
  readonly backend: Backend;
  readonly stats: FrameStats = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, frames: 0 };
  preset: QualityPreset;
  /**
   * MSAA samples of the scene pass (and of the street reflection) for the level being shown. Part of
   * every scene pipeline's key: it never changes while a level is shown. A preset that wants another
   * count gets it at the next level build (`settleMsaa`), which precompiles everything anyway.
   */
  msaa: number;
  /** Called after a preset is applied (lights budget, abyss density…). Must stay compile-free. */
  readonly presetListeners = new Set<(p: QualityPreset) => void>();
  /** Called after each rendered frame. */
  readonly frameListeners = new Set<(stats: FrameStats) => void>();
  private post: PostFX;
  /** While true the loop still updates the game but does not render (pipelines compiling). */
  private paused = false;
  private forceFrame = false;
  private auto: AutoQuality | null = null;
  /** The automatic quality only judges frames while this is on (the game sets it in `playing`). */
  private autoActive = false;
  /** The load-time probe ran (once per session). */
  private probed = false;
  private pendingMsaa: number | null = null;
  private forced: QualityLevel | null;
  private last = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  /** CPU time of the last `post.render()` (ms), for the probe. */
  private renderMs = 0;
  /** The host has no size (hidden tab, collapsed pane): nothing is drawn until it gets one. */
  private blank = false;
  /** Set for one frame: it is rendered dry (`dryRender`) and its pipeline compilations land here. */
  private dry: Promise<void>[] | null = null;
  /** The scene stays hidden from the boot frame until the first level compiles (`warmUp`). */
  private sceneHeld = false;

  private constructor(
    private readonly host: HTMLElement,
    renderer: THREE.WebGPURenderer,
    private readonly store: Store,
    forced: QualityLevel | null,
    private readonly options: EngineOptions,
  ) {
    this.renderer = renderer;
    this.forced = forced;
    this.backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
    this.scene.name = 'harnest';
    // world matrices are updated once per frame (`start`), not again in every render of the frame (the
    // street reflection, the shadow map): nothing moves between those renders
    this.scene.matrixWorldAutoUpdate = false;
    this.preset = QUALITY_PRESETS[this.pickInitial()];
    this.msaa = this.preset.msaa;
    if (this.auto) this.auto.msaa = this.msaa;
    this.post = new PostFX(renderer, this.scene, this.rig.active, this.preset);
    this.post.parallelCompile = options.parallelCompile;
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
      // picking the level the automatic quality is at still turns the automatic quality off
      else if (want !== 'auto' && (want !== this.preset.level || this.auto)) this.setQuality(want);
    });
  }

  static async create(host: HTMLElement, store: Store, forced: QualityLevel | null, options: Partial<EngineOptions> = {}): Promise<Engine> {
    const renderer = new THREE.WebGPURenderer({ antialias: false, powerPreference: 'high-performance' });
    // Point / spot / hemisphere lights go into uniform arrays walked by a loop: shaders stay small and
    // the light budget can change without recompiling every material (the shadow-casting key light
    // keeps the regular per-light path).
    keepLightClassNames();
    renderer.lighting = new DynamicLighting({ maxPointLights: MAX_POINT_LIGHTS, maxSpotLights: 2, maxHemisphereLights: 1, maxDirectionalLights: 1 });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    // part of every lit pipeline's key: never toggled at runtime (low quality turns shadows off with a
    // strength uniform and by not rendering the map, see Atmosphere.setShadows)
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    host.appendChild(renderer.domElement);
    renderer.domElement.tabIndex = -1;
    await renderer.init();
    shareInstancingShaders(renderer);
    return new Engine(host, renderer, store, forced, { ...DEFAULT_OPTIONS, ...options });
  }

  private pickInitial(): QualityLevel {
    if (this.forced) return this.forced;
    const q = this.store.settings.quality;
    if (q !== 'auto') return q;
    // where the automatic quality ended last session (so the first level compiles with its MSAA);
    // the probe at the first level load re-checks it
    const start = readAutoLevel() ?? 'medium';
    this.auto = new AutoQuality(start);
    return start;
  }

  /**
   * Quality from the settings or the URL (`auto` picks by measurement). Compile-free: a preset that
   * needs another MSAA count gets it at the next level build.
   */
  setQuality(q: Quality): void {
    if (q === 'auto') {
      this.auto = this.newAuto(this.preset.level);
      return;
    }
    this.auto = null;
    this.applyPreset(QUALITY_PRESETS[q]);
  }

  /**
   * Applies a preset without compiling anything: DPR, bloom scale and the listeners' parameters
   * (light budget, shadow strength / map size, reflection scale, particle counts). The MSAA count is
   * only recorded for the next level build.
   */
  private applyPreset(p: QualityPreset, initial = false, log = !initial): void {
    this.preset = p;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, p.dprCap));
    this.pendingMsaa = p.msaa !== this.msaa ? p.msaa : null;
    if (!initial) this.post.setPreset({ ...p, msaa: this.msaa });
    for (const fn of this.presetListeners) fn(p);
    if (log) console.info(`[engine] quality → ${p.level}${this.pendingMsaa !== null ? ` (MSAA ${this.pendingMsaa} from the next level load)` : ''}`);
  }

  /**
   * Called by the game before it builds a level: applies an MSAA count a preset asked for since the
   * last build (the level's passes are then created and precompiled with it). Returns the count.
   */
  settleMsaa(): number {
    // an automatic step up that needed more MSAA waited for this build: it takes effect now
    const held = this.auto?.takeHeld() ?? null;
    if (held) {
      this.applyPreset(QUALITY_PRESETS[held], false, false);
      console.info(`[engine] quality → ${held} (held step up, with this level build)`);
      writeAutoLevel(held);
    }
    if (this.pendingMsaa !== null && this.pendingMsaa !== this.msaa) {
      this.msaa = this.pendingMsaa;
      this.post.setPreset({ ...this.preset, msaa: this.msaa });
      console.info(`[engine] MSAA → ${this.msaa}`);
    }
    this.pendingMsaa = null;
    if (this.auto) this.auto.msaa = this.msaa;
    return this.msaa;
  }

  /** An automatic quality starting at `level` that knows the MSAA count of the level being shown. */
  private newAuto(level: QualityLevel): AutoQuality {
    const auto = new AutoQuality(level);
    auto.msaa = this.msaa;
    return auto;
  }

  /**
   * A preset asked for more MSAA samples than the shown level has (low → medium / high): the picture
   * would differ from that preset's until the passes are compiled with them (the game does that behind
   * the loading screen: `settleMsaa` + `compile`). Fewer samples can wait for the next level build.
   */
  get msaaUpgradePending(): boolean {
    return this.pendingMsaa !== null && this.pendingMsaa > this.msaa;
  }

  /** The automatic quality judges frames only while on (the game turns it on in `playing`). */
  setAutoQualityActive(on: boolean): void {
    if (on && !this.autoActive) this.auto?.rewarm();
    this.autoActive = on;
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
      const dt = freeze.active ? 0 : Math.min(Math.max(raw / 1000, 0), 1 / 20); // [freeze] dt = 0
      update(dt, now / 1000);
      if (freeze.active) pinNodeTime(this.renderer); // [freeze] TSL `time` pinned
      if (this.paused && !this.forceFrame) return;
      if (this.blank) {
        this.resize();
        if (this.blank) return;
      }
      const r0 = performance.now();
      this.scene.updateMatrixWorld();
      if (this.dry) this.dry.push(...dryRender(this.renderer, () => this.post.render()));
      else this.post.render();
      this.renderMs = performance.now() - r0;
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
    // only frames of play are judged (menus, loads and transitions say nothing about the play frame rate)
    if (this.auto && this.autoActive && !freeze.active && document.visibilityState === 'visible') { // [freeze] no auto switch
      const held = this.auto.held;
      const next = this.auto.sample(frameMs);
      if (next) {
        this.applyPreset(QUALITY_PRESETS[next]);
        writeAutoLevel(next);
      } else if (this.auto.held && this.auto.held !== held) {
        // it needs more MSAA: taken at the next level build, never with a compile in the middle of play
        console.info(`[engine] quality → ${this.auto.held} at the next level load (MSAA ${QUALITY_PRESETS[this.auto.held].msaa})`);
      }
    }
  }

  /**
   * Load-time pick of the automatic quality (once per session, `auto` only), called behind the loading
   * screen once the level is compiled and the game camera is in place: renders a few frames of the
   * current preset and measures their GPU time (WebGPU timestamp queries; CPU render time counts too),
   * tries `high` when there is headroom, and applies the pick. Switching presets is compile-free, so the
   * probe costs only its frames (~0.5–1 s). Without timestamps (WebGL2) only a slow frame rate is
   * detectable (vsync caps it): it then only steps down to `low`. A preset picked in the settings while
   * the probe runs wins: the probe stops and applies nothing.
   */
  async probeQuality(): Promise<void> {
    if (!this.auto || this.probed || freeze.active || this.paused) return; // [freeze] no probe
    this.probed = true;
    const t0 = performance.now();
    const backend = this.renderer.backend as unknown as { trackTimestamp?: boolean };
    const timed = this.backend === 'webgpu' && this.renderer.hasFeature('timestamp-query');
    const wasTracking = backend.trackTimestamp === true;
    const start = this.preset;
    const auto = this.auto;
    let pick: QualityLevel;
    try {
      if (timed) backend.trackTimestamp = true;
      this.applyPreset(QUALITY_PRESETS.medium, false, false);
      const medium = await this.measureFrames(timed);
      if (this.auto !== auto) return; // the settings picked a preset meanwhile: it stays
      let high: ProbeCost | null = null;
      if (timed) {
        let choice = chooseQuality({ medium: medium.cost });
        if (choice === 'probe-high') {
          this.applyPreset(QUALITY_PRESETS.high, false, false);
          high = await this.measureFrames(timed);
          if (this.auto !== auto) return;
          choice = chooseQuality({ medium: medium.cost, high: high.cost });
        }
        pick = choice === 'probe-high' ? 'medium' : choice;
      } else {
        // frame time alone (vsync-capped) can only show a slow frame rate, never headroom
        pick = chooseUntimedQuality(medium);
      }
      const fmt = (m: ProbeCost) => `${m.cost.toFixed(1)} ms (${timed ? `GPU ${m.gpu.toFixed(1)}, ` : ''}CPU ${m.cpu.toFixed(1)})`;
      console.info(`[engine] quality probe: medium ${fmt(medium)}${high ? `, high ${fmt(high)}` : ''} → ${pick} in ${Math.round(performance.now() - t0)} ms`);
    } catch (err) {
      console.warn('[engine] quality probe failed', err);
      pick = start.level;
    } finally {
      backend.trackTimestamp = wasTracking;
    }
    if (this.auto !== auto) return; // the settings picked a preset meanwhile
    this.auto = this.newAuto(pick);
    this.applyPreset(QUALITY_PRESETS[pick]);
    writeAutoLevel(pick);
  }

  /** Median cost (ms) of a few frames of the current preset: GPU time (timestamps) or CPU render time, whichever is larger; frame time without timestamps. */
  private async measureFrames(timed: boolean, frames = 16, settle = 4): Promise<ProbeCost> {
    for (let i = 0; i < settle; i++) await this.nextFrame();
    const renderer = this.renderer;
    if (timed) await renderer.resolveTimestampsAsync('render'); // drop the settle frames' queries
    const cpu: number[] = [];
    const interval: number[] = [];
    for (let i = 0; i < frames; i++) {
      const a = performance.now();
      await this.nextFrame();
      interval.push(performance.now() - a);
      cpu.push(this.renderMs);
    }
    const cpuMs = median(cpu);
    if (!timed) return { cost: Math.max(cpuMs, median(interval)), gpu: 0, cpu: cpuMs };
    const last = (await renderer.resolveTimestampsAsync('render')) ?? 0;
    // per-frame GPU sums from the resolved queries (uid = …:f<frame>); the last frame's total otherwise
    const pool = (renderer.backend as unknown as { timestampQueryPool?: { render?: { timestamps?: Map<string, number> } } }).timestampQueryPool?.render;
    const perFrame = new Map<string, number>();
    for (const [uid, ms] of pool?.timestamps ?? []) {
      const f = /:f(\d+)$/.exec(uid)?.[1];
      if (f !== undefined) perFrame.set(f, (perFrame.get(f) ?? 0) + ms);
    }
    const gpuMs = perFrame.size >= 4 ? median([...perFrame.values()]) : last;
    return { cost: Math.max(gpuMs, cpuMs), gpu: gpuMs, cpu: cpuMs };
  }

  /**
   * Boot frame, before the first level: configures the post pipeline (its targets get their size, so the
   * level can be precompiled against them) and compiles its pipelines asynchronously (a dry frame). The
   * scene is hidden for it and stays hidden until the first level's `compile`: the robot, already in it,
   * would otherwise build its pipelines synchronously in the frames drawn while the level is built
   * (they are behind the opaque boot loading screen, so hiding it changes nothing on screen).
   */
  async warmUp(): Promise<void> {
    this.scene.visible = false;
    this.sceneHeld = true;
    if ((await this.dryFrame()) < 0) await this.nextFrame();
  }

  /**
   * Renders the next frame dry (`dryRender.ts`: prepared like a real frame, pipelines compiled
   * asynchronously, nothing drawn) and resolves once every pipeline it started is compiled. Returns
   * their number, or -1 when dry frames are off or unsupported (nothing was rendered).
   */
  private async dryFrame(): Promise<number> {
    if (!this.options.dryFrame || !dryRenderSupported(this.renderer)) return -1;
    const pending: Promise<void>[] = [];
    this.dry = pending;
    try {
      await this.nextFrame(true);
    } finally {
      this.dry = null;
    }
    await Promise.all(pending);
    return pending.length;
  }

  /**
   * Pre-builds every pipeline of the scene before a level is shown: the scene pass and the passes nested
   * in it (`nested`, e.g. the puddle reflection) asynchronously, so the page keeps animating; then a dry
   * frame with everything in view compiles, also asynchronously, what `compileAsync` cannot (the
   * shadow-map materials, the two passes of transparent double-sided materials); then one real frame
   * uploads and draws everything and the GPU is let finish it, so the first seconds of play neither
   * create a pipeline nor stutter. Rendering pauses meanwhile, and culling is off so off-screen objects
   * compile too.
   *
   * Everything a quality switch can turn on is built here whatever the current preset: the reflection
   * pass is precompiled and rendered in the real frame even when off (`reflectionControl.force`), and
   * `beforeFrame` lets the caller request a shadow-map render for those frames. `ready` (e.g. textures
   * painted in a worker) is awaited before them, so the real frame is drawn with final content; nothing
   * is rendered while waiting (a frame of the new level outside the precompile would build it synchronously).
   * `uploads`: textures not in view yet (other pages of a screen), uploaded before the real frame.
   */
  async compile(
    onProgress?: (ratio: number) => void,
    nested?: (camera: THREE.Camera) => readonly NestedPass[],
    beforeFrame?: () => void,
    ready?: Promise<unknown>,
    uploads: readonly THREE.Texture[] = [],
  ): Promise<void> {
    const t0 = performance.now();
    this.paused = true;
    reflectionControl.paused = true;
    if (this.sceneHeld) {
      this.sceneHeld = false;
      this.scene.visible = true;
    }
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
    const progress = (from: number, span: number) => {
      let counted = false;
      return (ratio: number, objects: number) => {
        if (ratio >= 1 && !counted) {
          counted = true;
          count += objects;
        }
        onProgress?.(from + span * Math.min(1, ratio));
        const now = performance.now();
        if (now - lastLog > 2000) {
          lastLog = now;
          console.info(`[engine] compiling pipelines ${Math.round(ratio * 100)}%…`);
        }
      };
    };
    const span = (name: string, start: number) => performance.measure(`compile:${name}`, { start, end: performance.now() });
    try {
      // the bounding spheres the first projection would compute in one long task (the static batches'
      // buffers), in slices: the loading screen keeps animating (paused: no frame renders meanwhile)
      let s = performance.now();
      const spheres = await precomputeSpheres(this.scene);
      if (spheres) span('bounds', s);
      if (!this.post.ready) await this.nextFrame(true);
      // every layer, so the reflection stand-ins and shadow blocks compile too
      camera.layers.enableAll();
      this.scene.updateMatrixWorld();
      s = performance.now();
      await this.post.compileAsync(progress(0, 0.8));
      span('scene', s);
      camera.layers.mask = layers;
      const passes = nested?.(camera) ?? [];
      s = performance.now();
      for (const [i, p] of passes.entries()) await this.post.compilePass(p.camera, p.target, progress(0.8 + (0.15 * i) / passes.length, 0.15 / passes.length));
      span('nested', s);
      if (ready) await ready;
      reflectionControl.paused = false;
      reflectionControl.force = true;
      // a dry frame (nothing culled) compiles what the real frame would still build synchronously
      s = performance.now();
      beforeFrame?.();
      const late = await this.dryFrame();
      span('dry', s);
      if (late > 0) console.info(`[engine] ${late} more pipelines compiled in a dry frame`);
      // textures the level shows later (other states of a screen): uploaded now, not in a frame of play
      for (const t of uploads) this.renderer.initTexture(t);
      if (this.options.forcedFrame) {
        // one real frame (nothing culled), then wait until the GPU has run it: uploads, mipmaps and
        // anything else done on first use are paid for behind the loading screen. The dry frame left
        // the shadow map empty: it is rendered again.
        s = performance.now();
        beforeFrame?.();
        await this.nextFrame(true);
        span('frame', s);
        reflectionControl.force = false;
        s = performance.now();
        await this.gpuIdle();
        span('gpuIdle', s);
      } else {
        // [A/B] no real frame: the first frame of play does all of that
        beforeFrame?.();
      }
      reflectionControl.force = false;
      onProgress?.(1);
    } catch (err) {
      console.warn('[engine] precompile failed', err);
    } finally {
      for (const o of culled) o.frustumCulled = true;
      camera.layers.mask = layers;
      this.paused = false;
      reflectionControl.paused = false;
      reflectionControl.force = false;
      // frames around a compile are not the play frame rate
      this.auto?.rewarm();
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

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

function readAutoLevel(): QualityLevel | null {
  try {
    const v = localStorage.getItem(AUTO_LEVEL_KEY);
    return v === 'low' || v === 'medium' || v === 'high' ? v : null;
  } catch {
    return null;
  }
}

function writeAutoLevel(level: QualityLevel): void {
  try {
    localStorage.setItem(AUTO_LEVEL_KEY, level);
  } catch {
    // storage blocked: the next session starts at medium again
  }
}
