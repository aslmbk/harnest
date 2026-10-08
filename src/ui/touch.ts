/**
 * Whether the touch controls are on, by the engine's rule (engine/touch.ts), so the UI's on-screen
 * buttons come and go with the joystick: `?touch=1` / `?touch=0` force it; otherwise it is on where
 * the primary pointer is coarse and cannot hover, else from the first touch. While it is on, the
 * overlay root has the class `is-touch`; touch-only elements are hidden by CSS without it.
 */
import { parseParams, type UrlParams } from '../engine/params';

/** The engine's start-up rule: forced on, or 'auto' on a coarse pointer that cannot hover. */
export function touchAtStart(mode: UrlParams['touch'], coarse: boolean): boolean {
  return mode === 'on' || (mode === 'auto' && coarse);
}

export class TouchSense {
  private value: boolean;
  private readonly fns = new Set<(on: boolean) => void>();
  private stop: (() => void) | null = null;

  constructor(
    private readonly root: HTMLElement,
    search = location.search,
  ) {
    const mode = parseParams(search).touch;
    const coarse = typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;
    this.value = touchAtStart(mode, coarse);
    if (mode === 'auto' && !coarse) {
      const first = (e: PointerEvent) => {
        if (e.pointerType !== 'touch') return;
        this.dispose();
        this.set(true);
      };
      window.addEventListener('pointerdown', first, true);
      this.stop = () => window.removeEventListener('pointerdown', first, true);
    }
    root.classList.toggle('is-touch', this.value);
  }

  get on(): boolean {
    return this.value;
  }

  /** Called when touch mode turns on (the first touch in 'auto' mode); returns the unsubscribe function. */
  onChange(fn: (on: boolean) => void): () => void {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }

  dispose(): void {
    this.stop?.();
    this.stop = null;
  }

  private set(on: boolean): void {
    if (on === this.value) return;
    this.value = on;
    this.root.classList.toggle('is-touch', on);
    for (const fn of [...this.fns]) fn(on);
  }
}
