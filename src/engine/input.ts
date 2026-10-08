/**
 * Keyboard, wheel and touch-stick input for driving. Only read while the game is in state `playing`
 * (`enabled`). `Esc` and `Tab` belong to the UI and are never handled here. Keys typed into text
 * fields are ignored. The touch joystick (`engine/touch.ts`) feeds an analog vector via `setStick`.
 */

const UP = ['KeyW', 'ArrowUp'];
const DOWN = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const INTERACT = ['KeyE', 'Enter', 'NumpadEnter', 'Space'];
const MOVE_KEYS = new Set([...UP, ...DOWN, ...LEFT, ...RIGHT, 'Space']);

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export class Input {
  private on = false;
  private readonly enabledListeners = new Set<(enabled: boolean) => void>();
  private readonly stick = { x: 0, z: 0 };
  private readonly held = new Set<string>();
  private interactAt = -Infinity;
  private zoom = 0;
  private readonly off: (() => void)[] = [];

  constructor(target: Window = window) {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      this.held.add(e.code);
      if (!this.enabled) return;
      if (MOVE_KEYS.has(e.code)) e.preventDefault();
      if (INTERACT.includes(e.code) && !e.repeat) this.interactAt = performance.now();
    };
    const up = (e: KeyboardEvent) => this.held.delete(e.code);
    const blur = () => this.held.clear();
    const wheel = (e: WheelEvent) => {
      if (!this.enabled || isTyping(e.target)) return;
      this.zoom += Math.sign(e.deltaY);
    };
    target.addEventListener('keydown', down);
    target.addEventListener('keyup', up);
    target.addEventListener('blur', blur);
    target.addEventListener('wheel', wheel, { passive: true });
    this.off.push(
      () => target.removeEventListener('keydown', down),
      () => target.removeEventListener('keyup', up),
      () => target.removeEventListener('blur', blur),
      () => target.removeEventListener('wheel', wheel),
    );
  }

  /** Movement and interaction are read only while enabled (state `playing`). */
  get enabled(): boolean {
    return this.on;
  }

  set enabled(value: boolean) {
    if (value === this.on) return;
    this.on = value;
    for (const fn of [...this.enabledListeners]) fn(value);
  }

  /** Called whenever `enabled` changes; returns the unsubscribe function. */
  onEnabled(fn: (enabled: boolean) => void): () => void {
    this.enabledListeners.add(fn);
    return () => this.enabledListeners.delete(fn);
  }

  /** Analog move from the touch joystick (screen-relative like `move()`, length <= 1; 0, 0 = released). */
  setStick(x: number, z: number): void {
    const len = Math.hypot(x, z);
    const k = len > 1 ? 1 / len : 1;
    this.stick.x = x * k;
    this.stick.z = z * k;
  }

  private any(codes: readonly string[]): boolean {
    return codes.some((c) => this.held.has(c));
  }

  /**
   * Screen-relative move direction (x = east, z = south), length ≤ 1. Zero when disabled. Keys win
   * over the touch stick; the stick is analog (a short push drives slowly).
   */
  move(): { x: number; z: number } {
    if (!this.enabled) return { x: 0, z: 0 };
    const x = (this.any(RIGHT) ? 1 : 0) - (this.any(LEFT) ? 1 : 0);
    const z = (this.any(DOWN) ? 1 : 0) - (this.any(UP) ? 1 : 0);
    const len = Math.hypot(x, z);
    if (len > 0) return { x: x / len, z: z / len };
    return { x: this.stick.x, z: this.stick.z };
  }

  /**
   * True once per interact press made at least `minAgeMs` after `since` (the moment the game entered
   * `playing`), so the key that closed a dialog cannot immediately reopen it.
   */
  consumeInteract(since: number, graceMs = 250): boolean {
    if (!this.enabled || this.interactAt < since + graceMs) return false;
    this.interactAt = -Infinity;
    return true;
  }

  /** Wheel steps since the last call (+ = zoom out). */
  consumeZoom(): number {
    const z = this.zoom;
    this.zoom = 0;
    return z;
  }

  /** Programmatic interaction (debug API, tests). */
  pressInteract(): void {
    this.interactAt = performance.now();
  }

  dispose(): void {
    this.off.forEach((f) => f());
    this.held.clear();
    this.enabledListeners.clear();
    this.setStick(0, 0);
  }
}
