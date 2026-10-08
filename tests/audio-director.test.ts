import { describe, expect, it } from 'vitest';
import { createAudio } from '../src/audio';
import { type ContextLike, createAudioDirector, type DirectorEnv, type EngineLike } from '../src/audio/director';
import type { Volumes } from '../src/audio/engine';
import type { AudioScene, StateMix } from '../src/audio/profiles';
import { EventBus, type GameEvents, type SfxName } from '../src/core/events';
import { Store } from '../src/core/store';

class FakeEngine implements EngineLike {
  calls: [string, unknown][] = [];
  played: SfxName[] = [];
  ticks = 0;
  disposed = false;
  setVolumes(v: Volumes) {
    this.calls.push(['volumes', { ...v }]);
  }
  setStateMix(m: StateMix) {
    this.calls.push(['mix', m]);
  }
  setHidden(h: boolean) {
    this.calls.push(['hidden', h]);
  }
  setScene(s: AudioScene | null) {
    this.calls.push(['scene', s?.id ?? null]);
  }
  setBright(on: boolean) {
    this.calls.push(['bright', on]);
  }
  flourish() {
    this.calls.push(['flourish', null]);
  }
  resolve() {
    this.calls.push(['resolve', null]);
  }
  setMotor(s: number) {
    this.calls.push(['motor', s]);
  }
  playSfx(name: SfxName) {
    this.played.push(name);
    return true;
  }
  tick() {
    this.ticks++;
  }
  dispose() {
    this.disposed = true;
  }
  count(kind: string) {
    return this.calls.filter((c) => c[0] === kind).length;
  }
  last(kind: string) {
    return [...this.calls].reverse().find((c) => c[0] === kind)?.[1];
  }
}

