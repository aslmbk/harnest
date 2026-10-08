/**
 * One-shot sound effects. "Friendly old hardware": soft blips, FM bells, relay clicks, CRT thunks.
 * Every sound is built from the primitives in synth.ts, so the set reads as one family.
 * Synths take any BaseAudioContext, so they render offline in checks exactly as they play live.
 */
import type { SfxName } from '../core/events';
import { type NoiseBank, Voice } from './dsp';
import type { Rng } from './rng';
import { bell, click, hiss, route, type SendBus, type Synth, syllable, thump, tone } from './synth';

export interface SfxInfo {
  /** Output trim (balanced with scripts/audio-check.mjs). */
  level: number;
  /** Ignore re-triggers closer than this (seconds): de-dupes double emits, tames spam. */
  minGap: number;
  /** Max simultaneous instances of this sound. */
  maxVoices: number;
  /** 0 = may be dropped when the voice budget is tight, 1 = normal, 2 = never dropped. */
  priority: 0 | 1 | 2;
}

export const SFX_INFO: Record<SfxName, SfxInfo> = {
  uiMove: { level: 0.78, minGap: 0.04, maxVoices: 3, priority: 0 },
  uiSelect: { level: 0.97, minGap: 0.05, maxVoices: 3, priority: 1 },
  uiBack: { level: 1, minGap: 0.05, maxVoices: 3, priority: 1 },
  key: { level: 0.7, minGap: 0.018, maxVoices: 5, priority: 0 },
  stepOk: { level: 1.06, minGap: 0.08, maxVoices: 2, priority: 2 },
  stepWrong: { level: 0.82, minGap: 0.08, maxVoices: 2, priority: 2 },
  hint: { level: 0.83, minGap: 0.08, maxVoices: 2, priority: 1 },
  challengeDone: { level: 1.53, minGap: 0.2, maxVoices: 1, priority: 2 },
  chip: { level: 1.7, minGap: 0.1, maxVoices: 2, priority: 2 },
  gateOpen: { level: 1.1, minGap: 0.5, maxVoices: 1, priority: 2 },
  // A typewriter may emit one per character: at most ~16 syllables per second.
  talk: { level: 0.65, minGap: 0.06, maxVoices: 2, priority: 0 },
  interact: { level: 1.03, minGap: 0.08, maxVoices: 2, priority: 1 },
  locked: { level: 0.83, minGap: 0.1, maxVoices: 2, priority: 1 },
  levelComplete: { level: 1.24, minGap: 0.5, maxVoices: 1, priority: 2 },
};

export const SFX_NAMES = Object.keys(SFX_INFO) as SfxName[];

const TALK_STEPS = [0, 2, 4, 7, 9, 12];

type SfxFn = (s: Synth, t: number) => void;

