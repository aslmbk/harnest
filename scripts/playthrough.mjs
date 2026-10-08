// Content-driven playthrough of the whole game: the real 3D game (WebGPU) with the real UI, played
// with real keys — no autoui, no harness.
//
//   node scripts/playthrough.mjs [--level l3] [--url http://127.0.0.1:5173/] [--browser chrome|msedge]
//        [--headed] [--q low|medium|high] [--fast] [--out .shots/playthrough] [--logs]
//
// Starts at ?skipMenu=1&level=<first> and, for each level in order: Enter on the intro card → talks to
// every NPC (E, Enter through the lines; the dialog must be the one the progress calls for) → a locked
// terminal and the closed gate refuse → every terminal in dependency order (teleport to its spot, real E)
// played in the real terminal UI: each command step's `example` typed + Enter, key steps pressed
// (mode-cycling ones: Shift+Tab until solved), the correct option by digit, Enter on info steps → the
// success panel → Enter → ui:terminalClosed {completed:true, stars:3} → every chip collected → the gate
// opens right after the last required terminal → NPCs again → the robot drives north through the open
// gate (held key) → summary → Enter → next level. After the last level: the `ending` state.
// Asserts zero console errors; exit code 1 on any failure. Prints a line per level (stars, chips, time).
//
// By default the game is served by a private Vite instance (HMR and file watching off): other agents
// saving files would otherwise reload the shared dev server's page mid-run. --url uses an existing
// server instead (a reloaded level is then retried once in a fresh page).
// --level <id>  plays one level (then checks that the next level starts loading, or the ending).
// --fast        skips Claude's streamed output by clicking the terminal's title bar (as a player can).
// Screenshots of failures, every summary and the ending go to --out (default .shots/playthrough).
// Uses the `window.__harnest` debug API (src/engine/debug.ts) for spots, teleport, state and the bus.
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
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
const quality = String(args.q ?? 'low');
const outDir = resolve(String(args.out ?? '.shots/playthrough'));
const fast = !!args.fast;
mkdirSync(outDir, { recursive: true });
// failure shots of an earlier run would read as failures of this one
for (const f of readdirSync(outDir)) if (/^fail-.*\.png$/.test(f)) rmSync(resolve(outDir, f));

// ───────────────────────────── results ─────────────────────────────

const results = [];
let scope = '';
function check(name, ok, detail = '') {
  results.push({ scope, name, ok: !!ok, detail });
  if (!ok || args.verbose) console.log(`${ok ? '  ok  ' : '  FAIL'} [${scope}] ${name}${detail ? ` — ${detail}` : ''}`);
  return !!ok;
}

class Reloaded extends Error {}

// ───────────────────────────── content rules (same as src/world/conditions.ts, src/content/match.ts) ─────────────────────────────

function evalCondition(cond, done, gateOpen) {
  if (!cond) return true;
  if (cond.done && !cond.done.every((id) => done.has(id))) return false;
  if (cond.notDone && cond.notDone.some((id) => done.has(id))) return false;
  if (cond.gateOpen !== undefined && cond.gateOpen !== gateOpen) return false;
  return true;
}

function pickDialog(npc, done, gateOpen) {
  return npc.dialogs.find((d) => evalCondition(d.when, done, gateOpen)) ?? npc.dialogs.at(-1);
}

/** Terminals sorted so that every terminal comes after the ones it requires. */
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

/** A canonical combo ('Ctrl+B', 'Shift+Tab', 'Escape', '?') as a Playwright key ('Control+KeyB', …). */
function playwrightKey(combo) {
  const parts = combo.split('+');
  const key = parts.pop() || '+';
  const mods = parts.map((m) => ({ Ctrl: 'Control', Alt: 'Alt', Shift: 'Shift', Meta: 'Meta' })[m] ?? m);
  const k = /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key === 'Space' ? ' ' : key;
  return [...mods, k].join('+');
}

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

