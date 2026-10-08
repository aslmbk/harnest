import type { GameBus, SfxName } from '../core/events';

/** Emits `sfx` events, optionally rate-limited per sound. */
export class Sfx {
  private last = new Map<SfxName, number>();

  constructor(private readonly bus: GameBus) {}

  play(name: SfxName, minGapMs = 0): void {
    const now = performance.now();
    if (minGapMs > 0 && now - (this.last.get(name) ?? -Infinity) < minGapMs) return;
    this.last.set(name, now);
    this.bus.emit('sfx', { name });
  }
}
