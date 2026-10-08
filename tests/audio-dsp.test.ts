import { describe, expect, it } from 'vitest';
import { fadeTo, glideTo, holdAt, rampBetween, segmentValue, valueAt } from '../src/audio/dsp';

type Ev = { type: 'set' | 'linear' | 'exp' | 'target'; t: number; v: number; tc?: number };

/**
 * An AudioParam timeline with the Web Audio rules the helpers rely on: events sorted by time,
 * ramps interpolate from the previous event, setTarget starts from the value at its time, and
 * cancelScheduledValues(t) removes every event at or after t — including the end of a ramp that is
 * still running, which snaps the param back to the ramp's start. `withHold` adds cancelAndHoldAtTime
 * (Chrome, Safari); without it the param behaves like Firefox's.
 */
class FakeParam {
  events: Ev[] = [];
  now = 0;
  cancelAndHoldAtTime?: (t: number) => void;

  constructor(
    readonly initial = 0,
    withHold = false,
  ) {
    if (withHold) {
      this.cancelAndHoldAtTime = (t: number) => {
        const v = this.at(t);
        const next = this.events.find((e) => e.t >= t);
        this.events = this.events.filter((e) => e.t < t);
        if (next && (next.type === 'linear' || next.type === 'exp')) this.add({ type: next.type, t, v });
        this.add({ type: 'set', t, v });
      };
    }
  }

  get value(): number {
    return this.at(this.now);
  }

  setValueAtTime(v: number, t: number) {
    this.add({ type: 'set', t, v });
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.add({ type: 'linear', t, v });
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.add({ type: 'exp', t, v });
  }
  setTargetAtTime(v: number, t: number, tc: number) {
    this.add({ type: 'target', t, v, tc });
  }
  cancelScheduledValues(t: number) {
    this.events = this.events.filter((e) => e.t < t);
  }

  /** Value at time T. */
  at(T: number): number {
    let v = this.initial;
    let t0 = 0;
    let target: { t: number; v0: number; to: number; tc: number } | null = null;
    const held = (t: number) => (target ? target.to + (target.v0 - target.to) * Math.exp(-(t - target.t) / target.tc) : v);
    for (const e of this.events) {
      if (e.t > T) {
        if (e.type === 'linear' || e.type === 'exp') {
          const v0 = held(t0);
          const k = (T - t0) / (e.t - t0);
          return e.type === 'linear' ? v0 + (e.v - v0) * k : v0 * (e.v / v0) ** k;
        }
        break;
      }
      if (e.type === 'target') {
        const start = held(e.t);
        target = { t: e.t, v0: start, to: e.v, tc: e.tc ?? 1 };
        v = start;
      } else {
        target = null;
        v = e.v;
      }
      t0 = e.t;
    }
    return held(T);
  }

  /** Largest jump between neighbouring samples in [from, to]. */
  maxStep(from: number, to: number, dt = 0.0005): number {
    let max = 0;
    let prev = this.at(from);
    for (let t = from + dt; t <= to; t += dt) {
      const v = this.at(t);
      max = Math.max(max, Math.abs(v - prev));
      prev = v;
    }
    return max;
  }

  private add(e: Ev) {
    let i = this.events.length;
    while (i > 0 && this.events[i - 1].t > e.t) i--;
    this.events.splice(i, 0, e);
  }
}

const asParam = (p: FakeParam) => p as unknown as AudioParam;
const PEAK = 0.032;

describe('automation segments', () => {
  it('interpolate like Web Audio', () => {
    expect(segmentValue({ kind: 'linear', t0: 1, v0: 0, t1: 3, v1: 1 }, 2)).toBeCloseTo(0.5);
    expect(segmentValue({ kind: 'linear', t0: 1, v0: 0, t1: 3, v1: 1 }, 5)).toBe(1);
    expect(segmentValue({ kind: 'linear', t0: 1, v0: 0.2, t1: 3, v1: 1 }, 0)).toBe(0.2);
    expect(segmentValue({ kind: 'exponential', t0: 0, v0: 100, t1: 2, v1: 400 }, 1)).toBeCloseTo(200);
    expect(segmentValue({ kind: 'target', t0: 1, v0: 1, target: 0, tc: 0.5 }, 1.5)).toBeCloseTo(Math.exp(-1));
    expect(segmentValue({ kind: 'set', t0: 1, v0: 0.4 }, 9)).toBe(0.4);
  });

  it('valueAt follows what the helpers scheduled, else reads the current value', () => {
    const p = new FakeParam(0.7);
    expect(valueAt(asParam(p), 5)).toBe(0.7);
    rampBetween(asParam(p), 0, 1, PEAK, 4);
    expect(valueAt(asParam(p), 2.5)).toBeCloseTo(PEAK / 2);
    expect(p.at(2.5)).toBeCloseTo(PEAK / 2);
  });
});

