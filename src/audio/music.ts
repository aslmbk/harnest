/**
 * Generative score: a slow warm pad with a soft bass under it and a sparse glassy arpeggio / melodic
 * phrase layer on top. Chords follow a weighted walk through the level's mode (no fixed loop), chord
 * lengths and the arp pattern change per chord, and a slow "intensity" random walk thins or fills the
 * texture over minutes. Everything is scheduled ahead by tick(until) on an integer step grid.
 */
import { fadeTo, glideTo, type NoiseBank, rampBetween, Voice, warmWave } from './dsp';
import type { MusicProfile } from './profiles';
import type { Rng } from './rng';
import { bell, type SendBus, type Synth } from './synth';
import {
  BRIGHTER,
  type ChordColor,
  chordPitchClasses,
  degreeToMidi,
  midiToHz,
  type ModeName,
  nextDegree,
  notesInRange,
  pickColor,
  scaleStep,
  voiceChord,
} from './theory';

/** Music category inputs: dry, reverb send and the tempo echo. */
export interface MusicBus extends SendBus {
  echo: AudioNode;
}

// Registers (MIDI) and levels (balanced with scripts/audio-check.mjs).
const PAD = { low: 52, high: 71, level: 0.032, wet: 0.45 };
const ARP = { low: 64, high: 81, bright: 5, level: 0.22, wet: 0.45, echo: 0.32 };
const BASS = { low: 36, level: 0.055 };
/** Chord lengths in eighth-note steps. */
const CHORD_STEPS = [12, 16, 16, 20, 24];

type Pattern =
  | { kind: 'rest'; lead: boolean }
  | { kind: 'sparse'; p: number }
  | { kind: 'arp'; notes: number[]; start: number; every: number }
  | { kind: 'phrase'; at: number[]; notes: number[] };

interface Held {
  v: Voice;
  g: GainNode;
}

export class MusicGen {
  private readonly v: Voice;
  private readonly out: GainNode;
  private readonly wetOut: GainNode;
  private readonly echoOut: GainNode;
  private readonly arpIn: GainNode;
  private readonly step: number;
  private readonly t0: number;
  private readonly live = new Set<Voice>();

  private stepIdx = 0;
  private chordIdx = 0;
  private chordStartIdx = 0;
  private degree = 0;
  private sinceTonic = 0;
  private first = true;
  private forceHome = false;
  private voicing: number[] | null = null;
  private chordPcs: number[] = [];
  private pad: Held | null = null;
  private bass: Held | null = null;
  private pattern: Pattern = { kind: 'rest', lead: false };
  private intensity = 0.6;
  private lastNote = 0;
  private stopped = false;
  private endTime = Infinity;

  constructor(
    private readonly ctx: BaseAudioContext,
    target: MusicBus,
    private readonly noise: NoiseBank,
    private readonly profile: MusicProfile,
    private readonly rng: Rng,
    t0: number,
    fade: number,
    private bright: boolean,
  ) {
    const v = (this.v = new Voice(ctx));
    this.step = 30 / profile.bpm; // eighth notes
    this.t0 = t0;
    this.out = v.gain(0);
    this.wetOut = v.gain(0);
    this.echoOut = v.gain(0);
    this.out.connect(target.dry);
    this.wetOut.connect(target.wet);
    this.echoOut.connect(target.echo);
    for (const g of [this.out.gain, this.wetOut.gain, this.echoOut.gain]) rampBetween(g, 0, t0, 1, t0 + Math.max(0.02, fade));
    this.arpIn = v.gain(1);
    this.arpIn.connect(this.out);
    const echoSend = v.gain(ARP.echo);
    this.arpIn.connect(echoSend);
    echoSend.connect(this.echoOut);
  }

  get end(): number {
    return this.endTime;
  }

