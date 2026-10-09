/**
 * `window.__harnest` — the debug/test API (design doc §10) plus a few extras for scripted playtests:
 *
 *   ready, backend, state(), level(), player() → { col, row }, teleport(col, row), loadLevel(id),
 *   completeTerminal(id), openGate()
 *   extras: interact(), prompt(), objectives(), spots(), events (recent bus events; recorded only with
 *   `?debug=1` or `?autoui=1`, empty otherwise), stats(), bus, internals (live engine / game objects for
 *   console debugging)
 */
import type { GameBus, GameEvents, GameState, ObjectiveItem } from '../core/events';
import { occlusion } from '../render/occlusion';
import type { DebugSpots, Game } from '../world/game';
import { worldToTile } from '../world/tiles';
import type { LoadReport } from './assets';
import type { Engine, FrameStats } from './engine';

export interface BusRecord {
  t: number;
  type: keyof GameEvents;
  payload: unknown;
}

export interface HarnestDebugApi {
  ready: boolean;
  backend: 'webgpu' | 'webgl2' | null;
  state(): GameState;
  level(): string | null;
  player(): { col: number; row: number };
  teleport(col: number, row: number): void;
  loadLevel(id: string): Promise<void>;
  completeTerminal(id: string): boolean;
  openGate(): void;
  interact(): boolean;
  prompt(): GameEvents['interact:prompt'];
  objectives(): ObjectiveItem[];
  /** Where to stand for each terminal / NPC, chips, gate, exit (tile coordinates). */
  spots(): DebugSpots | null;
  events: BusRecord[];
  stats(): FrameStats & { quality: string; lights: number; instances: number; assets: LoadReport | null };
  bus: GameBus;
  /** Live objects for console debugging (unstable, do not script against). */
  internals: { engine: Engine | null; game: Game | null; occlusion: typeof occlusion };
}

declare global {
  interface Window {
    __harnest?: HarnestDebugApi;
  }
}

/** Records bus traffic (ring buffer) by wrapping `emit`. Install before anything emits. */
export function recordBus(bus: GameBus, max = 600): BusRecord[] {
  const log: BusRecord[] = [];
  const emit = bus.emit.bind(bus);
  bus.emit = (type, payload) => {
    log.push({ t: Math.round(performance.now()), type, payload: structuredCloneSafe(payload) });
    if (log.length > max) log.splice(0, log.length - max);
    emit(type, payload);
  };
  return log;
}

function structuredCloneSafe<T>(v: T): T {
  try {
    return structuredClone(v);
  } catch {
    return v;
  }
}

/** Early, minimal API: `ready` stays false until the game is up. */
export function installEarlyApi(bus: GameBus, events: BusRecord[]): HarnestDebugApi {
  const notReady = () => {
    throw new Error('HARNEST is not ready yet');
  };
  const api: HarnestDebugApi = {
    ready: false,
    backend: null,
    state: () => 'boot',
    level: () => null,
    player: () => ({ col: 0, row: 0 }),
    teleport: notReady,
    loadLevel: async () => notReady(),
    completeTerminal: () => false,
    openGate: notReady,
    interact: () => false,
    prompt: () => null,
    objectives: () => [],
    spots: () => null,
    events,
    stats: () => ({ fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, frames: 0, quality: '', lights: 0, instances: 0, assets: null }),
    bus,
    internals: { engine: null, game: null, occlusion },
  };
  window.__harnest = api;
  return api;
}

export function attachGame(api: HarnestDebugApi, game: Game, engine: Engine, assets: LoadReport): void {
  api.backend = engine.backend;
  api.internals = { engine, game, occlusion };
  api.state = () => game.state;
  api.level = () => game.levelId;
  api.player = () => {
    const t = worldToTile(game.player.x, game.player.z);
    return { col: Math.round(t.col * 100) / 100, row: Math.round(t.row * 100) / 100 };
  };
  api.teleport = (col, row) => game.teleport(col, row);
  api.loadLevel = (id) => game.enterLevel(id);
  api.completeTerminal = (id) => game.completeTerminal(id, 3);
  api.openGate = () => game.openGate(true);
  api.interact = () => game.pressInteract();
  api.prompt = () => game.currentPrompt;
  api.objectives = () => game.session?.objectives() ?? [];
  api.spots = () => game.spots();
  api.stats = () => ({
    ...engine.stats,
    quality: engine.preset.level,
    lights: game.runtime?.built.lights.active ?? 0,
    instances: game.runtime?.built.instances ?? 0,
    assets,
  });
}
