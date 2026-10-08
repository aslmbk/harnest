/**
 * Dev harness for /audio-dev.html: drives the real audio director through a local bus and store
 * (every sfx, scenes per district, game states, music events, motor), shows a level meter, and runs
 * the offline checks. Also exposes window.__audioDev for scripts/audio-check.mjs.
 */
import { EventBus, type GameEvents, type GameState, type SfxName } from '../../core/events';
import { Store } from '../../core/store';
import { type AudioDirector, createAudioDirector } from '../director';
import type { AudioEngine } from '../engine';
import { createAudio } from '../index';
import { SFX_NAMES } from '../sfx';
import { type CheckReport, runChecks } from './checks';
import { devResolveLevel, districtInputs } from './levels';

const STATES: GameState[] = ['menu', 'loading', 'intro', 'playing', 'dialog', 'terminal', 'paused', 'levelComplete', 'ending'];
const checkMode = new URLSearchParams(location.search).has('check');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ───────────────────────────── realtime smoke test (used by audio-check.mjs) ─────────────────────────────

let smoke: { bus: EventBus<GameEvents>; store: Store; audio: AudioDirector } | null = null;

function smokeStart(): { runtimeBeforeGesture: boolean } {
  const bus = new EventBus<GameEvents>();
  const store = new Store(null);
  const audio = createAudio({ bus, store }) as AudioDirector;
  smoke = { bus, store, audio };
  bus.emit('state:changed', { from: 'boot', to: 'menu' });
  bus.emit('sfx', { name: 'uiMove' }); // before the gesture: queued/skipped, must not throw
  return { runtimeBeforeGesture: audio.debug.runtime !== null };
}

async function smokeRun(): Promise<Record<string, unknown>> {
  if (!smoke) throw new Error('smokeStart() first');
  const { bus, store, audio } = smoke;
  const rt = audio.debug.runtime;
  if (!rt) return { ok: false, detail: 'no AudioContext after the gesture' };
  await sleep(250);
  const running = rt.ctx.state;
  const ctx = rt.ctx as AudioContext;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  (rt.engine as AudioEngine).output.connect(analyser);

  bus.emit('level:ready', { levelId: 'l1' });
  bus.emit('state:changed', { from: 'loading', to: 'intro' });
  bus.emit('state:changed', { from: 'intro', to: 'playing' });
  bus.emit('player:motion', { speed: 0.8 });
  for (const name of SFX_NAMES) bus.emit('sfx', { name });
  bus.emit('objectives:changed', { levelId: 'l1', items: [], gateOpen: true });
  bus.emit('gate:opened', { levelId: 'l1' });
  bus.emit('chip:collected', { levelId: 'l1', chipId: 'c1' });
  store.setSettings({ master: 0.6, music: 0.3, sfx: 0.9 });

  // Sample the output for a second.
  const data = new Float32Array(analyser.fftSize);
  let peak = 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < 20; i++) {
    await sleep(60);
    analyser.getFloatTimeDomainData(data);
    for (const x of data) {
      peak = Math.max(peak, Math.abs(x));
      sum += x * x;
      count++;
    }
  }
  bus.emit('state:changed', { from: 'playing', to: 'terminal' });
  bus.emit('player:motion', { speed: 0 });
  await sleep(200);
  const stats = rt.engine.stats?.() ?? null;
  audio.dispose();
  await sleep(150);
  const closed = rt.ctx.state;
  smoke = null;
  const rmsDb = count ? 10 * Math.log10(sum / count || 1e-20) : -Infinity;
  return {
    ok: running === 'running' && closed === 'closed',
    running,
    closed,
    peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
    rmsDb,
    stats,
  };
}

declare global {
  interface Window {
    __audioDev?: {
      ready: boolean;
      runChecks: typeof runChecks;
      smokeStart: typeof smokeStart;
      smokeRun: typeof smokeRun;
    };
  }
}

window.__audioDev = { ready: true, runChecks, smokeStart, smokeRun };

// ───────────────────────────── interactive harness ─────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function section(title: string, ...children: (Node | string)[]): HTMLElement {
  return el('section', {}, el('h2', { textContent: title }), ...children);
}

