// Scripted playtest of the whole level flow against the running dev server.
//
//   node scripts/playtest.mjs [--url http://127.0.0.1:5173/] [--level l1] [--q low] [--noui]
//        [--shots .shots/engine/playtest] [--only flow|keys] [--browser chrome|msedge]
//
// 1. flow  (?skipMenu=1&autoui=1): zone bark at the spawn → a locked terminal refuses → every terminal
//    in dependency order (real E key) → NPC dialog → chip → the gate opens → pause / restart and
//    quit / play keep the progress → the exit completes the level. Asserts states, bus events (order,
//    store before chip:collected, stars and codex after a terminal), the game's sfx (one per action,
//    no doubles) and zero console errors.
// 2. keys  (real held keys): W moves the robot north, a wall stops it, W+D slides along the wall,
//    keys do nothing while paused, `player:motion` reports speed.
//
// Exit code 0 when every check passes. Uses only the `window.__harnest` debug API (see src/engine/debug.ts).
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { holdKeys, launchBrowser, openPage, waitReady } from './lib/browser.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else out[key] = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const base = String(args.url ?? 'http://127.0.0.1:5173/');
const level = String(args.level ?? 'l1');
const quality = String(args.q ?? 'low');
const shotsDir = resolve(String(args.shots ?? '.shots/engine/playtest'));
mkdirSync(shotsDir, { recursive: true });

const results = [];
let scenario = '';
function check(name, ok, detail = '') {
  results.push({ scenario, name, ok: !!ok, detail });
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  return !!ok;
}

function gameUrl(extra = '') {
  const q = new URLSearchParams({ skipMenu: '1', autoui: '1', level, q: quality });
  if (args.noui) q.set('noui', '1');
  return `${base}?${q}${extra}`;
}

/** Page helpers bound to one page. */
function helpers(page) {
  const h = (expr, arg) => page.evaluate(expr, arg);
  const api = (body) => page.evaluate(`(() => { const H = window.__harnest; ${body} })()`);
  const waitFor = async (expr, timeout = 10000) => {
    try {
      await page.waitForFunction(expr, undefined, { timeout, polling: 50 });
      return true;
    } catch {
      return false;
    }
  };
  const waitState = (s, timeout = 10000) => waitFor(`window.__harnest?.state() === ${JSON.stringify(s)}`, timeout);
  const eventCount = () => api('return H.events.length');
  /** Events (type + payload) recorded since index `from`. */
  const eventsSince = (from, type) =>
    api(`return H.events.slice(${from}).filter((e) => ${type ? `e.type === ${JSON.stringify(type)}` : 'true'})`);
  /** Names of the `sfx` events since index `from` (optionally only up to index `to`). */
  const sfxSince = async (from, to) => (await api(`return H.events.slice(${from}${to !== undefined ? `, ${to}` : ''}).filter((e) => e.type === 'sfx').map((e) => e.payload.name)`));
  const count = (list, name) => list.filter((n) => n === name).length;
  const waitEvent = (from, type, timeout = 5000) =>
    waitFor(`window.__harnest.events.slice(${from}).some((e) => e.type === ${JSON.stringify(type)})`, timeout);
  const teleport = async (spot) => {
    await api(`H.teleport(${spot.col}, ${spot.row})`);
    await page.waitForTimeout(250); // a few frames: prompt / pickups update
  };
  /** Waits until the prompt points at `id` (or the timeout), returns the prompt. */
  const promptFor = async (id, timeout = 2000) => {
    await waitFor(`window.__harnest.prompt()?.id === ${JSON.stringify(id)}`, timeout);
    return api('return H.prompt()');
  };
  return { h, api, waitFor, waitState, eventCount, eventsSince, sfxSince, count, waitEvent, teleport, promptFor };
}

async function newGamePage(browser) {
  const { page, problems, logs } = await openPage(browser, { width: 1280, height: 720 });
  let reloads = -1;
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) reloads++;
  });
  await page.goto(gameUrl(), { waitUntil: 'load', timeout: 60000 });
  const ready = await waitReady(page, undefined, 90000);
  return { page, problems, logs, ready, reloads: () => reloads };
}

