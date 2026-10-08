// Scripted playtest + screenshot tour of one level against the running dev server.
//
//   node scripts/playtest-level.mjs --level l4 [--url http://127.0.0.1:5173/] [--q high]
//        [--out .shots/levels/<id>] [--browser chrome|msedge] [--no-shots] [--logs]
//
// Loads ?level=<id>&skipMenu=1&autoui=1, then: the zone bark at the spawn → every zone fires where it
// stands → the closed gate refuses → a locked terminal refuses → every terminal in dependency order
// (teleport to its spot, real E key, autoui completes it) → the gate opens after the required ones →
// every NPC talks (real Enter key) → every chip is collected → the exit completes the level.
// Asserts states, bus events and zero console errors. Screenshots (into --out): spawn, every terminal,
// every NPC, every chip, the gate closed and open, and ?view=map.
// Uses only the `window.__harnest` debug API (src/engine/debug.ts). Exit code 0 when every check passes.
import { mkdirSync } from 'node:fs';
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
if (!args.level || args.level === true) {
  console.error('usage: node scripts/playtest-level.mjs --level <id> [--url …] [--q high] [--out dir]');
  process.exit(2);
}
const level = String(args.level);
const base = String(args.url ?? 'http://127.0.0.1:5173/');
const quality = String(args.q ?? 'high');
const shots = !args['no-shots'];
const outDir = resolve(String(args.out ?? `.shots/levels/${level}`));
if (shots) mkdirSync(outDir, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  return !!ok;
}

function gameUrl(extra = {}) {
  const u = new URL(base);
  for (const [k, v] of Object.entries({ skipMenu: '1', autoui: '1', level, q: quality, ...extra })) u.searchParams.set(k, v);
  return u.toString();
}

/** Page helpers bound to one page (same shape as scripts/playtest.mjs). */
function helpers(page) {
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
  const eventsSince = (from, type) =>
    api(`return H.events.slice(${from}).filter((e) => ${type ? `e.type === ${JSON.stringify(type)}` : 'true'})`);
  const waitEvent = (from, type, timeout = 5000) =>
    waitFor(`window.__harnest.events.slice(${from}).some((e) => e.type === ${JSON.stringify(type)})`, timeout);
  /** Teleports, lets a few frames run, returns how far the robot ended up from the asked spot (tiles). */
  const teleport = async (spot, settle = 300) => {
    await api(`H.teleport(${spot.col}, ${spot.row})`);
    await page.waitForTimeout(settle);
    const p = await api('return H.player()');
    return Math.hypot(p.col - spot.col, p.row - spot.row);
  };
  const promptFor = async (id, timeout = 2000) => {
    await waitFor(`window.__harnest.prompt()?.id === ${JSON.stringify(id)}`, timeout);
    return api('return H.prompt()');
  };
  const shot = async (name) => {
    if (!shots) return;
    await page.waitForTimeout(900); // camera easing after a teleport
    await page.screenshot({ path: resolve(outDir, `${name}.png`) });
  };
  return { api, waitFor, waitState, eventCount, eventsSince, waitEvent, teleport, promptFor, shot };
}

/** Terminal ids sorted so that every terminal comes after the ones it requires. */
function dependencyOrder(terminals) {
  const done = new Set();
  const out = [];
  for (let guard = 0; out.length < terminals.length && guard < 100; guard++) {
    for (const t of terminals) {
      if (done.has(t.id) || !(t.requires ?? []).every((r) => done.has(r))) continue;
      out.push(t);
      done.add(t.id);
    }
  }
  return out;
}

