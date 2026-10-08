/**
 * Low-level WebAudio helpers shared by every synth: click-free parameter automation, shared noise and
 * impulse-response buffers, a node-group helper that disconnects everything after use, and the
 * compressor makeup-gain formula. Everything accepts any BaseAudioContext (realtime or offline).
 */
import { Rng } from './rng';

export const dbToGain = (db: number): number => 10 ** (db / 20);

// ───────────────────────────── automation ─────────────────────────────

/**
 * The last automation segment the helpers below scheduled on a param. Firefox lacks
 * cancelAndHoldAtTime, so holdAt has to know the param's value at a (future) time t itself.
 */
export type Segment =
  | { kind: 'set'; t0: number; v0: number }
  | { kind: 'linear' | 'exponential'; t0: number; v0: number; t1: number; v1: number }
  | { kind: 'target'; t0: number; v0: number; target: number; tc: number };

const segments = new WeakMap<AudioParam, Segment>();

/** Value of a segment at time t (Web Audio interpolation rules; before t0 it reads as v0). */
export function segmentValue(s: Segment, t: number): number {
  if (t <= s.t0) return s.v0;
  switch (s.kind) {
    case 'set':
      return s.v0;
    case 'target':
      return s.target + (s.v0 - s.target) * Math.exp(-(t - s.t0) / s.tc);
    case 'linear':
    case 'exponential': {
      if (t >= s.t1) return s.v1;
      const k = (t - s.t0) / (s.t1 - s.t0);
      if (s.kind === 'linear') return s.v0 + (s.v1 - s.v0) * k;
      // exponential ramps need same-sign, non-zero ends (otherwise the browser holds v0)
      return s.v0 * s.v1 > 0 ? s.v0 * (s.v1 / s.v0) ** k : s.v0;
    }
  }
}

/**
 * The param's value at time t as far as the helpers know (its current value when they know nothing,
 * e.g. for a param automated directly).
 */
export function valueAt(param: AudioParam, t: number): number {
  const s = segments.get(param);
  return s ? segmentValue(s, t) : param.value;
}

/** Jumps to v0 at t0, then ramps (linear or exponential) to v1 at t1. Remembered for holdAt. */
export function rampBetween(param: AudioParam, v0: number, t0: number, v1: number, t1: number, kind: 'linear' | 'exponential' = 'linear'): void {
  param.setValueAtTime(v0, t0);
  if (kind === 'linear') param.linearRampToValueAtTime(v1, t1);
  else param.exponentialRampToValueAtTime(v1, t1);
  segments.set(param, { kind, t0, v0, t1, v1 });
}

/**
 * Freezes a param at its automated value at time t, which may lie in the future (a chord released
 * ahead of time). Returns that value.
 *
 * Firefox lacks cancelAndHoldAtTime. There the value at t comes from the segment the helpers scheduled
 * (a pad released mid-attack is held at its ramp value at t, not at today's value), and a ramp still
 * running at t is re-scheduled to end at t: cancelScheduledValues(t) removes its end event, which would
 * otherwise snap the param back to the ramp's start value at once.
 */
export function holdAt(param: AudioParam, t: number): number {
  const seg = segments.get(param);
  const v = seg ? segmentValue(seg, t) : param.value;
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(t);
  } else {
    param.cancelScheduledValues(t);
    if (seg && (seg.kind === 'linear' || seg.kind === 'exponential') && t > seg.t0 && t <= seg.t1) {
      if (seg.kind === 'exponential' && seg.v0 * v > 0) param.exponentialRampToValueAtTime(v, t);
      else param.linearRampToValueAtTime(v, t);
    }
    param.setValueAtTime(v, t);
  }
  segments.set(param, { kind: 'set', t0: t, v0: v });
  return v;
}

/** Smoothly approaches `value` (exponential, time constant tc) starting at t. No zipper noise. */
export function glideTo(param: AudioParam, value: number, t: number, tc: number): void {
  const v0 = holdAt(param, t);
  const k = Math.max(0.001, tc);
  param.setTargetAtTime(value, t, k);
  segments.set(param, { kind: 'target', t0: t, v0, target: value, tc: k });
}

/** Linear ramp from the current value to `value`, reaching it at t + dur. */
export function fadeTo(param: AudioParam, value: number, t: number, dur: number): void {
  const v0 = holdAt(param, t);
  const t1 = t + Math.max(0.005, dur);
  param.linearRampToValueAtTime(value, t1);
  segments.set(param, { kind: 'linear', t0: t, v0, t1, v1: value });
}

/**
 * Percussive envelope: 0 → peak in `attack`, hold, then exponential decay. `decay` is the time to fall
 * ~50 dB. Returns the time when the sound is effectively silent.
 */
export function envelope(param: AudioParam, t: number, peak: number, attack: number, decay: number, hold = 0): number {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  if (hold > 0) param.setValueAtTime(peak, t + attack + hold);
  param.setTargetAtTime(0, t + attack + hold, decay / 6);
  return t + attack + hold + decay;
}