/** Terminal ids sorted so that every terminal comes after the ones it requires. */
function dependencyOrder(terminals) {
  const done = new Set();
  const out = [];
  let guard = 0;
  while (out.length < terminals.length && guard++ < 100) {
    for (const t of terminals) {
      if (done.has(t.id)) continue;
      if ((t.requires ?? []).every((r) => done.has(r))) {
        out.push(t);
        done.add(t.id);
      }
    }
  }
  return out;
}

async function flowScenario(browser) {
  scenario = 'flow';
  console.log(`\n[flow] ${gameUrl()}`);
  const { page, problems, logs, ready, reloads } = await newGamePage(browser);
  const { api, waitFor, waitState, eventCount, eventsSince, sfxSince, count, waitEvent, teleport, promptFor } = helpers(page);
  try {
    if (!check('game ready', ready)) return;
    check('level id', (await api('return H.level()')) === level);
    check('reaches playing after intro', await waitState('playing'));

    const states = (await eventsSince(0, 'state:changed')).map((e) => e.payload.to);
    check('state path boot → loading → intro → playing', states.join(',').endsWith('loading,intro,playing'), states.join(' → '));
    check('level:ready sent', (await eventsSince(0, 'level:ready')).length === 1);
    {
      const order = await api(`return H.events.map((e) => e.type === 'state:changed' ? 'state:' + e.payload.to : e.type)`);
      const ready = order.indexOf('level:ready');
      const intro = order.indexOf('state:intro');
      check('level:ready before the intro', ready >= 0 && intro > ready, `level:ready #${ready}, intro #${intro}`);
    }
    const objectives = await eventsSince(0, 'objectives:changed');
    check('objectives:changed sent', objectives.length >= 1, `${objectives.at(-1)?.payload.items.length ?? 0} items`);
    check('renderer:info sent', (await eventsSince(0, 'renderer:info')).length === 1);

    const spots = await api('return H.spots()');
    check('spots() available', !!spots && Object.keys(spots.terminals).length > 0);
    const lessons = await page.evaluate(async (id) => {
      const m = await import('/src/content/index.ts');
      const l = m.getLevel(id).lessons;
      return {
        terminals: l.terminals.map((t) => ({ id: t.id, required: t.required, requires: t.requires ?? [] })),
        npcs: l.npcs.map((n) => n.id),
        chips: l.chips.map((c) => c.id),
        zones: l.zones.map((z) => z.id),
      };
    }, level);

    // zone bark at the spawn (if the spawn is inside a zone)
    if (lessons.zones.length) {
      const barks = (await eventsSince(0, 'toast')).filter((e) => e.payload.kind === 'bark');
      check('zone bark toast', barks.length >= 1 || !(await api('return H.spots()')).zones, barks[0]?.payload.text ?? 'no zone at the spawn');
    }

    // a locked terminal refuses
    const locked = lessons.terminals.find((t) => t.requires.length);
    if (locked) {
      await teleport(spots.terminals[locked.id]);
      const prompt = await promptFor(locked.id);
      check(`prompt for locked ${locked.id}`, prompt?.id === locked.id && prompt.locked === true, JSON.stringify(prompt));
      const from = await eventCount();
      await page.keyboard.press('KeyE');
      check('locked terminal → warn toast', await waitFor(`window.__harnest.events.slice(${from}).some((e) => e.type === 'toast' && e.payload.kind === 'warn')`, 2000));
      check('locked terminal stays in playing', (await api('return H.state()')) === 'playing');
      check('no terminal:open for a locked terminal', (await eventsSince(from, 'terminal:open')).length === 0);
      const sfx = await sfxSince(from);
      check('locked terminal → one "locked" sfx, no "interact"', count(sfx, 'locked') === 1 && count(sfx, 'interact') === 0, sfx.join(','));
    }

    // every terminal, in dependency order, with the real E key
    let gateOpenedAt = -1;
    for (const t of dependencyOrder(lessons.terminals)) {
      await teleport(spots.terminals[t.id]);
      const prompt = await promptFor(t.id);
      check(`prompt ${t.id}`, prompt?.kind === 'terminal' && prompt.id === t.id && !prompt.locked, JSON.stringify(prompt));
      const from = await eventCount();
      await page.keyboard.press('KeyE');
      check(`${t.id}: state terminal`, await waitState('terminal', 3000));
      const opened = await eventsSince(from, 'terminal:open');
      check(`${t.id}: terminal:open`, opened.length === 1 && opened[0].payload.terminalId === t.id);
      if (t === dependencyOrder(lessons.terminals)[0]) await page.screenshot({ path: resolve(shotsDir, 'terminal.png') });
      check(`${t.id}: back to playing`, await waitState('playing', 3000));
      const obj = (await api('return H.objectives()')).find((o) => o.id === t.id);
      check(`${t.id}: objective done`, obj?.done === true);
      const sfx = await sfxSince(from);
      check(`${t.id}: one "interact" sfx, at most one "challengeDone"`, count(sfx, 'interact') === 1 && count(sfx, 'challengeDone') <= 1, sfx.join(','));
      const saved = await page.evaluate(
        async ({ level, id }) => {
          const H = window.__harnest;
          const m = await import('/src/content/index.ts');
          const lesson = m.getLevel(level).lessons.terminals.find((x) => x.id === id);
          const store = H.internals.game.d.store;
          return { stars: store.level(level).terminals[id] ?? 0, codex: lesson.challenge.unlocks.every((c) => store.data.codex.includes(c)) };
        },
        { level, id: t.id },
      );
      check(`${t.id}: stars and codex recorded`, saved.stars > 0 && saved.codex, JSON.stringify(saved));
      if (gateOpenedAt < 0 && (await eventsSince(from, 'gate:opened')).length) gateOpenedAt = from;
    }
    const required = lessons.terminals.filter((t) => t.required).map((t) => t.id);
    check('gate:opened after all required terminals', gateOpenedAt >= 0, `required: ${required.join(', ')}`);
    const lastObj = (await eventsSince(0, 'objectives:changed')).at(-1)?.payload;
    check('objectives report gateOpen', lastObj?.gateOpen === true);
    check('one "gateOpen" sfx', count(await sfxSince(0), 'gateOpen') === 1);

    // NPC dialogs
    for (const id of lessons.npcs) {
      await teleport(spots.npcs[id]);
      const prompt = await promptFor(id);
      check(`prompt npc ${id}`, prompt?.kind === 'npc' && prompt.id === id, JSON.stringify(prompt));
      const from = await eventCount();
      await page.keyboard.press('Enter');
      check(`${id}: state dialog`, await waitState('dialog', 3000));
      const start = await eventsSince(from, 'dialog:start');
      check(`${id}: dialog:start with lines`, start.length === 1 && start[0].payload.lines.length > 0);
      const startAt = (await api(`return H.events.slice(${from}).findIndex((e) => e.type === 'dialog:start')`)) + from;
      const sfx = await sfxSince(from, startAt);
      check(`${id}: one "interact" sfx before the dialog`, count(sfx, 'interact') === 1 && count(sfx, 'talk') === 0, sfx.join(','));
      await page.screenshot({ path: resolve(shotsDir, 'dialog.png') });
      check(`${id}: back to playing`, await waitState('playing', 3000));
    }

    // chips
    await page.evaluate((level) => {
      const H = window.__harnest;
      window.__chipStore = [];
      H.bus.on('chip:collected', (p) => window.__chipStore.push(H.internals.game.d.store.level(level).chips.includes(p.chipId)));
    }, level);
    for (const id of lessons.chips) {
      const from = await eventCount();
      await teleport(spots.chips[id]);
      check(`chip ${id} collected`, await waitEvent(from, 'chip:collected', 2000));
      check(`chip ${id}: one "chip" sfx`, count(await sfxSince(from), 'chip') === 1);
    }
    if (lessons.chips.length) {
      const stored = await page.evaluate(() => window.__chipStore);
      check('store has the chip when chip:collected arrives', stored.length === lessons.chips.length && stored.every(Boolean), JSON.stringify(stored));
    }

    // pause → restart keeps the progress
    {
      let from = await eventCount();
      await api(`H.bus.emit('ui:pause', {})`);
      check('pause', await waitState('paused', 2000));
      await api(`H.bus.emit('ui:restartLevel', {})`);
      check('restart → playing', await waitState('playing', 30000) && (await eventsSince(from, 'level:ready')).length === 1);
      const obj = await api('return H.objectives()');
      check('restart keeps finished terminals', obj.every((o) => o.done), obj.map((o) => `${o.id}:${o.done}`).join(' '));
      check('restart keeps the gate open', (await eventsSince(from, 'objectives:changed')).at(-1)?.payload.gateOpen === true);
      const p = await api('return H.player()');
      check('restart puts the robot at the spawn', Math.abs(p.col - spots.spawn.col) < 0.6 && Math.abs(p.row - spots.spawn.row) < 0.6, JSON.stringify(p));
      // quit to menu → play continues with the progress
      from = await eventCount();
      await api(`H.bus.emit('ui:quitToMenu', {})`);
      check('quit → menu', await waitState('menu', 2000));
      await api(`H.bus.emit('ui:play', {})`);
      check('play again → playing', await waitState('playing', 30000));
      const chipsLeft = lessons.chips.length ? await api(`return H.internals.game.session.chips.size`) : 0;
      check('chips stay collected', chipsLeft === lessons.chips.length, `${chipsLeft}/${lessons.chips.length}`);
    }

    // exit
    {
      await page.screenshot({ path: resolve(shotsDir, 'before-exit.png') });
      const from = await eventCount();
      await teleport(spots.exit);
      check('exit → levelComplete', await waitState('levelComplete', 3000));
      const done = await eventsSince(from, 'level:completed');
      check('level:completed with stats', done.length === 1 && done[0].payload.stats.maxStars > 0, JSON.stringify(done[0]?.payload.stats));
      check('one "levelComplete" sfx', count(await sfxSince(from), 'levelComplete') === 1);
      const isLast = done[0]?.payload.isLast;
      check(isLast ? 'last level → ending' : 'next level → loading', await waitFor(`['ending','loading','intro','playing'].includes(window.__harnest.state()) && window.__harnest.state() !== 'levelComplete'`, 5000), await api('return H.state()'));
    }

    check('no page reloads during the run', reloads() === 0, reloads() ? 'HMR reload — rerun' : '');
    check('zero console errors', problems.length === 0, problems.slice(0, 5).join(' | '));
  } finally {
    if (args.logs) console.log(logs.join('\n'));
    await page.close();
  }
}

