/**
 * Offline audio checks: renders every one-shot, every ambience/music bed, the motor and a stress
 * mix through OfflineAudioContext with the real engine, and asserts levels, durations and balance.
 * Run in a page (audio-dev.html); driven headless by scripts/audio-check.mjs.
 */
import type { GameState, SfxName } from '../../core/events';
import { AudioEngine, buildMasterChain, type Volumes } from '../engine';
import { type AudioScene, levelScene, menuScene, mixForState } from '../profiles';
import { SFX_NAMES } from '../sfx';
import { type Analysis, analyze } from './analyze';
import { districtInputs } from './levels';

export type CheckGroup = 'chain' | 'sfx' | 'ambience' | 'music' | 'mix' | 'motor' | 'stress';

export interface CheckRow {
  group: CheckGroup;
  name: string;
  /** Seconds within 40 dB of the peak (one-shots) or the analysed window (beds). */
  duration: number;
  peakDb: number;
  rmsDb: number;
  maxRmsDb: number;
  /** Peak without compressor/limiter (one-shots). */
  rawPeakDb?: number;
}

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

export interface CheckReport {
  sampleRate: number;
  ms: number;
  rows: CheckRow[];
  results: CheckResult[];
}

const SR = 48000;
const DEFAULTS: Volumes = { master: 0.8, music: 0.6, sfx: 0.8 };
const MAX: Volumes = { master: 1, music: 1, sfx: 1 };

/** Expected audible duration (s, within 40 dB of the peak, reverb tail included). */
const SFX_DURATION: Record<SfxName, readonly [number, number]> = {
  key: [0.01, 0.15],
  talk: [0.03, 0.2],
  uiMove: [0.03, 0.3],
  uiSelect: [0.08, 0.7],
  uiBack: [0.08, 0.7],
  interact: [0.08, 0.9],
  locked: [0.15, 0.9],
  stepOk: [0.2, 1.6],
  stepWrong: [0.2, 1.3],
  hint: [0.2, 1.6],
  chip: [0.3, 2.2],
  challengeDone: [0.6, 3],
  gateOpen: [1.8, 5],
  levelComplete: [1.5, 5],
};

/** Short, frequent sounds: only their transient has to poke out of the beds. */
const SUBTLE = new Set<SfxName>(['key', 'talk', 'uiMove']);

const fmt = (db: number) => (Number.isFinite(db) ? db.toFixed(1) : '-inf');

function channels(buf: AudioBuffer): Float32Array[] {
  return Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
}

/** Maps items with at most `limit` renders in flight (each offline context renders on its own thread). */
async function pool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const PARALLEL = 4;

/** Runs fn when the offline render reaches time t. */
function at(ctx: OfflineAudioContext, t: number, fn: () => void): void {
  ctx
    .suspend(t)
    .then(() => {
      fn();
      return ctx.resume();
    })
    .catch((err: unknown) => console.error('[audio-check] suspend failed', err));
}

async function render(
  seconds: number,
  setup: (engine: AudioEngine, ctx: OfflineAudioContext) => void,
  opts: { raw?: boolean; seed?: number } = {},
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR);
  const engine = new AudioEngine(ctx, { seed: opts.seed ?? 7, raw: opts.raw });
  setup(engine, ctx);
  return ctx.startRendering();
}

function renderBed(scene: AudioScene, volumes: Volumes, seconds: number, state: GameState, bright = false): Promise<AudioBuffer> {
  return render(seconds, (e) => {
    e.setVolumes(volumes, true);
    e.setStateMix(mixForState(state), true);
    e.setBright(bright);
    e.setScene(scene, 0.05);
    e.tick(seconds);
  });
}

async function renderTone(amplitude: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, SR, SR);
  const chain = buildMasterChain(ctx, ctx.destination);
  const osc = ctx.createOscillator();
  osc.frequency.value = 440;
  const g = ctx.createGain();
  g.gain.value = amplitude;
  osc.connect(g);
  g.connect(chain.input);
  osc.start(0);
  return ctx.startRendering();
}

