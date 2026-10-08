/**
 * Synth primitives shared by one-shots, ambience events and the music: blip tone, FM bell, filtered
 * noise burst, thump and relay click. Using the same few building blocks everywhere keeps every sound
 * in one family. All of them schedule into a Voice, which disconnects its nodes after use.
 */
import { envelope, type NoiseBank, type NoiseColor, Voice, warmWave } from './dsp';
import type { Rng } from './rng';

/** Destination of a sound: dry signal and the reverb send of its category. */
export interface SendBus {
  dry: AudioNode;
  wet: AudioNode;
}

/** Scheduling context of one sound. */
export interface Synth {
  v: Voice;
  rng: Rng;
  noise: NoiseBank;
  dry: AudioNode;
  wet: AudioNode;
}

export function route(s: Synth, node: AudioNode, pan = 0, wet = 0): void {
  let out = node;
  if (pan !== 0) {
    const p = s.v.pan(pan);
    out.connect(p);
    out = p;
  }
  out.connect(s.dry);
  if (wet > 0) {
    const send = s.v.gain(wet);
    out.connect(send);
    send.connect(s.wet);
  }
}

export interface ToneOpts {
  wave?: OscillatorType | 'warm';
  f: number;
  /** Glide target frequency (exponential). */
  to?: number;
  glide?: number;
  a?: number;
  hold?: number;
  /** Decay time (~50 dB). */
  d: number;
  g: number;
  lp?: number;
  q?: number;
  pan?: number;
  wet?: number;
}

/** Oscillator blip with an optional pitch glide and lowpass. */
export function tone(s: Synth, t: number, o: ToneOpts): void {
  const a = o.a ?? 0.004;
  const end = t + a + (o.hold ?? 0) + o.d;
  const osc = s.v.osc(o.wave === 'warm' ? warmWave(s.v.ctx) : (o.wave ?? 'sine'), o.f, t, end + 0.02);
  if (o.to) {
    osc.frequency.setValueAtTime(o.f, t);
    osc.frequency.exponentialRampToValueAtTime(o.to, t + (o.glide ?? o.d * 0.5));
  }
  let node: AudioNode = osc;
  if (o.lp) {
    const f = s.v.filter('lowpass', o.lp, o.q ?? 0.707);
    node.connect(f);
    node = f;
  }
  const g = s.v.gain(0);
  envelope(g.gain, t, o.g, a, o.d, o.hold ?? 0);
  node.connect(g);
  route(s, g, o.pan, o.wet);
}

export interface BellOpts {
  f: number;
  /** Modulator : carrier ratio. 1 = round, 2 = warm e-piano, 3 = glassy, 2.76 = metallic. */
  ratio?: number;
  /** FM index at the strike (decays quickly, leaving a near-sine tail). */
  index?: number;
  a?: number;
  d: number;
  g: number;
  pan?: number;
  wet?: number;
}

/** Two-operator FM bell / glass tone. */
export function bell(s: Synth, t: number, o: BellOpts): void {
  const a = o.a ?? 0.003;
  const end = t + a + o.d + 0.02;
  const car = s.v.osc('sine', o.f, t, end);
  const mod = s.v.osc('sine', o.f * (o.ratio ?? 2), t, end);
  const depth = s.v.gain(0);
  const peak = o.f * (o.index ?? 1);
  depth.gain.setValueAtTime(peak, t);
  depth.gain.setTargetAtTime(peak * 0.06, t, o.d * 0.15);
  mod.connect(depth);
  depth.connect(car.frequency);
  const g = s.v.gain(0);
  envelope(g.gain, t, o.g, a, o.d);
  car.connect(g);
  route(s, g, o.pan, o.wet);
}

export interface HissOpts {
  color?: NoiseColor;
  type?: BiquadFilterType;
  f: number;
  to?: number;
  glide?: number;
  q?: number;
  a?: number;
  hold?: number;
  d: number;
  g: number;
  pan?: number;
  wet?: number;
}

/** Filtered noise burst. */
export function hiss(s: Synth, t: number, o: HissOpts): void {
  const a = o.a ?? 0.002;
  const end = t + a + (o.hold ?? 0) + o.d;
  const src = s.v.noise(s.noise[o.color ?? 'white'], t, end + 0.02, s.rng);
  const f = s.v.filter(o.type ?? 'bandpass', o.f, o.q ?? 1);
  if (o.to) {
    f.frequency.setValueAtTime(o.f, t);
    f.frequency.exponentialRampToValueAtTime(o.to, t + (o.glide ?? o.d));
  }
  const g = s.v.gain(0);
  envelope(g.gain, t, o.g, a, o.d, o.hold ?? 0);
  src.connect(f);
  f.connect(g);
  route(s, g, o.pan, o.wet);
}

/** Low sine with a fast pitch drop: CRT thunk, latch, heavy clunk. */
export function thump(s: Synth, t: number, o: { f: number; to: number; d: number; g: number; wet?: number; pan?: number }): void {
  tone(s, t, { wave: 'sine', f: o.f, to: o.to, glide: o.d * 0.35, a: 0.002, d: o.d, g: o.g, wet: o.wet, pan: o.pan });
}

/** Relay "click-clack": two tiny band-passed ticks. */
export function click(s: Synth, t: number, g: number, f = 3000, pan = 0): void {
  hiss(s, t, { type: 'bandpass', f, q: 2.5, a: 0.0006, d: 0.014, g, pan });
  hiss(s, t + 0.011 + s.rng.range(0, 0.004), { type: 'bandpass', f: f * 0.72, q: 2.5, a: 0.0006, d: 0.012, g: g * 0.55, pan });
}

const VOWELS: readonly (readonly [number, number])[] = [
  [730, 1090],
  [530, 1840],
  [420, 1500],
  [570, 840],
  [330, 900],
  [640, 1500],
];

/**
 * Robot-speech syllable: a buzzy source through two vowel formants with a small pitch fall.
 * `lp` darkens it for far-away chatter.
 */
export function syllable(s: Synth, t: number, o: { f: number; dur: number; g: number; lp?: number; pan?: number; wet?: number }): void {
  const r = s.rng;
  const [f1, f2] = r.pick(VOWELS);
  const osc = s.v.osc('sawtooth', o.f, t, t + o.dur + 0.03);
  osc.frequency.setValueAtTime(o.f * r.range(1, 1.1), t);
  osc.frequency.exponentialRampToValueAtTime(o.f * r.range(0.86, 0.98), t + o.dur);
  const b1 = s.v.filter('bandpass', f1, 5);
  const b2 = s.v.filter('bandpass', f2, 7);
  const g2 = s.v.gain(0.5);
  const env = s.v.gain(0);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(o.g, t + 0.006);
  env.gain.setValueAtTime(o.g, t + Math.max(0.008, o.dur - 0.02));
  env.gain.linearRampToValueAtTime(0, t + o.dur);
  osc.connect(b1);
  osc.connect(b2);
  b2.connect(g2);
  let out: AudioNode = env;
  if (o.lp) {
    const lp = s.v.filter('lowpass', o.lp, 0.7);
    env.connect(lp);
    out = lp;
  }
  b1.connect(env);
  g2.connect(env);
  route(s, out, o.pan, o.wet);
}
