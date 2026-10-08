/**
 * Keyboard routing for the overlay. One capture-phase listener on window sees every keydown first.
 * Open UI screens push a layer; only the top layer gets keys, and while any layer is open keydown
 * never reaches the game (keyup always does, so the game never misses a key release).
 * With no layer open (state 'playing'), the fallback handles the UI's own hotkeys and everything
 * else passes through to the game untouched.
 */

export interface KeyLayer {
  /** Handles a keydown. Propagation to the game is already stopped. */
  onKey(e: KeyboardEvent): void;
  /** The layer became the top layer (focus text inputs here). */
  onTop?(): void;
}

export class KeyRouter {
  private stack: KeyLayer[] = [];
  private fallback: ((e: KeyboardEvent) => void) | null = null;
  private readonly listener = (e: KeyboardEvent) => this.dispatch(e);

  constructor(private readonly target: Window = window) {
    target.addEventListener('keydown', this.listener, true);
  }

  setFallback(fn: (e: KeyboardEvent) => void): void {
    this.fallback = fn;
  }

  push(layer: KeyLayer): void {
    const i = this.stack.indexOf(layer);
    if (i >= 0) this.stack.splice(i, 1);
    this.stack.push(layer);
    layer.onTop?.();
  }

  remove(layer: KeyLayer): void {
    const i = this.stack.indexOf(layer);
    if (i < 0) return;
    const wasTop = i === this.stack.length - 1;
    this.stack.splice(i, 1);
    if (wasTop) this.stack[this.stack.length - 1]?.onTop?.();
  }

  has(layer: KeyLayer): boolean {
    return this.stack.includes(layer);
  }

  isTop(layer: KeyLayer): boolean {
    return this.stack[this.stack.length - 1] === layer;
  }

  get empty(): boolean {
    return this.stack.length === 0;
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.listener, true);
    this.stack = [];
  }

  private dispatch(e: KeyboardEvent): void {
    if (e.isComposing) return;
    const top = this.stack[this.stack.length - 1];
    if (top) {
      e.stopPropagation();
      top.onKey(e);
      return;
    }
    this.fallback?.(e);
  }
}

/** Enter / Space / E: the "confirm / advance" keys of non-text screens. */
export function isConfirmKey(e: KeyboardEvent): boolean {
  return e.key === 'Enter' || e.key === ' ' || e.code === 'KeyE';
}