// ───────────────────────────── shared buffers ─────────────────────────────

export interface NoiseBank {
  /** Stereo, decorrelated channels, seamless loops, RMS ≈ 0.25. */
  white: AudioBuffer;
  pink: AudioBuffer;
  brown: AudioBuffer;
}

export type NoiseColor = keyof NoiseBank;

// AudioBuffers may be shared between contexts of the same sample rate (spec), so cache per rate.
const noiseCache = new Map<number, NoiseBank>();
const irCache = new Map<number, AudioBuffer>();

export function noiseBank(ctx: BaseAudioContext): NoiseBank {
  let bank = noiseCache.get(ctx.sampleRate);
  if (!bank) {
    bank = {
      white: makeNoise(ctx, 'white', 5, 11),
      pink: makeNoise(ctx, 'pink', 5, 23),
      brown: makeNoise(ctx, 'brown', 5, 37),
    };
    noiseCache.set(ctx.sampleRate, bank);
  }
  return bank;
}

function makeNoise(ctx: BaseAudioContext, color: NoiseColor, seconds: number, seed: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(seconds * sr);
  const fade = Math.floor(0.08 * sr);
  const buf = ctx.createBuffer(2, len, sr);
  const rng = new Rng(seed);
  const raw = new Float32Array(len + fade);
  for (let ch = 0; ch < 2; ch++) {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < raw.length; i++) {
      const w = rng.next() * 2 - 1;
      if (color === 'white') {
        raw[i] = w;
      } else if (color === 'pink') {
        // Paul Kellet's refined pink filter.
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
        b6 = w * 0.115926;
      } else {
        last = 0.98 * last + 0.0196 * w; // one-pole lowpass ≈150 Hz: brown above, flat below
        raw[i] = last;
      }
    }
    const out = buf.getChannelData(ch);
    out.set(raw.subarray(0, len));
    // Seamless loop: the tail past `len` is cross-faded (equal power) into the head.
    for (let i = 0; i < fade; i++) {
      const a = i / fade;
      out[i] = raw[i] * Math.sqrt(a) + raw[len + i] * Math.sqrt(1 - a);
    }
    let mean = 0;
    for (let i = 0; i < len; i++) mean += out[i];
    mean /= len;
    let sq = 0;
    for (let i = 0; i < len; i++) {
      out[i] -= mean;
      sq += out[i] * out[i];
    }
    const scale = 0.25 / Math.sqrt(sq / len || 1);
    for (let i = 0; i < len; i++) out[i] = Math.max(-1, Math.min(1, out[i] * scale));
  }
  return buf;
}

/** Dark, diffuse stereo tail ("wet street between tall walls"), ~2.2 s RT60. Shared by all wet sends. */
export function impulseResponse(ctx: BaseAudioContext): AudioBuffer {
  let ir = irCache.get(ctx.sampleRate);
  if (ir) return ir;
  const sr = ctx.sampleRate;
  const seconds = 2.6;
  const rt60 = 2.2;
  const len = Math.floor(seconds * sr);
  ir = ctx.createBuffer(2, len, sr);
  const rng = new Rng(77);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    const pre = Math.floor((0.011 + ch * 0.004) * sr);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const env = 10 ** ((-3 * t) / rt60) * Math.min(1, t / 0.008);
      const damp = Math.min(0.94, 0.35 + t * 0.4); // the tail gets darker
      lp = lp * damp + (rng.next() * 2 - 1) * (1 - damp);
      d[i] = lp * env;
    }
    // A few early reflections off the walls.
    for (let k = 0; k < 7; k++) {
      const at = pre + Math.floor(rng.range(0.003, 0.075) * sr);
      d[at] += rng.range(-0.35, 0.35);
    }
  }
  irCache.set(ctx.sampleRate, ir);
  return ir;
}

const waveCache = new WeakMap<BaseAudioContext, PeriodicWave>();

/** Soft saw-like wave (odd harmonics a bit stronger, steep roll-off): warm pads without harsh highs. */
export function warmWave(ctx: BaseAudioContext): PeriodicWave {
  let wave = waveCache.get(ctx);
  if (!wave) {
    const n = 20;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k++) imag[k] = (k % 2 ? 1 : 0.55) / k ** 1.65;
    wave = ctx.createPeriodicWave(real, imag);
    waveCache.set(ctx, wave);
  }
  return wave;
}

// ───────────────────────────── node groups ─────────────────────────────

/**
 * Owns the nodes of one sound (a one-shot, a chord, an ambience bed). Sources are tracked so the
 * whole group can be disconnected when the last one ends — nothing lingers in the graph.
 */
export class Voice {
  private nodes: AudioNode[] = [];
  private sources: AudioScheduledSourceNode[] = [];
  /** Scheduled stop per source (Infinity = open-ended). */
  private stops: number[] = [];
  private last: AudioScheduledSourceNode | null = null;
  private lastEnd = -1;
  private released = false;

