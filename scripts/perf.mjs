// Performance probe: frame time, draw calls and triangles at a few spots of a level.
//
//   node scripts/perf.mjs [--url http://127.0.0.1:5173/] [--level l1] [--q medium] [--w 1920 --h 1080]
//        [--spots spawn,t1,t2,plaza] [--seconds 4] [--shots .shots/engine2/perf] [--passes]
//
// For every spot: teleports the robot there, waits, then samples frame times for `seconds`
// (headless Chrome is not vsync-locked, so fps above 60 shows headroom). `--passes` also measures the
// main pass alone (shadows and street reflection off) to show what each pass costs.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { openPage, waitReady } from './lib/browser.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true;
    else out[a.slice(2)] = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const base = String(args.url ?? 'http://127.0.0.1:5173/');
const q = String(args.q ?? 'medium');
const level = args.level ? String(args.level) : null;
const width = Number(args.w ?? 1920);
const height = Number(args.h ?? 1080);
const seconds = Number(args.seconds ?? 4);
const shots = args.shots ? resolve(String(args.shots)) : null;
if (shots) mkdirSync(shots, { recursive: true });

const u = new URL(base);
u.searchParams.set('skipMenu', '1');
u.searchParams.set('autoui', '1');
u.searchParams.set('noui', '1');
u.searchParams.set('q', q);
if (level) u.searchParams.set('level', level);

// uncapped frame rate (no vsync), so the numbers show headroom above 60 fps
const browser = await chromium.launch({
  channel: String(args.browser ?? process.env.HARNEST_BROWSER ?? 'chrome'),
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--mute-audio', '--enable-unsafe-webgpu', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
});
const rows = [];
try {
  const { page, problems } = await openPage(browser, { width, height });
  await page.goto(u.toString(), { waitUntil: 'load', timeout: 60000 });
  if (!(await waitReady(page, undefined, 90000))) throw new Error('not ready');
  await page.waitForFunction(() => window.__harnest.state() === 'playing', undefined, { timeout: 30000 });
  const info = await page.evaluate(async () => {
    const a = await navigator.gpu?.requestAdapter?.();
    const i = a?.info ?? {};
    return { vendor: i.vendor, arch: i.architecture, device: i.device, description: i.description };
  });
  console.log(`gpu: ${JSON.stringify(info)}  ${width}×${height} q=${q}`);
  const spotsAll = await page.evaluate(() => window.__harnest.spots());
  const wanted = args.spots ? String(args.spots).split(',') : ['spawn', ...Object.keys(spotsAll.terminals), 'gate'];
  const spotOf = (name) => {
    if (name === 'spawn') return spotsAll.spawn;
    if (name === 'gate') return { col: spotsAll.gate.col, row: spotsAll.gate.row + 1.5 };
    if (spotsAll.terminals[name]) return spotsAll.terminals[name];
    if (spotsAll.npcs[name]) return spotsAll.npcs[name];
    if (spotsAll.chips[name]) return spotsAll.chips[name];
    const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(name);
    return m ? { col: Number(m[1]), row: Number(m[2]) } : null;
  };
  const sample = (secs) =>
    page.evaluate(async (s) => {
      const H = window.__harnest;
      const times = [];
      let last = performance.now();
      const end = last + s * 1000;
      let calls = 0;
      let tris = 0;
      let n = 0;
      await new Promise((done) => {
        const tick = () => {
          const now = performance.now();
          times.push(now - last);
          last = now;
          const st = H.stats();
          calls += st.drawCalls;
          tris += st.triangles;
          n++;
          if (now < end) requestAnimationFrame(tick);
          else done();
        };
        requestAnimationFrame(tick);
      });
      times.shift();
      times.sort((a, b) => a - b);
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      return { avgMs: avg, p95: times[Math.floor(times.length * 0.95)], fps: 1000 / avg, calls: Math.round(calls / n), tris: Math.round(tris / n) };
    }, secs);
  for (const name of wanted) {
    const spot = spotOf(name);
    if (!spot) continue;
    await page.evaluate(({ col, row }) => window.__harnest.teleport(col, row), spot);
    await page.waitForTimeout(1200);
    const all = await sample(seconds);
    const row = { spot: name, ...all };
    if (args.passes) {
      await page.evaluate(() => {
        const { engine, game } = window.__harnest.internals;
        engine.renderer.shadowMap.enabled = false;
        game.runtime.built.applyPreset({ ...engine.preset, reflection: 0 });
      });
      await page.waitForTimeout(600);
      const main = await sample(Math.max(2, seconds / 2));
      row.mainCalls = main.calls;
      row.mainTris = main.tris;
      row.mainMs = main.avgMs;
      await page.evaluate(() => {
        const { engine, game } = window.__harnest.internals;
        engine.renderer.shadowMap.enabled = engine.preset.shadows;
        game.runtime.built.applyPreset(engine.preset);
      });
      await page.waitForTimeout(600);
    }
    if (shots) await page.screenshot({ path: resolve(shots, `${q}-${name}.png`) });
    rows.push(row);
    console.log(
      `${name.padEnd(8)} ${row.fps.toFixed(0).padStart(4)} fps  avg ${row.avgMs.toFixed(1)} ms  p95 ${row.p95.toFixed(1)} ms  calls ${row.calls}  tris ${(row.tris / 1000).toFixed(0)}k` +
        (row.mainCalls !== undefined ? `   | main pass only: calls ${row.mainCalls} tris ${(row.mainTris / 1000).toFixed(0)}k ${row.mainMs.toFixed(1)} ms` : ''),
    );
  }
  if (problems.length) console.log('problems:', problems.slice(0, 5));
} finally {
  await browser.close();
}
