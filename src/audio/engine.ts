/**
 * The audio engine: the mixer graph and everything that plays through it, on any BaseAudioContext
 * (the live AudioContext, or an OfflineAudioContext in checks).
 *
 *   music voices ─ musicState(duck) ─ tone LP ─ musicVol ─┐
 *   ambience bed ─ ambState ─────────────┐                │
 *   one-shots ──── sfxIn ────────────────┼─ fxVol ────────┼─ master ─ comp ─ trim ─ limiter ─ trim ─ out
 *   motor ──────── motorState ───────────┘                │
 *   wet sends (per category, scaled by the same volumes) ─ reverb ─┘
 *
 * Settings volumes: master → master, music → musicVol, sfx → fxVol (ambience, one-shots, motor).
 */
import type { SfxName } from '../core/events';
import { AmbienceBed } from './ambience';
import { compressorMakeupGain, glideTo, holdAt, impulseResponse, type NoiseBank, noiseBank } from './dsp';
import { Motor } from './motor';
import { type MusicBus, MusicGen } from './music';
import { type AudioScene, type StateMix, volumeCurve } from './profiles';
import { Rng } from './rng';
import { renderSfx, SFX_INFO } from './sfx';
import type { SendBus } from './synth';

export interface Volumes {
  master: number;
  music: number;
  sfx: number;
}

/** How far ahead generative content is scheduled (s). Larger than a throttled timer period. */
export const LOOKAHEAD = 1.5;
/** One-shot voice budget: above SOFT low-priority sounds are dropped, above HARD normal ones too. */
const SFX_SOFT = 14;
const SFX_HARD = 24;

const COMP = { threshold: -16, knee: 12, ratio: 2, attack: 0.01, release: 0.25 };
const LIMIT = { threshold: -3, knee: 1, ratio: 20, attack: 0.001, release: 0.08 };

export interface MasterChain {
  input: GainNode;
  output: AudioNode;
  nodes: AudioNode[];
}

/**
 * Gentle glue compressor + peak limiter. Both compressors' automatic makeup gain is cancelled, so
 * the chain is unity gain below threshold and only ever turns loud peaks down.
 */
export function buildMasterChain(ctx: BaseAudioContext, destination: AudioNode): MasterChain {
  const input = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  const lim = ctx.createDynamicsCompressor();
  for (const [node, p] of [
    [comp, COMP],
    [lim, LIMIT],
  ] as const) {
    node.threshold.value = p.threshold;
    node.knee.value = p.knee;
    node.ratio.value = p.ratio;
    node.attack.value = p.attack;
    node.release.value = p.release;
  }
  const compTrim = ctx.createGain();
  compTrim.gain.value = 1 / compressorMakeupGain(COMP.threshold, COMP.knee, COMP.ratio);
  const limTrim = ctx.createGain();
  limTrim.gain.value = 1 / compressorMakeupGain(LIMIT.threshold, LIMIT.knee, LIMIT.ratio);
  input.connect(comp);
  comp.connect(compTrim);
  compTrim.connect(lim);
  lim.connect(limTrim);
  limTrim.connect(destination);
  return { input, output: limTrim, nodes: [input, comp, compTrim, lim, limTrim] };
}

function setParam(param: AudioParam, value: number, t: number, tc: number): void {
  if (tc <= 0) {
    holdAt(param, t);
    param.setValueAtTime(value, t);
  } else {
    glideTo(param, value, t, tc);
  }
}

interface Dying {
  readonly end: number;
  dispose(): void;
}

export interface EngineStats {
  scene: string | null;
  sfxVoices: number;
  motor: boolean;
  fading: number;
}

export class AudioEngine {
  readonly ctx: BaseAudioContext;
  /** Last node before the destination (for meters). */
  readonly output: AudioNode;

  private readonly noise: NoiseBank;
  private readonly rng: Rng;
  private readonly nodes: AudioNode[] = [];
  private readonly master: GainNode;
  private readonly musicState: GainNode;
  private readonly musicStateWet: GainNode;
  private readonly musicVol: GainNode;
  private readonly musicVolWet: GainNode;
  private readonly ambState: GainNode;
  private readonly ambStateWet: GainNode;
  private readonly motorState: GainNode;
  private readonly fxVol: GainNode;
  private readonly fxVolWet: GainNode;
  private readonly echoDelay: DelayNode;
  private readonly musicBus: MusicBus;
  private readonly ambBus: SendBus;
  private readonly sfxBus: SendBus;
  private readonly motor: Motor;

