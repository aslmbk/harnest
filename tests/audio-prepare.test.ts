import { describe, expect, it } from 'vitest';
import { type ContextLike, createAudioDirector, type DirectorEnv, type EngineLike } from '../src/audio/director';
import type { Volumes } from '../src/audio/engine';
import type { AudioScene, StateMix } from '../src/audio/profiles';
import { EventBus, type GameEvents, type SfxName } from '../src/core/events';
import { Store } from '../src/core/store';

/** Records every engine call in order (name + argument). */
class RecEngine implements EngineLike {
  calls: [string, unknown][] = [];
  disposed = false;
  setVolumes(v: Volumes, immediate?: boolean) {
    this.calls.push(['volumes', { ...v, immediate: !!immediate }]);
  }
  setStateMix(m: StateMix, immediate?: boolean) {
    this.calls.push(['mix', { ...m, immediate: !!immediate }]);
  }
  setHidden(h: boolean) {
    this.calls.push(['hidden', h]);
  }
  setScene(s: AudioScene | null, fade?: number) {
    this.calls.push(['scene', [s?.id ?? null, fade]]);
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
    this.calls.push(['sfx', name]);
    return true;
  }
  tick() {
    this.calls.push(['tick', null]);
  }
  dispose() {
    this.disposed = true;
  }
}

class Ctx implements ContextLike {
  log: string[] = [];
  constructor(public state: string) {}
  resume() {
    this.log.push('resume');
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.log.push('suspend');
    this.state = 'suspended';
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
}

function setup(opts: { idle: boolean; startState?: string }) {
  let gesture: (() => void) | null = null;
  const idle: (() => void)[] = [];
  let now = 0;
  let id = 1;
  const runtimes: { ctx: Ctx; engine: RecEngine; at: string }[] = [];
  let phase = 'before-gesture';
  const env: DirectorEnv = {
    createRuntime() {
      const rt = { ctx: new Ctx(opts.startState ?? 'suspended'), engine: new RecEngine(), at: phase };
      runtimes.push(rt);
      return rt;
    },
    onGesture(fn) {
      gesture = fn;
      return () => (gesture = null);
    },
    onVisibility: () => () => {},
    isHidden: () => false,
    now: () => now,
    setInterval: () => id++,
    clearInterval: () => {},
    setTimeout: () => id++,
    clearTimeout: () => {},
    ...(opts.idle ? { whenIdle: (fn: () => void) => void idle.push(fn) } : {}),
  };
  const bus = new EventBus<GameEvents>();
  const audio = createAudioDirector({ bus, store: new Store(null) }, { env, seed: 7 });
  return {
    bus,
    audio,
    runtimes,
    runIdle() {
      for (const fn of idle.splice(0)) fn();
    },
    gesture() {
      phase = 'gesture';
      gesture?.();
    },
    advance: (ms: number) => (now += ms),
  };
}

/** The game's usual start: boot → loading (level built) → intro → playing, with a sound before the gesture. */
function playStart(t: ReturnType<typeof setup>) {
  t.bus.emit('state:changed', { from: 'boot', to: 'loading' });
  t.runIdle();
  t.bus.emit('level:ready', { levelId: 'l1' });
  t.bus.emit('state:changed', { from: 'loading', to: 'intro' });
  t.bus.emit('state:changed', { from: 'intro', to: 'playing' });
  t.bus.emit('player:motion', { speed: 0.5 });
  t.advance(1000);
  t.bus.emit('sfx', { name: 'uiSelect' });
  t.advance(100);
  t.gesture();
}

describe('audio director: runtime prepared during loading', () => {
  it('builds the context + engine in idle time behind the loading screen, inert until the gesture', async () => {
    const t = setup({ idle: true });
    expect(t.runtimes).toHaveLength(0); // only in idle time
    t.runIdle();
    expect(t.runtimes).toHaveLength(1);
    const { ctx, engine } = t.runtimes[0];
    expect(ctx.state).toBe('suspended');
    expect(engine.calls).toEqual([]); // nothing scheduled before the gesture
    expect(t.audio.debug.runtime).toBeNull();

    t.bus.emit('state:changed', { from: 'boot', to: 'loading' });
    t.bus.emit('level:ready', { levelId: 'l1' });
    t.bus.emit('sfx', { name: 'key' }); // before the gesture: not played (as without preparation)
    expect(engine.calls).toEqual([]);

    await new Promise((r) => setTimeout(r, 0)); // the prepare-time suspend() settles long before any gesture
    t.gesture();
    expect(t.runtimes).toHaveLength(1);
    expect(t.audio.debug.runtime?.engine).toBe(engine);
    expect(ctx.state).toBe('running');
    expect(ctx.log).toEqual(['suspend', 'resume']);
  });

  it('the gesture drives the engine exactly as a context created on the gesture', () => {
    const plain = setup({ idle: false });
    playStart(plain);
    const prep = setup({ idle: true });
    playStart(prep);
    expect(plain.runtimes[0].at).toBe('gesture');
    expect(prep.runtimes[0].at).toBe('before-gesture');
    expect(prep.runtimes[0].engine.calls).toEqual(plain.runtimes[0].engine.calls);
    expect(prep.runtimes[0].engine.calls.some(([k, v]) => k === 'sfx' && v === 'uiSelect')).toBe(true);
  });

  it('a context that only starts later (spec: asynchronously) is suspended too, and resumed on the gesture', async () => {
    const t = setup({ idle: true }); // reads 'suspended' at creation
    t.runIdle();
    expect(t.runtimes[0].ctx.log).toEqual(['suspend']);
    await new Promise((r) => setTimeout(r, 0));
    t.gesture();
    expect(t.runtimes[0].ctx.log).toEqual(['suspend', 'resume']);
  });

  it('a context allowed to start without a gesture is suspended at once and resumed on the gesture', async () => {
    const t = setup({ idle: true, startState: 'running' });
    t.runIdle();
    expect(t.runtimes[0].ctx.log).toEqual(['suspend']);
    await new Promise((r) => setTimeout(r, 0)); // the suspend settles long before any gesture
    t.gesture();
    expect(t.runtimes[0].ctx.log).toEqual(['suspend', 'resume']);
  });

  it('a gesture during that suspend resumes after it (never left suspended)', async () => {
    const t = setup({ idle: true, startState: 'running' });
    t.runIdle();
    t.gesture(); // the suspend() promise has not settled yet
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(t.runtimes[0].ctx.log).toEqual(['suspend', 'resume']);
    expect(t.runtimes[0].ctx.state).toBe('running');
  });

  it('never prepares outside boot / loading (the block would be a visible stall there)', () => {
    const t = setup({ idle: true });
    t.bus.emit('state:changed', { from: 'boot', to: 'menu' });
    t.runIdle(); // the boot-time request runs after the menu is up: skipped
    t.bus.emit('state:changed', { from: 'menu', to: 'playing' });
    t.runIdle();
    expect(t.runtimes).toHaveLength(0);
    t.gesture();
    expect(t.runtimes).toHaveLength(1);
    expect(t.runtimes[0].at).toBe('gesture');
  });

  it('dispose closes a prepared runtime that was never unlocked', () => {
    const t = setup({ idle: true });
    t.runIdle();
    t.audio.dispose();
    expect(t.runtimes[0].engine.disposed).toBe(true);
    expect(t.runtimes[0].ctx.state).toBe('closed');
  });
});
