// Touch controls check against the running dev server.
//
//   node scripts/playtest-touch.mjs [--level l1] [--url http://127.0.0.1:5173/] [--q medium]
//        [--out .shots/touch] [--browser chrome|msedge]
//
// 1. desktop (mouse, no touch screen): the controls stay hidden in auto mode.
// 2. ?touch=1 with a mouse: the controls show while playing; dragging the stick drives the robot the
//    way of the drag (analog: a short push is slower); the action button lights up at a terminal and
//    opens it; the controls hide while the terminal is open and come back after.
// 3. phone (hasTouch + isMobile, 844×390 landscape, auto mode): the controls show; a real touch drag
//    (CDP touch events → pointer events) drives the robot; a tap on the button talks to an NPC.
// Screenshots (into --out): desktop-forced.png, phone.png. Exit code 0 when every check passes.
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
const level = String(args.level ?? 'l1');
const base = String(args.url ?? 'http://127.0.0.1:5173/');
const quality = String(args.q ?? 'medium');
const outDir = resolve(String(args.out ?? '.shots/touch'));
mkdirSync(outDir, { recursive: true });

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
  const shown = () =>
    page.evaluate(() => {
      const root = document.querySelector('.ht-root');
      return !!root && getComputedStyle(root).display !== 'none';
    });
  const rect = (sel) =>
    page.evaluate((s) => {
      const r = document.querySelector(s)?.getBoundingClientRect();
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height } : null;
    }, sel);
  const player = () => api('return H.player()');
  const teleport = async (spot, settle = 400) => {
    await api(`H.teleport(${spot.col}, ${spot.row})`);
    await page.waitForTimeout(settle);
  };
  const eventCount = () => api('return H.events.length');
  const eventsSince = (from, type) => api(`return H.events.slice(${from}).filter((e) => e.type === ${JSON.stringify(type)})`);
  return { api, waitFor, waitState, shown, rect, player, teleport, eventCount, eventsSince };
}

/** Drives with a drag of (dx, dy) px from the stick's resting place for `ms`; returns the move in tiles. */
async function drag(page, h, dx, dy, ms, touch) {
  const c = await h.rect('.ht-base');
  const p0 = await h.player();
  const steps = 6;
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    const point = (x, y) => [{ x: Math.round(x), y: Math.round(y), id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(c.x, c.y) });
    for (let i = 1; i <= steps; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(c.x + (dx * i) / steps, c.y + (dy * i) / steps) });
    await page.waitForTimeout(ms);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + dx, c.y + dy, { steps });
    await page.waitForTimeout(ms);
    await page.mouse.up();
  }
  const p1 = await h.player();
  await page.waitForTimeout(250);
  return { dx: p1.col - p0.col, dz: p1.row - p0.row, after: await h.player(), at: p1 };
}

/** Tries the four screen directions; returns how many moved the robot that way (≥ 0.3 tiles, within 35°). */
async function driveAround(page, h, touch, label) {
  const dirs = [
    ['east', 90, 0],
    ['south', 0, 90],
    ['west', -90, 0],
    ['north', 0, -90],
  ];
  let good = 0;
  const notes = [];
  for (const [name, dx, dy] of dirs) {
    const m = await drag(page, h, dx, dy, 700, touch);
    const len = Math.hypot(m.dx, m.dz);
    const cos = len > 0 ? (m.dx * Math.sign(dx) + m.dz * Math.sign(dy)) / len : 0;
    if (len >= 0.3 && cos > 0.82) good++;
    notes.push(`${name} ${len.toFixed(2)}t cos ${cos.toFixed(2)}`);
  }
  check(`${label}: the stick drives the robot the way of the drag`, good >= 2, notes.join('; '));
  return good;
}