const SYNTHS: Record<SfxName, SfxFn> = {
  uiMove(s, t) {
    const p = s.rng.range(0.985, 1.015);
    tone(s, t, { wave: 'triangle', f: 1046 * p, to: 940 * p, glide: 0.03, a: 0.002, d: 0.06, g: 0.5, wet: 0.05 });
  },

  uiSelect(s, t) {
    click(s, t, 0.9, 2800);
    tone(s, t, { wave: 'triangle', f: 784, a: 0.003, d: 0.08, g: 0.45 });
    tone(s, t + 0.06, { wave: 'triangle', f: 1175, a: 0.003, d: 0.17, g: 0.5, wet: 0.12 });
  },

  uiBack(s, t) {
    tone(s, t, { wave: 'triangle', f: 1046, a: 0.003, d: 0.07, g: 0.42 });
    tone(s, t + 0.055, { wave: 'triangle', f: 698, a: 0.003, d: 0.15, g: 0.45, lp: 2400, wet: 0.1 });
  },

  key(s, t) {
    // Mechanical key: a bright tick and a small "thock", slightly different every time.
    const r = s.rng;
    const p = r.range(0.9, 1.1);
    const pan = r.range(-0.18, 0.18);
    hiss(s, t, { type: 'bandpass', f: 3300 * p, q: 1.4, a: 0.0008, d: 0.022, g: 1.1 * r.range(0.75, 1), pan });
    tone(s, t, { wave: 'sine', f: 480 * p, to: 170 * p, glide: 0.016, a: 0.001, d: 0.035, g: 0.35 * r.range(0.8, 1), pan });
  },

  stepOk(s, t) {
    click(s, t, 0.8, 3000);
    bell(s, t + 0.005, { f: 659.26, ratio: 2, index: 0.8, d: 0.55, g: 0.34, wet: 0.2 });
    bell(s, t + 0.085, { f: 987.77, ratio: 2, index: 0.7, d: 0.8, g: 0.32, wet: 0.25 });
  },

  stepWrong(s, t) {
    // A soft, round "boo-bop" downward. Gentle, never a buzzer.
    tone(s, t, { wave: 'triangle', f: 415.3, to: 392, glide: 0.1, a: 0.008, d: 0.18, g: 0.4, lp: 1400 });
    tone(s, t + 0.13, { wave: 'triangle', f: 329.63, to: 311.13, glide: 0.15, a: 0.01, d: 0.32, g: 0.42, lp: 1200, wet: 0.12 });
  },

  hint(s, t) {
    // "Hm?" — a rising sine, then a glassy ping.
    tone(s, t, { wave: 'sine', f: 587.33, to: 880, glide: 0.16, a: 0.02, hold: 0.06, d: 0.32, g: 0.34, wet: 0.25 });
    bell(s, t + 0.17, { f: 1318.5, ratio: 3, index: 0.5, d: 0.6, g: 0.16, wet: 0.35 });
  },

  challengeDone(s, t) {
    thump(s, t, { f: 110, to: 48, d: 0.25, g: 0.5 });
    click(s, t, 0.9, 2600);
    const arp = [523.25, 659.26, 783.99, 1046.5];
    arp.forEach((f, i) => bell(s, t + 0.04 + i * 0.09, { f, ratio: 2, index: 0.9, d: 0.9 + i * 0.15, g: 0.3, pan: (i - 1.5) * 0.12, wet: 0.3 }));
    for (const f of [261.63, 329.63, 392]) tone(s, t + 0.05, { wave: 'warm', f, a: 0.12, hold: 0.3, d: 1.2, g: 0.09, lp: 1800, wet: 0.3 });
  },

  chip(s, t) {
    const notes = [783.99, 987.77, 1174.66, 1567.98];
    notes.forEach((f, i) => bell(s, t + i * 0.05, { f, ratio: 3, index: 0.6, d: 0.6 + i * 0.1, g: 0.22, pan: (i - 1.5) * 0.15, wet: 0.35 }));
    tone(s, t, { wave: 'sine', f: 900, to: 1800, glide: 0.12, a: 0.005, d: 0.15, g: 0.08 });
  },

  gateOpen(s, t) {
    const { v } = s;
    // 1 · locks release
    thump(s, t, { f: 85, to: 42, d: 0.3, g: 0.6 });
    hiss(s, t, { type: 'bandpass', f: 1800, q: 2, a: 0.001, d: 0.08, g: 1.2, wet: 0.3 });
    click(s, t + 0.02, 1, 2000);
    // 2 · hydraulic hiss
    hiss(s, t + 0.12, { type: 'highpass', f: 3000, to: 1500, glide: 0.9, a: 0.04, hold: 0.25, d: 0.7, g: 0.12, wet: 0.2 });
    // 3 · motor grind with a rattle
    const g0 = t + 0.18;
    const len = 2.1;
    const end = g0 + len + 0.05;
    const env = v.gain(0);
    env.gain.setValueAtTime(0, g0);
    env.gain.linearRampToValueAtTime(1, g0 + 0.35);
    env.gain.setValueAtTime(1, g0 + len - 0.4);
    env.gain.linearRampToValueAtTime(0, g0 + len);
    const rattle = v.gain(0.7);
    const lfo = v.osc('sine', 11, g0, end);
    const lfoDepth = v.gain(0.3);
    lfo.connect(lfoDepth);
    lfoDepth.connect(rattle.gain);
    env.connect(rattle);
    route(s, rattle, 0, 0.25);
    const saw = v.osc('sawtooth', 42, g0, end);
    saw.frequency.setValueAtTime(42, g0);
    saw.frequency.linearRampToValueAtTime(68, g0 + len);
    const sawLp = v.filter('lowpass', 260, 4);
    sawLp.frequency.setValueAtTime(260, g0);
    sawLp.frequency.linearRampToValueAtTime(480, g0 + len);
    const sawG = v.gain(0.3);
    saw.connect(sawLp);
    sawLp.connect(sawG);
    sawG.connect(env);
    const rumble = v.noise(s.noise.brown, g0, end, s.rng);
    const rumbleLp = v.filter('lowpass', 240, 0.9);
    const rumbleG = v.gain(1.1);
    rumble.connect(rumbleLp);
    rumbleLp.connect(rumbleG);
    rumbleG.connect(env);
    // 4 · the heavy clunk when the doors reach the end
    const tc = g0 + len + 0.1;
    thump(s, tc, { f: 70, to: 34, d: 0.5, g: 0.8, wet: 0.35 });
    hiss(s, tc, { color: 'brown', type: 'lowpass', f: 500, a: 0.002, d: 0.35, g: 1.6, wet: 0.3 });
    hiss(s, tc, { type: 'bandpass', f: 1400, q: 1.5, a: 0.001, d: 0.06, g: 1, wet: 0.2 });
    bell(s, tc + 0.01, { f: 196, ratio: 2.76, index: 1.5, d: 1.1, g: 0.06, wet: 0.4 });
  },

  talk(s, t) {
    // Robot-speech blip, sing-song pentatonic pitch.
    const f = 196 * 2 ** (s.rng.pick(TALK_STEPS) / 12);
    syllable(s, t, { f, dur: s.rng.range(0.05, 0.085), g: 1.6 });
  },

  interact(s, t) {
    // CRT power-on: thunk, a crackle of static, a little rising "ready" tone.
    thump(s, t, { f: 150, to: 55, d: 0.16, g: 0.55 });
    hiss(s, t, { type: 'highpass', f: 2600, a: 0.001, d: 0.07, g: 0.2 });
    tone(s, t + 0.03, { wave: 'sine', f: 440, to: 880, glide: 0.09, a: 0.01, d: 0.16, g: 0.22, wet: 0.12 });
  },

  locked(s, t) {
    // Two dull, soft buzzes: "nope".
    click(s, t, 0.6, 2200);
    for (const dt of [0.01, 0.15]) tone(s, t + dt, { wave: 'sawtooth', f: 155, a: 0.006, hold: 0.06, d: 0.07, g: 0.35, lp: 650, q: 3 });
  },

  levelComplete(s, t) {
    // IV → V → I stinger with a bell melody on top.
    thump(s, t, { f: 120, to: 50, d: 0.25, g: 0.4 });
    const chords = [
      [349.23, 440, 523.25, 659.26],
      [392, 493.88, 587.33],
      [261.63, 329.63, 392, 587.33],
    ];
    const bass = [87.31, 98, 65.41];
    const at = [0, 0.42, 0.84];
    chords.forEach((chord, i) => {
      const last = i === chords.length - 1;
      for (const f of chord) {
        tone(s, t + at[i], { wave: 'warm', f, a: 0.04, hold: last ? 0.9 : 0.3, d: last ? 1.6 : 0.5, g: 0.1, lp: 2200, wet: 0.3 });
      }
      tone(s, t + at[i], { wave: 'sine', f: bass[i], a: 0.02, hold: last ? 0.8 : 0.3, d: last ? 1 : 0.35, g: 0.3 });
    });
    const melody: [number, number][] = [
      [0, 880],
      [0.21, 783.99],
      [0.42, 987.77],
      [0.63, 880],
      [0.84, 1046.5],
    ];
    for (const [dt, f] of melody) bell(s, t + dt, { f, ratio: 2, index: 0.8, d: dt === 0.84 ? 1.8 : 0.7, g: 0.26, wet: 0.35 });
    bell(s, t + 1.1, { f: 1567.98, ratio: 3, index: 0.4, d: 1.2, g: 0.08, wet: 0.5 });
  },
};

/**
 * Plays one sound at time t into `bus`. Returns the time its last node stops; all its nodes are
 * disconnected automatically after that (then `onDone` is called).
 */
export function renderSfx(
  ctx: BaseAudioContext,
  bus: SendBus,
  noise: NoiseBank,
  rng: Rng,
  name: SfxName,
  t: number,
  onDone?: () => void,
): number {
  const v = new Voice(ctx);
  const level = SFX_INFO[name].level;
  const dry = v.gain(level);
  const wet = v.gain(level);
  dry.connect(bus.dry);
  wet.connect(bus.wet);
  SYNTHS[name]({ v, rng, noise, dry, wet }, t);
  return v.release(onDone);
}
