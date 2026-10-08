// Screenshots of every UI screen from the dev harness (ui-dev.html) into .shots/ui/.
//
//   node scripts/ui-shots.mjs [--only name1,name2] [--base http://127.0.0.1:5173] [--browser chrome|msedge]
//
// Each shot opens ui-dev.html with URL params, waits for window.__uiReady, optionally plays a few
// real key presses, and saves <name>.png. Console errors are collected and reported; exit code 1
// if any shot failed or logged an error.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchBrowser, openPage, waitReady } from './lib/browser.mjs';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') ? true : (all[i + 1] ?? true)] : null))
    .filter(Boolean),
);
const BASE = String(args.base ?? 'http://127.0.0.1:5173');
const OUT = resolve('.shots/ui');
const only = args.only ? String(args.only).split(',') : null;
mkdirSync(OUT, { recursive: true });

const T = '.hx-terminal.is-open';
const sel = {
  shell: `${T} .hx-sh`,
  claude: `${T} .hx-pb:not(.is-inert)`,
  choice: `${T} .hx-choice`,
  cont: `${T} .hx-continue`,
  success: `${T} .hx-tw-success.is-on`,
};

/** Types a line into the terminal and presses Enter. */
async function line(page, text) {
  await page.keyboard.type(text, { delay: 12 });
  await page.keyboard.press('Enter');
}

/** Solves the current terminal step with its canonical answer (from window.__dev.answers). */
async function solveStep(page, step) {
  if (step.kind === 'command') {
    await page.waitForSelector(step.prompt === 'shell' ? sel.shell : sel.claude);
    await line(page, step.example);
  } else if (step.kind === 'key') {
    await page.waitForSelector(sel.claude);
    if (step.untilMode) {
      for (let i = 0; i < 6; i++) {
        const done = await page.evaluate(() => !document.querySelector('.hx-terminal.is-open .hx-pb:not(.is-inert)'));
        if (done) break;
        await page.keyboard.press(step.keys[0]);
        await page.waitForTimeout(80);
      }
    } else for (const k of step.keys) await page.keyboard.press(k);
  } else if (step.kind === 'choice') {
    await page.waitForSelector(sel.choice);
    await page.keyboard.press(String(step.correct + 1));
  } else {
    await page.waitForSelector(sel.cont);
    await page.keyboard.press('Enter');
  }
  await page.waitForTimeout(150);
}

async function solveUpTo(page, count, level = 'l1', terminal = 't1') {
  const steps = await page.evaluate(([l, t]) => window.__dev.answers(l, t), [level, terminal]);
  for (const step of steps.slice(0, count)) await solveStep(page, step);
}

/** Skips any streaming output so the picture is final. */
async function settle(page, ms = 2600) {
  await page.waitForTimeout(ms);
}