async function desktop(browser) {
  console.log(`\n[desktop, auto] ${gameUrl()}`);
  {
    const { page, problems } = await openPage(browser, { width: 1280, height: 720 });
    await page.goto(gameUrl());
    const h = helpers(page);
    const ready = (await waitReady(page)) && (await h.waitState('playing', 30000));
    check('game ready', ready);
    check('no touch controls on a desktop without touch', !(await h.shown()));
    check('zero console errors', problems.length === 0, problems.slice(0, 3).join(' | '));
    await page.context().close();
  }

  console.log(`\n[desktop, forced] ${gameUrl({ touch: '1' })}`);
  const { page, problems } = await openPage(browser, { width: 1280, height: 720 });
  await page.goto(gameUrl({ touch: '1' }));
  const h = helpers(page);
  const ready = (await waitReady(page)) && (await h.waitState('playing', 30000));
  if (!check('game ready', ready)) return;
  check('?touch=1 shows the controls while playing', await h.shown());
  const spots = await h.api('return H.spots()');
  await h.teleport(spots.spawn);
  await driveAround(page, h, false, 'mouse');

  // analog: a short push moves slower than a full one
  await h.teleport(spots.spawn);
  const short = await drag(page, h, 0, 22, 600, false);
  await h.teleport(spots.spawn);
  const full = await drag(page, h, 0, 90, 600, false);
  const s1 = Math.hypot(short.dx, short.dz);
  const s2 = Math.hypot(full.dx, full.dz);
  check('a short push drives slower than a full one', s2 > 0.3 && s1 < s2 * 0.75, `short ${s1.toFixed(2)}t, full ${s2.toFixed(2)}t`);
  check('the robot stops when the stick is let go', Math.hypot(full.after.col - full.at.col, full.after.row - full.at.row) < 0.15);

  // action button at the first unlocked terminal
  const lessons = await page.evaluate(async (lv) => {
    const m = await import('/src/content/index.ts');
    return m.getLevel(lv).lessons.terminals.map((t) => ({ id: t.id, requires: t.requires ?? [] }));
  }, level);
  const first = dependencyOrder(lessons)[0];
  await h.teleport(spots.terminals[first.id]);
  await h.waitFor(`window.__harnest.prompt()?.id === ${JSON.stringify(first.id)}`, 3000);
  await page.waitForTimeout(150);
  const ready2 = await page.evaluate(() => document.querySelector('.ht-act')?.classList.contains('ready'));
  const caption = await page.evaluate(() => document.querySelector('.ht-cap')?.textContent ?? '');
  check(`action button lights up at ${first.id}`, ready2, `caption «${caption}»`);
  await page.screenshot({ path: resolve(outDir, 'desktop-forced.png') });
  const from = await h.eventCount();
  const b = await h.rect('.ht-act');
  await page.mouse.click(b.x, b.y);
  const opened = await h.waitState('terminal', 3000);
  check(`action button opens ${first.id}`, opened && (await h.eventsSince(from, 'terminal:open')).length === 1);
  check('controls hidden while the terminal is open', !(await h.shown()));
  check('back to playing (autoui)', await h.waitState('playing', 15000));
  check('controls back after the terminal', await h.shown());
  check('zero console errors', problems.length === 0, problems.slice(0, 3).join(' | '));
  await page.context().close();
}

async function phone(browser) {
  console.log(`\n[phone, auto] ${gameUrl()}`);
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (msg) => msg.type() === 'error' && problems.push(msg.text()));
  page.on('pageerror', (err) => problems.push(err.message));
  await page.goto(gameUrl());
  const h = helpers(page);
  const ready = (await waitReady(page)) && (await h.waitState('playing', 30000));
  if (!check('game ready', ready)) return;
  const coarse = await page.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches);
  if (!coarse) {
    // some emulations keep a fine pointer: the first touch must bring the controls up
    await page.touchscreen.tap(600, 60);
    await page.waitForTimeout(100);
  }
  check(`controls on a touch screen (${coarse ? 'coarse pointer' : 'after the first touch'})`, await h.shown());
  const spots = await h.api('return H.spots()');
  await h.teleport(spots.spawn);
  await driveAround(page, h, true, 'touch');

  const npcId = Object.keys(spots.npcs)[0];
  if (npcId) {
    await h.teleport(spots.npcs[npcId]);
    await h.waitFor(`window.__harnest.prompt()?.id === ${JSON.stringify(npcId)}`, 3000);
    await page.waitForTimeout(150);
    await page.screenshot({ path: resolve(outDir, 'phone.png') });
    const from = await h.eventCount();
    const b = await h.rect('.ht-act');
    await page.touchscreen.tap(b.x, b.y);
    check(`tap on the button talks to ${npcId}`, (await h.waitState('dialog', 3000)) && (await h.eventsSince(from, 'dialog:start')).length === 1);
    check('controls hidden during the dialog', !(await h.shown()));
  } else {
    await page.screenshot({ path: resolve(outDir, 'phone.png') });
  }
  check('zero console errors', problems.length === 0, problems.slice(0, 3).join(' | '));
  await context.close();
}

const browser = await launchBrowser({ browser: args.browser });
try {
  await desktop(browser);
  await phone(browser);
} catch (err) {
  check('no exception', false, String(err?.stack ?? err));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
console.log(`screenshots: ${outDir}`);
process.exit(failed.length ? 1 : 0);
