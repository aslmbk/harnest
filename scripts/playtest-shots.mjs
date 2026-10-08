// Standard engine screenshot set, for visual checks after render / layout changes:
//   play.png         ?skipMenu=1&autoui=1 with the UI (what a player sees)
//   map.png          ?view=map, the whole layout from above (with the UI)
//   close.png        close-up camera at the first terminal, as when a terminal is open (no UI)
//   occlusion.png    the robot pressed against the north wall of a building: dithered cut-out
//   occlusion-off.png  the same frame with the cut-out disabled, for comparison
//
//   node scripts/playtest-shots.mjs [--url http://127.0.0.1:5173/] [--level l1] [--q high]
//        [--out .shots/engine] [--only play,map,close,occlusion] [--occlude col,row]
//        [--browser chrome|msedge]
//
// Fails on console errors. Gameplay spots come from window.__harnest.spots(); the occlusion spot is
// picked automatically (a street tile with a building right to the south) unless --occlude is given.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { holdKeys, launchBrowser, openPage, waitReady } from './lib/browser.mjs';

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
const outDir = resolve(String(args.out ?? '.shots/engine'));
const only = args.only ? String(args.only).split(',') : ['play', 'map', 'close', 'occlusion'];
mkdirSync(outDir, { recursive: true });

function pageUrl(extra) {
  const u = new URL(base);
  u.searchParams.set('skipMenu', '1');
  u.searchParams.set('autoui', '1');
  u.searchParams.set('q', String(args.q ?? 'high'));
  if (args.level) u.searchParams.set('level', String(args.level));
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return u.toString();
}

const results = [];
const browser = await launchBrowser({ browser: args.browser });

async function shot(name, extra, prepare) {
  const { page, problems } = await openPage(browser, { width: 1280, height: 720 });
  try {
    await page.goto(pageUrl(extra), { waitUntil: 'load', timeout: 60000 });
    if (!(await waitReady(page, undefined, 60000))) throw new Error('not ready');
    await page.waitForFunction(() => window.__harnest.state() === 'playing', undefined, { timeout: 20000 });
    const note = (await prepare?.(page)) ?? '';
    const file = resolve(outDir, `${name}.png`);
    await page.screenshot({ path: file });
    results.push({ name, ok: problems.length === 0, file, note, problems });
  } catch (err) {
    results.push({ name, ok: false, note: String(err?.message ?? err), problems });
  } finally {
    await page.context().close();
  }
}

try {
  if (only.includes('play')) {
    await shot('play', {}, async (page) => {
      await page.waitForTimeout(2000);
    });
  }

  if (only.includes('map')) {
    await shot('map', { view: 'map' }, async (page) => {
      await page.waitForTimeout(1500);
    });
  }

  if (only.includes('close')) {
    await shot('close', { noui: '1' }, async (page) => {
      const id = await page.evaluate(() => Object.keys(window.__harnest.spots().terminals)[0]);
      if (!id) return 'no terminal';
      await page.evaluate((tid) => {
        const h = window.__harnest;
        const spot = h.spots().terminals[tid];
        h.teleport(spot.col, spot.row);
      }, id);
      // drive into the terminal so the robot faces it, then frame it like an open terminal does
      const dir = await page.evaluate((tid) => {
        const g = window.__harnest.internals.game;
        const t = g.runtime.terminals.get(tid);
        const dx = t.pose.x - g.player.x;
        const dz = t.pose.z - g.player.z;
        return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'KeyD' : 'KeyA') : dz > 0 ? 'KeyS' : 'KeyW';
      }, id);
      await holdKeys(page, `${dir}:250`);
      await page.evaluate((tid) => {
        const { game: g, engine: e } = window.__harnest.internals;
        const t = g.runtime.terminals.get(tid);
        e.rig.setCloseTarget((t.pose.x + g.player.x) / 2, 0.9, (t.pose.z + g.player.z) / 2);
        e.rig.mode = 'close';
      }, id);
      await page.waitForTimeout(2200);
      return `terminal ${id}`;
    });
  }

  if (only.includes('occlusion')) {
    const findSpot = async (page) =>
      page.evaluate((forced) => {
        if (forced) {
          const [col, row] = forced.split(',').map(Number);
          return { col, row };
        }
        const grid = window.__harnest.internals.game.runtime.plan.grid;
        const cx = grid.width / 2;
        const cy = grid.height / 2;
        let best = null;
        let bestD = Infinity;
        for (let r = 1; r < grid.height - 1; r++) {
          for (let c = 1; c < grid.width - 1; c++) {
            const street = grid.walkable(c, r) && grid.walkable(c - 1, r) && grid.walkable(c + 1, r);
            const wall = grid.isBuilding(c, r + 1) && grid.isBuilding(c - 1, r + 1) && grid.isBuilding(c + 1, r + 1);
            if (!street || !wall) continue;
            const d = Math.hypot(c - cx, r - cy);
            if (d < bestD) {
              bestD = d;
              best = { col: c, row: r };
            }
          }
        }
        return best;
      }, args.occlude ? String(args.occlude) : null);

    const pressAgainstWall = async (page) => {
      const spot = await findSpot(page);
      if (!spot) return null;
      await page.evaluate(({ col, row }) => window.__harnest.teleport(col, row), spot);
      await holdKeys(page, 'KeyS:450');
      await page.waitForTimeout(1200);
      return spot;
    };

    await shot('occlusion', { noui: '1' }, async (page) => {
      const spot = await pressAgainstWall(page);
      return spot ? `tile ${spot.col},${spot.row}` : 'no spot found';
    });
    await shot('occlusion-off', { noui: '1' }, async (page) => {
      const spot = await pressAgainstWall(page);
      // through the live object: a fresh import() could load another module instance (Vite ?t= urls)
      await page.evaluate(() => {
        window.__harnest.internals.occlusion.strength.value = 0;
      });
      await page.waitForTimeout(300);
      return spot ? `tile ${spot.col},${spot.row}, cut-out off` : 'no spot found';
    });
  }
} finally {
  await browser.close();
}

for (const r of results) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name.padEnd(14)} ${r.note}${r.file ? `  → ${r.file}` : ''}`);
  for (const p of r.problems) console.log(`       ${p}`);
}
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