const shots = [
  { name: 'boot', q: 'screen=boot&hold=1' },
  { name: 'loading', q: 'screen=loading&hold=1' },
  { name: 'menu', q: 'screen=menu' },
  { name: 'menu-fresh', q: 'screen=menu&save=none' },
  { name: 'levels', q: 'screen=levels&mock=1&level=m3' },
  { name: 'confirm', q: 'screen=confirm' },
  { name: 'intro', q: 'screen=intro' },
  { name: 'hud', q: 'screen=hud' },
  {
    name: 'hud-locked',
    q: 'screen=hud&mock=1&level=m2&save=none',
    run: async (page) => {
      await page.evaluate(() => window.__dev.game.walkTo(2));
      await page.waitForTimeout(250);
    },
  },
  { name: 'dialog', q: 'screen=dialog' },
  {
    name: 'dialog-harni',
    q: 'screen=dialog&mock=1&level=m2',
    run: async (page) => {
      await page.keyboard.press('Enter'); // line 2: ХАРНИ
      await page.waitForTimeout(900);
    },
  },
  {
    name: 'dialog-long',
    q: 'screen=dialog&mock=1&level=m2',
    run: async (page) => {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(250);
      await page.keyboard.press('Enter'); // finish line 2
      await page.waitForTimeout(250);
      await page.keyboard.press('Enter'); // line 3 starts typing (long)
      await page.waitForTimeout(700);
    },
  },
  { name: 'chip', q: 'screen=chip&mock=1&level=m2' },
  { name: 'codex', q: 'screen=codex&mock=1&level=m3' },
  { name: 'codex-l1', q: 'screen=codex' },
  { name: 'pause', q: 'screen=pause' },
  { name: 'settings', q: 'screen=settings' },
  { name: 'summary', q: 'screen=summary' },
  { name: 'ending', q: 'screen=ending' },
  { name: 'terminal-t1-start', q: 'screen=terminal&terminal=t1' },
  {
    name: 'terminal-t1-wrong-hint',
    q: 'screen=terminal&terminal=t1',
    run: async (page) => {
      await page.waitForSelector(sel.shell);
      await line(page, 'claude code');
      await page.waitForTimeout(150);
      await page.keyboard.press('F1');
      await page.waitForTimeout(300);
    },
  },
  {
    name: 'terminal-t1-claude',
    q: 'screen=terminal&terminal=t1',
    run: async (page) => {
      await solveUpTo(page, 1);
      await page.waitForSelector(sel.claude);
      await page.keyboard.type('что делает', { delay: 15 });
      await page.waitForTimeout(200);
    },
  },
  {
    name: 'terminal-t1-working',
    q: 'screen=terminal&terminal=t1',
    run: async (page) => {
      await solveUpTo(page, 1);
      await page.waitForSelector(sel.claude);
      await line(page, 'что делает этот проект?');
      await page.waitForTimeout(450);
    },
  },
  {
    name: 'terminal-t1-success',
    q: 'screen=terminal&terminal=t1',
    run: async (page) => {
      await solveUpTo(page, 4);
      await page.waitForSelector(sel.success, { timeout: 20000 });
      await page.waitForTimeout(450);
    },
  },
  {
    // l1/t3 «Привод ворот»: a Claude-first session in manual mode; s2 is the Bash permission dialog
    name: 'terminal-t3-perm',
    q: 'screen=terminal&terminal=t3',
    run: async (page) => {
      await solveUpTo(page, 1, 'l1', 't3');
      await page.waitForSelector(sel.choice, { timeout: 15000 });
      // a wrong option picked with the arrows (marked ✗, coach reply), then the cursor on the right one
      const perm = (await page.evaluate(() => window.__dev.answers('l1', 't3')))[1];
      const wrong = perm.correct === perm.count - 1 ? 0 : perm.count - 1;
      for (let i = 0; i < wrong; i++) await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      for (let i = wrong; i > perm.correct; i--) await page.keyboard.press('ArrowUp');
      for (let i = wrong; i < perm.correct; i++) await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(150);
    },
  },
  {
    name: 'showcase-info',
    q: 'screen=terminal&mock=1&level=m2&terminal=t1',
    run: async (page) => {
      await page.waitForSelector(sel.cont, { timeout: 15000 });
      await page.waitForTimeout(200);
    },
  },
  {
    name: 'showcase-key',
    q: 'screen=terminal&mock=1&level=m2&terminal=t1',
    run: async (page) => {
      await solveUpTo(page, 1, 'm2', 't1');
      await page.waitForSelector(sel.claude);
      await page.keyboard.press('Shift+Tab');
      await page.waitForTimeout(200);
    },
  },
  {
    name: 'showcase-quiz',
    q: 'screen=terminal&mock=1&level=m2&terminal=t1',
    run: async (page) => {
      await solveUpTo(page, 2, 'm2', 't1');
      await page.waitForSelector(sel.choice, { timeout: 15000 });
      await page.keyboard.press('2');
      await page.waitForTimeout(250);
      await page.keyboard.press('F1');
      await page.keyboard.press('F1');
      await page.waitForTimeout(250);
    },
  },
  {
    name: 'showcase-bash',
    q: 'screen=terminal&mock=1&level=m2&terminal=t1',
    run: async (page) => {
      await solveUpTo(page, 3, 'm2', 't1');
      await page.waitForSelector(sel.claude, { timeout: 15000 });
      await page.keyboard.type('!npm te', { delay: 15 });
      await page.waitForTimeout(200);
    },
  },
  {
    name: 'showcase-perm',
    q: 'screen=terminal&mock=1&level=m2&terminal=t1',
    run: async (page) => {
      await solveUpTo(page, 4, 'm2', 't1');
      await page.waitForSelector(sel.choice, { timeout: 15000 });
      await page.waitForTimeout(250);
    },
  },
  {
    name: 'terminal-long',
    q: 'screen=terminal&mock=1&level=m2&terminal=t2',
    run: async (page) => {
      await page.waitForSelector(sel.shell);
      await line(page, 'привет');
      await page.keyboard.press('F1');
      await page.keyboard.press('F1');
      await page.keyboard.press('F1');
      await page.waitForTimeout(300);
    },
  },
  {
    name: 'terminal-long-reply',
    q: 'screen=terminal&mock=1&level=m2&terminal=t2',
    run: async (page) => {
      await solveUpTo(page, 2, 'm2', 't2');
      await page.waitForSelector(sel.success, { timeout: 15000 });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
    },
    skip: true,
  },
  // Small screen.
  { name: 'small-menu', q: 'screen=menu', w: 1024, h: 600 },
  { name: 'small-levels', q: 'screen=levels&mock=1&level=m3', w: 1024, h: 600 },
  { name: 'small-hud', q: 'screen=hud', w: 1024, h: 600 },
  { name: 'small-dialog', q: 'screen=dialog&mock=1&level=m2', w: 1024, h: 600 },
  { name: 'small-codex', q: 'screen=codex&mock=1&level=m3', w: 1024, h: 600 },
  { name: 'small-settings', q: 'screen=settings', w: 1024, h: 600 },
  { name: 'small-summary', q: 'screen=summary', w: 1024, h: 600 },
  {
    name: 'small-terminal-perm',
    q: 'screen=terminal&terminal=t3',
    w: 1024,
    h: 600,
    run: async (page) => {
      await solveUpTo(page, 1, 'l1', 't3');
      await page.waitForSelector(sel.choice, { timeout: 15000 });
      await page.waitForTimeout(250);
    },
  },
  {
    name: 'small-showcase',
    q: 'screen=terminal&mock=1&level=m2&terminal=t1',
    w: 1024,
    h: 600,
    run: async (page) => {
      await page.waitForSelector(sel.cont, { timeout: 15000 });
    },
  },
  // Large screen.
  {
    name: 'large-showcase',
    q: 'screen=terminal&mock=1&level=m2&terminal=t1',
    w: 2560,
    h: 1440,
    run: async (page) => {
      await page.waitForSelector(sel.cont, { timeout: 15000 });
    },
  },
  { name: 'large-menu', q: 'screen=menu', w: 2560, h: 1440 },
];

