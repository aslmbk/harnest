import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/content';
import type { GameState, SfxName } from '../src/core/events';
import { analyze } from '../src/audio/dev/analyze';
import { districtInputs } from '../src/audio/dev/levels';
import { levelInputFromContent } from '../src/audio/director';
import { compressorMakeupGain } from '../src/audio/dsp';
import { levelScene, menuScene, mixForState, musicForIndex, volumeCurve } from '../src/audio/profiles';
import { SFX_INFO, SFX_NAMES } from '../src/audio/sfx';

const STATES: GameState[] = ['boot', 'menu', 'loading', 'intro', 'playing', 'dialog', 'terminal', 'paused', 'levelComplete', 'ending'];

describe('scenes', () => {
  it('derive a valid ambience from every level in the content', () => {
    for (const level of LEVELS) {
      const input = levelInputFromContent(level.id);
      expect(input, level.id).not.toBeNull();
      const scene = levelScene(input!);
      expect(scene.ambience.rain).toBe(Math.min(1, Math.max(0, level.layout.mood.rain)));
      for (const [key, value] of Object.entries(scene.ambience)) {
        if (key === 'humHz') expect(value).toBeGreaterThan(30);
        else {
          expect(value, `${level.id} ${key}`).toBeGreaterThanOrEqual(0);
          expect(value, `${level.id} ${key}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('give every district (and the menu) its own key', () => {
    const keys = [0, 1, 2, 3, 4, 5].map((i) => {
      const m = musicForIndex(i);
      return `${m.root % 12}:${m.mode}`;
    });
    expect(new Set(keys).size).toBe(keys.length);
    expect(menuScene().music).toEqual(musicForIndex(0));
  });

  it('let the rain bed follow mood.rain', () => {
    const [l1] = districtInputs();
    const dry = levelScene({ ...l1, mood: { ...l1.mood, rain: 0 } });
    const wet = levelScene({ ...l1, mood: { ...l1.mood, rain: 1 } });
    expect(dry.ambience.rain).toBe(0);
    expect(wet.ambience.rain).toBe(1);
    expect(wet.ambience.drips).toBeGreaterThan(dry.ambience.drips);
  });

  it('cover districts 1..5 with stand-ins where the content has no level yet', () => {
    expect(districtInputs().map((d) => d.index)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('state mix', () => {
  it('ducks the music in terminal and dialog, lowers everything when paused', () => {
    const playing = mixForState('playing');
    expect(mixForState('terminal').music).toBeLessThan(playing.music * 0.6);
    expect(mixForState('dialog').music).toBeLessThan(playing.music * 0.6);
    const paused = mixForState('paused');
    expect(paused.music).toBeLessThan(playing.music);
    expect(paused.ambience).toBeLessThan(playing.ambience);
  });

  it('only lets the motor sound while playing', () => {
    for (const s of STATES) expect(mixForState(s).motor > 0, s).toBe(s === 'playing');
  });
});

describe('volume curve', () => {
  it('maps 0 to silence, 1 to unity, monotonic, clamped', () => {
    expect(volumeCurve(0)).toBe(0);
    expect(volumeCurve(1)).toBe(1);
    expect(volumeCurve(2)).toBe(1);
    expect(volumeCurve(-1)).toBe(0);
    expect(volumeCurve(Number.NaN)).toBe(0);
    let prev = -1;
    for (let v = 0; v <= 1; v += 0.05) {
      expect(volumeCurve(v)).toBeGreaterThan(prev);
      prev = volumeCurve(v);
    }
  });
});

describe('compressor makeup gain', () => {
  it('is 1 without compression and grows with lower thresholds', () => {
    // ratio 1 = no compression (the kernel's knee bisection is approximate to ~0.2 %)
    expect(compressorMakeupGain(-20, 6, 1)).toBeCloseTo(1, 2);
    const gentle = compressorMakeupGain(-10, 6, 2);
    const hard = compressorMakeupGain(-30, 6, 2);
    expect(gentle).toBeGreaterThan(1);
    expect(hard).toBeGreaterThan(gentle);
  });

  it('matches the static curve without a knee: (1 / (T + (0 − T) / R))^0.6', () => {
    // threshold −24 dB, ratio 4, (almost) no knee → 0 dBFS comes out at −18 dB
    const expected = 10 ** ((18 * 0.6) / 20);
    expect(compressorMakeupGain(-24, 0.0001, 4)).toBeCloseTo(expected, 1);
  });
});

describe('one-shot table', () => {
  it('has an entry for every SfxName, with sane limits', () => {
    const all: SfxName[] = ['uiMove', 'uiSelect', 'uiBack', 'key', 'stepOk', 'stepWrong', 'hint', 'challengeDone', 'chip', 'gateOpen', 'talk', 'interact', 'locked', 'levelComplete'];
    expect([...SFX_NAMES].sort()).toEqual([...all].sort());
    for (const name of SFX_NAMES) {
      const info = SFX_INFO[name];
      expect(info.level).toBeGreaterThan(0);
      expect(info.maxVoices).toBeGreaterThanOrEqual(1);
      expect(info.minGap).toBeGreaterThan(0);
    }
    // the sounds that matter most are never dropped by the voice budget
    for (const name of ['stepOk', 'stepWrong', 'challengeDone', 'gateOpen', 'levelComplete'] as const) expect(SFX_INFO[name].priority).toBe(2);
  });
});

describe('analyze', () => {
  const sr = 8000;
  const burst = (from: number, to: number, amp: number, total = 1) => {
    const x = new Float32Array(total * sr);
    for (let i = Math.floor(from * sr); i < to * sr; i++) x[i] = amp * Math.sin((2 * Math.PI * 440 * i) / sr);
    return x;
  };

  it('measures peak, RMS and the active span of a sine burst', () => {
    const x = burst(0.2, 0.5, 0.5);
    const a = analyze([x, x], sr);
    expect(a.peakDb).toBeCloseTo(20 * Math.log10(0.5), 1);
    expect(a.rmsDb).toBeCloseTo(20 * Math.log10(0.5 / Math.SQRT2), 1);
    expect(a.start).toBeCloseTo(0.2, 2);
    expect(a.end).toBeCloseTo(0.5, 2);
    expect(a.duration).toBeCloseTo(0.3, 2);
    expect(a.tail).toBeCloseTo(0.5, 2);
  });

  it('honours windows and whole-window RMS', () => {
    const x = burst(0, 1, 0.1);
    const a = analyze([x], sr, { from: 0.5, to: 1, span: 'all' });
    expect(a.rmsDb).toBeCloseTo(20 * Math.log10(0.1 / Math.SQRT2), 1);
    expect(a.maxRmsDb).toBeCloseTo(a.rmsDb, 0);
    const silent = analyze([new Float32Array(sr)], sr);
    expect(silent.peak).toBe(0);
    expect(silent.rmsDb).toBe(-Infinity);
  });
});