  private bed: AmbienceBed | null = null;
  private music: MusicGen | null = null;
  private sceneId: string | null = null;
  private readonly dying: Dying[] = [];
  private bright = false;
  private volumes: Volumes = { master: 0.8, music: 0.6, sfx: 0.8 };
  private mix: StateMix = { ambience: 0, music: 0, motor: 0 };
  private hidden = false;
  private disposed = false;
  private sfxVoices = 0;
  private readonly sfxCount = new Map<SfxName, number>();
  private readonly sfxLast = new Map<SfxName, number>();

  /**
   * @param opts.seed       PRNG seed (fixed in checks for reproducible renders)
   * @param opts.destination where the master chain ends (default ctx.destination)
   * @param opts.raw        bypass compressor + limiter (checks: prove sounds do not rely on them)
   */
  constructor(ctx: BaseAudioContext, opts: { seed?: number; destination?: AudioNode; raw?: boolean } = {}) {
    this.ctx = ctx;
    this.rng = new Rng(opts.seed ?? 1);
    this.noise = noiseBank(ctx);
    const gain = (value: number, to?: AudioNode) => {
      const g = ctx.createGain();
      g.gain.value = value;
      if (to) g.connect(to);
      this.nodes.push(g);
      return g;
    };

    const destination = opts.destination ?? ctx.destination;
    const chain = opts.raw ? null : buildMasterChain(ctx, destination);
    if (chain) this.nodes.push(...chain.nodes);
    this.master = gain(volumeCurve(this.volumes.master), chain ? chain.input : destination);
    this.output = chain ? chain.output : this.master;

    // One shared reverb for every category ("the wet street").
    const reverbIn = gain(1);
    const reverb = ctx.createConvolver();
    reverb.buffer = impulseResponse(ctx);
    reverbIn.connect(reverb);
    reverb.connect(this.master);
    this.nodes.push(reverb);

    // Music: soft top end, ducked by game state, then the music volume.
    this.musicVol = gain(volumeCurve(this.volumes.music), this.master);
    this.musicVolWet = gain(volumeCurve(this.volumes.music), reverbIn);
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 4500;
    tone.Q.value = 0.5;
    tone.connect(this.musicVol);
    this.nodes.push(tone);
    this.musicState = gain(0, tone);
    this.musicStateWet = gain(0, this.musicVolWet);

    // Tempo echo for the arp voice (feedback through a darkening lowpass).
    const echoIn = gain(1);
    this.echoDelay = ctx.createDelay(2);
    this.echoDelay.delayTime.value = 0.7;
    const echoLp = ctx.createBiquadFilter();
    echoLp.type = 'lowpass';
    echoLp.frequency.value = 2000;
    const feedback = gain(0.33);
    echoIn.connect(this.echoDelay);
    this.echoDelay.connect(echoLp);
    echoLp.connect(feedback);
    feedback.connect(this.echoDelay);
    const echoOut = gain(0.55, this.musicState);
    echoLp.connect(echoOut);
    this.nodes.push(this.echoDelay, echoLp);
    this.musicBus = { dry: this.musicState, wet: this.musicStateWet, echo: echoIn };

    // Ambience + one-shots + motor share the sfx volume.
    this.fxVol = gain(volumeCurve(this.volumes.sfx), this.master);
    this.fxVolWet = gain(volumeCurve(this.volumes.sfx), reverbIn);
    this.ambState = gain(0, this.fxVol);
    this.ambStateWet = gain(0, this.fxVolWet);
    this.ambBus = { dry: this.ambState, wet: this.ambStateWet };
    this.sfxBus = { dry: gain(1, this.fxVol), wet: gain(1, this.fxVolWet) };
    this.motorState = gain(0, this.fxVol);
    this.motor = new Motor(ctx, this.motorState, this.noise, this.rng.fork());
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  stats(): EngineStats {
    return { scene: this.sceneId, sfxVoices: this.sfxVoices, motor: this.motor.active, fading: this.dying.length };
  }

  /** Settings volumes (0..1 sliders). Smoothly ramped unless `immediate`. */
  setVolumes(v: Volumes, immediate = false): void {
    this.volumes = { master: v.master, music: v.music, sfx: v.sfx };
    const t = this.now;
    const tc = immediate ? 0 : 0.06;
    setParam(this.master.gain, this.hidden ? 0 : volumeCurve(v.master), t, tc);
    setParam(this.musicVol.gain, volumeCurve(v.music), t, tc);
    setParam(this.musicVolWet.gain, volumeCurve(v.music), t, tc);
    setParam(this.fxVol.gain, volumeCurve(v.sfx), t, tc);
    setParam(this.fxVolWet.gain, volumeCurve(v.sfx), t, tc);
  }

  /** Per-state levels (ducking, pause, motor mute). */
  setStateMix(mix: StateMix, immediate = false): void {
    const t = this.now;
    const musicTc = immediate ? 0 : mix.music < this.mix.music ? 0.25 : 0.8;
    const ambTc = immediate ? 0 : 0.5;
    const motorTc = immediate ? 0 : mix.motor > this.mix.motor ? 0.15 : 0.06;
    this.mix = { ...mix };
    setParam(this.musicState.gain, mix.music, t, musicTc);
    setParam(this.musicStateWet.gain, mix.music, t, musicTc);
    setParam(this.ambState.gain, mix.ambience, t, ambTc);
    setParam(this.ambStateWet.gain, mix.ambience, t, ambTc);
    setParam(this.motorState.gain, mix.motor, t, motorTc);
  }

  /** Quick fade before the context is suspended (tab hidden), back up when visible. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    glideTo(this.master.gain, hidden ? 0 : volumeCurve(this.volumes.master), this.now, hidden ? 0.015 : 0.12);
  }

  /** Cross-fades ambience and music to another place. Same scene id = no-op. */
  setScene(scene: AudioScene | null, fade = 2.5): void {
    const id = scene?.id ?? null;
    if (id === this.sceneId) return;
    this.sceneId = id;
    const t = this.now;
    if (this.bed) {
      this.bed.stop(t, fade);
      this.dying.push(this.bed);
      this.bed = null;
    }
    if (this.music) {
      this.music.stop(t, fade);
      this.dying.push(this.music);
      this.music = null;
    }
    if (!scene) return;
    this.bed = new AmbienceBed(this.ctx, this.ambBus, this.noise, scene.ambience, this.rng.fork(), t, fade);
    this.music = new MusicGen(this.ctx, this.musicBus, this.noise, scene.music, this.rng.fork(), t + 0.05, fade, this.bright);
    glideTo(this.echoDelay.delayTime, 45 / scene.music.bpm, t, 0.4); // dotted eighth
    this.tick();
  }

  /** Brighter musical variation (gate open). */
  setBright(on: boolean): void {
    if (on === this.bright) return;
    this.bright = on;
    this.music?.setBright(on, this.now);
  }

  /** The music answers with a small rising figure (after a chip pickup). */
  flourish(): void {
    this.music?.flourish(this.now + 0.6);
  }

  /** Level done: resolve home to a bright tonic. */
  resolve(): void {
    this.bright = true;
    this.music?.resolveHome(this.now);
  }

  setMotor(speed: number): void {
    this.motor.setSpeed(speed, this.now);
  }

  /** Plays a one-shot (at `when`, default now). Returns false when it was skipped by the budget. */
  playSfx(name: SfxName, when?: number): boolean {
    if (this.disposed) return false;
    const info = SFX_INFO[name];
    if (!info) return false;
    const t = Math.max(when ?? 0, this.now + 0.01);
    if (t - (this.sfxLast.get(name) ?? -Infinity) < info.minGap) return false;
    const count = this.sfxCount.get(name) ?? 0;
    if (count >= info.maxVoices) return false;
    if (info.priority === 0 && this.sfxVoices >= SFX_SOFT) return false;
    if (info.priority === 1 && this.sfxVoices >= SFX_HARD) return false;
    this.sfxLast.set(name, t);
    this.sfxCount.set(name, count + 1);
    this.sfxVoices++;
    renderSfx(this.ctx, this.sfxBus, this.noise, this.rng, name, t, () => {
      this.sfxVoices--;
      this.sfxCount.set(name, (this.sfxCount.get(name) ?? 1) - 1);
    });
    return true;
  }

  /** Schedules generative content up to `until` and frees finished parts. Call a few times a second. */
  tick(until = this.now + LOOKAHEAD): void {
    if (this.disposed) return;
    const now = this.now;
    this.bed?.tick(until);
    this.music?.tick(until);
    this.motor.tick(now);
    for (let i = this.dying.length - 1; i >= 0; i--) {
      if (this.dying[i].end < now) {
        this.dying[i].dispose();
        this.dying.splice(i, 1);
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.bed?.dispose();
    this.music?.dispose();
    for (const d of this.dying) d.dispose();
    this.dying.length = 0;
    this.motor.dispose();
    for (const n of this.nodes) n.disconnect();
    this.bed = this.music = null;
  }
}
