/**
 * Reactive audio director: listens to the bus and the store, keeps the desired audio state (scene,
 * game state, brightness, motor speed, volumes) and applies it to the engine. The AudioContext is
 * created on the first user gesture; before that, state is tracked and one-shots are skipped (the
 * last few are replayed if the gesture arrives right after them). The context is suspended while the
 * tab is hidden. Browser specifics live in `browserEnv()` so the logic is testable without WebAudio.
 */
import { getLevel } from '../content';
import type { GameBus, GameState, SfxName } from '../core/events';
import type { Settings, Store } from '../core/store';
import { AudioEngine, type EngineStats, type Volumes } from './engine';
import { type AudioScene, type LevelAudioInput, levelScene, menuScene, mixForState, type StateMix } from './profiles';

export interface AudioDeps {
  bus: GameBus;
  store: Store;
}

export interface AudioHandle {
  dispose(): void;
}

/** What the director needs from an engine (AudioEngine; a fake in unit tests). */
export interface EngineLike {
  setVolumes(v: Volumes, immediate?: boolean): void;
  setStateMix(mix: StateMix, immediate?: boolean): void;
  setHidden(hidden: boolean): void;
  setScene(scene: AudioScene | null, fade?: number): void;
  setBright(on: boolean): void;
  flourish(): void;
  resolve(): void;
  setMotor(speed: number): void;
  playSfx(name: SfxName): boolean;
  tick(): void;
  stats?(): EngineStats;
  dispose(): void;
}

export interface ContextLike {
  readonly state: string;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
}

export interface AudioRuntime {
  ctx: ContextLike;
  engine: EngineLike;
}