const browser = await launchBrowser({ browser: args.browser, webgpu: false });
const report = [];
let failed = 0;
try {
  for (const shot of shots) {
    if (only ? !only.includes(shot.name) : shot.skip) continue;
    let error = null;
    let columns = null;
    let problems = [];
    // The dev server reloads the page when someone edits content: retry such a shot.
    for (let attempt = 1; attempt <= 3; attempt++) {
      const opened = await openPage(browser, { width: shot.w ?? 1280, height: shot.h ?? 720 });
      const page = opened.page;
      problems = opened.problems;
      let loads = 0;
      page.on('load', () => loads++);
      error = null;
      try {
        await page.goto(`${BASE}/ui-dev.html?devbar=0&${shot.q}`, { waitUntil: 'load', timeout: 60000 });
        if (!(await waitReady(page, 'window.__uiReady === true', 20000))) throw new Error('harness not ready');
        if (shot.run) await shot.run(page);
        columns = await page.evaluate(() => window.__dev.columns());
        if (loads > 1) throw new Error('page reloaded');
        await page.screenshot({ path: resolve(OUT, `${shot.name}.png`) });
      } catch (err) {
        error = String(err?.message ?? err);
      }
      await page.context().close();
      if (!error || loads <= 1) break;
    }
    if (error || problems.length) failed++;
    report.push({ name: shot.name, size: `${shot.w ?? 1280}x${shot.h ?? 720}`, columns: columns || undefined, error: error ?? undefined, problems: problems.length ? problems : undefined });
  }
} finally {
  await browser.close();
}
for (const r of report) console.log(JSON.stringify(r));
console.log(failed ? `${failed} shot(s) with problems` : `all ${report.length} shots ok → ${OUT}`);
process.exitCode = failed ? 1 : 0;