async function keysScenario(browser) {
  scenario = 'keys';
  console.log(`\n[keys] ${gameUrl()}`);
  const { page, problems, logs, ready, reloads } = await newGamePage(browser);
  const { api, waitState, eventCount, eventsSince } = helpers(page);
  try {
    if (!check('game ready', ready)) return;
    check('playing', await waitState('playing'));
    await page.waitForTimeout(400);
    const p0 = await api('return H.player()');

    // W moves north (−row)
    let from = await eventCount();
    await holdKeys(page, 'KeyW:700');
    await page.waitForTimeout(150);
    const p1 = await api('return H.player()');
    check('W moves the robot north', p1.row < p0.row - 0.7 && Math.abs(p1.col - p0.col) < 0.3, `${JSON.stringify(p0)} → ${JSON.stringify(p1)}`);
    const motion = (await eventsSince(from, 'player:motion')).map((e) => e.payload.speed);
    check('player:motion reports speed', motion.some((s) => s > 0.5) && motion.at(-1) !== undefined, motion.join(','));

    // go below a wall (3 tiles of building to the north) along which the robot can slide east — checked
    // by simulating the slide with the game's own collision, since dressing (barrels, crates, deep shop
    // fronts) makes perfectly clean walls rare — and push north until the wall stops the robot
    const wallSpot = await page
      .evaluate(async () => {
        const { isFree, moveCircle, resolveCircle } = await import('/src/world/collision.ts');
        const g = window.__harnest.internals.game;
        const grid = g.runtime.plan.grid;
        const src = g.runtime.sources;
        const R = 0.45;
        for (let r = 1; r < grid.height; r++) {
          for (let c = 0; c + 2 < grid.width; c++) {
            let ok = true;
            for (let k = 0; k < 3 && ok; k++) ok = grid.walkable(c + k, r) && grid.isBuilding(c + k, r - 1);
            if (!ok || !isFree(src, c * 2, r * 2, R)) continue;
            // driving north from the tile centre reaches the wall…
            let x = c * 2;
            let z = r * 2;
            for (let i = 0; i < 40; i++) ({ x, z } = moveCircle(src, x, z, 0, -0.05, R));
            if (z > r * 2 - 0.3 || Math.abs(x - c * 2) > 0.05) continue;
            const wallZ = z;
            // …W+D then slides east along it, about one row…
            for (let i = 0; i < 40; i++) ({ x, z } = moveCircle(src, x, z, 0.05, -0.05, R));
            if (x - c * 2 < 1.4 || Math.abs(z - wallZ) > 0.3) continue;
            // …and there is room to back off south afterwards
            if (!isFree(src, resolveCircle(src, x, wallZ + 1.4, R).x, wallZ + 1.4, R)) continue;
            return { col: c, row: r };
          }
        }
        return null;
      })
      .catch(() => null);
    if (!check('found a straight wall to test against', !!wallSpot, JSON.stringify(wallSpot))) return;
    await api(`H.teleport(${wallSpot.col}, ${wallSpot.row})`);
    await page.waitForTimeout(200);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1500);
    const a = await api('return H.player()');
    await page.waitForTimeout(500);
    const b = await api('return H.player()');
    await page.keyboard.up('KeyW');
    check('a wall stops the robot (no movement while W is held)', Math.abs(a.row - b.row) < 0.02 && b.row < wallSpot.row - 0.1, `${JSON.stringify(a)} → ${JSON.stringify(b)}`);
    const free = await page
      .evaluate(async () => {
        const { isFree } = await import('/src/world/collision.ts');
        const g = window.__harnest.internals.game;
        return isFree(g.runtime.sources, g.player.x, g.player.z, 0.44);
      })
      .catch((err) => String(err));
    check('robot is not inside a collider', free === true, String(free));

    // W+D slides along the wall
    await holdKeys(page, 'KeyW+KeyD:700');
    await page.waitForTimeout(150);
    const c = await api('return H.player()');
    check('W+D slides along the wall (east, same row)', c.col > b.col + 0.4 && Math.abs(c.row - b.row) < 0.25, `${JSON.stringify(b)} → ${JSON.stringify(c)}`);

    // keys are ignored while paused
    await api(`H.bus.emit('ui:pause', {})`);
    await waitState('paused', 2000);
    await holdKeys(page, 'KeyS:500');
    const d = await api('return H.player()');
    check('keys do nothing while paused', Math.abs(d.col - c.col) < 0.05 && Math.abs(d.row - c.row) < 0.05, JSON.stringify(d));
    await api(`H.bus.emit('ui:resume', {})`);
    check('resume → playing', await waitState('playing', 2000));
    from = await eventCount();
    await holdKeys(page, 'KeyS:500');
    const e = await api('return H.player()');
    check('S moves the robot south after resume', e.row > d.row + 0.4, JSON.stringify(e));
    await page.waitForTimeout(600);
    const stop = (await eventsSince(from, 'player:motion')).at(-1)?.payload.speed;
    check('player:motion back to 0 when released', stop === 0, String(stop));
    await page.screenshot({ path: resolve(shotsDir, 'keys.png') });

    check('no page reloads during the run', reloads() === 0, reloads() ? 'HMR reload — rerun' : '');
    check('zero console errors', problems.length === 0, problems.slice(0, 5).join(' | '));
  } finally {
    if (args.logs) console.log(logs.join('\n'));
    await page.close();
  }
}

const browser = await launchBrowser({ browser: args.browser });
try {
  if (!args.only || args.only === 'flow') await flowScenario(browser);
  if (!args.only || args.only === 'keys') await keysScenario(browser);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — ${failed.length} failed` : ''}`);
for (const f of failed) console.log(`  [${f.scenario}] ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
process.exitCode = failed.length ? 1 : 0;
