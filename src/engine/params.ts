/**
 * URL parameters (design doc §10). Pure: parse a query string into typed options.
 *
 *   ?skipMenu=1   start playing at once          ?level=l2     level to start / show
 *   ?autoui=1     auto-answer UI requests         ?noui=1       do not load the DOM UI
 *   ?q=low|medium|high   force a quality preset   ?debug=1      colliders + stats overlay
 *   ?view=map     orthographic top-down view of the whole level (layout checks)
 *   ?assets=0     ignore exported GLBs and use placeholders (to check the fallbacks)
 *   ?touch=1|0    force the touch controls on / off (default: on touch screens)
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
}

const truthy = (v: string | null) => v !== null && v !== '0' && v.toLowerCase() !== 'false';

export function parseParams(search: string): UrlParams {
  const p = new URLSearchParams(search);
  const q = p.get('q');
  const touch = p.get('touch');
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
  };
}
