/**
 * Level analysis of rendered audio (pure; unit tested): peak, RMS, loudest short window and the
 * active span of a sound.
 */

export interface Analysis {
  peak: number;
  peakDb: number;
  /** RMS over the active span (span 'active') or the whole window (span 'all'). */
  rmsDb: number;
  /** Loudest 50 ms window (a loudness proxy for short sounds). */
  maxRmsDb: number;
  /** Active span: first/last sample within `relDb` of the peak (seconds from the window start). */
  start: number;
  end: number;
  duration: number;
  /** Last sample above −60 dBFS (reverb tail included), seconds from the window start. */
  tail: number;
}

export interface AnalyzeOptions {
  /** Window in seconds. */
  from?: number;
  to?: number;
  /** Active-span threshold below the peak (dB). Default 40. */
  relDb?: number;
  span?: 'active' | 'all';
  /** Short-term window (s). Default 0.05. */
  window?: number;
}

const toDb = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

export function analyze(channels: readonly Float32Array[], sampleRate: number, opts: AnalyzeOptions = {}): Analysis {
  const len = channels[0]?.length ?? 0;
  const a = Math.max(0, Math.floor((opts.from ?? 0) * sampleRate));
  const b = Math.min(len, Math.ceil((opts.to ?? len / sampleRate) * sampleRate));
  const n = Math.max(0, b - a);
  const abs = (i: number) => {
    let m = 0;
    for (const ch of channels) m = Math.max(m, Math.abs(ch[i]));
    return m;
  };

  let peak = 0;
  for (let i = a; i < b; i++) peak = Math.max(peak, abs(i));

  const thr = peak * 10 ** (-(opts.relDb ?? 40) / 20);
  const floor = 10 ** (-60 / 20);
  let first = -1;
  let last = -1;
  let tailIdx = -1;
  for (let i = a; i < b; i++) {
    const v = abs(i);
    if (peak > 0 && v >= thr) {
      if (first < 0) first = i;
      last = i;
    }
    if (v > floor) tailIdx = i;
  }

  const sq = (i: number) => {
    let s = 0;
    for (const ch of channels) s += ch[i] * ch[i];
    return s / channels.length;
  };
  const [ra, rb] = opts.span === 'all' || first < 0 ? [a, b] : [first, last + 1];
  let sum = 0;
  for (let i = ra; i < rb; i++) sum += sq(i);
  const rms = rb > ra ? Math.sqrt(sum / (rb - ra)) : 0;

  const w = Math.max(1, Math.min(n, Math.round((opts.window ?? 0.05) * sampleRate)));
  let maxMean = 0;
  if (n > 0) {
    let acc = 0;
    for (let i = a; i < a + w; i++) acc += sq(i);
    maxMean = acc / w;
    for (let i = a + w; i < b; i++) {
      acc += sq(i) - sq(i - w);
      if (acc / w > maxMean) maxMean = acc / w;
    }
  }

  const start = first < 0 ? 0 : (first - a) / sampleRate;
  const end = last < 0 ? 0 : (last + 1 - a) / sampleRate;
  return {
    peak,
    peakDb: toDb(peak),
    rmsDb: toDb(rms),
    maxRmsDb: toDb(Math.sqrt(Math.max(0, maxMean))),
    start,
    end,
    duration: end - start,
    tail: tailIdx < 0 ? 0 : (tailIdx + 1 - a) / sampleRate,
  };
}
