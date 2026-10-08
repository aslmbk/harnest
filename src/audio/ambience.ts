/**
 * Ambience bed of one place: a few long-lived layers (mains hum, city rumble, machinery chug, rain,
 * wind) plus sparse random events (drips, rain ticks on metal, neon buzz, far clanks, steam, distant
 * robot chatter, data chirps). Events are scheduled ahead by tick(until) from a seeded generator, so
 * the same code renders offline. A bed fades in on creation and fades out + frees itself on stop().
 */
import { fadeTo, type NoiseBank, Voice } from './dsp';
import type { AmbienceProfile } from './profiles';
import type { Rng } from './rng';
import { bell, hiss, type SendBus, type Synth, syllable, thump, tone } from './synth';

// Layer levels (balanced with scripts/audio-check.mjs).
const L = {
  hum: 0.032,
  rumble: 0.18,
  machinery: 0.45,
  rainHiss: 0.16,
  rainBody: 0.24,
  wind: 0.3,
};

type EventKind = 'drip' | 'tick' | 'buzz' | 'clank' | 'steam' | 'chatter' | 'chirp';

/** Mean events per second at profile value 1. */
const RATE: Record<EventKind, number> = {
  drip: 0.9,
  tick: 3,
  buzz: 0.06,
  clank: 0.08,
  steam: 0.05,
  chatter: 0.07,
  chirp: 0.08,
};

const KINDS = Object.keys(RATE) as EventKind[];

export class AmbienceBed {
  private readonly v: Voice;
  private readonly out: GainNode;
  private readonly wetOut: GainNode;
  private readonly bus: SendBus;
  /** Active event streams (plain array: the scheduler loop allocates nothing). */
  private readonly streams: { kind: EventKind; rate: number; next: number }[] = [];
  private readonly live = new Set<Voice>();
  private stopped = false;
  private endTime = Infinity;

  constructor(
    private readonly ctx: BaseAudioContext,
    target: SendBus,
    private readonly noise: NoiseBank,
    private readonly p: AmbienceProfile,
    private readonly rng: Rng,
    t0: number,
    fade: number,
  ) {
    const v = (this.v = new Voice(ctx));
    this.out = v.gain(0);
    this.wetOut = v.gain(0);
    this.out.connect(target.dry);
    this.wetOut.connect(target.wet);
    this.bus = { dry: this.out, wet: this.wetOut };
    for (const g of [this.out.gain, this.wetOut.gain]) {
      g.setValueAtTime(0, t0);
      g.linearRampToValueAtTime(1, t0 + Math.max(0.02, fade));
    }
    this.buildLayers(t0);

    const rate: Record<EventKind, number> = {
      drip: p.drips,
      tick: p.rain,
      buzz: p.buzz,
      clank: p.clanks,
      steam: p.steam,
      chatter: p.chatter,
      chirp: p.chirps,
    };
    for (const kind of KINDS) {
      const r = rate[kind] * RATE[kind];
      if (r <= 0.0005) continue;
      // Rare events never fire in the first seconds; frequent ones may.
      this.streams.push({ kind, rate: r, next: t0 + Math.min(2, 0.3 / r) + rng.exp(1 / r) });
    }
  }

  /** When the bed has fully stopped (Infinity while playing). */
  get end(): number {
    return this.endTime;
  }

