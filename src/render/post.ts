/**
 * Post-processing (TSL, `RenderPipeline`): scene pass (HDR, MSAA) → bloom → vignette → tone mapping.
 * Tone mapping and sRGB output are applied by the pipeline (`outputColorTransform`).
 *
 * Extension point for the polish pass: add nodes between `scene` and `output` in `build()`
 * (film grain, chromatic aberration, colour grading LUT…).
 */
import * as THREE from 'three/webgpu';
import { float, length, mix, pass, smoothstep, uniform, uv, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import type { QualityPreset } from '../engine/quality';

export interface PostSettings {
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  vignette: number;
}

export const DEFAULT_POST: PostSettings = { bloomStrength: 0.85, bloomRadius: 0.55, bloomThreshold: 0.8, vignette: 0.42 };

/** Call depth of the scene pass inside the pipeline; nested passes it triggers (reflection, shadow map) are one deeper. */
export const SCENE_PASS_DEPTH = 1;

type RenderContexts = { get(target: THREE.RenderTarget | null, mrt: unknown, depth?: number): unknown };

/**
 * Runs `Renderer.compileAsync` for the render contexts of call `depth`. Render contexts are part of every
 * pipeline's cache key and are kept per call depth, but `compileAsync` always uses depth 0, while the
 * scene pass renders nested in the post pipeline (depth 1) and the puddle reflection inside it (depth 2):
 * compiling at depth 0 builds pipelines no frame ever uses, and the real ones are then built
 * synchronously in the first frames of play (a visible freeze). Relies on three r186 internals
 * (`_renderContexts`); without them it compiles as before.
 *
 * `compileAsync` picks its render context in its synchronous part (before its first `await`), so the
 * depth shift only lasts for that part: frames rendered while the compile goes on are not affected.
 */
async function compileAtDepth(renderer: THREE.WebGPURenderer, depth: number, run: () => Promise<unknown>): Promise<void> {
  const contexts = (renderer as unknown as { _renderContexts?: RenderContexts })._renderContexts;
  if (!contexts || typeof contexts.get !== 'function' || depth === 0) {
    await run();
    return;
  }
  const get = contexts.get;
  contexts.get = function (this: RenderContexts, target, mrt, d = 0) {
    return get.call(this, target, mrt, d + depth);
  };
  let pending: Promise<unknown>;
  try {
    pending = run();
  } finally {
    contexts.get = get;
  }
  await pending;
}

/**
 * Progress of a precompile: `ratio` 0..1 over the call; `objects` render objects prepared so far (all of
 * them when `ratio` reaches 1).
 */
export type CompileProgress = (ratio: number, objects: number) => void;

type PipelineCache = { getForRender(renderObject: unknown, promises: Promise<void>[] | null): unknown };

/**
 * Runs `Renderer.compileAsync` (inside `run`) with its pipelines compiled in parallel, and resolves once
 * all of them are. `compileAsync` (r186) waits for each object's pipeline before it builds the next
 * object's shaders, so a level's ~20 pipelines are compiled one after the other (≈ 4 s, most of the
 * load). Here its pipeline requests go to one list it does not wait for: the shaders are still built
 * object by object with yields, and the GPU process compiles the pipelines side by side. Same
 * pipelines, none created synchronously. `onPipelines(done, total)` reports their progress.
 * Relies on r186 internals (`_pipelines.getForRender`); without them it compiles as before.
 */
async function compileParallel(
  renderer: THREE.WebGPURenderer,
  run: () => Promise<unknown>,
  onPipelines?: (done: number, total: number) => void,
): Promise<void> {
  const cache = (renderer as unknown as { _pipelines?: Partial<PipelineCache> })._pipelines;
  const get = cache?.getForRender;
  if (!cache || typeof get !== 'function') {
    await run();
    return;
  }
  const pending: Promise<void>[] = [];
  // only compileAsync passes a promise list (a real frame passes null: those stay synchronous). Its
  // `updateAfter` then runs before the pipeline is ready: no node here has an update-after step.
  const own = Object.prototype.hasOwnProperty.call(cache, 'getForRender');
  cache.getForRender = function (this: PipelineCache, renderObject, promises) {
    return get.call(this, renderObject, promises === null ? null : pending);
  };
  try {
    await run();
  } finally {
    if (own) cache.getForRender = get;
    else delete cache.getForRender; // the prototype's method again
  }
  let done = 0;
  onPipelines?.(0, pending.length);
  await Promise.all(pending.map((p) => p.then(() => onPipelines?.(++done, pending.length))));
}

export class PostFX {
  /** Pipelines of a precompile compile in parallel (`compileParallel`); false: one after the other (A/B). */
  parallelCompile = true;
  private pipeline: THREE.RenderPipeline;
  private scenePass: ReturnType<typeof pass>;
  private bloomNode: ReturnType<typeof bloom>;
  readonly vignette = uniform(DEFAULT_POST.vignette);

  constructor(
    private readonly renderer: THREE.WebGPURenderer,
    private readonly scene: THREE.Scene,
    private camera: THREE.Camera,
    preset: QualityPreset,
    settings: PostSettings = DEFAULT_POST,
  ) {
    this.pipeline = new THREE.RenderPipeline(renderer);
    this.scenePass = pass(scene, camera, { samples: preset.msaa });
    const sceneColor = this.scenePass.getTextureNode('output');
    this.bloomNode = bloom(sceneColor, settings.bloomStrength, settings.bloomRadius, settings.bloomThreshold);
    this.bloomNode.setResolutionScale(preset.bloomScale);
    const centred = uv().sub(0.5);
    const vig = mix(float(1).sub(this.vignette), float(1), smoothstep(0.85, 0.25, length(centred.mul(1.25))));
    const lit = sceneColor.add(this.bloomNode);
    this.pipeline.outputNode = vec4(lit.rgb.mul(vig), 1);
  }

  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
    this.scenePass.camera = camera;
  }

  get bloom() {
    return this.bloomNode;
  }

  /**
   * Applies a quality preset. The MSAA sample count is part of every scene-pass pipeline key: a change
   * rebuilds them all (the engine keeps it fixed while a level is shown); the bloom scale only resizes.
   */
  setPreset(preset: QualityPreset): void {
    this.bloomNode.setResolutionScale(preset.bloomScale);
    const samples = preset.msaa;
    if ((this.scenePass.options as { samples?: number }).samples !== samples) {
      (this.scenePass.options as { samples?: number }).samples = samples;
      // the target too (the pass only copies the option at its next setup): a precompile run before the
      // next frame must target the new sample count
      this.scenePass.renderTarget.samples = samples;
      this.pipeline.needsUpdate = true;
    }
  }

  render(): void {
    this.pipeline.render();
  }

  /** True once the pipeline has rendered at least once (the scene pass target is configured). */
  get ready(): boolean {
    return this.scenePass.renderTarget.width > 1;
  }

  /**
   * Pre-builds the pipelines of the scene pass against its real render target (format, MSAA) and call
   * depth, with asynchronous pipeline creation so the page does not freeze while shaders compile.
   */
  async compileAsync(onProgress?: CompileProgress): Promise<void> {
    // same as PassNode.compileAsync, plus progress and the right call depth
    const { scenePass } = this;
    await this.compileInto(scenePass.camera, scenePass.renderTarget, scenePass.getMRT(), SCENE_PASS_DEPTH, onProgress);
  }

  /**
   * Pre-builds the pipelines of a pass nested in the scene pass (the puddle reflection: its mirrored
   * camera and render target), at the depth it renders at.
   */
  async compilePass(camera: THREE.Camera, target: THREE.RenderTarget, onProgress?: CompileProgress): Promise<void> {
    await this.compileInto(camera, target, null, SCENE_PASS_DEPTH + 1, onProgress);
  }

  private async compileInto(
    camera: THREE.Camera,
    target: THREE.RenderTarget,
    mrt: THREE.MRTNode | null,
    depth: number,
    onProgress?: CompileProgress,
  ): Promise<void> {
    const { renderer, scenePass } = this;
    // Every render object's pipeline key includes a scene key (lights, environment, fog) that three
    // caches per render call (`info.calls`); compileAsync does not count as a call, so it would reuse
    // the key of the last frame, rendered before this level (its lights, its environment) existed, and
    // the first real frame would then find every precompiled object stale and rebuild them all
    // synchronously (seconds). A new call id makes the precompile use the scene as it is now.
    (renderer.info as { calls: number }).calls++;
    const prevTarget = renderer.getRenderTarget();
    const prevMrt = renderer.getMRT();
    renderer.setRenderTarget(target);
    renderer.setMRT(mrt);
    // the target and MRT are read in the synchronous part of compileAsync: restored right after it
    const compile = (onObjects: ((e: ProgressEvent) => void) | null) => {
      let pending: Promise<void>;
      try {
        pending = compileAtDepth(renderer, depth, () => renderer.compileAsync(scenePass.scene, camera, null, onObjects));
      } finally {
        renderer.setRenderTarget(prevTarget);
        renderer.setMRT(prevMrt);
      }
      return pending;
    };
    const parallel = this.parallelCompile;
    let objects = 0;
    const onObjects = (e: ProgressEvent) => {
      objects = e.loaded;
      onProgress?.((parallel ? 0.5 : 1) * (e.loaded / Math.max(1, e.total)), objects);
    };
    if (!parallel) {
      await compile(onObjects);
      onProgress?.(1, objects);
      return;
    }
    // progress: the first half while shaders are built, the second while the pipelines compile
    await compileParallel(renderer, () => compile(onObjects), (done, total) => onProgress?.(0.5 + (0.5 * done) / Math.max(1, total), objects));
    onProgress?.(1, objects);
  }

  dispose(): void {
    this.pipeline.dispose();
    this.scenePass.dispose();
    this.bloomNode.dispose();
  }
}
