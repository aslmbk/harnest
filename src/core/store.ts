/**
 * Persistent progress and settings (localStorage). Shared by the game, the UI and audio.
 */

export type Quality = 'auto' | 'low' | 'medium' | 'high';
export type Stars = 1 | 2 | 3;

export interface Settings {
  master: number; // 0..1
  music: number; // 0..1
  sfx: number; // 0..1
  quality: Quality;
}

export interface LevelProgress {
  /** terminal id → best stars */
  terminals: Record<string, Stars>;
  chips: string[];
  completed: boolean;
}

export interface SaveData {
  v: 1;
  /** Level to continue from; null = fresh save. */
  currentLevel: string | null;
  levels: Record<string, LevelProgress>;
  /** Unlocked codex entry ids. */
  codex: string[];
  settings: Settings;
}

const KEY = 'harnest.save.v1';

function defaults(): SaveData {
  return {
    v: 1,
    currentLevel: null,
    levels: {},
    codex: [],
    settings: { master: 0.8, music: 0.6, sfx: 0.8, quality: 'auto' },
  };
}

type Listener = (data: Readonly<SaveData>) => void;

export class Store {
  private state: SaveData;
  private listeners = new Set<Listener>();
  private storage: Pick<Storage, 'getItem' | 'setItem'> | null;

  constructor(storage?: Pick<Storage, 'getItem' | 'setItem'> | null) {
    this.storage = storage === undefined ? safeLocalStorage() : storage;
    this.state = this.load();
  }

  get data(): Readonly<SaveData> {
    return this.state;
  }

  get settings(): Readonly<Settings> {
    return this.state.settings;
  }

  /** Progress of a level (an empty record if the level was never played). */
  level(levelId: string): Readonly<LevelProgress> {
    return this.state.levels[levelId] ?? { terminals: {}, chips: [], completed: false };
  }

  hasProgress(): boolean {
    return this.state.currentLevel !== null;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Mutate, persist, notify. */
  update(mutate: (draft: SaveData) => void): void {
    mutate(this.state);
    this.persist();
    for (const fn of [...this.listeners]) fn(this.state);
  }

  setSettings(patch: Partial<Settings>): void {
    this.update((d) => Object.assign(d.settings, patch));
  }

  setCurrentLevel(levelId: string): void {
    this.update((d) => {
      d.currentLevel = levelId;
      ensureLevel(d, levelId);
    });
  }

  /** Keeps the best star count. */
  completeTerminal(levelId: string, terminalId: string, stars: Stars): void {
    this.update((d) => {
      const lp = ensureLevel(d, levelId);
      const prev = lp.terminals[terminalId] ?? 0;
      lp.terminals[terminalId] = Math.max(prev, stars) as Stars;
    });
  }

  collectChip(levelId: string, chipId: string): void {
    this.update((d) => {
      const lp = ensureLevel(d, levelId);
      if (!lp.chips.includes(chipId)) lp.chips.push(chipId);
    });
  }

  unlockCodex(ids: readonly string[]): void {
    const fresh = ids.filter((id) => !this.state.codex.includes(id));
    if (fresh.length) this.update((d) => d.codex.push(...fresh));
  }

  completeLevel(levelId: string): void {
    this.update((d) => {
      ensureLevel(d, levelId).completed = true;
    });
  }

  /** Wipe progress; settings survive. */
  resetProgress(): void {
    this.update((d) => {
      d.currentLevel = null;
      d.levels = {};
      d.codex = [];
    });
  }

  private load(): SaveData {
    const base = defaults();
    try {
      const raw = this.storage?.getItem(KEY);
      if (!raw) return base;
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed) || parsed.v !== 1) return base;
      // A corrupted or partial save: every field falls back to its default on its own.
      return {
        ...base,
        ...parsed,
        v: 1,
        currentLevel: typeof parsed.currentLevel === 'string' ? parsed.currentLevel : null,
        levels: readLevels(parsed.levels),
        codex: readStrings(parsed.codex),
        settings: readSettings(parsed.settings, base.settings),
      };
    } catch {
      return base;
    }
  }

  private persist(): void {
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.state));
    } catch {
      // storage full or blocked — progress stays in memory
    }
  }
}

function ensureLevel(d: SaveData, levelId: string): LevelProgress {
  return (d.levels[levelId] ??= { terminals: {}, chips: [], completed: false });
}

// ───────────── reading a stored save (anything may be missing or of the wrong type) ─────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function readLevels(v: unknown): Record<string, LevelProgress> {
  const out: Record<string, LevelProgress> = {};
  if (!isRecord(v)) return out;
  for (const [id, lp] of Object.entries(v)) {
    if (!isRecord(lp) || id === '__proto__') continue;
    const terminals: Record<string, Stars> = {};
    if (isRecord(lp.terminals)) {
      for (const [tid, stars] of Object.entries(lp.terminals)) {
        if ((stars === 1 || stars === 2 || stars === 3) && tid !== '__proto__') terminals[tid] = stars;
      }
    }
    out[id] = { terminals, chips: readStrings(lp.chips), completed: lp.completed === true };
  }
  return out;
}

function readSettings(v: unknown, base: Settings): Settings {
  if (!isRecord(v)) return { ...base };
  const volume = (x: unknown, fallback: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : fallback);
  const quality = v.quality === 'auto' || v.quality === 'low' || v.quality === 'medium' || v.quality === 'high' ? v.quality : base.quality;
  return { ...v, master: volume(v.master, base.master), music: volume(v.music, base.music), sfx: volume(v.sfx, base.sfx), quality };
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
