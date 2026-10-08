/**
 * Touch controls: a floating virtual joystick under the left thumb and an action button under the
 * right one, as a DOM layer over the canvas and under the UI (UI buttons keep winning where they
 * overlap). Pointer events only. Visible while the game is `playing` (`Input.enabled`) on touch
 * screens: from the start where the primary pointer is coarse and cannot hover, otherwise from the
 * first touch. `?touch=1` forces them on (any pointer drives them, handy for testing with a mouse),
 * `?touch=0` off. Movement is analog and screen-relative, like the keyboard (`Input.setStick`).
 */
import type { Input } from './input';

export type TouchMode = 'auto' | 'on' | 'off';

/** What the action button would do now (the game's `interact:prompt`), or null. */
export interface TouchPrompt {
  label: string;
  locked: boolean;
}

/** Knob travel, px. */
export const STICK_RADIUS = 56;
/** Share of the travel that does nothing (thumb jitter). */
export const STICK_DEAD = 0.14;

/**
 * Joystick vector for a knob offset (px, screen axes: +x right, +y down): direction of the offset,
 * length 0 inside the dead zone, rising to 1 at `radius` and beyond.
 */
export function stickVector(dx: number, dy: number, radius = STICK_RADIUS, dead = STICK_DEAD): { x: number; z: number } {
  const len = Math.hypot(dx, dy);
  const mag = Math.min(1, len / radius);
  if (len === 0 || mag <= dead) return { x: 0, z: 0 };
  const k = (mag - dead) / (1 - dead) / len;
  return { x: dx * k, z: dy * k };
}

const BASE = STICK_RADIUS * 2 + 16;

const CSS = `
.ht-root{position:fixed;inset:0;pointer-events:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;
  -webkit-tap-highlight-color:transparent;font:600 13px/1.25 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.ht-zone{position:absolute;left:0;bottom:0;width:50%;height:62%;pointer-events:auto;touch-action:none}
.ht-base{position:absolute;width:${BASE}px;height:${BASE}px;margin:-${BASE / 2}px 0 0 -${BASE / 2}px;pointer-events:none;
  border-radius:50%;box-sizing:border-box;border:2px solid rgba(255,255,255,.16);
  background:radial-gradient(circle,rgba(12,16,24,.18) 0,rgba(12,16,24,.42) 70%,rgba(12,16,24,.5) 100%);
  opacity:.55;transition:opacity .2s}
.ht-base.on{opacity:1;border-color:rgba(255,154,60,.45)}
.ht-knob{position:absolute;left:50%;top:50%;width:58px;height:58px;margin:-29px 0 0 -29px;border-radius:50%;
  background:radial-gradient(circle at 40% 35%,#ffb874,#d97757 62%,#9c4a2f);box-shadow:0 0 18px rgba(255,140,60,.35),0 2px 6px rgba(0,0,0,.5)}
.ht-act{position:absolute;right:calc(22px + env(safe-area-inset-right));bottom:calc(84px + env(safe-area-inset-bottom));
  width:84px;height:84px;padding:0;border-radius:50%;box-sizing:border-box;pointer-events:auto;touch-action:none;cursor:pointer;
  border:2px solid rgba(255,255,255,.18);background:rgba(12,16,24,.55);color:rgba(255,255,255,.55);
  display:grid;place-items:center;transition:transform .08s,border-color .2s,color .2s,background .2s;outline:none}
.ht-act svg{width:38px;height:38px}
.ht-act.ready{border-color:#ff9a3c;color:#ffd2ad;background:rgba(60,28,12,.62);animation:ht-pulse 1.3s ease-in-out infinite}
.ht-act.locked{border-color:rgba(160,175,195,.45);color:rgba(190,200,215,.7)}
.ht-act.down{transform:scale(.9)}
.ht-cap{position:absolute;right:calc(10px + env(safe-area-inset-right));bottom:calc(176px + env(safe-area-inset-bottom));width:108px;
  text-align:center;color:#ffd2ad;text-shadow:0 1px 3px #000;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ht-cap.locked{color:rgba(190,200,215,.8)}
@keyframes ht-pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,154,60,.45)}50%{box-shadow:0 0 0 10px rgba(255,154,60,0)}}
`;

/** A hand pressing a button: the action icon (no text, so no keyboard letters on a phone). */
const ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V10m0-.5V4.5a1.5 1.5 0 0 1 3 0V10m0-1a1.5 1.5 0 0 1 3 0v5.5a6 6 0 0 1-6 6h-.6a6 6 0 0 1-4.6-2.2L4 15.2a1.6 1.6 0 0 1 2.4-2.1L9 15.5"/></svg>';

export class TouchControls {
  readonly root: HTMLDivElement;
  private readonly zone: HTMLDivElement;
  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly button: HTMLButtonElement;
  private readonly caption: HTMLDivElement;
  /** The device has a touch screen (or the mode forces the controls). */
  private available: boolean;
  private stickId: number | null = null;
  private buttonId: number | null = null;
  private ox = 0;
  private oy = 0;
  private readonly off: (() => void)[] = [];

  constructor(
    private readonly input: Input,
    private readonly mode: TouchMode,
    /** The layer goes right before this element (the UI root), so the UI stays on top. */
    before: Element | null,
  ) {
    const root = (this.root = document.createElement('div'));
    root.className = 'ht-root';
    root.dataset.touch = 'controls';
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);
    this.zone = this.el('ht-zone');
    this.base = this.el('ht-base');
    this.knob = document.createElement('div');
    this.knob.className = 'ht-knob';
    this.base.appendChild(this.knob);
    this.button = document.createElement('button');
    this.button.className = 'ht-act';
    this.button.type = 'button';
    this.button.tabIndex = -1;
    this.button.setAttribute('aria-label', 'Действие');
    this.button.innerHTML = ICON;
    root.appendChild(this.button);
    this.caption = this.el('ht-cap');
    if (before?.parentNode) before.parentNode.insertBefore(root, before);
    else document.body.appendChild(root);

