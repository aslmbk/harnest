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
  try {
    await run();
  } finally {
    contexts.get = get;
  }
}

export class PostFX {
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

  /** Applies a quality preset (MSAA change rebuilds the scene pass target). */
  setPreset(preset: QualityPreset): void {
    this.bloomNode.setResolutionScale(preset.bloomScale);
    const samples = preset.msaa;
    if ((this.scenePass.options as { samples?: number }).samples !== samples) {
      (this.scenePass.options as { samples?: number }).samples = samples;
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
  async compileAsync(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    // same as PassNode.compileAsync, plus progress and the right call depth
    const { scenePass } = this;
    await this.compileInto(scenePass.camera, scenePass.renderTarget, scenePass.getMRT(), SCENE_PASS_DEPTH, onProgress);
  }

  /**
   * Pre-builds the pipelines of a pass nested in the scene pass (the puddle reflection: its mirrored
   * camera and render target), at the depth it renders at.
   */
  async compilePass(camera: THREE.Camera, target: THREE.RenderTarget, onProgress?: (loaded: number, total: number) => void): Promise<void> {
    await this.compileInto(camera, target, null, SCENE_PASS_DEPTH + 1, onProgress);
  }

  private async compileInto(
    camera: THREE.Camera,
    target: THREE.RenderTarget,
    mrt: THREE.MRTNode | null,
    depth: number,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<void> {
    const { renderer, scenePass } = this;
    const prevTarget = renderer.getRenderTarget();
    const prevMrt = renderer.getMRT();
    renderer.setRenderTarget(target);
    renderer.setMRT(mrt);
    try {
      await compileAtDepth(renderer, depth, () =>
        renderer.compileAsync(scenePass.scene, camera, null, onProgress ? (e: ProgressEvent) => onProgress(e.loaded, e.total) : null),
      );
    } finally {
      renderer.setRenderTarget(prevTarget);
      renderer.setMRT(prevMrt);
    }
  }

  dispose(): void {
    this.pipeline.dispose();
    this.scenePass.dispose();
    this.bloomNode.dispose();
  }
}
