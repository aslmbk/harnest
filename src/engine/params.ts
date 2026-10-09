/**
 * URL parameters (design doc §10). Pure: parse a query string into typed options.
 *
 *   ?skipMenu=1   start playing at once          ?level=l2     level to start / show
 *   ?autoui=1     auto-answer UI requests         ?noui=1       do not load the DOM UI
 *   ?q=low|medium|high   force a quality preset   ?debug=1      colliders + stats overlay
 *   ?view=map     orthographic top-down view of the whole level (layout checks)
 *   ?assets=0     ignore exported GLBs and use placeholders (to check the fallbacks)
 *   ?touch=1|0    force the touch controls on / off (default: on touch screens)
 *   ?freeze=<s>   [freeze] deterministic frames for visual-regression shots: clock pinned at <s> seconds
 *
 * Precompile A/B switches (profiling only; all default on, the game looks the same either way):
 *   ?dryframe=0   no dry frames (`src/engine/dryRender.ts`): the boot frame and the level's precompile
 *                 frame then create the pipelines `compileAsync` misses synchronously, as before
 *   ?forceframe=0 no real precompile frame at the end of a level compile (and no wait for the GPU):
 *                 uploads and first-use work move into the first frames of the level
 *   ?parcompile=0 a precompile's pipelines compile one after the other, as `compileAsync` does by
 *                 itself (`src/render/post.ts`), instead of side by side
 */
import type { Quality } from '../core/store';

export interface UrlParams {
  skipMenu: boolean;
  level: string | null;
  autoui: boolean;
  noui: boolean;
  quality: Exclude<Quality, 'auto'> | null;
  debug: boolean;
  view: 'game' | 'map';
  assets: boolean;
  /** Touch controls: 'auto' = on touch screens (from the first touch), 'on' / 'off' forced. */
  touch: 'auto' | 'on' | 'off';
  /** [freeze] Pinned simulation time in seconds (`src/engine/freeze.ts`), null = live clock. */
  freeze: number | null;
  /** Dry precompile frames (`?dryframe=0` turns them off). */
  dryFrame: boolean;
  /** The real precompile frame of a level compile (`?forceframe=0` turns it off). */
  forcedFrame: boolean;
  /** A precompile's pipelines compile side by side (`?parcompile=0` turns it off). */
  parallelCompile: boolean;
}

const truthy = (v: string | null) => v !== null && v !== '0' && v.toLowerCase() !== 'false';

export function parseParams(search: string): UrlParams {
  const p = new URLSearchParams(search);
  const q = p.get('q');
  const touch = p.get('touch');
  const freeze = p.get('freeze'); // [freeze]
  return {
    skipMenu: truthy(p.get('skipMenu')),
    level: p.get('level') || null,
    autoui: truthy(p.get('autoui')),
    noui: truthy(p.get('noui')),
    quality: q === 'low' || q === 'medium' || q === 'high' ? q : null,
    debug: truthy(p.get('debug')),
    view: p.get('view') === 'map' ? 'map' : 'game',
    assets: p.get('assets') !== '0',
    touch: touch === null || touch === '' || touch === 'auto' ? 'auto' : truthy(touch) ? 'on' : 'off',
    freeze: freeze !== null && freeze !== '' && Number.isFinite(Number(freeze)) ? Number(freeze) : null, // [freeze]
    dryFrame: p.get('dryframe') === null || truthy(p.get('dryframe')),
    forcedFrame: p.get('forceframe') === null || truthy(p.get('forceframe')),
    parallelCompile: p.get('parcompile') === null || truthy(p.get('parcompile')),
  };
}