async function flow(browser) {
  console.log(`\n[flow] ${gameUrl()}`);
  const { page, problems, logs } = await openPage(browser, { width: 1280, height: 720 });
  let reloads = -1;
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) reloads++;
  });
  const { api, waitFor, waitState, eventCount, eventsSince, waitEvent, teleport, promptFor, shot } = helpers(page);
  try {
    await page.goto(gameUrl(), { waitUntil: 'load', timeout: 60000 });
    if (!check('game ready', await waitReady(page, undefined, 90000))) return;
    check('level id', (await api('return H.level()')) === level, await api('return H.level()'));
    if (!check('reaches playing after intro', await waitState('playing', 30000))) return;

    const spots = await api('return H.spots()');
    const lessons = await page.evaluate(async (id) => {
      const m = await import('/src/content/index.ts');
      const l = m.getLevel(id);
      return {
        terminals: l.lessons.terminals.map((t) => ({ id: t.id, title: t.title, required: t.required, requires: t.requires ?? [] })),
        npcs: l.lessons.npcs.map((n) => n.id),
        chips: l.lessons.chips.map((c) => c.id),
        zones: l.lessons.zones.map((z) => ({ id: z.id, text: z.text })),
        gateAxis: l.layout.gate.axis,
      };
    }, level);
    check('spots for every lesson object', lessons.terminals.every((t) => spots.terminals[t.id]) && lessons.npcs.every((n) => spots.npcs[n]) && lessons.chips.every((c) => spots.chips[c]));

    // spawn
    await page.waitForTimeout(1200);
    const p0 = await api('return H.player()');
    check('robot at the spawn', Math.hypot(p0.col - spots.spawn.col, p0.row - spots.spawn.row) < 0.6, JSON.stringify(p0));
    await shot('spawn');

    // zones: each one barks where it stands (before any progress, so every `when` still holds)
    const barks = async (from) => (await eventsSince(from, 'toast')).filter((e) => e.payload.kind === 'bark').map((e) => e.payload.text);
    for (const z of lessons.zones) {
      const spot = spots.zones[z.id];
      const from = await eventCount();
      await teleport(spot, 400);
      const heard = (await barks(0)).includes(z.text) || (await waitFor(`window.__harnest.events.slice(${from}).some((e) => e.type === 'toast' && e.payload.text === ${JSON.stringify(z.text)})`, 1500));
      check(`zone ${z.id} barks`, heard, z.text);
    }

    // the closed gate refuses
    {
      const g = spots.gate;
      const front = lessons.gateAxis === 'x' ? { col: g.col, row: g.row + 1 } : { col: g.col + 1, row: g.row };
      await teleport(front);
      const prompt = await promptFor('gate');
      check('closed gate prompts (locked)', prompt?.kind === 'gate' && prompt.locked === true, JSON.stringify(prompt));
      const from = await eventCount();
      await page.keyboard.press('KeyE');
      check('closed gate → warn toast', await waitFor(`window.__harnest.events.slice(${from}).some((e) => e.type === 'toast' && e.payload.kind === 'warn')`, 2000));
      await shot('gate-closed');
    }

    // a locked terminal refuses
    const locked = lessons.terminals.find((t) => t.requires.length);
    if (locked) {
      await teleport(spots.terminals[locked.id]);
      const prompt = await promptFor(locked.id);
      check(`locked ${locked.id} prompts as locked`, prompt?.id === locked.id && prompt.locked === true, JSON.stringify(prompt));
      const from = await eventCount();
      await page.keyboard.press('KeyE');
      check(`locked ${locked.id} → warn toast, no terminal:open`, (await waitFor(`window.__harnest.events.slice(${from}).some((e) => e.type === 'toast' && e.payload.kind === 'warn')`, 2000)) && (await eventsSince(from, 'terminal:open')).length === 0);
    }

    // every terminal, in dependency order, with the real E key
    let gateOpened = false;
    for (const t of dependencyOrder(lessons.terminals)) {
      const off = await teleport(spots.terminals[t.id]);
      check(`${t.id}: spot is free`, off < 0.35, `${off.toFixed(2)} tiles off`);
      const prompt = await promptFor(t.id);
      check(`${t.id}: prompt «${t.title}»`, prompt?.kind === 'terminal' && prompt.id === t.id && !prompt.locked, JSON.stringify(prompt));
      await shot(`terminal-${t.id}`);
      const from = await eventCount();
      await page.keyboard.press('KeyE');
      check(`${t.id}: state terminal`, await waitState('terminal', 3000));
      const opened = await eventsSince(from, 'terminal:open');
      check(`${t.id}: terminal:open`, opened.length === 1 && opened[0].payload.terminalId === t.id);
      check(`${t.id}: back to playing`, await waitState('playing', 4000));
      const obj = (await api('return H.objectives()')).find((o) => o.id === t.id);
      check(`${t.id}: objective done`, obj?.done === true);
      const gateNow = (await eventsSince(from, 'gate:opened')).length > 0;
      if (gateNow) {
        const required = lessons.terminals.filter((x) => x.required).map((x) => x.id);
        const done = (await api('return H.objectives()')).filter((o) => o.done).map((o) => o.id);
        check('gate:opened exactly when the required terminals are done', required.every((r) => done.includes(r)), `done: ${done.join(', ')}`);
        gateOpened = true;
      }
    }
    check('gate opened', gateOpened);

    // NPCs (real Enter key)
    for (const id of lessons.npcs) {
      const off = await teleport(spots.npcs[id]);
      check(`npc ${id}: talk spot is free`, off < 0.35, `${off.toFixed(2)} tiles off`);
      const prompt = await promptFor(id);
      check(`npc ${id}: prompt`, prompt?.kind === 'npc' && prompt.id === id, JSON.stringify(prompt));
      await shot(`npc-${id}`);
      const from = await eventCount();
      await page.keyboard.press('Enter');
      check(`npc ${id}: dialog`, await waitState('dialog', 3000));
      const start = await eventsSince(from, 'dialog:start');
      check(`npc ${id}: dialog:start with lines`, start.length === 1 && start[0].payload.lines.length > 0);
      check(`npc ${id}: back to playing`, await waitState('playing', 3000));
    }

    // chips
    for (const id of lessons.chips) {
      const spot = spots.chips[id];
      const from = await eventCount();
      // stand a little away first (pick-up radius is 0.4 tiles), so the screenshot shows the chip
      for (const [dc, dr] of [[0, 1.2], [0, -1.2], [-1.2, 0], [1.2, 0]]) {
        await teleport({ col: spot.col + dc, row: spot.row + dr }, 150);
        const p = await api('return H.player()');
        if (Math.hypot(p.col - spot.col, p.row - spot.row) >= 0.6) break;
      }
      await shot(`chip-${id}`);
      await teleport(spot);
      check(`chip ${id} collected`, await waitEvent(from, 'chip:collected', 2000));
    }

    // the open gate, then the exit
    {
      const g = spots.gate;
      await teleport(lessons.gateAxis === 'x' ? { col: g.col, row: g.row + 1.6 } : { col: g.col + 1.6, row: g.row });
      check('no gate prompt once open', (await api('return H.prompt()'))?.kind !== 'gate');
      await shot('gate-open');
      const from = await eventCount();
      await teleport(spots.exit);
      check('exit → levelComplete', await waitState('levelComplete', 3000));
      const done = await eventsSince(from, 'level:completed');
      const stats = done[0]?.payload.stats;
      check('level:completed with full stats', done.length === 1 && stats?.stars === stats?.maxStars && stats?.chips === stats?.maxChips, JSON.stringify(stats));
    }

    check('no page reloads during the run', reloads === 0, reloads ? 'HMR reload — rerun' : '');
    check('zero console errors', problems.length === 0, problems.slice(0, 5).join(' | '));
  } finally {
    if (args.logs) console.log(logs.join('\n'));
    await page.context().close();
  }
}

async function mapShot(browser) {
  console.log(`\n[map] ${gameUrl({ view: 'map', noui: '1' })}`);
  const { page, problems } = await openPage(browser, { width: 1280, height: 720 });
  try {
    await page.goto(gameUrl({ view: 'map', noui: '1' }), { waitUntil: 'load', timeout: 60000 });
    if (!check('map view ready', await waitReady(page, undefined, 90000))) return;
    await page.waitForFunction(() => window.__harnest.state() === 'playing', undefined, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    if (shots) await page.screenshot({ path: resolve(outDir, 'map.png') });
    check('map view: zero console errors', problems.length === 0, problems.slice(0, 5).join(' | '));
  } finally {
    await page.context().close();
  }
}

const browser = await launchBrowser({ browser: args.browser });
try {
  await flow(browser);
  await mapShot(browser);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — ${failed.length} failed` : ''}`);
for (const f of failed) console.log(`  ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
if (shots) console.log(`screenshots: ${outDir}`);
process.exitCode = failed.length ? 1 : 0;