// ───────────────────────────── server ─────────────────────────────

let server = null;
let base = args.url && args.url !== true ? String(args.url) : '';
if (!base) {
  const { createServer } = await import('vite');
  server = await createServer({
    server: { port: 5198, strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
    cacheDir: 'node_modules/.vite-playthrough',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'warn',
  });
  await server.listen();
  base = server.resolvedUrls.local[0];
}
if (!base.endsWith('/')) base += '/';

function gameUrl(levelId) {
  const u = new URL(base);
  for (const [k, v] of Object.entries({ skipMenu: '1', level: levelId, q: quality, touch: '0' })) u.searchParams.set(k, v);
  return u.toString();
}

// ───────────────────────────── page session ─────────────────────────────

/** Helpers bound to one game page. */
function session(page) {
  const H = (fn, arg) => page.evaluate(fn, arg);
  const waitFn = async (fn, arg, timeout = 10000) => {
    try {
      await page.waitForFunction(fn, arg, { timeout, polling: 50 });
      return true;
    } catch {
      return false;
    }
  };
  const state = () => H(() => window.__harnest.state());
  const waitState = (s, timeout = 10000) => waitFn((x) => window.__harnest?.state() === x, s, timeout);
  /** Bus log of this script (unbounded; window.__harnest.events is a ring buffer). */
  const mark = () => H(() => window.__pt.length);
  const since = (from, type) => H(([f, t]) => window.__pt.slice(f).filter((e) => !t || e.type === t), [from, type]);
  const waitEvent = async (from, type, timeout = 10000) => {
    const ok = await waitFn(([f, t]) => window.__pt.slice(f).some((e) => e.type === t), [from, type], timeout);
    return ok ? (await since(from, type)).at(-1).payload : null;
  };
  const teleport = async (spot, settle = 300) => {
    await H(([c, r]) => window.__harnest.teleport(c, r), [spot.col, spot.row]);
    await page.waitForTimeout(settle);
    const p = await H(() => window.__harnest.player());
    return Math.hypot(p.col - spot.col, p.row - spot.row);
  };
  const promptFor = async (id, timeout = 3000) => {
    await waitFn((x) => window.__harnest.prompt()?.id === x, id, timeout);
    return H(() => window.__harnest.prompt());
  };
  const text = (selector) => H((s) => document.querySelector(s)?.textContent?.trim() ?? '', selector);
  const count = (selector) => H((s) => document.querySelectorAll(s).length, selector);
  const visible = (selector, timeout = 10000) =>
    page
      .waitForSelector(selector, { state: 'visible', timeout })
      .then(() => true)
      .catch(() => false);
  const press = async (key, wait = 120) => {
    await page.keyboard.press(key);
    if (wait) await page.waitForTimeout(wait);
  };
  /** E only counts 250 ms after the game entered 'playing' (src/engine/input.ts): give it some slack. */
  const settlePlaying = () => page.waitForTimeout(380);
  const shot = async (name) => {
    try {
      await page.screenshot({ path: resolve(outDir, `${name}.png`) });
    } catch {
      // the page may be gone
    }
  };
  return { H, waitFn, state, waitState, mark, since, waitEvent, teleport, promptFor, text, count, visible, press, settlePlaying, shot };
}

/** Installs the script's bus log (window.__pt) once the game is up. */
async function installLog(page) {
  await page.evaluate(() => {
    if (window.__pt) return;
    const log = (window.__pt = []);
    const types = [
      'state:changed',
      'level:ready',
      'interact:prompt',
      'dialog:start',
      'terminal:open',
      'toast',
      'chip:collected',
      'objectives:changed',
      'gate:opened',
      'level:completed',
      'ui:introDone',
      'ui:dialogDone',
      'ui:terminalClosed',
      'ui:nextLevel',
      'ui:quitToMenu',
    ];
    for (const type of types) window.__harnest.bus.on(type, (payload) => log.push({ type, payload: JSON.parse(JSON.stringify(payload ?? null)), t: Math.round(performance.now()) }));
  });
}

/** Level data the script needs, straight from the content modules the game runs. */
async function loadContent(page) {
  return page.evaluate(async () => {
    const m = await import('/src/content/index.ts');
    return m.LEVELS.map((l) => ({
      id: l.id,
      index: l.index,
      title: l.meta.title,
      lessons: l.lessons,
      gate: l.layout.gate,
      exit: l.layout.exit,
    }));
  });
}

// ───────────────────────────── terminal UI ─────────────────────────────

const T = '.hx-terminal.is-open';
const SEL = {
  shell: `${T} .hx-sh`,
  claude: `${T} .hx-pb:not(.is-inert)`,
  choice: `${T} .hx-choice`,
  cont: `${T} .hx-continue`,
  success: `${T} .hx-tw-success.is-on`,
};

function widgetFor(step) {
  if (step.kind === 'command') return step.prompt === 'shell' ? SEL.shell : SEL.claude;
  if (step.kind === 'key') return SEL.claude;
  if (step.kind === 'choice') return SEL.choice;
  return SEL.cont;
}

function describe(step) {
  if (step.kind === 'command') return `${step.prompt === 'shell' ? '$' : '>'} ${step.example}`;
  if (step.kind === 'key') return step.untilMode ? `${step.keys.join(' ')} → ${step.untilMode}` : step.keys.join(' ');
  if (step.kind === 'choice') return `${step.style} → ${step.options.findIndex((o) => o.correct) + 1}`;
  return 'Enter';
}

/** Plays one challenge in the open terminal with real keys. Returns null when solved, else what went wrong. */
async function playChallenge(page, s, terminal) {
  const steps = terminal.challenge.steps;
  const coachWrong = () => s.H(() => document.querySelector('.hx-terminal.is-open .hx-coach.is-on.is-wrong')?.textContent?.trim() ?? '');
  /** --fast: a click on the title bar skips the stream (a no-op in every other phase). */
  const skipper = fast
    ? setInterval(() => {
        page.click(`${T} .hx-tw-title`, { timeout: 200 }).catch(() => {});
      }, 180)
    : null;
  try {
    for (const [i, step] of steps.entries()) {
      const where = `${step.id} (${describe(step)})`;
      const ready = await s.waitFn(
        ([n, w]) => {
          const dot = document.querySelectorAll('.hx-terminal.is-open .hx-task-dots > i')[n];
          const el = document.querySelector(w);
          return !!dot?.classList.contains('is-now') && !!el && el.getClientRects().length > 0;
        },
        [i, widgetFor(step)],
        25000,
      );
      if (!ready) return `${where}: the step never became ready (${await s.text(`${T} .hx-task-counter`)})`;
      if (step.kind === 'command') {
        if (!(await s.waitFn(() => document.activeElement?.classList.contains('hx-tw-input'), undefined, 4000))) return `${where}: the terminal input is not focused`;
        await page.keyboard.type(step.example, { delay: 8 });
        await s.press('Enter', 0);
        const verdict = await s.waitFn(
          () => {
            const coach = document.querySelector('.hx-terminal.is-open .hx-coach.is-on.is-wrong');
            const input = document.querySelector('.hx-terminal.is-open .hx-tw-input');
            return !!coach || input?.value === '';
          },
          undefined,
          4000,
        );
        const wrong = await coachWrong();
        if (!verdict || wrong) return `${where}: the example was not accepted${wrong ? ` — «${wrong}»` : ''}`;
      } else if (step.kind === 'choice' || step.kind === 'info') {
        // solved: the dialog / the continue button is gone, or the next step already took over (a step
        // without output is followed at once by the next one, maybe another dialog)
        if (step.kind === 'choice') await s.press(String(step.options.findIndex((o) => o.correct) + 1), 0);
        else await s.press('Enter', 0);
        const solved = await s.waitFn(
          ([n, w]) => {
            if (document.querySelector('.hx-terminal.is-open .hx-coach.is-on.is-wrong')) return true;
            const dot = document.querySelectorAll('.hx-terminal.is-open .hx-task-dots > i')[n];
            return !dot?.classList.contains('is-now') || !document.querySelector(w);
          },
          [i, widgetFor(step)],
          4000,
        );
        const wrong = await coachWrong();
        if (!solved || wrong) return `${where}: ${step.kind === 'choice' ? 'the correct option' : 'Enter'} did not solve the step${wrong ? ` — «${wrong}»` : ''}`;
      } else {
        const solved = () =>
          s.H((n) => {
            const dot = document.querySelectorAll('.hx-terminal.is-open .hx-task-dots > i')[n];
            return !dot?.classList.contains('is-now') || !document.querySelector('.hx-terminal.is-open .hx-pb:not(.is-inert)');
          }, i);
        if (step.untilMode) {
          for (let k = 0; k < 6 && !(await solved()); k++) await s.press(playwrightKey(step.keys[0]), 160);
        } else {
          for (const key of step.keys) await s.press(playwrightKey(key), 90);
        }
        if (!(await s.waitFn(
          (n) => {
            const dot = document.querySelectorAll('.hx-terminal.is-open .hx-task-dots > i')[n];
            return !dot?.classList.contains('is-now') || !document.querySelector('.hx-terminal.is-open .hx-pb:not(.is-inert)');
          },
          i,
          3000,
        ))) {
          const wrong = await coachWrong();
          return `${where}: the keys did not solve the step${wrong ? ` — «${wrong}»` : ''} (status: ${await s.text(`${T} .hx-status-left`)})`;
        }
      }
    }
    if (!(await s.visible(SEL.success, 25000))) return `no success panel after the last step (${await s.text(`${T} .hx-task-counter`)})`;
    return null;
  } finally {
    if (skipper) clearInterval(skipper);
  }
}

// ───────────────────────────── one level ─────────────────────────────

/**
 * Plays `level` from its intro card to the summary (inclusive). Returns { stats, wallSec } or throws
 * Reloaded when the page reloaded under the run.
 */
async function playLevel(page, s, level, ctx) {
  const t0 = Date.now();
  const L = level.lessons;
  const reloadsAtStart = ctx.reloads();
  const guard = () => {
    if (ctx.reloads() > reloadsAtStart) throw new Reloaded(`page reloaded during ${level.id}`);
  };

  // ── intro → playing ──
  check('intro card', await s.visible('.hx-intro.is-open', 60000));
  check(`intro title «${level.title}»`, (await s.text('.hx-intro.is-open .hx-intro-title')) === level.title, await s.text('.hx-intro.is-open .hx-intro-title'));
  await page.waitForTimeout(400);
  let m = await s.mark();
  await s.press('Enter', 0);
  check('Enter → ui:introDone', !!(await s.waitEvent(m, 'ui:introDone', 4000)));
  if (!check('state playing', await s.waitState('playing', 8000), await s.state())) throw new Error('the level never started');
  await s.settlePlaying();
  guard();

  const spots = await s.H(() => window.__harnest.spots());
  check(
    'spots for every terminal, NPC and chip',
    L.terminals.every((t) => spots.terminals[t.id]) && L.npcs.every((n) => spots.npcs[n.id]) && L.chips.every((c) => spots.chips[c.id]),
  );
  const required = L.terminals.filter((t) => t.required);
  const done = new Set();
  let gateOpen = false;
  check('HUD district', (await s.text('.hx-hud-district')) === level.title, await s.text('.hx-hud-district'));
  check(`HUD objectives 0 / ${required.length}`, (await s.text('.hx-hud-objcount')) === `0 / ${required.length}`, await s.text('.hx-hud-objcount'));

  // ── NPCs ──
  const talk = async (npc, round) => {
    const label = `npc ${npc.id} (${round})`;
    const off = await s.teleport(spots.npcs[npc.id]);
    const prompt = await s.promptFor(npc.id);
    if (!check(`${label}: prompt «${npc.name}»`, prompt?.kind === 'npc' && prompt.id === npc.id && prompt.label === npc.name, `${JSON.stringify(prompt)}, ${off.toFixed(2)} tiles off`)) return;
    const from = await s.mark();
    await s.press('KeyE', 0);
    if (!check(`${label}: E opens the dialog`, await s.waitState('dialog', 3000), await s.state())) return;
    const start = (await s.since(from, 'dialog:start'))[0]?.payload;
    const expected = pickDialog(npc, done, gateOpen);
    check(
      `${label}: the dialog the progress calls for («${expected.lines[0].text.slice(0, 40)}…»)`,
      start?.npcId === npc.id && start.lines.length === expected.lines.length && start.lines[0].text === expected.lines[0].text,
      start ? `${start.lines.length} lines, «${start.lines[0]?.text.slice(0, 40)}…»` : 'no dialog:start',
    );
    check(`${label}: dialog box shows ${npc.name}`, await s.visible('.hx-dialog.is-open', 3000));
    for (let k = 0; k < 4 * expected.lines.length + 4 && (await s.state()) === 'dialog'; k++) await s.press('Enter', 140);
    const doneEv = await s.waitEvent(from, 'ui:dialogDone', 3000);
    check(`${label}: Enter through every line → ui:dialogDone`, doneEv?.npcId === npc.id && (await s.waitState('playing', 3000)));
    await s.settlePlaying();
  };
  for (const npc of L.npcs) await talk(npc, 'first');
  guard();

  // ── a locked terminal and the closed gate refuse ──
  const locked = L.terminals.find((t) => (t.requires ?? []).length);
  if (locked) {
    await s.teleport(spots.terminals[locked.id]);
    const prompt = await s.promptFor(locked.id);
    const from = await s.mark();
    await s.press('KeyE', 400);
    const warned = (await s.since(from, 'toast')).some((e) => e.payload.kind === 'warn');
    check(`locked ${locked.id} refuses (prompt locked, warn toast, no terminal)`, prompt?.locked === true && warned && (await s.since(from, 'terminal:open')).length === 0, JSON.stringify(prompt));
  }
  {
    const g = spots.gate;
    const front = level.gate.axis === 'x' ? { col: g.col, row: g.row + 1 } : { col: g.col + 1, row: g.row };
    await s.teleport(front);
    const prompt = await s.promptFor('gate');
    const from = await s.mark();
    await s.press('KeyE', 400);
    check('the closed gate refuses (prompt locked, warn toast)', prompt?.kind === 'gate' && prompt.locked === true && (await s.since(from, 'toast')).some((e) => e.payload.kind === 'warn'), JSON.stringify(prompt));
  }
  guard();

  // ── terminals in dependency order, the real terminal UI ──
  for (const t of dependencyOrder(L.terminals)) {
    const label = `${t.id} «${t.title}»`;
    const tStart = Date.now();
    const off = await s.teleport(spots.terminals[t.id]);
    const prompt = await s.promptFor(t.id);
    if (!check(`${label}: prompt, unlocked`, prompt?.kind === 'terminal' && prompt.id === t.id && !prompt.locked && prompt.label === t.title, `${JSON.stringify(prompt)}, ${off.toFixed(2)} tiles off`)) {
      await s.H((id) => window.__harnest.completeTerminal(id), t.id);
      done.add(t.id);
      continue;
    }
    const from = await s.mark();
    await s.press('KeyE', 0);
    const open = await s.waitEvent(from, 'terminal:open', 4000);
    check(`${label}: E → terminal:open`, open?.terminalId === t.id && open.levelId === level.id && (await s.waitState('terminal', 2000)), JSON.stringify(open));
    check(`${label}: terminal window`, (await s.visible(T, 4000)) && (await s.text(`${T} .hx-tw-title`)) === t.title, await s.text(`${T} .hx-tw-title`));
    const problem = await playChallenge(page, s, t);
    guard();
    if (!check(`${label}: every step solved with its canonical answer`, problem === null, problem ?? '')) {
      await s.shot(`fail-${level.id}-${t.id}`);
      // rescue: leave with ✕ and record the terminal through the debug API so the run can go on
      await page.click(`${T} .hx-tw-close`).catch(() => {});
      await s.waitState('playing', 4000);
      await s.H((id) => window.__harnest.completeTerminal(id), t.id);
      done.add(t.id);
      await s.settlePlaying();
      continue;
    }
    check(`${label}: success panel shows 3 stars`, (await s.count(`${T} .hx-success-stars .is-on`)) === 3, `${await s.count(`${T} .hx-success-stars .is-on`)} stars`);
    const before = await s.mark();
    await page.waitForTimeout(200);
    await s.press('Enter', 0);
    const closed = await s.waitEvent(before, 'ui:terminalClosed', 4000);
    check(`${label}: Enter → ui:terminalClosed {completed:true, stars:3}`, closed?.terminalId === t.id && closed.completed === true && closed.stars === 3, JSON.stringify(closed));
    check(`${label}: back to playing`, await s.waitState('playing', 4000), await s.state());
    done.add(t.id);
    const objectives = await s.H(() => window.__harnest.objectives());
    check(`${label}: objective done`, objectives.find((o) => o.id === t.id)?.done === true);
    const saved = await s.H(([l, id]) => JSON.parse(localStorage.getItem('harnest.save.v1') ?? '{}')?.levels?.[l]?.terminals?.[id], [level.id, t.id]);
    check(`${label}: 3 stars saved`, saved === 3, String(saved));
    const codex = await s.H(() => JSON.parse(localStorage.getItem('harnest.save.v1') ?? '{}')?.codex ?? []);
    check(`${label}: codex entries unlocked`, t.challenge.unlocks.every((id) => codex.includes(id)), t.challenge.unlocks.filter((id) => !codex.includes(id)).join(', '));
    const reqDone = required.filter((r) => done.has(r.id)).length;
    check(`${label}: HUD objectives ${reqDone} / ${required.length}`, (await s.text('.hx-hud-objcount')) === `${reqDone} / ${required.length}`, await s.text('.hx-hud-objcount'));
    const opened = (await s.since(from, 'gate:opened')).length > 0;
    const shouldOpen = !gateOpen && required.every((r) => done.has(r.id));
    check(`${label}: gate ${shouldOpen ? 'opens now' : gateOpen ? 'stays open' : 'stays closed'}`, opened === shouldOpen);
    if (opened) gateOpen = true;
    console.log(`    ${level.id}/${t.id} ${t.required ? '        ' : '(bonus) '}${String(t.challenge.steps.length).padStart(2)} steps  ${((Date.now() - tStart) / 1000).toFixed(1)}s  «${t.title}»`);
    await s.settlePlaying();
    guard();
  }
  if (!gateOpen && required.every((r) => done.has(r.id))) gateOpen = (await s.since(0, 'gate:opened')).some((e) => e.payload.levelId === level.id);
  check('gate opened', gateOpen);
  check('HUD: gate open', /Ворота открыты/.test(await s.text('.hx-hud-gate')), await s.text('.hx-hud-gate'));

  // ── chips ──
  for (const chip of L.chips) {
    const have = await s.H(([l, id]) => (JSON.parse(localStorage.getItem('harnest.save.v1') ?? '{}')?.levels?.[l]?.chips ?? []).includes(id), [level.id, chip.id]);
    if (have) {
      check(`chip ${chip.id}: collected on the way`, true);
      continue;
    }
    const from = await s.mark();
    await s.teleport(spots.chips[chip.id], 150);
    const got = await s.waitEvent(from, 'chip:collected', 3000);
    check(`chip ${chip.id} «${chip.title}» collected`, got?.chipId === chip.id && got.levelId === level.id, JSON.stringify(got));
  }
  check(`HUD chips ${L.chips.length} / ${L.chips.length}`, (await s.text('.hx-hud-chipcount')) === `${L.chips.length} / ${L.chips.length}`, await s.text('.hx-hud-chipcount'));
  guard();

  // ── NPCs again, now that the gate is open ──
  for (const npc of L.npcs) await talk(npc, 'gate open');
  guard();

  // ── out through the open gate: drive (a held key) to the exit ──
  {
    const g = spots.gate;
    const ex = spots.exit;
    const axisX = level.gate.axis === 'x';
    const dir = axisX ? Math.sign(ex.row - g.row) || -1 : Math.sign(ex.col - g.col) || 1;
    const start = axisX ? { col: g.col, row: g.row - dir * 1.6 } : { col: g.col - dir * 1.6, row: g.row };
    await s.teleport(start);
    check('no gate prompt once it is open', (await s.H(() => window.__harnest.prompt()))?.kind !== 'gate');
    const key = axisX ? (dir < 0 ? 'KeyW' : 'KeyS') : dir > 0 ? 'KeyD' : 'KeyA';
    const from = await s.mark();
    await page.keyboard.down(key);
    const through = await s.waitState('levelComplete', 6000);
    await page.keyboard.up(key);
    if (!check(`drives through the open gate (${key} held) → levelComplete`, through, `robot at ${JSON.stringify(await s.H(() => window.__harnest.player()))}`)) {
      await s.teleport(ex);
      await s.waitState('levelComplete', 3000);
    }
    const completed = (await s.since(from, 'level:completed'))[0]?.payload;
    const st = completed?.stats;
    check('level:completed with every star and chip', completed?.levelId === level.id && st?.stars === st?.maxStars && st?.chips === st?.maxChips, JSON.stringify(st));
    check('summary', await s.visible('.hx-summary.is-open', 4000));
    const starsText = await s.text('.hx-summary-stat .hx-summary-value');
    check(`summary stars ${st?.maxStars} / ${st?.maxStars}`, starsText === `${st?.maxStars} / ${st?.maxStars}`, starsText);
    await page.waitForTimeout(500);
    await s.shot(`summary-${level.id}`);
    guard();
    return { stats: st ?? null, isLast: !!completed?.isLast, wallSec: (Date.now() - t0) / 1000 };
  }
}

// ───────────────────────────── main ─────────────────────────────

const browser = await launchBrowser({ browser: args.browser, headless: !args.headed });
const lines = [];
let problemsAll = [];
let backend = '?';
try {
  // which levels
  const boot = await openPage(browser, { width: 1280, height: 720 });
  let { page, problems } = boot;
  let navs = 0;
  const track = (p) => p.on('framenavigated', (f) => f === p.mainFrame() && navs++);
  track(page);
  let pageNavsAtLoad = 0;
  const reloads = () => navs - pageNavsAtLoad;

  const start = async (levelId) => {
    pageNavsAtLoad = navs + 1;
    await page.goto(gameUrl(levelId), { waitUntil: 'load', timeout: 90000 });
    if (!(await waitReady(page, undefined, 120000))) throw new Error(`the game did not start (${gameUrl(levelId)})`);
    await installLog(page);
  };

  scope = 'boot';
  const firstUrlLevel = args.level && args.level !== true ? String(args.level) : null;
  await start(firstUrlLevel ?? 'l1');
  const LEVELS = await loadContent(page);
  backend = await page.evaluate(() => window.__harnest.backend);
  const firstIndex = firstUrlLevel ? LEVELS.findIndex((l) => l.id === firstUrlLevel) : 0;
  if (firstIndex < 0) throw new Error(`unknown level ${firstUrlLevel}; levels: ${LEVELS.map((l) => l.id).join(', ')}`);
  const plan = firstUrlLevel ? [LEVELS[firstIndex]] : LEVELS;
  console.log(`playthrough: ${plan.map((l) => l.id).join(' → ')} · ${base} · backend ${backend} · q=${quality}${fast ? ' · fast' : ''}`);
  check('level:ready for the first level', (await page.evaluate(() => window.__harnest.level())) === plan[0].id);

  let fullRun = !firstUrlLevel;
  for (let li = 0; li < plan.length; li++) {
    const level = plan[li];
    scope = level.id;
    let outcome = null;
    for (let attempt = 1; attempt <= 2 && !outcome; attempt++) {
      const problemsBefore = problems.length;
      try {
        outcome = await playLevel(page, session(page), level, { reloads });
      } catch (err) {
        if (!(err instanceof Reloaded) || attempt === 2) throw err;
        // a dev-server reload (someone saved a file): the level starts over in a fresh page and save;
        // what the aborted attempt logged goes with it
        console.log(`  [${level.id}] ${err.message} — retrying the level in a fresh page`);
        fullRun = false;
        for (let i = results.length - 1; i >= 0; i--) if (results[i].scope === level.id) results.splice(i, 1);
        problemsAll.push(...problems.slice(0, problemsBefore));
        await page.context().close();
        ({ page, problems } = await openPage(browser, { width: 1280, height: 720 }));
        track(page);
        await start(level.id);
      }
    }
    const st = outcome.stats;
    const failed = results.filter((r) => r.scope === level.id && !r.ok).length;
    const line = `${level.id} «${level.title}»  stars ${st?.stars ?? '?'}/${st?.maxStars ?? '?'}  chips ${st?.chips ?? '?'}/${st?.maxChips ?? '?'}  game ${st ? fmtTime(st.timeSec) : '?'}  wall ${fmtTime(outcome.wallSec)}  ${failed ? `${failed} FAILED` : 'ok'}`;
    lines.push(line);
    console.log(`  ${line}`);

    // summary → Enter → the next level (or the ending)
    const s = session(page);
    const m = await s.mark();
    await s.press('Enter', 0);
    check('summary → Enter → ui:nextLevel', !!(await s.waitEvent(m, 'ui:nextLevel', 4000)));
    const next = LEVELS[LEVELS.findIndex((l) => l.id === level.id) + 1];
    if (next) {
      const ready = await s.waitEvent(m, 'level:ready', 90000);
      check(`next level loads: ${next.id}`, ready?.levelId === next.id, JSON.stringify(ready));
      if (li === plan.length - 1) check(`state intro for ${next.id}`, await s.waitState('intro', 60000), await s.state());
    } else {
      scope = 'ending';
      check('state ending', await s.waitState('ending', 10000), await s.state());
      check('ending screen', await s.visible('.hx-ending.is-open', 5000));
      const stats = await s.text('.hx-ending-stats');
      const stars = /Звёзды: (\d+) \/ (\d+)/.exec(stats);
      if (fullRun) check('ending: every star of the game', !!stars && stars[1] === stars[2], stats);
      await page.waitForTimeout(700);
      await s.shot('ending');
    }
  }
  scope = 'all';
  problemsAll = [...problemsAll, ...problems];
  check('zero console errors', problemsAll.length === 0, problemsAll.slice(0, 6).join(' | '));
} catch (err) {
  check('run', false, err instanceof Error ? (err.stack ?? err.message) : String(err));
} finally {
  await browser.close();
  await server?.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${lines.join('\n')}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — ${failed.length} failed` : ''} (backend ${backend})`);
for (const f of failed) console.log(`  FAIL [${f.scope}] ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
console.log(`screenshots: ${outDir}`);
process.exitCode = failed.length ? 1 : 0;
