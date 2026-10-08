/**
 * Sound "scenes": what the ambience and the music of a place sound like, derived from level data
 * (`layout.mood`, level index, neon signs). Also the per-game-state mix. Pure data — unit tested.
 */
import type { GameState } from '../core/events';
import type { LevelMood } from '../content/types';
import type { ModeName } from './theory';

export interface AmbienceProfile {
  /** 0..1 rain bed level and droplet density (from `mood.rain`). */
  rain: number;
  /** Mains hum: fundamental (Hz) and level 0..1. */
  humHz: number;
  hum: number;
  /** Low city rumble (distant traffic, pumps). */
  rumble: number;
  /** Rhythmic distant machinery chug. */
  machinery: number;
  /** Air moving between towers. */
  wind: number;
  // Event rates, roughly 0..1 (1 = busy).
  drips: number;
  buzz: number;
  clanks: number;
  steam: number;
  chatter: number;
  chirps: number;
}

export interface MusicProfile {
  /** MIDI note of the key root (bass register). */
  root: number;
  mode: ModeName;
  bpm: number;
  /** Base arpeggio density 0..1. */
  density: number;
}

export interface AudioScene {
  id: string;
  ambience: AmbienceProfile;
  music: MusicProfile;
}

/** What audio needs to know about a level. Built from a LevelDef (see director.ts). */
export interface LevelAudioInput {
  id: string;
  index: number;
  mood: Pick<LevelMood, 'rain' | 'fogDensity'>;
  neonSigns?: number;
  flickerSigns?: number;
}

type Flavor = Omit<AmbienceProfile, 'rain'>;

// Per-district character (GAME_DESIGN §5 "Level moods"); index 1..5, later indexes wrap around.
const FLAVORS: Flavor[] = [
  // 1 · rainy narrow alley
  { humHz: 50, hum: 0.55, rumble: 0.5, machinery: 0.25, wind: 0.15, drips: 1, buzz: 0.6, clanks: 0.3, steam: 0.1, chatter: 0, chirps: 0 },
  // 2 · lantern-lit market
  { humHz: 55, hum: 0.45, rumble: 0.6, machinery: 0.12, wind: 0.1, drips: 0.6, buzz: 0.45, clanks: 0.15, steam: 0, chatter: 1, chirps: 0.1 },
  // 3 · industrial depot, steam, dry
  { humHz: 47, hum: 0.75, rumble: 0.7, machinery: 1, wind: 0.12, drips: 0.25, buzz: 0.3, clanks: 1, steam: 1, chatter: 0, chirps: 0 },
  // 4 · tech bazaar, rain
  { humHz: 60, hum: 0.55, rumble: 0.5, machinery: 0.3, wind: 0.1, drips: 0.8, buzz: 1, clanks: 0.2, steam: 0.1, chatter: 0.35, chirps: 1 },
  // 5 · tower plaza, fog
  { humHz: 41, hum: 0.85, rumble: 0.4, machinery: 0.2, wind: 1, drips: 0.3, buzz: 0.4, clanks: 0.12, steam: 0, chatter: 0, chirps: 0.2 },
];

// Key per level index (0 = menu). Every level gets its own root and mode.
const KEYS: MusicProfile[] = [
  { root: 50, mode: 'dorian', bpm: 60, density: 0.5 }, // menu · D dorian
  { root: 45, mode: 'aeolian', bpm: 64, density: 0.55 }, // 1 alley · A aeolian
  { root: 41, mode: 'lydian', bpm: 70, density: 0.65 }, // 2 market · F lydian
  { root: 43, mode: 'mixolydian', bpm: 66, density: 0.6 }, // 3 depot · G mixolydian
  { root: 40, mode: 'phrygian', bpm: 68, density: 0.6 }, // 4 bazaar · E phrygian
  { root: 47, mode: 'dorian', bpm: 58, density: 0.5 }, // 5 tower · B dorian
];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function musicForIndex(index: number): MusicProfile {
  if (index <= 0) return { ...KEYS[0] };
  return { ...KEYS[((index - 1) % (KEYS.length - 1)) + 1] };
}

export function levelScene(input: LevelAudioInput): AudioScene {
  const f = FLAVORS[(Math.max(1, input.index) - 1) % FLAVORS.length];
  const rain = clamp01(input.mood.rain);
  const signs = input.neonSigns ?? 3;
  const flicker = input.flickerSigns ?? 0;
  return {
    id: `level:${input.id}`,
    ambience: {
      ...f,
      rain,
      // Water keeps dripping after the rain stops, just less.
      drips: clamp01(f.drips * (0.3 + rain)),
      // More neon on the map (and flickering signs) → more electric buzz.
      buzz: clamp01(f.buzz * (0.6 + 0.08 * signs + 0.15 * flicker)),
      wind: clamp01(f.wind + (input.mood.fogDensity - 0.5) * 0.3),
    },
    music: musicForIndex(input.index),
  };
}

export function menuScene(): AudioScene {
  return {
    id: 'menu',
    ambience: {
      rain: 0.45,
      humHz: 50,
      hum: 0.3,
      rumble: 0.35,
      machinery: 0,
      wind: 0.15,
      drips: 0.6,
      buzz: 0.3,
      clanks: 0.08,
      steam: 0,
      chatter: 0,
      chirps: 0,
    },
    music: musicForIndex(0),
  };
}

/** Relative levels per game state (multiplied with the settings volumes). */
export interface StateMix {
  ambience: number;
  music: number;
  motor: number;
}

export function mixForState(state: GameState): StateMix {
  switch (state) {
    case 'boot':
      return { ambience: 0, music: 0, motor: 0 };
    case 'menu':
      return { ambience: 0.85, music: 1, motor: 0 };
    case 'loading':
      return { ambience: 0.5, music: 0.6, motor: 0 };
    case 'intro':
      return { ambience: 1, music: 0.9, motor: 0 };
    case 'playing':
      return { ambience: 1, music: 1, motor: 1 };
    case 'dialog':
      return { ambience: 0.8, music: 0.5, motor: 0 };
    case 'terminal':
      return { ambience: 0.6, music: 0.42, motor: 0 };
    case 'paused':
      return { ambience: 0.65, music: 0.7, motor: 0 };
    case 'levelComplete':
      return { ambience: 0.6, music: 1, motor: 0 };
    case 'ending':
      return { ambience: 0.5, music: 1.1, motor: 0 };
  }
}

/** Settings slider (0..1) → linear gain. Squared: feels even across the slider, 0 is silence. */
export function volumeCurve(v: number): number {
  const x = clamp01(Number.isFinite(v) ? v : 0);
  return x * x;
}