function spacer(): HTMLDivElement {
  const d = el('div');
  d.style.height = '8px';
  return d;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  return el('button', { textContent: label, onclick: onClick });
}

function slider(label: string, value: number, onInput: (v: number) => void): HTMLLabelElement {
  const out = el('span', { textContent: value.toFixed(2) });
  const input = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(value) });
  input.oninput = () => {
    out.textContent = Number(input.value).toFixed(2);
    onInput(Number(input.value));
  };
  return el('label', {}, label, input, out);
}

function reportTable(report: CheckReport): HTMLElement {
  const db = (x: number | undefined) => (x === undefined ? '' : Number.isFinite(x) ? x.toFixed(1) : '-inf');
  const head = el('tr', {}, ...['group', 'name', 'dur s', 'peak dBFS', 'rms dBFS', '50ms rms', 'raw peak'].map((h) => el('th', { textContent: h })));
  const body = report.rows.map((r) =>
    el(
      'tr',
      {},
      ...[r.group, r.name, r.duration.toFixed(2), db(r.peakDb), db(r.rmsDb), db(r.maxRmsDb), db(r.rawPeakDb)].map((c) => el('td', { textContent: c })),
    ),
  );
  const failed = report.results.filter((r) => !r.ok);
  const summary = el(
    'p',
    { className: failed.length ? 'bad' : 'ok' },
    `${report.results.length - failed.length}/${report.results.length} checks passed in ${report.ms} ms`,
  );
  const failures = failed.map((f) => el('div', { className: 'bad', textContent: `✗ ${f.name}: ${f.detail}` }));
  return el('div', {}, summary, ...failures, el('table', {}, head, ...body));
}