  tick(until: number): void {
    if (this.stopped) return;
    // After a stall (throttled timers), skip ahead instead of bursting missed notes.
    const stale = Math.floor((this.ctx.currentTime - 0.2 - this.t0) / this.step);
    if (stale > this.stepIdx) {
      this.stepIdx = stale;
      if (this.chordIdx < stale) this.chordIdx = stale;
    }
    for (;;) {
      const t = this.t0 + this.stepIdx * this.step;
      if (t >= until) break;
      if (this.stepIdx >= this.chordIdx) this.startChord(t);
      this.stepAt(t, this.stepIdx - this.chordStartIdx);
      this.stepIdx++;
    }
  }

  /** Brighter variation (gate opened): brighter mode, higher arps, more notes, open filter. */
  setBright(on: boolean, t: number): void {
    if (on === this.bright) return;
    this.bright = on;
    this.cutChord(t);
  }

  /** A short rising answer in the arp voice on the first grid step after t (chip collected). */
  flourish(t: number): void {
    if (this.stopped) return;
    this.playFlourish(this.t0 + Math.ceil((t - this.t0) / this.step) * this.step);
  }

  /** Resolve home: the next chord is the tonic, bright (level completed). */
  resolveHome(t: number): void {
    this.forceHome = true;
    this.bright = true;
    this.cutChord(t);
  }

  stop(t: number, fade: number): number {
    if (this.stopped) return this.endTime;
    this.stopped = true;
    for (const g of [this.out.gain, this.wetOut.gain, this.echoOut.gain]) fadeTo(g, 0, t, fade);
    this.releaseHeld(this.pad, t, fade);
    this.releaseHeld(this.bass, t, fade);
    this.pad = this.bass = null;
    this.endTime = t + fade + 0.1;
    for (const v of this.live) v.stopAll(this.endTime);
    return this.endTime;
  }

  dispose(): void {
    this.stopped = true;
    for (const v of this.live) v.disconnect();
    this.live.clear();
    this.v.disconnect();
    this.endTime = 0;
  }

  // ───────────────────────────── harmony ─────────────────────────────

  private mode(): ModeName {
    return this.bright ? BRIGHTER[this.profile.mode] : this.profile.mode;
  }

  private arpRange(): [number, number] {
    const shift = this.bright ? ARP.bright : 0;
    return [ARP.low + shift, ARP.high + shift];
  }

  private density(): number {
    return this.profile.density * this.intensity * (this.bright ? 1.35 : 1);
  }

  /** Brings the next chord change forward to the next step after t. */
  private cutChord(t: number): void {
    const k = Math.max(this.stepIdx, Math.ceil((t + this.step - this.t0) / this.step));
    if (k < this.chordIdx) this.chordIdx = k;
  }

  private startChord(t: number): void {
    const r = this.rng;
    const mode = this.mode();
    let color: ChordColor;
    if (this.first || this.forceHome) {
      this.degree = 0;
      color = this.forceHome ? 'add9' : r.pick<ChordColor>(['add9', 'seventh', 'open5']);
      this.first = this.forceHome = false;
    } else {
      this.degree = nextDegree(r, mode, this.degree, this.sinceTonic);
      color = pickColor(r);
    }
    this.sinceTonic = this.degree === 0 ? 0 : this.sinceTonic + 1;
    this.chordPcs = chordPitchClasses(this.profile.root, mode, this.degree, color);
    this.voicing = voiceChord(this.chordPcs, this.voicing, PAD.low, PAD.high);
    this.intensity = Math.min(1, Math.max(0.25, this.intensity + r.range(-0.25, 0.25)));

    const len = r.pick(CHORD_STEPS);
    this.chordStartIdx = this.stepIdx;
    this.chordIdx = this.stepIdx + len;

    this.releaseHeld(this.pad, t, r.range(3.5, 5.5));
    this.pad = this.padVoice(t, this.voicing);
    this.releaseHeld(this.bass, t, r.range(2.5, 4));
    this.bass = null;
    if (r.chance(0.7)) {
      let m = degreeToMidi(this.profile.root, mode, this.degree);
      while (m >= BASS.low + 12) m -= 12;
      while (m < BASS.low) m += 12;
      this.bass = this.bassVoice(t, m);
    }
    this.pattern = this.pickPattern();
  }

