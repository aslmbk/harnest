import { describe, expect, it } from 'vitest';
import { parseParams } from '../src/engine/params';
import { AutoQuality, QUALITY_PRESETS, stepQuality } from '../src/engine/quality';

describe('parseParams', () => {
  it('reads the documented URL params', () => {
    const p = parseParams('?skipMenu=1&level=l2&autoui=1&noui=1&q=low&debug=1&view=map&assets=0&touch=1');
    expect(p).toEqual({
      skipMenu: true,
      level: 'l2',
      autoui: true,
      noui: true,
      quality: 'low',
      debug: true,
      view: 'map',
      assets: false,
      touch: 'on',
    });
  });

  it('has safe defaults', () => {
    expect(parseParams('')).toEqual({
      skipMenu: false,
      level: null,
      autoui: false,
      noui: false,
      quality: null,
      debug: false,
      view: 'game',
      assets: true,
      touch: 'auto',
    });
    expect(parseParams('?q=ultra&skipMenu=0').quality).toBeNull();
    expect(parseParams('?touch=0').touch).toBe('off');
    expect(parseParams('?touch=false').touch).toBe('off');
    expect(parseParams('?touch=auto').touch).toBe('auto');
  });
});

describe('quality presets', () => {
  it('respect the light budget and grow with the level', () => {
    expect(QUALITY_PRESETS.high.maxPointLights).toBeLessThanOrEqual(24);
    expect(QUALITY_PRESETS.low.maxPointLights).toBeLessThan(QUALITY_PRESETS.medium.maxPointLights);
    expect(stepQuality('low', -1)).toBe('low');
    expect(stepQuality('medium', 1)).toBe('high');
  });
});

describe('AutoQuality', () => {
  const run = (aq: AutoQuality, ms: number, seconds: number) => {
    const changes: string[] = [];
    for (let t = 0; t < seconds; t += ms / 1000) {
      const c = aq.sample(ms);
      if (c) changes.push(c);
    }
    return changes;
  };

  it('steps down when frames are slow', () => {
    const aq = new AutoQuality('high');
    expect(run(aq, 30, 10)).toEqual(['medium', 'low']);
    expect(aq.level).toBe('low');
  });

  it('steps up when frames are fast, but never back to a level it dropped from', () => {
    const aq = new AutoQuality('medium');
    expect(run(aq, 6, 8)).toEqual(['high']);
    const aq2 = new AutoQuality('high');
    run(aq2, 30, 5);
    expect(aq2.level).not.toBe('high');
    run(aq2, 6, 20);
    expect(aq2.level).not.toBe('high');
  });

  it('ignores the warm-up period', () => {
    const aq = new AutoQuality('medium');
    expect(run(aq, 40, 2)).toEqual([]);
  });

  it('does not step down for a stall (back from a hidden tab)', () => {
    const aq = new AutoQuality('high');
    run(aq, 16, 4.52); // warm-up (2.5 s) and one window (2 s) done: the next window has just begun
    expect(aq.sample(16)).toBeNull();
    expect(aq.sample(30_000)).toBeNull();
    expect(run(aq, 16, 6)).toEqual([]);
    expect(aq.level).toBe('high');
  });
});