/** Builds the interactive page. Returns a teardown (used on hot reload). */
function buildHarness(): () => void {
  const app = document.getElementById('app');
  if (!app) return () => {};
  const bus = new EventBus<GameEvents>();
  const store = new Store(null);
  const audio = createAudioDirector({ bus, store }, { resolveLevel: devResolveLevel, seed: 1234 });
  let state: GameState = 'boot';
  const go = (to: GameState) => {
    bus.emit('state:changed', { from: state, to });
    state = to;
  };

  const status = el('div', { id: 'status', textContent: 'click to start audio' });
  const meterBar = el('div');
  const meter = el('div', { id: 'meter' }, meterBar);

  // Scenes
  const scenes = el('div', { className: 'row' });
  scenes.append(button('Menu', () => go('menu')));
  for (const input of districtInputs()) {
    scenes.append(
      button(`L${input.index} · rain ${input.mood.rain.toFixed(2)}`, () => {
        go('loading');
        bus.emit('level:ready', { levelId: input.id });
        go('intro');
        go('playing');
      }),
    );
  }

  const states = el('div', { className: 'row' }, ...STATES.map((s) => button(s, () => go(s))));

  const levelId = () => audio.debug.scene?.replace('level:', '') ?? 'l1';
  const music = el(
    'div',
    { className: 'row' },
    button('gate:opened', () => bus.emit('gate:opened', { levelId: levelId() })),
    button('gate closed (objectives)', () => bus.emit('objectives:changed', { levelId: levelId(), items: [], gateOpen: false })),
    button('chip:collected', () => bus.emit('chip:collected', { levelId: levelId(), chipId: 'c1' })),
    button('level:completed', () =>
      bus.emit('level:completed', { levelId: levelId(), stats: { stars: 9, maxStars: 9, chips: 4, maxChips: 4, timeSec: 300 }, isLast: false }),
    ),
  );

  // Motor
  let speed = 0;
  let drive = -1;
  const motorSlider = slider('speed', 0, (v) => {
    speed = v;
    bus.emit('player:motion', { speed: v });
  });
  const driveButton = button('auto-drive', () => {
    if (drive >= 0) {
      clearInterval(drive);
      drive = -1;
      driveButton.classList.remove('on');
      bus.emit('player:motion', { speed: (speed = 0) });
      return;
    }
    driveButton.classList.add('on');
    let t = 0;
    drive = window.setInterval(() => {
      t += 0.1;
      // drive, brake, idle, steer: a rough player-like pattern
      const phase = t % 8;
      const target = phase < 3 ? 1 : phase < 4 ? 0.35 : phase < 5.5 ? 0 : 0.7;
      speed += (target - speed) * 0.35;
      if (speed < 0.02) speed = 0;
      bus.emit('player:motion', { speed });
    }, 100);
  });

  // One-shots
  const sfx = el('div', { className: 'row' }, ...SFX_NAMES.map((name) => button(name, () => bus.emit('sfx', { name }))));
  const burst = (name: SfxName, n: number, gap: () => number) => {
    let i = 0;
    const next = () => {
      bus.emit('sfx', { name });
      if (++i < n) setTimeout(next, gap());
    };
    next();
  };
  const bursts = el(
    'div',
    { className: 'row' },
    button('typing burst', () => burst('key', 28, () => 45 + Math.random() * 110)),
    button('dialog burst', () => burst('talk', 22, () => 55 + Math.random() * 30)),
    button('menu scroll', () => burst('uiMove', 6, () => 120)),
  );

  // Offline checks
  const checkOut = el('div', { className: 'hint', textContent: 'Renders every sound offline and checks levels (also: node scripts/audio-check.mjs).' });
  const checkButton = button('run offline checks', async () => {
    checkButton.disabled = true;
    try {
      const report = await runChecks((m) => (checkOut.textContent = `rendering ${m}…`));
      checkOut.replaceChildren(reportTable(report));
    } catch (err) {
      checkOut.textContent = String(err);
    } finally {
      checkButton.disabled = false;
    }
  });

  const intro = [...app.childNodes];
  app.append(
    section('status', status, meter),
    section(
      'volumes (store settings)',
      el(
        'div',
        { className: 'row' },
        slider('master', store.settings.master, (v) => store.setSettings({ master: v })),
        slider('music', store.settings.music, (v) => store.setSettings({ music: v })),
        slider('sfx', store.settings.sfx, (v) => store.setSettings({ sfx: v })),
      ),
    ),
    section('scene (level:ready + states)', scenes),
    section('game state', states),
    section('music events', music),
    section('motor (player:motion)', el('div', { className: 'row' }, motorSlider, driveButton)),
    section('one-shots (sfx)', sfx, spacer(), bursts),
    section('offline checks', checkButton, spacer(), checkOut),
  );

  // Status + meter
  let analyser: AnalyserNode | null = null;
  const data = new Float32Array(1024);
  const statusTimer = setInterval(() => {
    const rt = audio.debug.runtime;
    if (rt && !analyser) {
      const ctx = rt.ctx as AudioContext;
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      (rt.engine as AudioEngine).output.connect(analyser);
    }
    let level = '';
    if (analyser) {
      analyser.getFloatTimeDomainData(data);
      let peak = 0;
      let sum = 0;
      for (const x of data) {
        peak = Math.max(peak, Math.abs(x));
        sum += x * x;
      }
      const rms = Math.sqrt(sum / data.length);
      const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -100;
      const peakDb = peak > 0 ? 20 * Math.log10(peak) : -100;
      meterBar.style.width = `${Math.max(0, Math.min(100, (rmsDb + 60) * (100 / 60)))}%`;
      level = `   rms ${rmsDb.toFixed(1)} dBFS   peak ${peakDb.toFixed(1)} dBFS`;
    }
    const s = rt?.engine.stats?.();
    status.textContent = rt
      ? `context ${rt.ctx.state} · state ${audio.debug.state} · scene ${s?.scene ?? '-'} · bright ${audio.debug.bright} · sfx voices ${s?.sfxVoices ?? 0} · motor ${s?.motor ? 'on' : 'off'} · fading ${s?.fading ?? 0}${level}`
      : 'click anywhere to start audio';
  }, 120);

  return () => {
    clearInterval(statusTimer);
    if (drive >= 0) clearInterval(drive);
    audio.dispose();
    app.replaceChildren(...intro);
  };
}

const teardown = checkMode ? () => {} : buildHarness();

// Other agents edit content files this page imports: accept hot updates here (rebuild the page)
// instead of letting Vite reload it, which would kill a running check.
if (import.meta.hot) {
  import.meta.hot.dispose(teardown);
  import.meta.hot.accept();
}
