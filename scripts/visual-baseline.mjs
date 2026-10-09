// Visual-regression baseline: deterministic screenshots of every level at fixed spots.
//
//   node scripts/visual-baseline.mjs [--tag base] [--levels l1,l2,l3,l4,l5] [--url http://127.0.0.1:5173/]
//        [--q high] [--freeze 12.5] [--w 1920 --h 1080] [--frames 6] [--browser chrome|msedge] [--logs]
//        [--spots gate,term-t2]   only these spot names (quick checks; compare with --subset)
//
// Every level loads in a fresh browser context (clean save) with
//   ?level=<id>&skipMenu=1&noui=1&autoui=1&q=<q>&freeze=<s>
// (`freeze` pins the simulation clock, see src/engine/freeze.ts; `noui` keeps the DOM overlay out of the
// picture). Spots: the spawn, every terminal (where the robot stands to use it), the gate, and up to 3
// mid-route points (zone centres, NPC spots, then halfway between route spots; none within reach of a chip, so nothing is picked up,
// and none next to a spot already taken). Per spot: `teleport` (the camera snaps), a few frames, a shot.
// Output: .shots/baseline/<tag>/<level>-<spot>.png + manifest.json (URL, spot, robot tile, stats() per shot).
// Exit code 1 on any console error or failed step. Compare two tags with scripts/visual-compare.mjs.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchBrowser, openPage, waitReady } from './lib/browser.mjs';

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
const tag = String(args.tag ?? 'base');
const levels = String(args.levels ?? 'l1,l2,l3,l4,l5').split(',').map((s) => s.trim()).filter(Boolean);
const base = String(args.url ?? 'http://127.0.0.1:5173/');
const quality = String(args.q ?? 'high');
const freezeAt = String(args.freeze ?? '12.5');
const width = Number(args.w ?? 1920);
const height = Number(args.h ?? 1080);
const settleFrames = Number(args.frames ?? 6);
const onlySpots = args.spots && args.spots !== true ? new Set(String(args.spots).split(',').map((x) => x.trim())) : null;
const outDir = resolve('.shots/baseline', tag);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

function levelUrl(level) {
  const u = new URL(base);
  for (const [k, v] of Object.entries({ level, skipMenu: '1', noui: '1', autoui: '1', q: quality, freeze: freezeAt })) u.searchParams.set(k, v);
  return u.toString();
}

/** Fixed spot list of a level, from the debug API and the level data. */
function pickSpots(spots, lessons) {
  const list = [{ name: 'spawn', ...spots.spawn }];
  for (const id of lessons.terminals) if (spots.terminals[id]) list.push({ name: `term-${id}`, ...spots.terminals[id] });
  list.push({ name: 'gate', ...spots.gate });
  // mid-route points: away from chips (no pickup) and from the spots already taken (no duplicate views)
  const chips = Object.values(spots.chips);
  const far = (p, others, d) => others.every((o) => Math.hypot(o.col - p.col, o.row - p.row) > d);
  const candidates = [
    ...lessons.zones.map((id) => ({ name: `mid-${id}`, ...spots.zones[id] })),
    ...lessons.npcs.map((id) => ({ name: `mid-npc-${id}`, ...spots.npcs[id] })),
  ];
  // fallback: halfway between consecutive spots of the route (spawn → terminals → gate)
  const route = [...list];
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    candidates.push({ name: `mid-${a.name.replace(/^term-/, '')}-${b.name.replace(/^term-/, '')}`, col: (a.col + b.col) / 2, row: (a.row + b.row) / 2 });
  }
  let mids = 0;
  for (const c of candidates) {
    if (mids >= 3 || !Number.isFinite(c.col) || !far(c, chips, 1.5) || !far(c, list, 2.5)) continue;
    list.push(c);
    mids++;
  }
  return list;
}

const manifest = {
  tag,
  created: new Date().toISOString(),
  params: { url: base, q: quality, freeze: Number(freezeAt), noui: 1, width, height, dpr: 1, settleFrames },
  browser: '',
  shots: [],
  problems: {},
};
let failed = false;

const browser = await launchBrowser({ browser: args.browser });
manifest.browser = browser.version();
try {
  for (const level of levels) {
    const url = levelUrl(level);
    console.log(`\n[${level}] ${url}`);
    const { page, problems, logs } = await openPage(browser, { width, height, scale: 1 });
    const api = (body) => page.evaluate(`(() => { const H = window.__harnest; ${body} })()`);
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 60000 });
      if (!(await waitReady(page, undefined, 120000))) throw new Error('game not ready');
      await page.waitForFunction(`window.__harnest.state() === 'playing'`, undefined, { timeout: 30000, polling: 50 });
      const backend = await api('return H.backend');
      if (backend !== 'webgpu') throw new Error(`backend is ${backend}, expected webgpu`);
      const spots = await api('return H.spots()');
      const lessons = await page.evaluate(async (id) => {
        const m = await import('/src/content/index.ts');
        const l = m.getLevel(id);
        return {
          terminals: l.lessons.terminals.map((t) => t.id),
          npcs: l.lessons.npcs.map((n) => n.id),
          zones: Object.keys(l.layout.zones),
        };
      }, level);
      for (const spot of pickSpots(spots, lessons)) {
        if (onlySpots && !onlySpots.has(spot.name)) continue;
        await api(`H.teleport(${spot.col}, ${spot.row})`);
        // frames after the teleport: the frozen loop settles everything in the first one
        const f0 = await api('return H.stats().frames');
        await page.waitForFunction(`window.__harnest.stats().frames >= ${f0 + settleFrames}`, undefined, { timeout: 20000, polling: 'raf' });
        const file = `${level}-${spot.name}.png`;
        await page.screenshot({ path: resolve(outDir, file) });
        const s = await api('return H.stats()');
        const player = await api('return H.player()');
        const state = await api('return H.state()');
        manifest.shots.push({
          file,
          level,
          spot: spot.name,
          tile: { col: spot.col, row: spot.row },
          player,
          state,
          url,
          eval: `__harnest.teleport(${spot.col}, ${spot.row})`,
          stats: { drawCalls: s.drawCalls, triangles: s.triangles, lights: s.lights, instances: s.instances, quality: s.quality },
        });
        console.log(`  ${file.padEnd(28)} draws ${String(s.drawCalls).padStart(4)}  tris ${String(s.triangles).padStart(8)}  lights ${s.lights}  robot ${player.col},${player.row}  ${state}`);
      }
    } catch (err) {
      failed = true;
      problems.push(`[script] ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (problems.length) {
        failed = true;
        manifest.problems[level] = problems;
        console.log(`  PROBLEMS:\n    ${problems.join('\n    ')}`);
      }
      if (args.logs) console.log(logs.join('\n'));
      await page.context().close();
    }
  }
} finally {
  await browser.close();
}

writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\n${manifest.shots.length} shots → ${outDir}${failed ? '  (FAILED: see problems)' : ''}`);
process.exitCode = failed ? 1 : 0;