  tick(until: number): void {
    if (this.stopped) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < this.streams.length; i++) {
      const s = this.streams[i];
      // After a long stall (timers throttled), skip stale events instead of bursting them.
      if (s.next < now - 0.25) s.next = now + this.rng.exp(1 / s.rate);
      while (s.next < until) {
        this.event(s.kind, s.next);
        s.next += Math.max(s.kind === 'tick' ? 0.05 : 0.25, this.rng.exp(1 / s.rate));
      }
    }
  }

  stop(t: number, fade: number): number {
    if (this.stopped) return this.endTime;
    this.stopped = true;
    fadeTo(this.out.gain, 0, t, fade);
    fadeTo(this.wetOut.gain, 0, t, fade);
    this.endTime = t + fade + 0.05;
    this.v.stopAll(this.endTime);
    this.v.release();
    return this.endTime;
  }

  /** Immediate teardown. */
  dispose(): void {
    this.stopped = true;
    for (const v of this.live) v.disconnect();
    this.live.clear();
    this.v.disconnect();
    this.endTime = 0;
  }

  // ───────────────────────────── long-lived layers ─────────────────────────────

  private buildLayers(t0: number): void {
    const { v, p, rng, noise } = this;
    // Slow "breathing" LFOs shared by several layers (cheap: three oscillators for the whole bed).
    const lfoA = v.osc('sine', rng.range(0.035, 0.05), t0);
    const lfoB = v.osc('sine', rng.range(0.06, 0.085), t0);
    const lfoC = v.osc('sine', rng.range(0.022, 0.032), t0);
    const mod = (lfo: OscillatorNode, depth: number, param: AudioParam) => {
      const d = v.gain(depth);
      lfo.connect(d);
      d.connect(param);
    };

    if (p.hum > 0.01) {
      const level = p.hum * L.hum;
      const g = v.gain(level);
      const lp = v.filter('lowpass', 420, 0.7);
      const partials: [OscillatorType, number, number][] = [
        ['sine', p.humHz, 1],
        ['sine', p.humHz * 2 + 0.13, 0.6],
        ['triangle', p.humHz * 3 - 0.07, 0.2],
      ];
      for (const [type, f, amp] of partials) {
        const o = v.osc(type, f, t0);
        const og = v.gain(amp);
        o.connect(og);
        og.connect(g);
      }
      g.connect(lp);
      lp.connect(this.out);
      mod(lfoA, level * 0.3, g.gain);
    }

    if (p.rumble > 0.01) {
      const level = p.rumble * L.rumble;
      const src = v.noise(noise.brown, t0, undefined, rng);
      const lp = v.filter('lowpass', 150, 0.6);
      const g = v.gain(level);
      src.connect(lp);
      lp.connect(g);
      g.connect(this.out);
      mod(lfoB, level * 0.3, g.gain);
    }

    if (p.machinery > 0.01) {
      // Distant pump/press: band-passed noise chugging at ~1 Hz, its rate wandering slowly.
      const level = p.machinery * L.machinery;
      const src = v.noise(noise.pink, t0, undefined, rng);
      const bp = v.filter('bandpass', rng.range(170, 230), 1.6);
      const ring = v.filter('bandpass', rng.range(480, 560), 6);
      const ringG = v.gain(0.35);
      const g = v.gain(level * 0.55);
      src.connect(bp);
      bp.connect(g);
      src.connect(ring);
      ring.connect(ringG);
      ringG.connect(g);
      g.connect(this.out);
      const chug = v.osc('triangle', rng.range(0.9, 1.5), t0);
      mod(chug, level * 0.45, g.gain);
      mod(lfoA, 0.18, chug.frequency);
    }

    if (p.rain > 0.02) {
      // Near hiss (decorrelated stereo) + darker body of rain on the ground, both gusting slowly.
      const hissSrc = v.noise(noise.white, t0, undefined, rng);
      const hp = v.filter('highpass', 900, 0.5);
      const lp = v.filter('lowpass', 5200, 0.5);
      const hissLevel = p.rain * L.rainHiss;
      const hissG = v.gain(hissLevel);
      hissSrc.connect(hp);
      hp.connect(lp);
      lp.connect(hissG);
      hissG.connect(this.out);
      mod(lfoB, hissLevel * 0.25, hissG.gain);

      const bodySrc = v.noise(noise.pink, t0, undefined, rng);
      const bp = v.filter('bandpass', 1300, 0.45);
      const bodyLevel = p.rain * L.rainBody;
      const bodyG = v.gain(bodyLevel);
      bodySrc.connect(bp);
      bp.connect(bodyG);
      bodyG.connect(this.out);
      mod(lfoC, bodyLevel * 0.2, bodyG.gain);
    }

    if (p.wind > 0.02) {
      const level = p.wind * L.wind;
      const src = v.noise(noise.pink, t0, undefined, rng);
      const bp = v.filter('bandpass', 420, 0.9);
      const g = v.gain(level);
      src.connect(bp);
      bp.connect(g);
      g.connect(this.out);
      mod(lfoC, 220, bp.frequency);
      mod(lfoC, level * 0.45, g.gain);
    }
  }

  // ───────────────────────────── events ─────────────────────────────

  private event(kind: EventKind, t: number): void {
    const s: Synth = { v: new Voice(this.ctx), rng: this.rng, noise: this.noise, dry: this.bus.dry, wet: this.bus.wet };
    const r = this.rng;
    switch (kind) {
      case 'drip': {
        // Water drop: a tiny sine chirping upward.
        const f = r.range(650, 1500);
        tone(s, t, { wave: 'sine', f, to: f * r.range(1.5, 2.1), glide: 0.025, a: 0.001, d: 0.09, g: 0.09 * r.range(0.35, 1), pan: r.range(-0.8, 0.8), wet: 0.45 });
        break;
      }
      case 'tick': {
        // Rain hitting metal close by.
        hiss(s, t, { type: 'bandpass', f: r.range(2500, 5500), q: 4, a: 0.0006, d: 0.014, g: 0.25 * r.range(0.3, 1), pan: r.range(-0.9, 0.9), wet: 0.15 });
        break;
      }
      case 'buzz': {
        // A neon tube complaining: 100/120 Hz buzz through a soft band, flickering.
        const dur = r.range(0.5, 2.4);
        const end = t + dur;
        const saw = s.v.osc('sawtooth', this.p.humHz * 2, t, end + 0.05);
        const bp = s.v.filter('bandpass', r.range(1500, 2400), 0.9);
        const g = s.v.gain(0);
        const peak = 0.15 * r.range(0.5, 1);
        g.gain.setValueAtTime(0, t);
        for (let x = t; x < end; x += r.range(0.025, 0.14)) g.gain.setTargetAtTime(r.chance(0.72) ? peak * r.range(0.5, 1) : 0, x, 0.004);
        g.gain.setTargetAtTime(0, end, 0.01);
        saw.connect(bp);
        bp.connect(g);
        const pan = s.v.pan(r.range(-0.7, 0.7));
        g.connect(pan);
        pan.connect(s.dry);
        const send = s.v.gain(0.3);
        pan.connect(send);
        send.connect(s.wet);
        break;
      }
      case 'clank': {
        // Something metal, far away: mostly reverb.
        const pan = r.range(-0.8, 0.8);
        bell(s, t, { f: r.range(110, 260), ratio: r.pick([2.76, 3.53, 1.41]), index: 2, d: r.range(0.8, 1.5), g: 0.06, pan, wet: 0.9 });
        thump(s, t, { f: 90, to: 45, d: 0.2, g: 0.08, wet: 0.8, pan });
        break;
      }
      case 'steam': {
        hiss(s, t, { type: 'highpass', f: 2400, to: 1300, glide: 1.5, a: 0.15, hold: r.range(0.5, 1.8), d: 0.8, g: 0.09, pan: r.range(-0.6, 0.6), wet: 0.3 });
        break;
      }
      case 'chatter': {
        // Two robots talking somewhere down the street.
        const n = r.int(3, 7);
        const pan = r.range(-0.8, 0.8);
        const base = r.range(150, 260);
        let x = t;
        for (let i = 0; i < n; i++) {
          syllable(s, x, { f: base * 2 ** (r.pick([0, 2, 4, 7]) / 12), dur: r.range(0.05, 0.09), g: 0.2, lp: 900, pan, wet: 0.5 });
          x += r.range(0.08, 0.16) + (r.chance(0.2) ? 0.25 : 0);
        }
        break;
      }
      case 'chirp': {
        // Data bleeps from a stall.
        const n = r.int(2, 5);
        const pan = r.range(-0.7, 0.7);
        for (let i = 0; i < n; i++) {
          tone(s, t + i * r.range(0.06, 0.09), { wave: 'sine', f: r.pick([1046.5, 1174.7, 1396.9, 1568, 1760]), a: 0.003, d: 0.06, g: 0.06, pan, wet: 0.6 });
        }
        break;
      }
    }
    this.live.add(s.v);
    s.v.release(() => this.live.delete(s.v));
  }
}
