/**
 * Dry frames: one frame rendered through the real passes — the post pipeline, the scene pass and the
 * passes nested in it (street reflection, shadow map) with their render targets, call depths, override
 * materials and render-object functions — in which every render object is prepared exactly as
 * `Renderer._renderObjectDirect` prepares it (nodes, geometry buffers, bindings) but its pipeline is
 * created asynchronously and nothing is drawn. Once the returned promises have resolved, the next real
 * frame of the same view finds every pipeline it uses compiled: none is created synchronously in it and
 * no driver compile lands in a frame of play.
 *
 * `Renderer.compileAsync` alone leaves some for the first real frame: it never reaches the shadow pass
 * (`ShadowNode.updateBefore` skips precompiles), and it builds its render objects after `renderObject()`
 * has restored the per-object state of the material it saw (the shadow override material's side and
 * position node, the BackSide / FrontSide passes of a transparent double-sided material), so the real
 * frame needs other pipelines for those.
 *
 * A dry frame draws nothing: render targets it touches hold a cleared picture until the next real frame
 * (a shadow map it "rendered" must be requested again, see `Atmosphere.primeShadow`). Content rendered
 * once and cached (a PMREM) must already exist; the level precompile generates the environment's PMREM
 * in `compileAsync`, before its dry frame.
 *
 * Relies on three r186 internals; `dryRenderSupported` is false when they are missing (callers then
 * render a normal frame, as before).
 */
import * as THREE from 'three/webgpu';

/** `RenderObjectRefreshType` (three r186 constants). */
const REFRESH_NONE = 0;
const REFRESH_SHARED = 1;
const REFRESH_FULL = 2;

interface RenderObjectLike {
  drawRange: unknown;
  group: unknown;
}

type HandleObject = (
  this: RendererInternals,
  object: THREE.Object3D & { geometry: { drawRange: unknown } },
  material: THREE.Material,
  scene: THREE.Scene,
  camera: THREE.Camera,
  lightsNode: unknown,
  group: unknown,
  clippingContext: unknown,
  passId?: string,
) => void;

interface RendererInternals {
  _renderObjectDirect?: HandleObject;
  _currentRenderContext: unknown;
  _currentRenderBundle: unknown;
  _objects: { get(...args: unknown[]): RenderObjectLike };
  _nodes: {
    needsRefresh(ro: RenderObjectLike): number;
    updateBefore(ro: RenderObjectLike): void;
    updateForRender(ro: RenderObjectLike): void;
    updateAfter(ro: RenderObjectLike): void;
  };
  _geometries: { updateForRender(ro: RenderObjectLike): void };
  _bindings: { updateForRender(ro: RenderObjectLike): void; updateSharedForRender(ro: RenderObjectLike): void };
  _pipelines: { getForRender(ro: RenderObjectLike, promises: Promise<void>[] | null): unknown; isReady(ro: RenderObjectLike): boolean };
}

/** The renderer internals a dry frame needs are there (three r186). */
export function dryRenderSupported(renderer: THREE.WebGPURenderer): boolean {
  const r = renderer as unknown as Partial<RendererInternals> & { _renderObjectDirect?: unknown };
  return (
    typeof r._renderObjectDirect === 'function' &&
    typeof r._objects?.get === 'function' &&
    typeof r._nodes?.needsRefresh === 'function' &&
    typeof r._nodes.updateBefore === 'function' &&
    typeof r._nodes.updateForRender === 'function' &&
    typeof r._nodes.updateAfter === 'function' &&
    typeof r._geometries?.updateForRender === 'function' &&
    typeof r._bindings?.updateForRender === 'function' &&
    typeof r._bindings.updateSharedForRender === 'function' &&
    typeof r._pipelines?.getForRender === 'function' &&
    typeof r._pipelines.isReady === 'function'
  );
}

/**
 * Runs `render` (one frame: `RenderPipeline.render()`, `Renderer.render()`…) as a dry frame and returns the
 * pipeline compilations it started (empty when every pipeline already existed). Await them before the
 * next real frame.
 */
export function dryRender(renderer: THREE.WebGPURenderer, render: () => void): Promise<void>[] {
  const promises: Promise<void>[] = [];
  const r = renderer as unknown as RendererInternals;
  const real = r._renderObjectDirect!;
  // `Renderer._renderObjectDirect` without the draw, and with asynchronous pipeline creation.
  // `_renderScene` picks `this._renderObjectDirect` as its object handler at every (nested) render.
  const prepare: HandleObject = function (object, material, scene, camera, lightsNode, group, clippingContext, passId) {
    // inside a render bundle being recorded (a `BundleGroup`): drawn for real, or the bundle would be
    // recorded empty and replayed empty until its group changes
    if (this._currentRenderBundle !== null) return real.call(this, object, material, scene, camera, lightsNode, group, clippingContext, passId);
    const ro = this._objects.get(object, material, scene, camera, lightsNode, this._currentRenderContext, clippingContext, passId);
    ro.drawRange = object.geometry.drawRange;
    ro.group = group;
    const refresh = this._nodes.needsRefresh(ro);
    if (refresh === REFRESH_FULL) {
      this._nodes.updateBefore(ro);
      this._geometries.updateForRender(ro);
      this._nodes.updateForRender(ro);
      this._bindings.updateForRender(ro);
    } else if (refresh === REFRESH_SHARED) {
      this._nodes.updateBefore(ro);
      this._nodes.updateForRender(ro);
      this._bindings.updateSharedForRender(ro);
    }
    this._pipelines.getForRender(ro, promises);
    if (this._pipelines.isReady(ro) && refresh !== REFRESH_NONE) this._nodes.updateAfter(ro);
  };
  const own = Object.prototype.hasOwnProperty.call(r, '_renderObjectDirect') ? r._renderObjectDirect : undefined;
  r._renderObjectDirect = prepare;
  try {
    render();
  } finally {
    if (own) r._renderObjectDirect = own;
    else delete r._renderObjectDirect; // the prototype's method again
  }
  return promises;
}
