/**
 * `?debug=1`: small stats panel (fps, frame time, draw calls, triangles, quality, lights, state, tile).
 */
import type { HarnestDebugApi } from '../engine/debug';

export function createStatsOverlay(api: HarnestDebugApi): () => void {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;left:8px;bottom:8px;z-index:9999;pointer-events:none;font:11px/1.35 ui-monospace,Consolas,monospace;' +
    'color:#bfe9ff;background:rgba(5,10,14,.72);border:1px solid rgba(25,227,255,.35);padding:6px 8px;border-radius:4px;white-space:pre';
  document.body.appendChild(el);
  let last = 0;
  let raf = 0;
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    if (now - last < 250) return;
    last = now;
    const s = api.stats();
    const p = api.player();
    el.textContent =
      `${s.fps} fps  ${s.frameMs.toFixed(1)} ms  ${api.backend ?? ''}\n` +
      `calls ${s.drawCalls}  tris ${(s.triangles / 1000).toFixed(0)}k\n` +
      `quality ${s.quality}  lights ${s.lights}  inst ${s.instances}\n` +
      `glb ${s.assets?.loaded.length ?? 0}/5  ${api.state()}  ${api.level() ?? '-'}  [${p.col.toFixed(1)}, ${p.row.toFixed(1)}]`;
  };
  raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    el.remove();
  };
}
