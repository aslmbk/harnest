import { h, svg } from './dom';

const ICONS = {
  star: '<svg viewBox="0 0 24 24"><path d="M12 2.6l2.75 5.95 6.5.72-4.86 4.4 1.38 6.4L12 16.8l-5.77 3.27 1.38-6.4-4.86-4.4 6.5-.72z" fill="currentColor"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2" fill="currentColor"/><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  chip: '<svg viewBox="0 0 24 24"><path d="M7 3.5h7.5L18 7v13.5H7z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><rect x="9.5" y="7" width="5" height="5" rx="1" fill="currentColor"/><path d="M9.5 15.5h5M9.5 18h5" stroke="currentColor" stroke-width="1.5"/></svg>',
  ring: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  gate: '<svg viewBox="0 0 24 24"><path d="M4 20V6l8-3 8 3v14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 20v-9h8v9M12 11v9" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  warn: '<svg viewBox="0 0 24 24"><path d="M12 4.2l8.6 15.3H3.4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 10v4.4M12 17v.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M15 15l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  bulb: '<svg viewBox="0 0 24 24"><path d="M9 17.5h6M10 20.5h4M12 3.5a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  terminal: '<svg viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M7 9.5l3 2.5-3 2.5M12 15h5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6.5" y="5" width="3.6" height="14" rx="1" fill="currentColor"/><rect x="13.9" y="5" width="3.6" height="14" rx="1" fill="currentColor"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M12 6.5C10.2 5 7.6 4.5 4 4.8v13.7c3.6-.3 6.2.2 8 1.7 1.8-1.5 4.4-2 8-1.7V4.8c-3.6-.3-6.2.2-8 1.7zM12 6.5v13.7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  enter: '<svg viewBox="0 0 24 24"><path d="M19 5.5v6.5a2 2 0 0 1-2 2H6m4-4l-4 4 4 4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, cls = ''): SVGSVGElement {
  return svg(ICONS[name], `hx-icon ${cls}`.trim());
}

/** A row of `max` stars with `n` filled. */
export function starsRow(n: number, max = 3, cls = ''): HTMLElement {
  const row = h('span', { class: `hx-stars ${cls}`.trim(), attrs: { 'aria-label': `${n} из ${max}` } });
  for (let i = 0; i < max; i++) row.append(icon('star', i < n ? 'is-on' : 'is-off'));
  return row;
}

/** Harni's mark: an orange rounded square with two eye pods (same as the favicon). */
export function logoMark(cls = ''): SVGSVGElement {
  return svg(
    '<svg viewBox="0 0 32 32"><rect x="1" y="1" width="30" height="30" rx="7" fill="#d97757"/><rect x="6.5" y="10" width="8" height="8" rx="2" fill="#0b1a22"/><rect x="17.5" y="10" width="8" height="8" rx="2" fill="#0b1a22"/><rect x="9" y="12.5" width="3" height="3" rx="1" fill="#ffe9c4"/><rect x="20" y="12.5" width="3" height="3" rx="1" fill="#ffe9c4"/><rect x="9" y="22" width="14" height="2.4" rx="1.2" fill="#8f4a33"/></svg>',
    `hx-logo-mark ${cls}`.trim(),
  );
}
