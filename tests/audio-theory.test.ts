import { describe, expect, it } from 'vitest';
import { Rng } from '../src/audio/rng';
import {
  BRIGHTER,
  chordPitchClasses,
  degreeToMidi,
  midiToHz,
  MODES,
  type ModeName,
  nextDegree,
  notesInRange,
  pitchClass,
  scalePitchClasses,
  scaleStep,
  triadQuality,
  usableDegrees,
  voiceChord,
} from '../src/audio/theory';

const MODE_NAMES = Object.keys(MODES) as ModeName[];

describe('Rng', () => {
  it('is deterministic per seed and stays in range', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 1000; i++) {
      const x = a.next();
      expect(x).toBe(b.next());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });

  it('draws inclusive integers and respects weights', () => {
    const r = new Rng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(r.int(2, 5));
    expect([...seen].sort()).toEqual([2, 3, 4, 5]);
    const counts = [0, 0, 0];
    for (let i = 0; i < 6000; i++) counts[r.weighted([1, 0, 3])]++;
    expect(counts[1]).toBe(0);
    expect(counts[2] / counts[0]).toBeGreaterThan(2.4);
    expect(counts[2] / counts[0]).toBeLessThan(3.6);
  });

  it('forks independent streams', () => {
    const r = new Rng(3);
    const f = r.fork();
    expect(f.next()).not.toBe(r.next());
  });
});

describe('pitch helpers', () => {
  it('converts MIDI to Hz', () => {
    expect(midiToHz(69)).toBeCloseTo(440, 6);
    expect(midiToHz(57)).toBeCloseTo(220, 6);
    expect(midiToHz(60)).toBeCloseTo(261.626, 2);
  });

  it('wraps scale degrees across octaves', () => {
    expect(degreeToMidi(60, 'ionian', 0)).toBe(60);
    expect(degreeToMidi(60, 'ionian', 7)).toBe(72);
    expect(degreeToMidi(60, 'ionian', -1)).toBe(59);
    expect(degreeToMidi(57, 'aeolian', 2)).toBe(60);
  });

  it('knows triad qualities', () => {
    const q = (mode: ModeName) => Array.from({ length: 7 }, (_, d) => triadQuality(mode, d));
    expect(q('ionian')).toEqual(['major', 'minor', 'minor', 'major', 'major', 'minor', 'diminished']);
    expect(q('aeolian')).toEqual(['minor', 'diminished', 'major', 'minor', 'minor', 'major', 'major']);
  });

  it('builds diatonic chords', () => {
    expect(chordPitchClasses(57, 'aeolian', 0, 'triad')).toEqual([9, 0, 4]); // A C E
    expect(chordPitchClasses(57, 'aeolian', 0, 'add9')).toEqual([9, 0, 4, 11]); // + B
    expect(chordPitchClasses(60, 'ionian', 4, 'seventh')).toEqual([7, 11, 2, 5]); // G7
  });

  it('brightens every mode into a mode that differs by at most one note', () => {
    for (const mode of MODE_NAMES) {
      const a = MODES[mode];
      const b = MODES[BRIGHTER[mode]];
      const diff = a.filter((x, i) => x !== b[i]).length;
      expect(diff).toBeLessThanOrEqual(1);
      expect(b.reduce((s, x) => s + x, 0)).toBeGreaterThanOrEqual(a.reduce((s, x) => s + x, 0));
    }
  });
});

describe('voiceChord', () => {
  it('places one note per pitch class inside the range, ascending', () => {
    const pcs = chordPitchClasses(57, 'aeolian', 0, 'add9');
    const v = voiceChord(pcs, null, 52, 71);
    expect(v).toHaveLength(pcs.length);
    expect([...v].sort((a, b) => a - b)).toEqual(v);
    for (const m of v) {
      expect(m).toBeGreaterThanOrEqual(52);
      expect(m).toBeLessThanOrEqual(71);
    }
    expect(v.map(pitchClass).sort()).toEqual([...pcs].sort());
  });

  it('keeps common tones and moves little between chords', () => {
    const am = voiceChord(chordPitchClasses(57, 'aeolian', 0, 'triad'), null, 52, 71);
    const f = voiceChord(chordPitchClasses(57, 'aeolian', 5, 'triad'), am, 52, 71); // F A C
    // A and C are shared with A minor and must not move
    for (const m of am.filter((n) => [9, 0].includes(pitchClass(n)))) expect(f).toContain(m);
    const movement = f.reduce((s, m) => s + Math.min(...am.map((p) => Math.abs(p - m))), 0);
    expect(movement).toBeLessThanOrEqual(2);
  });
});

describe('chord walk', () => {
  it('only uses major/minor chords and never repeats a chord', () => {
    for (const mode of MODE_NAMES) {
      const usable = usableDegrees(mode);
      const r = new Rng(11);
      let d = 0;
      let since = 0;
      for (let i = 0; i < 400; i++) {
        const next = nextDegree(r, mode, d, since);
        expect(next).not.toBe(d);
        expect(usable).toContain(next);
        since = next === 0 ? 0 : since + 1;
        d = next;
      }
    }
  });

  it('visits every usable chord and comes home regularly', () => {
    const r = new Rng(5);
    const seen = new Set<number>();
    let d = 0;
    let since = 0;
    let longestAway = 0;
    let returns = 0;
    for (let i = 0; i < 600; i++) {
      d = nextDegree(r, 'aeolian', d, since);
      seen.add(d);
      if (d === 0) returns++;
      since = d === 0 ? 0 : since + 1;
      longestAway = Math.max(longestAway, since);
    }
    expect([...seen].sort()).toEqual(usableDegrees('aeolian').sort());
    // home roughly every 3–5 chords on average, never lost for long
    expect(600 / returns).toBeGreaterThan(2.5);
    expect(600 / returns).toBeLessThan(6);
    expect(longestAway).toBeLessThanOrEqual(10);
  });

  it('walks the scale stepwise inside a range', () => {
    const pcs = scalePitchClasses(57, 'aeolian');
    let m = 69;
    const r = new Rng(9);
    for (let i = 0; i < 200; i++) {
      m = scaleStep(m, r.pick([-2, -1, 1, 2]), 57, 'aeolian', 64, 81);
      expect(pcs).toContain(pitchClass(m));
      expect(m).toBeGreaterThanOrEqual(64);
      expect(m).toBeLessThanOrEqual(81);
    }
    expect(notesInRange([0], 59, 73)).toEqual([60, 72]);
  });
});
