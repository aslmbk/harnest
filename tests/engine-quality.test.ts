import { describe, expect, it } from 'vitest';
import { parseParams } from '../src/engine/params';
import { AutoQuality, chooseQuality, chooseUntimedQuality, MAX_POINT_LIGHTS, PROBE_BUDGET_MS, QUALITY_PRESETS, stepQuality, UNTIMED_SLOW_MS } from '../src/engine/quality';

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
      freeze: null,
      dryFrame: true,
      forcedFrame: true,
      parallelCompile: true,
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
      freeze: null,
      dryFrame: true,
      forcedFrame: true,
      parallelCompile: true,
    });
    expect(parseParams('?q=ultra&skipMenu=0').quality).toBeNull();
    expect(parseParams('?touch=0').touch).toBe('off');
    expect(parseParams('?touch=false').touch).toBe('off');
    expect(parseParams('?touch=auto').touch).toBe('auto');
  });

  it('reads the [freeze] clock pin', () => {
    expect(parseParams('?freeze=12.5').freeze).toBe(12.5);
    expect(parseParams('?freeze=0').freeze).toBe(0);
    expect(parseParams('?freeze=').freeze).toBeNull();
    expect(parseParams('?freeze=abc').freeze).toBeNull();
  });

  it('reads the precompile A/B switches (both on unless turned off)', () => {
    expect(parseParams('?dryframe=0')).toMatchObject({ dryFrame: false, forcedFrame: true });
    expect(parseParams('?forceframe=0&dryframe=1')).toMatchObject({ dryFrame: true, forcedFrame: false });
    expect(parseParams('?dryframe=false&forceframe=false')).toMatchObject({ dryFrame: false, forcedFrame: false, parallelCompile: true });
    expect(parseParams('?parcompile=0')).toMatchObject({ dryFrame: true, forcedFrame: true, parallelCompile: false });
  });
});

describe('quality presets', () => {
  it('respect the light budget and grow with the level', () => {
    expect(QUALITY_PRESETS.high.maxPointLights).toBeLessThanOrEqual(24);
    expect(QUALITY_PRESETS.low.maxPointLights).toBeLessThan(QUALITY_PRESETS.medium.maxPointLights);
    expect(stepQuality('low', -1)).toBe('low');
    expect(stepQuality('medium', 1)).toBe('high');
  });

  it('fit the light uniform arrays (a budget change never recompiles)', () => {
    for (const p of Object.values(QUALITY_PRESETS)) expect(p.maxPointLights).toBeLessThanOrEqual(MAX_POINT_LIGHTS);
  });
});

describe('chooseQuality (load-time probe)', () => {
  const b = PROBE_BUDGET_MS;
  it('drops to low when medium is far over budget', () => {
    expect(chooseQuality({ medium: b * 2 })).toBe('low');
  });
  it('keeps medium when medium is close to the budget', () => {
    expect(chooseQuality({ medium: b })).toBe('medium');
  });
  it('asks for a high measurement when medium has headroom, then decides on it', () => {
    expect(chooseQuality({ medium: b * 0.5 })).toBe('probe-high');
    expect(chooseQuality({ medium: b * 0.5, high: b * 0.9 })).toBe('high');
    expect(chooseQuality({ medium: b * 0.5, high: b * 1.2 })).toBe('medium');
  });
});

describe('chooseUntimedQuality (probe without GPU timestamps)', () => {
  it('keeps medium at a vsync-capped frame interval (60 Hz, 144 Hz)', () => {
    expect(chooseUntimedQuality({ cost: 16.7, cpu: 12 })).toBe('medium');
    expect(chooseUntimedQuality({ cost: 6.9, cpu: 4 })).toBe('medium');
  });
  it('steps down to low on a slow frame rate or CPU render time over budget', () => {
    expect(chooseUntimedQuality({ cost: UNTIMED_SLOW_MS + 5, cpu: 8 })).toBe('low');
    expect(chooseUntimedQuality({ cost: 16.7, cpu: PROBE_BUDGET_MS * 2 })).toBe('low');
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

  it('starts over after rewarm() (a compile in between says nothing about play)', () => {
    const aq = new AutoQuality('high');
    run(aq, 16, 4); // past the warm-up
    aq.rewarm();
    expect(run(aq, 40, 2)).toEqual([]); // inside the new warm-up: slow frames are ignored
    expect(aq.level).toBe('high');
  });

  it('holds a step up that needs more MSAA than the shown level has until the next build', () => {
    const aq = new AutoQuality('low');
    aq.msaa = QUALITY_PRESETS.low.msaa; // the level was built without MSAA
    expect(run(aq, 6, 12)).toEqual([]); // fast, but medium needs MSAA 4: no change during play
    expect(aq.level).toBe('low');
    expect(aq.held).toBe('medium');
    expect(aq.takeHeld()).toBe('medium'); // the next level build applies it
    expect(aq.level).toBe('medium');
    expect(aq.held).toBeNull();
    expect(aq.takeHeld()).toBeNull();
    // built with MSAA 4 now: medium → high needs no more samples and happens during play
    aq.msaa = QUALITY_PRESETS.medium.msaa;
    expect(run(aq, 6, 12)).toEqual(['high']);
  });

  it('drops a held step up after a slow window, and steps up at once when the MSAA is already there', () => {
    const aq = new AutoQuality('low');
    aq.msaa = 0;
    run(aq, 6, 12);
    expect(aq.held).toBe('medium');
    run(aq, 30, 3);
    expect(aq.held).toBeNull();
    expect(aq.takeHeld()).toBeNull();
    expect(aq.level).toBe('low');
    // a level built with MSAA 4 (a manual medium switched to low keeps it until the next build)
    const kept = new AutoQuality('low');
    kept.msaa = QUALITY_PRESETS.medium.msaa;
    expect(run(kept, 6, 8)).toEqual(['medium']);
    // the default (MSAA unknown) holds nothing
    expect(run(new AutoQuality('low'), 6, 8)).toEqual(['medium']);
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