  constructor(readonly ctx: BaseAudioContext) {}

  /** Time the last source stops (−1 while open-ended). */
  get end(): number {
    return this.lastEnd;
  }

  add<T extends AudioNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }

  gain(value = 0): GainNode {
    const g = this.add(this.ctx.createGain());
    g.gain.value = value;
    return g;
  }

  filter(type: BiquadFilterType, freq: number, q = 0.707): BiquadFilterNode {
    const f = this.add(this.ctx.createBiquadFilter());
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  pan(value: number): StereoPannerNode {
    const p = this.add(this.ctx.createStereoPanner());
    p.pan.value = Math.max(-1, Math.min(1, value));
    return p;
  }

  osc(type: OscillatorType | PeriodicWave, freq: number, start: number, stop?: number): OscillatorNode {
    const o = this.ctx.createOscillator();
    // PeriodicWave is an empty interface in lib.dom, so typeof narrowing widens to string.
    if (typeof type === 'string') o.type = type as OscillatorType;
    else o.setPeriodicWave(type);
    o.frequency.value = freq;
    o.start(start);
    this.track(o, stop);
    return o;
  }

  /** Looping noise source starting at a random point of the buffer. */
  noise(buf: AudioBuffer, start: number, stop: number | undefined, rng: Rng): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start(start, rng.range(0, buf.duration * 0.95));
    this.track(s, stop);
    return s;
  }

  /** Stops every source at t at the latest (never extends an earlier stop). */
  stopAll(t: number): void {
    let end = -1;
    let last: AudioScheduledSourceNode | null = null;
    for (let i = 0; i < this.sources.length; i++) {
      if (this.stops[i] > t) {
        this.sources[i].stop(t);
        this.stops[i] = t;
      }
      if (this.stops[i] >= end) {
        end = this.stops[i];
        last = this.sources[i];
      }
    }
    this.lastEnd = end;
    if (last) this.last = last;
  }

  /** Disconnects every node once the last source has ended. Returns the end time. */
  release(onDone?: () => void): number {
    if (this.released) return this.lastEnd;
    this.released = true;
    const last = this.last;
    if (!last) {
      this.disconnect();
      onDone?.();
      return this.lastEnd;
    }
    last.onended = () => {
      last.onended = null;
      this.disconnect();
      onDone?.();
    };
    return this.lastEnd;
  }

  /** Immediate teardown (dispose). */
  disconnect(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    for (const n of this.nodes) n.disconnect();
    this.nodes.length = 0;
    this.sources.length = 0;
    this.stops.length = 0;
  }

  private track(s: AudioScheduledSourceNode, stop: number | undefined): void {
    this.nodes.push(s);
    this.sources.push(s);
    this.stops.push(stop ?? Infinity);
    if (stop !== undefined) {
      s.stop(stop);
      if (stop > this.lastEnd) {
        this.lastEnd = stop;
        this.last = s;
      }
    }
  }
}

// ───────────────────────────── compressor ─────────────────────────────

/**
 * Static makeup gain a DynamicsCompressorNode applies on its own (port of the Blink/WebKit kernel,
 * shared by Chrome, Firefox and Safari). Multiplying the compressor output by 1/makeup keeps the
 * chain at unity gain below the threshold, so the settings volumes mean what they say.
 */
export function compressorMakeupGain(thresholdDb: number, kneeDb: number, ratio: number): number {
  const linThreshold = dbToGain(thresholdDb);
  const slope = 1 / ratio;
  const kneeCurve = (x: number, k: number) => (x < linThreshold ? x : linThreshold + (1 - Math.exp(-k * (x - linThreshold))) / k);
  const toDb = (x: number) => 20 * Math.log10(x);
  const slopeAt = (x: number, k: number) => {
    if (x < linThreshold) return 1;
    const x2 = x * 1.001;
    return (toDb(kneeCurve(x2, k)) - toDb(kneeCurve(x, k))) / (toDb(x2) - toDb(x));
  };
  // k such that the knee ends with the ratio's slope (geometric bisection, like the kernel).
  const kneeX = dbToGain(thresholdDb + kneeDb);
  let minK = 0.1;
  let maxK = 10000;
  let k = 5;
  for (let i = 0; i < 15; i++) {
    if (slopeAt(kneeX, k) < slope) maxK = k;
    else minK = k;
    k = Math.sqrt(minK * maxK);
  }
  const kneeThresholdDb = thresholdDb + kneeDb;
  const kneeThreshold = dbToGain(kneeThresholdDb);
  const yKneeDb = toDb(kneeCurve(kneeThreshold, k));
  const saturate = (x: number) => (x < kneeThreshold ? kneeCurve(x, k) : dbToGain(yKneeDb + slope * (toDb(x) - kneeThresholdDb)));
  return (1 / saturate(1)) ** 0.6;
}