    const coarse = typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;
    this.available = mode === 'on' || (mode === 'auto' && coarse);
    if (mode === 'auto' && !coarse) {
      const first = (e: PointerEvent) => {
        if (e.pointerType !== 'touch') return;
        window.removeEventListener('pointerdown', first, true);
        this.available = true;
        this.refresh();
      };
      window.addEventListener('pointerdown', first, true);
      this.off.push(() => window.removeEventListener('pointerdown', first, true));
    }

    this.listen(this.zone, 'pointerdown', (e) => this.stickDown(e));
    this.listen(this.zone, 'pointermove', (e) => this.stickMove(e));
    this.listen(this.zone, 'pointerup', (e) => this.stickUp(e));
    this.listen(this.zone, 'pointercancel', (e) => this.stickUp(e));
    this.listen(this.zone, 'contextmenu', (e) => e.preventDefault());
    this.listen(this.button, 'pointerdown', (e) => this.buttonDown(e));
    this.listen(this.button, 'pointerup', (e) => this.buttonUp(e));
    this.listen(this.button, 'pointercancel', (e) => this.buttonUp(e));
    this.listen(this.button, 'contextmenu', (e) => e.preventDefault());
    const blur = () => this.release();
    const resize = () => {
      if (this.stickId === null) this.rest();
    };
    window.addEventListener('blur', blur);
    window.addEventListener('resize', resize);
    this.off.push(
      () => window.removeEventListener('blur', blur),
      () => window.removeEventListener('resize', resize),
      input.onEnabled(() => this.refresh()),
    );
    this.refresh();
  }

  /** Whether the controls are on screen now. */
  get visible(): boolean {
    return this.available && this.input.enabled;
  }

  /** Highlights the action button (and names the target) while something can be used. */
  setPrompt(p: TouchPrompt | null): void {
    this.button.classList.toggle('ready', !!p && !p.locked);
    this.button.classList.toggle('locked', !!p && p.locked);
    this.caption.classList.toggle('locked', !!p && p.locked);
    this.caption.textContent = p ? p.label : '';
  }

  dispose(): void {
    this.release();
    this.off.forEach((f) => f());
    this.root.remove();
  }

  private el(cls: string): HTMLDivElement {
    const d = document.createElement('div');
    d.className = cls;
    this.root.appendChild(d);
    return d;
  }

  private listen<K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void): void {
    target.addEventListener(type, fn);
    this.off.push(() => target.removeEventListener(type, fn));
  }

  /** Touch and pen always; a mouse only when the controls are forced on (`?touch=1`). */
  private accepts(e: PointerEvent): boolean {
    return this.visible && (e.pointerType !== 'mouse' || (this.mode === 'on' && e.button === 0));
  }

  private refresh(): void {
    const show = this.visible;
    this.root.style.display = show ? '' : 'none';
    this.release();
  }

  /** The stick's resting place, bottom left. */
  private rest(): void {
    const h = this.root.clientHeight || window.innerHeight;
    this.place(28 + BASE / 2, h - (40 + BASE / 2));
    this.knob.style.transform = '';
    this.base.classList.remove('on');
  }

  private place(x: number, y: number): void {
    this.ox = x;
    this.oy = y;
    this.base.style.left = `${x}px`;
    this.base.style.top = `${y}px`;
  }

  private local(e: PointerEvent): { x: number; y: number } {
    const r = this.root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private stickDown(e: PointerEvent): void {
    if (this.stickId !== null || !this.accepts(e)) return;
    e.preventDefault();
    this.stickId = e.pointerId;
    this.zone.setPointerCapture?.(e.pointerId);
    const p = this.local(e);
    this.place(p.x, p.y);
    this.base.classList.add('on');
    this.drive(e);
  }

  private stickMove(e: PointerEvent): void {
    if (e.pointerId !== this.stickId) return;
    e.preventDefault();
    this.drive(e);
  }

  private stickUp(e: PointerEvent): void {
    if (e.pointerId !== this.stickId) return;
    this.stickId = null;
    this.input.setStick(0, 0);
    this.rest();
  }

  /** The knob follows the finger; past the rim the base is dragged along, so turning around stays quick. */
  private drive(e: PointerEvent): void {
    const p = this.local(e);
    let dx = p.x - this.ox;
    let dy = p.y - this.oy;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      const k = STICK_RADIUS / len;
      dx *= k;
      dy *= k;
      this.place(p.x - dx, p.y - dy);
    }
    this.knob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
    const v = stickVector(dx, dy);
    this.input.setStick(v.x, v.z);
  }

  private buttonDown(e: PointerEvent): void {
    if (this.buttonId !== null || !this.accepts(e)) return;
    e.preventDefault();
    this.buttonId = e.pointerId;
    this.button.setPointerCapture?.(e.pointerId);
    this.button.classList.add('down');
    this.input.pressInteract();
  }

  private buttonUp(e: PointerEvent): void {
    if (e.pointerId !== this.buttonId) return;
    this.buttonId = null;
    this.button.classList.remove('down');
  }

  /** Lets go of everything (hidden, window blurred): the robot stops. */
  private release(): void {
    if (this.stickId !== null) this.input.setStick(0, 0);
    this.stickId = null;
    this.buttonId = null;
    this.button.classList.remove('down');
    this.rest();
  }
}