describe('holdAt without cancelAndHoldAtTime (Firefox)', () => {
  it('releases a pad mid-attack from its ramp value at the future release time — no drop, no step', () => {
    const p = new FakeParam();
    rampBetween(asParam(p), 0, 1, PEAK, 4); // 3 s attack from t = 1
    p.now = 1.6; // the gate opens: the chord is cut 1.4 s ahead, still inside the attack
    const before = p.at(1.7);
    glideTo(asParam(p), 0, 3, 0.8);
    expect(p.at(1.7)).toBeCloseTo(before, 9); // the swell goes on until the release (it used to drop to 0)
    expect(p.at(2.999)).toBeCloseTo((PEAK * 1.999) / 3, 6);
    expect(p.at(3)).toBeCloseTo((PEAK * 2) / 3, 9); // released where the ramp is, not at today's value
    expect(p.at(3.8)).toBeCloseTo(((PEAK * 2) / 3) * Math.exp(-1), 6);
    expect(p.maxStep(1, 8)).toBeLessThan(PEAK * 0.001);
  });

  it('holds exactly at the end of a ramp', () => {
    const p = new FakeParam();
    rampBetween(asParam(p), 0, 1, PEAK, 4);
    p.now = 2;
    expect(holdAt(asParam(p), 4)).toBeCloseTo(PEAK);
    expect(p.at(3)).toBeCloseTo((PEAK * 2) / 3);
    expect(p.maxStep(1, 6)).toBeLessThan(PEAK * 0.001);
    expect(p.at(6)).toBeCloseTo(PEAK);
  });

  it('keeps exponential ramps exponential up to the hold', () => {
    const p = new FakeParam(100);
    rampBetween(asParam(p), 100, 0, 1600, 4, 'exponential');
    p.now = 0.5;
    expect(holdAt(asParam(p), 2)).toBeCloseTo(400);
    expect(p.at(1)).toBeCloseTo(200);
    expect(p.at(3)).toBeCloseTo(400);
    expect(p.maxStep(0, 4, 0.001)).toBeLessThan(2);
  });

  it('fades out from a fade-in that has not finished (scene change), and from a running glide', () => {
    const p = new FakeParam();
    rampBetween(asParam(p), 0, 0, 1, 2.5);
    p.now = 1;
    fadeTo(asParam(p), 0, 1, 2.5);
    expect(p.at(1)).toBeCloseTo(0.4);
    expect(p.at(2.25)).toBeCloseTo(0.2);
    expect(p.at(3.5)).toBe(0);
    expect(p.maxStep(0, 4)).toBeLessThan(0.001);

    const q = new FakeParam(1);
    glideTo(asParam(q), 0, 0, 0.5);
    q.now = 0.5;
    glideTo(asParam(q), 1, 0.75, 0.5); // a second glide ahead of now starts from the first one's value then
    expect(q.at(0.75)).toBeCloseTo(Math.exp(-1.5), 6);
    expect(q.maxStep(0, 3)).toBeLessThan(0.002);
  });

  it('keeps the old behaviour for params automated directly (current value)', () => {
    const p = new FakeParam(0.5);
    p.now = 1;
    expect(holdAt(asParam(p), 1)).toBe(0.5);
    expect(p.at(2)).toBe(0.5);
  });
});

describe('holdAt with cancelAndHoldAtTime', () => {
  it('lets the browser hold and still remembers the value for later glides', () => {
    const p = new FakeParam(0, true);
    let calls = 0;
    const hold = p.cancelAndHoldAtTime!;
    p.cancelAndHoldAtTime = (t) => {
      calls++;
      hold(t);
    };
    rampBetween(asParam(p), 0, 1, PEAK, 4);
    p.now = 1.6;
    glideTo(asParam(p), 0, 3, 0.8);
    expect(calls).toBe(1);
    expect(p.at(3)).toBeCloseTo((PEAK * 2) / 3, 9);
    expect(valueAt(asParam(p), 3.8)).toBeCloseTo(((PEAK * 2) / 3) * Math.exp(-1), 6);
    expect(p.maxStep(1, 8)).toBeLessThan(PEAK * 0.001);
  });
});
