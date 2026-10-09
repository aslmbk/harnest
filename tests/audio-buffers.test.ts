import { afterEach, describe, expect, it, vi } from 'vitest';

type Dsp = typeof import('../src/audio/dsp');

/** Minimal BaseAudioContext: createBuffer with real channel arrays. */
function mockCtx(sampleRate: number): BaseAudioContext {
  return {
    sampleRate,
    createBuffer(n: number, len: number) {
      const data = Array.from({ length: n }, () => new Float32Array(len));
      return { length: len, numberOfChannels: n, getChannelData: (c: number) => data[c], copyToChannel: (d: Float32Array, c: number) => data[c].set(d) };
    },
  } as unknown as BaseAudioContext;
}

async function freshDsp(): Promise<Dsp> {
  vi.resetModules();
  return import('../src/audio/dsp');
}

function buffers(dsp: Dsp, sr: number): AudioBuffer[] {
  const ctx = mockCtx(sr);
  const bank = dsp.noiseBank(ctx);
  return [bank.white, bank.pink, bank.brown, dsp.impulseResponse(ctx)];
}

function expectSame(a: AudioBuffer[], b: AudioBuffer[]): void {
  a.forEach((buf, i) => {
    for (let ch = 0; ch < 2; ch++) {
      const x = buf.getChannelData(ch);
      const y = b[i].getChannelData(ch);
      expect(x.length).toBe(y.length);
      expect(x.every((v, k) => Object.is(v, y[k])), `buffer ${i} channel ${ch}`).toBe(true);
    }
  });
}

describe('shared audio buffers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('noise is normalised and the impulse response decays', async () => {
    const [white, pink, brown, ir] = buffers(await freshDsp(), 8000);
    for (const b of [white, pink, brown]) {
      const d = b.getChannelData(0);
      const rms = Math.sqrt(d.reduce((s, v) => s + v * v, 0) / d.length);
      expect(rms).toBeGreaterThan(0.2);
      expect(rms).toBeLessThan(0.3);
    }
    const d = ir.getChannelData(0);
    const early = d.slice(0, 2000).reduce((s, v) => s + Math.abs(v), 0);
    const late = d.slice(-2000).reduce((s, v) => s + Math.abs(v), 0);
    expect(late).toBeLessThan(early * 0.05);
  });

  it('prewarmed in idle slices = computed on demand (bit for bit), also when the gesture comes midway', async () => {
    const reference = buffers(await freshDsp(), 8000);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const full = await freshDsp();
    full.prewarmAudioBuffers([8000]);
    vi.runAllTimers();
    expectSame(buffers(full, 8000), reference);

    const partial = await freshDsp();
    partial.prewarmAudioBuffers([8000]);
    vi.advanceTimersToNextTimer(); // one idle slice only
    expectSame(buffers(partial, 8000), reference);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1); // the rest of the prewarm stops after the handoff
    vi.runAllTimers();
  });
});