export interface DirectorEnv {
  /** Creates the context and the engine on it; null when WebAudio is unavailable. */
  createRuntime(seed: number): AudioRuntime | null;
  /** Calls fn on user gestures (pointer, key, touch). Returns an unsubscribe function. */
  onGesture(fn: () => void): () => void;
  onVisibility(fn: (hidden: boolean) => void): () => void;
  isHidden(): boolean;
  /** Milliseconds, monotonic. */
  now(): number;
  setInterval(fn: () => void, ms: number): number;
  clearInterval(id: number): void;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

export interface DirectorOptions {
  env?: DirectorEnv;
  /** Level id → audio input. Defaults to the game content (getLevel). */
  resolveLevel?: (levelId: string) => LevelAudioInput | null;
  seed?: number;
}

export interface AudioDirector extends AudioHandle {
  /** Dev/test introspection. */
  readonly debug: {
    readonly runtime: AudioRuntime | null;
    readonly state: GameState;
    readonly scene: string | null;
    readonly bright: boolean;
    unlock(): void;
  };
}

/** Engine scheduling period (the engine schedules 1.5 s ahead, so throttled timers are fine). */
const TICK_MS = 200;
/** One-shots emitted this shortly before the unlocking gesture are still played. */
const PENDING_MS = 300;
const SCENE_FADE = 2.5;

export function levelInputFromContent(levelId: string): LevelAudioInput | null {
  try {
    const level = getLevel(levelId);
    const signs = level.layout.signs;
    return {
      id: level.id,
      index: level.index,
      mood: level.layout.mood,
      neonSigns: signs.length,
      flickerSigns: signs.filter((s) => s.flicker).length,
    };
  } catch {
    return null;
  }
}

/** Fallback for a level id the content does not know: guess the index from the id ("l3" → 3). */
function fallbackInput(levelId: string): LevelAudioInput {
  const index = Number(/\d+/.exec(levelId)?.[0] ?? 1) || 1;
  return { id: levelId, index, mood: { rain: 0.4, fogDensity: 0.5 } };
}

function volumesOf(s: Readonly<Settings>): Volumes {
  return { master: s.master, music: s.music, sfx: s.sfx };
}

export function createAudioDirector(deps: AudioDeps, options: DirectorOptions = {}): AudioDirector {
  const { bus, store } = deps;
  const env = options.env ?? browserEnv();
  const resolveLevel = options.resolveLevel ?? levelInputFromContent;
  const seed = options.seed ?? (Date.now() >>> 0);

  // Desired state, tracked from the first event on (also before audio is unlocked).
  let state: GameState = 'boot';
  /** False until the first state:changed — then a late-created director plays the menu bed, not silence. */
  let stateKnown = false;
  let scene: AudioScene | null = null;
  let levelId: string | null = null;
  let bright = false;
  let speed = 0;
  let volumes = volumesOf(store.settings);
  let hidden = env?.isHidden() ?? false;

  let rt: AudioRuntime | null = null;
  let failed = false;
  let disposed = false;
  let tickTimer = -1;
  let suspendTimer = -1;
  const pending: { name: SfxName; at: number }[] = [];
  const offs: (() => void)[] = [];

  const engine = () => rt?.engine ?? null;

  function startTicking(): void {
    if (!env || !rt || tickTimer >= 0) return;
    tickTimer = env.setInterval(() => rt?.engine.tick(), TICK_MS);
  }

  function stopTicking(): void {
    if (env && tickTimer >= 0) env.clearInterval(tickTimer);
    tickTimer = -1;
  }

  function setScene(next: AudioScene | null): void {
    if (next?.id === scene?.id) return;
    scene = next;
    engine()?.setScene(scene, SCENE_FADE);
  }

  function setBright(on: boolean): void {
    bright = on;
    engine()?.setBright(on);
  }

  function resume(): void {
    if (!rt || hidden) return;
    const s = rt.ctx.state;
    if (s === 'suspended' || s === 'interrupted') rt.ctx.resume().catch(() => {});
  }

  function unlock(): void {
    if (disposed || failed || !env) return;
    if (!rt) {
      if (hidden) return;
      rt = env.createRuntime(seed);
      if (!rt) {
        failed = true;
        return;
      }
      const e = rt.engine;
      if (!stateKnown && !scene) scene = menuScene();
      e.setVolumes(volumes, true);
      e.setStateMix(mixForState(stateKnown ? state : 'menu'), true);
      e.setBright(bright);
      e.setScene(scene, 1.5);
      e.setMotor(speed);
      e.tick();
      startTicking();
    }
    resume();
    if (pending.length) {
      const now = env.now();
      for (const p of pending) if (now - p.at <= PENDING_MS) rt.engine.playSfx(p.name);
      pending.length = 0;
    }
  }

  if (env) {
    offs.push(env.onGesture(unlock));
    offs.push(
      env.onVisibility((h) => {
        hidden = h;
        if (!rt) return;
        if (h) {
          rt.engine.setHidden(true);
          stopTicking();
          if (suspendTimer >= 0) env.clearTimeout(suspendTimer);
          suspendTimer = env.setTimeout(() => {
            suspendTimer = -1;
            if (hidden && rt && rt.ctx.state === 'running') rt.ctx.suspend().catch(() => {});
          }, 120);
        } else {
          if (suspendTimer >= 0) env.clearTimeout(suspendTimer);
          suspendTimer = -1;
          resume();
          rt.engine.setHidden(false);
          startTicking();
        }
      }),
    );
  }

  offs.push(
    bus.on('state:changed', ({ to }) => {
      state = to;
      stateKnown = true;
      if (to === 'menu') {
        levelId = null;
        setScene(menuScene());
      } else if ((to === 'intro' || to === 'playing') && !scene) {
        setScene(menuScene()); // audio was created after level:ready; better than silence
      }
      if (to === 'ending') setBright(true);
      engine()?.setStateMix(mixForState(to));
      // The robot cannot move outside 'playing'; do not resume a stale speed when play continues.
      if (to !== 'playing' && speed !== 0) {
        speed = 0;
        engine()?.setMotor(0);
      }
    }),
    bus.on('level:ready', ({ levelId: id }) => {
      if (id !== levelId) {
        levelId = id;
        setScene(levelScene(resolveLevel(id) ?? fallbackInput(id)));
      }
      setBright(false); // a (re)built level starts with its gate closed
    }),
    bus.on('objectives:changed', ({ gateOpen }) => {
      if (gateOpen !== bright) setBright(gateOpen);
    }),
    bus.on('gate:opened', () => setBright(true)),
    bus.on('chip:collected', () => engine()?.flourish()),
    bus.on('level:completed', () => {
      bright = true;
      engine()?.resolve();
    }),
    bus.on('player:motion', ({ speed: s }) => {
      speed = s;
      engine()?.setMotor(s);
    }),
    bus.on('sfx', ({ name }) => {
      if (rt) {
        if (!hidden) rt.engine.playSfx(name);
      } else if (env && !failed) {
        if (pending.length >= 4) pending.shift();
        pending.push({ name, at: env.now() });
      }
    }),
  );

  offs.push(
    store.subscribe((data) => {
      const v = volumesOf(data.settings);
      if (v.master === volumes.master && v.music === volumes.music && v.sfx === volumes.sfx) return;
      volumes = v;
      engine()?.setVolumes(v);
    }),
  );

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const off of offs) off();
      offs.length = 0;
      stopTicking();
      if (env && suspendTimer >= 0) env.clearTimeout(suspendTimer);
      if (rt) {
        rt.engine.dispose();
        rt.ctx.close().catch(() => {});
        rt = null;
      }
    },
    debug: {
      get runtime() {
        return rt;
      },
      get state() {
        return state;
      },
      get scene() {
        return scene?.id ?? null;
      },
      get bright() {
        return bright;
      },
      unlock,
    },
  };
}

type AudioContextCtor = typeof AudioContext;

/** Real browser wiring. Null outside a browser (SSR, unit tests): the director then stays silent. */
export function browserEnv(): DirectorEnv | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  const Ctor: AudioContextCtor | undefined =
    typeof AudioContext !== 'undefined' ? AudioContext : (window as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  const gestures = ['pointerdown', 'pointerup', 'keydown', 'touchend', 'click'] as const;
  return {
    createRuntime(seed) {
      if (!Ctor) return null;
      try {
        const ctx = new Ctor({ latencyHint: 'interactive' });
        return { ctx, engine: new AudioEngine(ctx, { seed }) };
      } catch (err) {
        console.warn('[audio] WebAudio is unavailable', err);
        return null;
      }
    },
    onGesture(fn) {
      for (const type of gestures) window.addEventListener(type, fn, { capture: true, passive: true });
      return () => {
        for (const type of gestures) window.removeEventListener(type, fn, { capture: true });
      };
    },
    onVisibility(fn) {
      const handler = () => fn(document.hidden);
      document.addEventListener('visibilitychange', handler);
      return () => document.removeEventListener('visibilitychange', handler);
    },
    isHidden: () => document.hidden,
    now: () => performance.now(),
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (id) => window.clearInterval(id),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id),
  };
}