export async function runChecks(onProgress?: (message: string) => void): Promise<CheckReport> {
  const started = performance.now();
  const rows: CheckRow[] = [];
  const results: CheckResult[] = [];
  const check = (name: string, ok: boolean, detail: string) => results.push({ name, ok, detail });
  const row = (group: CheckGroup, name: string, a: Analysis, extra: Partial<CheckRow> = {}) =>
    rows.push({ group, name, duration: a.duration, peakDb: a.peakDb, rmsDb: a.rmsDb, maxRmsDb: a.maxRmsDb, ...extra });
  const progress = (m: string) => onProgress?.(m);

  // ── 1 · master chain: unity below threshold, limiting above ──
  progress('master chain');
  {
    const quiet = analyze(channels(await renderTone(0.05)), SR, { from: 0.5, to: 1, span: 'all' });
    const gainDb = quiet.peakDb - 20 * Math.log10(0.05);
    check('master chain: unity gain below threshold', Math.abs(gainDb) < 0.5, `${gainDb.toFixed(2)} dB`);
    const loud = analyze(channels(await renderTone(2)), SR, { span: 'all' });
    row('chain', 'sine +6 dBFS in', loud);
    check('master chain: limiter holds a +6 dBFS sine under 0 dBFS', loud.peak < 1, `peak ${fmt(loud.peakDb)} dBFS`);
  }

  // ── 2 · one-shots ──
  progress('one-shots');
  const sfx = new Map<SfxName, Analysis>();
  const sfxRenders = await pool(SFX_NAMES, PARALLEL, async (name) => {
    const seconds = 0.05 + SFX_DURATION[name][1] + 2.8;
    const setup = (e: AudioEngine) => {
      e.setVolumes(DEFAULTS, true);
      e.setStateMix(mixForState('playing'), true);
      e.playSfx(name, 0.05);
    };
    const [out, raw] = await Promise.all([render(seconds, setup), render(seconds, setup, { raw: true })]);
    return { name, a: analyze(channels(out), SR), raw: analyze(channels(raw), SR) };
  });
  for (const { name, a, raw } of sfxRenders) {
    const [lo, hi] = SFX_DURATION[name];
    sfx.set(name, a);
    row('sfx', name, a, { rawPeakDb: raw.peakDb });
    check(`sfx ${name}: audible`, a.peakDb > -50, `peak ${fmt(a.peakDb)} dBFS`);
    check(`sfx ${name}: no clipping`, a.peak < 1 && raw.peak < 1, `peak ${fmt(a.peakDb)} dBFS, raw ${fmt(raw.peakDb)} dBFS`);
    check(`sfx ${name}: duration ${lo}–${hi} s`, a.duration >= lo && a.duration <= hi, `${a.duration.toFixed(3)} s`);
  }

  // ── 3 · ambience and music beds per scene ──
  progress('beds');
  const scenes = [menuScene(), ...districtInputs().map(levelScene)];
  const bedRenders = await pool(scenes, PARALLEL, async (scene) => {
    const state: GameState = scene.id === 'menu' ? 'menu' : 'playing';
    const [amb, mus, mix] = await Promise.all([
      renderBed(scene, { ...DEFAULTS, music: 0 }, 10, state),
      renderBed(scene, { ...DEFAULTS, sfx: 0 }, 16, state),
      renderBed(scene, DEFAULTS, 16, state),
    ]);
    return {
      scene,
      amb: analyze(channels(amb), SR, { from: 3, to: 10, span: 'all' }),
      mus: analyze(channels(mus), SR, { from: 4, to: 16, span: 'all' }),
      mix: analyze(channels(mix), SR, { from: 4, to: 16, span: 'all' }),
    };
  });
  let loudestBed = -Infinity;
  for (const g of ['ambience', 'music', 'mix'] as const) {
    for (const { scene, amb, mus, mix } of bedRenders) {
      const a = g === 'ambience' ? amb : g === 'music' ? mus : mix;
      row(g, scene.id, a);
      if (g !== 'mix') check(`${g} ${scene.id}: not silent`, a.rmsDb > -60, `rms ${fmt(a.rmsDb)} dBFS`);
      check(`${g} ${scene.id}: no clipping`, a.peak < 1, `peak ${fmt(a.peakDb)} dBFS`);
      if (g === 'mix') loudestBed = Math.max(loudestBed, a.rmsDb);
    }
  }

  // ── 4 · balance: one-shots over the beds, key far below challengeDone ──
  for (const [name, a] of sfx) {
    if (SUBTLE.has(name)) {
      check(`balance ${name}: transient pokes out of the beds`, a.peakDb >= loudestBed + 6, `peak ${fmt(a.peakDb)} vs bed rms ${fmt(loudestBed)} dB`);
    } else {
      check(`balance ${name}: clearly above the beds`, a.maxRmsDb >= loudestBed + 6, `50 ms rms ${fmt(a.maxRmsDb)} vs bed rms ${fmt(loudestBed)} dB`);
    }
  }
  const key = sfx.get('key');
  const done = sfx.get('challengeDone');
  if (key && done) {
    check(
      'balance: key much quieter than challengeDone',
      key.maxRmsDb <= done.maxRmsDb - 12 && key.peakDb <= done.peakDb - 6,
      `key ${fmt(key.maxRmsDb)} / ${fmt(key.peakDb)} vs challengeDone ${fmt(done.maxRmsDb)} / ${fmt(done.peakDb)} dB (50 ms rms / peak)`,
    );
  }

  // ── 5 · motor: silent at rest, follows speed, muted outside 'playing' ──
  progress('motor');
  {
    const buf = await render(4.5, (e, ctx) => {
      e.setVolumes({ ...DEFAULTS, music: 0 }, true);
      e.setStateMix(mixForState('playing'), true);
      e.setMotor(0);
      at(ctx, 1, () => e.setMotor(0.5));
      at(ctx, 2, () => e.setMotor(1));
      at(ctx, 3, () => e.setMotor(0));
    });
    const ch = channels(buf);
    const idle = analyze(ch, SR, { from: 0.1, to: 0.95, span: 'all' });
    const half = analyze(ch, SR, { from: 1.5, to: 1.95, span: 'all' });
    const full = analyze(ch, SR, { from: 2.5, to: 2.95, span: 'all' });
    const after = analyze(ch, SR, { from: 3.9, to: 4.5, span: 'all' });
    row('motor', 'speed 0.5', half);
    row('motor', 'speed 1.0', full);
    check('motor: silent at speed 0', idle.peak === 0, `peak ${fmt(idle.peakDb)} dBFS`);
    check('motor: audible when driving', full.rmsDb > -45, `rms ${fmt(full.rmsDb)} dBFS`);
    check('motor: louder at full speed', full.rmsDb > half.rmsDb + 1, `${fmt(half.rmsDb)} → ${fmt(full.rmsDb)} dBFS`);
    check('motor: fades out after stopping', after.rmsDb < -60, `rms ${fmt(after.rmsDb)} dBFS`);

    const paused = await render(2, (e) => {
      e.setVolumes({ ...DEFAULTS, music: 0 }, true);
      e.setStateMix(mixForState('paused'), true);
      e.setMotor(1);
    });
    const p = analyze(channels(paused), SR, { from: 0.5, to: 2, span: 'all' });
    check('motor: muted when paused', !(p.rmsDb > -80), `rms ${fmt(p.rmsDb)} dBFS`);
  }

  // ── 6 · state ducking ──
  progress('ducking');
  {
    const l1 = levelScene(districtInputs()[0]);
    const musicOnly = { ...DEFAULTS, sfx: 0 };
    const ambOnly = { ...DEFAULTS, music: 0 };
    const [playBuf, termBuf, ambPlayBuf, ambPauseBuf, brightBuf] = await Promise.all([
      renderBed(l1, musicOnly, 14, 'playing'),
      renderBed(l1, musicOnly, 14, 'terminal'),
      renderBed(l1, ambOnly, 8, 'playing'),
      renderBed(l1, ambOnly, 8, 'paused'),
      renderBed(l1, musicOnly, 16, 'playing', true),
    ]);
    const play = analyze(channels(playBuf), SR, { from: 4, to: 14, span: 'all' });
    const term = analyze(channels(termBuf), SR, { from: 4, to: 14, span: 'all' });
    check('music ducks in terminal (≥ 5 dB)', play.rmsDb - term.rmsDb >= 5, `${(play.rmsDb - term.rmsDb).toFixed(1)} dB`);
    const ambPlay = analyze(channels(ambPlayBuf), SR, { from: 3, to: 8, span: 'all' });
    const ambPause = analyze(channels(ambPauseBuf), SR, { from: 3, to: 8, span: 'all' });
    check('ambience lowers when paused (≥ 2 dB)', ambPlay.rmsDb - ambPause.rmsDb >= 2, `${(ambPlay.rmsDb - ambPause.rmsDb).toFixed(1)} dB`);
    const bright = analyze(channels(brightBuf), SR, { from: 4, to: 16, span: 'all' });
    row('music', `${l1.id} bright`, bright);
    check('music bright variation: not silent, no clipping', bright.rmsDb > -60 && bright.peak < 1, `rms ${fmt(bright.rmsDb)}, peak ${fmt(bright.peakDb)} dBFS`);
  }

  // ── 7 · stress: everything at once, all volumes at max ──
  progress('stress');
  {
    const depot = levelScene(districtInputs()[2]);
    const buf = await render(9, (e) => {
      e.setVolumes(MAX, true);
      e.setStateMix(mixForState('playing'), true);
      e.setScene(depot, 0.05);
      e.tick(9);
      e.setMotor(1);
      const loud: SfxName[] = ['gateOpen', 'levelComplete', 'challengeDone', 'chip', 'stepOk', 'uiSelect', 'interact', 'hint'];
      for (const n of loud) e.playSfx(n, 4);
      for (let i = 0; i < 40; i++) e.playSfx('key', 4 + i * 0.025);
      for (let i = 0; i < 20; i++) e.playSfx('talk', 4.01 + i * 0.05);
    });
    const a = analyze(channels(buf), SR, { span: 'all' });
    row('stress', 'all at max volume', a);
    check('stress: limiter keeps the full mix under 0 dBFS', a.peak < 1, `peak ${fmt(a.peakDb)} dBFS`);
  }

  return { sampleRate: SR, ms: Math.round(performance.now() - started), rows, results };
}