class FakeContext implements ContextLike {
  state = 'suspended';
  resume() {
    if (this.state !== 'closed') this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.state = 'suspended';
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
}

function setup(opts: { available?: boolean } = {}) {
  let gesture: (() => void) | null = null;
  let visibility: ((hidden: boolean) => void) | null = null;
  let hidden = false;
  let now = 0;
  let nextId = 1;
  let created = 0;
  const intervals = new Map<number, () => void>();
  const timeouts = new Map<number, () => void>();
  const runtimes: { ctx: FakeContext; engine: FakeEngine }[] = [];
  const env: DirectorEnv = {
    createRuntime() {
      created++;
      if (opts.available === false) return null;
      const rt = { ctx: new FakeContext(), engine: new FakeEngine() };
      runtimes.push(rt);
      return rt;
    },
    onGesture(fn) {
      gesture = fn;
      return () => (gesture = null);
    },
    onVisibility(fn) {
      visibility = fn;
      return () => (visibility = null);
    },
    isHidden: () => hidden,
    now: () => now,
    setInterval(fn) {
      intervals.set(nextId, fn);
      return nextId++;
    },
    clearInterval: (id) => intervals.delete(id),
    setTimeout(fn) {
      timeouts.set(nextId, fn);
      return nextId++;
    },
    clearTimeout: (id) => timeouts.delete(id),
  };
  const bus = new EventBus<GameEvents>();
  const store = new Store(null);
  const audio = createAudioDirector({ bus, store }, { env, seed: 1 });
  return {
    bus,
    store,
    audio,
    runtimes,
    intervals,
    created: () => created,
    gesture: () => gesture?.(),
    hasGestureListener: () => gesture !== null,
    setHidden(h: boolean) {
      hidden = h;
      visibility?.(h);
    },
    advance: (ms: number) => (now += ms),
    runTimeouts() {
      const fns = [...timeouts.values()];
      timeouts.clear();
      for (const fn of fns) fn();
    },
    engine: () => runtimes[0].engine,
    ctx: () => runtimes[0].ctx,
  };
}

describe('audio director', () => {
  it('creates no AudioContext before the first gesture, but tracks the desired state', () => {
    const t = setup();
    t.bus.emit('state:changed', { from: 'boot', to: 'menu' });
    t.bus.emit('level:ready', { levelId: 'l1' });
    t.bus.emit('state:changed', { from: 'loading', to: 'playing' });
    t.bus.emit('player:motion', { speed: 0.4 });
    expect(t.runtimes).toHaveLength(0);

    t.gesture();
    expect(t.runtimes).toHaveLength(1);
    const e = t.engine();
    expect(e.last('volumes')).toEqual({ master: 0.8, music: 0.6, sfx: 0.8 });
    expect(e.last('scene')).toBe('level:l1');
    expect((e.last('mix') as StateMix).motor).toBe(1);
    expect(e.last('motor')).toBe(0.4);
    expect(t.ctx().state).toBe('running');
    expect(t.intervals.size).toBe(1);

    t.gesture();
    expect(t.runtimes).toHaveLength(1);
  });

  it('skips one-shots before unlock, except those right before the unlocking gesture', () => {
    const t = setup();
    t.bus.emit('sfx', { name: 'key' });
    t.advance(1000);
    t.bus.emit('sfx', { name: 'uiSelect' });
    t.advance(100);
    t.gesture();
    expect(t.engine().played).toEqual(['uiSelect']);
    t.bus.emit('sfx', { name: 'stepOk' });
    expect(t.engine().played).toEqual(['uiSelect', 'stepOk']);
  });

  it('maps domain events onto music and ambience, and plays sounds only on sfx events', () => {
    const t = setup();
    t.gesture();
    const e = t.engine();
    t.bus.emit('state:changed', { from: 'boot', to: 'menu' });
    expect(e.last('scene')).toBe('menu');

    t.bus.emit('level:ready', { levelId: 'l1' });
    expect(e.last('scene')).toBe('level:l1');
    const scenes = e.count('scene');
    t.bus.emit('level:ready', { levelId: 'l1' }); // restart: same scene, gate closed again
    expect(e.count('scene')).toBe(scenes);
    expect(e.last('bright')).toBe(false);

    t.bus.emit('gate:opened', { levelId: 'l1' });
    expect(e.last('bright')).toBe(true);
    t.bus.emit('objectives:changed', { levelId: 'l1', items: [], gateOpen: false });
    expect(e.last('bright')).toBe(false);
    t.bus.emit('chip:collected', { levelId: 'l1', chipId: 'c1' });
    expect(e.count('flourish')).toBe(1);
    t.bus.emit('level:completed', { levelId: 'l1', stats: { stars: 3, maxStars: 3, chips: 1, maxChips: 1, timeSec: 10 }, isLast: false });
    expect(e.count('resolve')).toBe(1);
    expect(e.played).toEqual([]); // domain events never trigger one-shots (no double triggers)

    t.bus.emit('state:changed', { from: 'intro', to: 'playing' });
    t.bus.emit('player:motion', { speed: 0.7 });
    expect(e.last('motor')).toBe(0.7);
    t.bus.emit('state:changed', { from: 'playing', to: 'terminal' });
    const terminal = e.last('mix') as StateMix;
    expect(terminal.music).toBeLessThan(0.6);
    expect(terminal.motor).toBe(0);
    expect(e.last('motor')).toBe(0); // no stale speed when play resumes
    t.bus.emit('sfx', { name: 'talk' });
    expect(e.played).toEqual(['talk']);
  });

  it('plays the menu bed when created after the game already left boot', () => {
    const t = setup();
    t.gesture(); // no state:changed was ever received
    expect(t.engine().last('scene')).toBe('menu');
    expect((t.engine().last('mix') as StateMix).music).toBeGreaterThan(0);
    t.bus.emit('state:changed', { from: 'menu', to: 'paused' });
    expect((t.engine().last('mix') as StateMix).motor).toBe(0);
  });

  it('stays silent when unlocked during boot', () => {
    const t = setup();
    t.bus.emit('state:changed', { from: 'boot', to: 'boot' });
    t.gesture();
    expect(t.engine().last('mix')).toEqual({ ambience: 0, music: 0, motor: 0 });
  });

  it('falls back to a guessed scene for unknown level ids', () => {
    const t = setup();
    t.gesture();
    expect(() => t.bus.emit('level:ready', { levelId: 'l9' })).not.toThrow();
    expect(t.engine().last('scene')).toBe('level:l9');
  });

  it('follows volume settings and ignores unrelated store updates', () => {
    const t = setup();
    t.gesture();
    const e = t.engine();
    const before = e.count('volumes');
    t.store.setSettings({ music: 0.2 });
    expect(e.count('volumes')).toBe(before + 1);
    expect(e.last('volumes')).toEqual({ master: 0.8, music: 0.2, sfx: 0.8 });
    t.store.completeTerminal('l1', 't1', 3);
    t.store.setSettings({ quality: 'low' });
    expect(e.count('volumes')).toBe(before + 1);
  });

  it('suspends while the tab is hidden and resumes when it is visible again', () => {
    const t = setup();
    t.gesture();
    const e = t.engine();
    t.setHidden(true);
    expect(e.last('hidden')).toBe(true);
    expect(t.intervals.size).toBe(0);
    t.runTimeouts();
    expect(t.ctx().state).toBe('suspended');
    t.bus.emit('sfx', { name: 'key' });
    expect(e.played).toEqual([]);

    t.setHidden(false);
    expect(t.ctx().state).toBe('running');
    expect(e.last('hidden')).toBe(false);
    expect(t.intervals.size).toBe(1);
  });

  it('survives a browser without WebAudio', () => {
    const t = setup({ available: false });
    t.gesture();
    t.gesture();
    expect(t.created()).toBe(1);
    expect(() => {
      t.bus.emit('sfx', { name: 'key' });
      t.bus.emit('level:ready', { levelId: 'l1' });
      t.audio.dispose();
    }).not.toThrow();
  });

  it('dispose stops everything and unsubscribes', () => {
    const t = setup();
    t.gesture();
    const e = t.engine();
    t.audio.dispose();
    expect(e.disposed).toBe(true);
    expect(t.ctx().state).toBe('closed');
    expect(t.hasGestureListener()).toBe(false);
    expect(t.intervals.size).toBe(0);
    const calls = e.calls.length;
    t.bus.emit('sfx', { name: 'key' });
    t.bus.emit('state:changed', { from: 'playing', to: 'paused' });
    t.store.setSettings({ master: 0.1 });
    expect(e.calls.length).toBe(calls);
    expect(e.played).toEqual([]);
  });

  it('createAudio is inert outside a browser', () => {
    const bus = new EventBus<GameEvents>();
    const audio = createAudio({ bus, store: new Store(null) });
    expect(() => {
      bus.emit('state:changed', { from: 'boot', to: 'menu' });
      bus.emit('sfx', { name: 'uiMove' });
      audio.dispose();
    }).not.toThrow();
  });
});
