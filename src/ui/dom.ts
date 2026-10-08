/**
 * Tiny DOM helpers. Content text always goes through textContent, never innerHTML.
 */

export type Child = Node | string | number | null | undefined | false | readonly Child[];

type Listeners = Partial<{ [K in keyof HTMLElementEventMap]: (e: HTMLElementEventMap[K]) => void }>;

export interface HProps {
  class?: string;
  text?: string;
  title?: string;
  attrs?: Record<string, string | number | boolean | undefined>;
  data?: Record<string, string>;
  on?: Listeners;
}

function append(el: Element, child: Child): void {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) {
    for (const c of child as readonly Child[]) append(el, c);
    return;
  }
  el.append(child instanceof Node ? child : String(child));
}

/** h('div', 'cls', [children]) or h('button', { class, on: { click } }, 'label'). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: HProps | string | null,
  children?: Child,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const p: HProps = typeof props === 'string' ? { class: props } : (props ?? {});
  if (p.class) el.className = p.class;
  if (p.text !== undefined) el.textContent = p.text;
  if (p.title) el.title = p.title;
  if (p.attrs) {
    for (const [k, v] of Object.entries(p.attrs)) {
      if (v === undefined || v === false) continue;
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  if (p.data) for (const [k, v] of Object.entries(p.data)) el.dataset[k] = v;
  if (p.on) {
    for (const [type, fn] of Object.entries(p.on)) el.addEventListener(type, fn as EventListener);
  }
  if (children !== undefined) append(el, children);
  return el;
}

export function clear(el: Element): void {
  el.replaceChildren();
}

/** Replaces the children; null / false entries are skipped. */
export function fill(el: Element, ...children: Child[]): void {
  el.replaceChildren();
  append(el, children);
}

/** Appends children; null / false entries are skipped. */
export function add(el: Element, ...children: Child[]): void {
  append(el, children);
}

/** Static, trusted SVG markup (icons) → element. */
export function svg(markup: string, cls?: string): SVGSVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup.trim();
  const el = tpl.content.firstElementChild as SVGSVGElement;
  if (cls) el.setAttribute('class', cls);
  el.setAttribute('aria-hidden', 'true');
  return el;
}

/**
 * Scrolls the nearest scrollable ancestor so `el` is visible. Never scrolls the document
 * (Element.scrollIntoView can shift the whole page under a fixed overlay).
 */
export function ensureVisible(el: HTMLElement, margin = 4): void {
  let p = el.parentElement;
  while (p && p !== document.body) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) break;
    p = p.parentElement;
  }
  if (!p || p === document.body) return;
  const er = el.getBoundingClientRect();
  const pr = p.getBoundingClientRect();
  if (er.top < pr.top + margin) p.scrollTop -= pr.top + margin - er.top;
  else if (er.bottom > pr.bottom - margin) p.scrollTop += er.bottom - (pr.bottom - margin);
}

export function toggle(el: Element, cls: string, on: boolean): void {
  el.classList.toggle(cls, on);
}

/** Restarts a CSS animation class (e.g. a shake). */
export function replay(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

export function pad2(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(2, '0');
}

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${pad2(m)}:${pad2(s % 60)}`;
}

/** Russian plural: plural(5, ['звезда', 'звезды', 'звёзд']). */
export function plural(n: number, forms: readonly [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