  private padVoice(t: number, notes: number[]): Held {
    const r = this.rng;
    const v = new Voice(this.ctx);
    const attack = r.range(2.2, 3.6);
    const g = v.gain(0);
    rampBetween(g.gain, 0, t, PAD.level, t + attack);
    // The filter opens slowly with the swell ("breathing").
    const cutoff = (this.bright ? 1500 : 1000) * r.range(0.85, 1.15);
    const lp = v.filter('lowpass', cutoff * 0.55, 0.5);
    lp.frequency.setValueAtTime(cutoff * 0.55, t);
    lp.frequency.setTargetAtTime(cutoff, t, attack);
    const left = v.pan(-0.35);
    const right = v.pan(0.35);
    const wave = warmWave(this.ctx);
    for (const m of notes) {
      const f = midiToHz(m);
      const a = v.osc(wave, f, t);
      a.detune.value = -r.range(4, 9);
      a.connect(left);
      const b = v.osc(wave, f, t);
      b.detune.value = r.range(4, 9);
      b.connect(right);
    }
    left.connect(lp);
    right.connect(lp);
    lp.connect(g);
    if (this.bright && notes.length) {
      // Shimmer: a soft sine an octave above the top voice.
      const sh = v.osc('sine', midiToHz(notes[notes.length - 1] + 12), t);
      const shg = v.gain(0.3);
      sh.connect(shg);
      shg.connect(g);
    }
    g.connect(this.out);
    const send = v.gain(PAD.wet);
    g.connect(send);
    send.connect(this.wetOut);
    this.live.add(v);
    return { v, g };
  }

  private bassVoice(t: number, midi: number): Held {
    const v = new Voice(this.ctx);
    const f = midiToHz(midi);
    const g = v.gain(0);
    rampBetween(g.gain, 0, t, BASS.level, t + 1.8);
    const fundamental = v.osc('sine', f, t);
    fundamental.connect(g);
    // A little second harmonic so the bass exists on small speakers.
    const second = v.osc('triangle', f * 2, t);
    const lp = v.filter('lowpass', 380, 0.6);
    const sg = v.gain(0.22);
    second.connect(lp);
    lp.connect(sg);
    sg.connect(g);
    g.connect(this.out);
    this.live.add(v);
    return { v, g };
  }

  /**
   * Fades a pad / bass out from t. t is often ahead of now (the next chord, or a chord cut short by the
   * gate or the level end) while the voice may still be in its attack ramp: glideTo holds the ramp's value
   * at t, so the release starts where the swell is at that moment (no step, no dropped pad on Firefox).
   */
  private releaseHeld(held: Held | null, t: number, release: number): void {
    if (!held) return;
    glideTo(held.g.gain, 0, t, release / 5);
    held.v.stopAll(t + release + 0.1);
    held.v.release(() => this.live.delete(held.v));
  }

  // ───────────────────────────── melody layer ─────────────────────────────

