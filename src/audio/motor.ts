/**
 * Harni's drive: a small servo whine and a track rumble with tread clatter. Pitch, brightness, clatter
 * rate and level follow the player speed (0..1) through smoothed parameter targets. The nodes are built
 * on the first movement and torn down after a few idle seconds, so a parked robot costs no CPU.
 */
import { glideTo, type NoiseBank, Voice } from './dsp';
import type { Rng } from './rng';

const LEVEL = 0.2;
/** Seconds at speed 0 before the nodes are released. */
const IDLE_TEARDOWN = 3;

interface MotorNodes {
  v: Voice;
  body: GainNode;
  whine: OscillatorNode;
  whineLp: BiquadFilterNode;
  servo: OscillatorNode;
  rumbleLp: BiquadFilterNode;
  tread: OscillatorNode;
}

export class Motor {
  private n: MotorNodes | null = null;
  private speed = 0;
  private lastActive = -Infinity;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly out: AudioNode,
    private readonly noise: NoiseBank,
    private readonly rng: Rng,
  ) {}

  get active(): boolean {
    return this.n !== null;
  }

  setSpeed(speed: number, t = this.ctx.currentTime): void {
    const s = Math.min(1, Math.max(0, Number.isFinite(speed) ? speed : 0));
    this.speed = s;
    if (s > 0.001) {
      this.lastActive = t;
      if (!this.n) this.n = this.build(t);
    }
    const n = this.n;
    if (!n) return;
    const level = s <= 0.001 ? 0 : LEVEL * (0.25 + 0.75 * s);
    glideTo(n.body.gain, level, t, s > 0.001 ? 0.06 : 0.1);
    glideTo(n.whine.frequency, 52 + 70 * s, t, 0.12);
    glideTo(n.whineLp.frequency, 260 + 900 * s, t, 0.12);
    glideTo(n.servo.frequency, 230 + 260 * s, t, 0.12);
    glideTo(n.rumbleLp.frequency, 140 + 260 * s, t, 0.15);
    glideTo(n.tread.frequency, 3 + 11 * s, t, 0.2);
  }

  /** Releases the nodes after a stretch of silence. */
  tick(now: number): void {
    if (this.n && this.speed <= 0.001 && now - this.lastActive > IDLE_TEARDOWN) {
      const { v } = this.n;
      this.n = null;
      v.stopAll(now + 0.05);
      v.release();
    }
  }

  dispose(): void {
    this.n?.v.disconnect();
    this.n = null;
  }

  private build(t: number): MotorNodes {
    const { ctx, rng, noise } = this;
    const v = new Voice(ctx);
    const body = v.gain(0);
    body.connect(this.out);

    // Electric drive: a filtered saw, low.
    const whine = v.osc('sawtooth', 52, t);
    const whineLp = v.filter('lowpass', 260, 1.4);
    const whineG = v.gain(0.42);
    whine.connect(whineLp);
    whineLp.connect(whineG);
    whineG.connect(body);

    // Servo: a soft triangle above it, with a little vibrato.
    const servo = v.osc('triangle', 230, t);
    const servoG = v.gain(0.09);
    const vib = v.osc('sine', 5.5, t);
    const vibDepth = v.gain(4);
    vib.connect(vibDepth);
    vibDepth.connect(servo.frequency);
    servo.connect(servoG);
    servoG.connect(body);

    // Tracks: brown-noise rumble and a band of clatter, both pulsed at the tread rate.
    const tread = v.osc('sine', 3, t);
    const rumble = v.noise(noise.brown, t, undefined, rng);
    const rumbleLp = v.filter('lowpass', 140, 0.7);
    const rumbleG = v.gain(0.65);
    const rumbleAm = v.gain(0.35);
    tread.connect(rumbleAm);
    rumbleAm.connect(rumbleG.gain);
    rumble.connect(rumbleLp);
    rumbleLp.connect(rumbleG);
    rumbleG.connect(body);

    const clatter = v.noise(noise.white, t, undefined, rng);
    const clatterBp = v.filter('bandpass', 1500, 1.8);
    const clatterG = v.gain(0.12);
    const clatterAm = v.gain(0.1);
    tread.connect(clatterAm);
    clatterAm.connect(clatterG.gain);
    clatter.connect(clatterBp);
    clatterBp.connect(clatterG);
    clatterG.connect(body);

    return { v, body, whine, whineLp, servo, rumbleLp, tread };
  }
}