  private pickPattern(): Pattern {
    const r = this.rng;
    const [low, high] = this.arpRange();
    const kind = r.weighted([2, 3.5, 3, 1.6]);
    if (kind === 0) return { kind: 'rest', lead: r.chance(0.35) };
    if (kind === 1) return { kind: 'sparse', p: 0.22 };
    if (kind === 2) {
      const tones = notesInRange(this.chordPcs, low, high);
      const n = r.int(Math.min(3, tones.length), Math.min(6, tones.length));
      const from = r.int(0, Math.max(0, tones.length - n));
      let notes = tones.slice(from, from + n);
      const dir = r.weighted([3, 2, 1.5]);
      if (dir === 1) notes.reverse();
      else if (dir === 2) notes = [...notes, ...notes.slice(0, -1).reverse()];
      return { kind: 'arp', notes, start: r.pick([0, 2, 4]), every: r.pick([2, 2, 3]) };
    }
    // A short melodic phrase: a random walk on the scale from a chord tone, landing on a chord tone.
    const mode = this.mode();
    const tones = notesInRange(this.chordPcs, low + 3, high - 4);
    if (!tones.length) return { kind: 'sparse', p: 0.2 };
    const n = r.int(3, 6);
    const at: number[] = [];
    const notes: number[] = [];
    let step = r.int(2, 6);
    let cur = r.pick(tones);
    for (let j = 0; j < n; j++) {
      at.push(step);
      notes.push(cur);
      step += r.pick([1, 2, 2, 3]);
      cur = scaleStep(cur, r.pick([-2, -1, -1, 1, 1, 2]), this.profile.root, mode, low, high);
    }
    const lastIdx = notes.length - 1;
    const landing = notesInRange(this.chordPcs, low, high);
    let best = landing[0] ?? notes[lastIdx];
    for (const m of landing) if (Math.abs(m - notes[lastIdx]) < Math.abs(best - notes[lastIdx])) best = m;
    notes[lastIdx] = best;
    return { kind: 'phrase', at, notes };
  }

  private stepAt(t: number, i: number): void {
    const r = this.rng;
    const jitter = r.range(-0.012, 0.012);
    const p = this.pattern;
    switch (p.kind) {
      case 'rest':
        if (p.lead && i === 2) this.pluck(t + jitter, this.arpNote(), r.range(0.4, 0.6));
        break;
      case 'sparse':
        if (r.chance(p.p * this.density())) this.pluck(t + jitter, this.arpNote(), r.range(0.45, 0.9));
        break;
      case 'arp': {
        const k = (i - p.start) / p.every;
        if (i >= p.start && Number.isInteger(k) && k < p.notes.length) this.pluck(t + jitter, p.notes[k], r.range(0.5, 0.85) * (1 - k * 0.05));
        else if (r.chance(0.05 * this.density())) this.pluck(t + jitter, this.arpNote(), r.range(0.35, 0.6));
        break;
      }
      case 'phrase': {
        const k = p.at.indexOf(i);
        if (k >= 0) this.pluck(t + jitter, p.notes[k], r.range(0.5, 0.85));
        break;
      }
    }
  }

  private arpNote(): number {
    const [low, high] = this.arpRange();
    const options = notesInRange(this.chordPcs, low, high);
    if (!options.length) return low;
    let n = this.rng.pick(options);
    if (n === this.lastNote && options.length > 1) n = this.rng.pick(options);
    this.lastNote = n;
    return n;
  }

  private playFlourish(t: number): void {
    const [low, high] = this.arpRange();
    const tones = notesInRange(this.chordPcs, low + 5, high + 5);
    const from = this.rng.int(0, Math.max(0, tones.length - 3));
    tones.slice(from, from + 3).forEach((m, k) => this.pluck(t + k * this.step * 0.5, m, 0.5 - k * 0.06));
  }

  /** Glassy FM pluck; softer FM on high notes so nothing gets shrill. */
  private pluck(t: number, midi: number, vel: number): void {
    const r = this.rng;
    const s: Synth = { v: new Voice(this.ctx), rng: r, noise: this.noise, dry: this.arpIn, wet: this.wetOut };
    const index = 0.9 * Math.min(1, Math.max(0.4, (90 - midi) / 26));
    bell(s, t, { f: midiToHz(midi), ratio: 2, index, a: 0.006, d: r.range(1.6, 2.6), g: ARP.level * vel, pan: r.range(-0.45, 0.45), wet: ARP.wet });
    this.live.add(s.v);
    s.v.release(() => this.live.delete(s.v));
  }
}
