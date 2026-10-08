// UI playtest on the dev harness (ui-dev.html): plays the real UI with real key presses.
//
//   node scripts/ui-playtest.mjs [--base http://127.0.0.1:5173] [--browser chrome|msedge] [--headed]
//
// Walks menu → new game → intro → HUD → dialog → pause → codex → settings → resume → Tab codex,
// then plays the three required terminals of level 1 by typing:
//   t1 (shell first): a tailored wrong answer, a hint, `claude`, the Shift+Tab mode cycle, every prompt → 2 stars;
//   t2 (shell first): no session header before `claude`, /init, a quiz (wrong option, then the right one), prompts → 3 stars;
//   t3 (Claude first, manual mode): the Bash permission dialog (a wrong option, then the right one), Esc = No,
//      a prompt, a one-time Yes, /exit as the last step → 3 stars → the gate opens;
// replays t1 and leaves it with /exit and with ✕, and finishes the level through the gate.
// Checks the ui:terminalClosed payloads, stars, HUD counters and the summary. Fails on any console error.
// Titles, target digits, counts, answers and replies come from window.__dev.content, so a content
// change only breaks the script where the lesson itself changed shape.
// The dev server hot-reloads while other people edit content; a run interrupted by a page reload
// is retried (up to 3 times).
import { launchBrowser, openPage, waitReady } from './lib/browser.mjs';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const BASE = opt('base', 'http://127.0.0.1:5173');
const headed = argv.includes('--headed');

/** Status-line label per permission mode (src/ui/terminal/lines.ts, reference §3.1). */
const MODE_LABEL = { auto: 'auto mode on', manual: 'manual mode on', default: 'manual mode on', acceptEdits: 'accept edits on', plan: 'plan mode on' };
/** The same answer matching as src/content/match.ts. */
const normalize = (raw) =>
  raw
    .replace(/[‘’]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
const matches = (src, input) => new RegExp(`^(?:${src})$`, 'i').test(normalize(input));

class Reloaded extends Error {}

async function run(browser) {
  const { page, problems } = await openPage(browser, { width: 1280, height: 720 });
  let loads = 0;
  page.on('load', () => loads++);
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok: !!ok, detail });
    console.log(`${ok ? '  ok ' : ' FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
    return !!ok;
  };
  const guard = () => {
    if (loads > 1) throw new Reloaded('page reloaded by the dev server');
  };

  const state = () => page.evaluate(() => window.__dev.state());
  const waitState = async (s, timeout = 8000) => {
    try {
      await page.waitForFunction((x) => window.__dev.state() === x, s, { timeout });
      return true;
    } catch {
      guard();
      return false;
    }
  };
  const mark = () => page.evaluate(() => window.__events.length);
  const eventsSince = (from, type) => page.evaluate(([f, t]) => window.__events.slice(f).filter((e) => e.type === t).map((e) => e.payload), [from, type]);
  const waitEvent = async (from, type, timeout = 8000) => {
    try {
      await page.waitForFunction(([f, t]) => window.__events.slice(f).some((e) => e.type === t), [from, type], { timeout });
    } catch {
      guard();
      return null;
    }
    const list = await eventsSince(from, type);
    return list[list.length - 1] ?? null;
  };
  const waitFor = (fn, arg, timeout = 8000) =>
    page
      .waitForFunction(fn, arg, { timeout })
      .then(() => true)
      .catch(() => (guard(), false));
  const visible = (selector, timeout = 8000) =>
    page
      .waitForSelector(selector, { state: 'visible', timeout })
      .then(() => true)
      .catch(() => (guard(), false));
  const text = (selector) => page.evaluate((s) => document.querySelector(s)?.textContent?.trim() ?? '', selector);
  const count = (selector) => page.evaluate((s) => document.querySelectorAll(s).length, selector);
  const press = async (key, wait = 120) => {
    await page.keyboard.press(key);
    await page.waitForTimeout(wait);
  };
  const terminalInputFocused = () =>
    page
      .waitForFunction(() => document.activeElement?.classList.contains('hx-tw-input'), undefined, { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
  const inputValue = () => page.evaluate(() => document.querySelector('.hx-tw-input')?.value ?? '');
  const typeLine = async (value) => {
    await terminalInputFocused();
    await page.keyboard.type(value, { delay: 25 });
    await press('Enter', 150);
  };
  const T = '.hx-terminal.is-open';
  const SEL = {
    shell: `${T} .hx-sh`,
    claude: `${T} .hx-pb:not(.is-inert)`,
    choice: `${T} .hx-choice`,
    cont: `${T} .hx-continue`,
    success: `${T} .hx-tw-success.is-on`,
  };
  const stars = (selector) => count(`${selector} .is-on`);

  /** Waits until step `i` of the open terminal is current and ready for input. */
  const stepReady = (i, step, timeout = 15000) => {
    const widget = step.kind === 'command' ? (step.prompt === 'shell' ? SEL.shell : SEL.claude) : step.kind === 'key' ? SEL.claude : step.kind === 'choice' ? SEL.choice : SEL.cont;
    return waitFor(
      ([n, w]) => {
        const dot = document.querySelectorAll('.hx-terminal.is-open .hx-task-dots > i')[n];
        const el = document.querySelector(w);
        return !!dot?.classList.contains('is-now') && !!el && el.getClientRects().length > 0;
      },
      [i, widget],
      timeout,
    );
  };
  /** Plays step `i` with its canonical answer (as a player who knows it would). */
  const solve = async (i, step) => {
    if (!(await stepReady(i, step))) return false;
    if (step.kind === 'command') await typeLine(step.example);
    else if (step.kind === 'choice') await press(String(step.options.findIndex((o) => o.correct) + 1), 150);
    else if (step.kind === 'info') await press('Enter', 150);
    else if (step.untilMode) {
      for (let k = 0; k < 6 && (await page.evaluate((n) => document.querySelectorAll('.hx-terminal.is-open .hx-task-dots > i')[n]?.classList.contains('is-now'), i)); k++) await press('Shift+Tab', 150);
    } else for (const key of step.keys) await press(key.replace(/^Ctrl\+/, 'Control+'), 120);
    return true;
  };
  const counter = () => text(`${T} .hx-task-counter`);

  await page.goto(`${BASE}/ui-dev.html?devbar=0&save=none`, { waitUntil: 'load', timeout: 60000 });
  if (!(await waitReady(page, 'window.__uiReady === true', 20000))) throw new Error('harness not ready');

  // ───── what level 1 is made of (window.__dev.content) ─────
  const L = await page.evaluate(() => {
    const level = window.__dev.content.levels[0];
    return {
      id: level.id,
      title: level.meta.title,
      npcs: level.lessons.npcs.map((n) => ({ id: n.id, name: n.name })),
      terminals: level.lessons.terminals.map((t) => ({ id: t.id, title: t.title, required: t.required, startMode: t.challenge.startMode ?? 'auto', steps: t.challenge.steps })),
    };
  });
  const required = L.terminals.filter((t) => t.required);
  const [t1, t2, t3] = required;
  const targets = [...L.npcs.map((n) => n.id), ...L.terminals.map((t) => t.id), 'gate'];
  /** The harness picks a target with digit (index + 1). */
  const walkTo = async (id) => {
    const i = targets.indexOf(id);
    if (i < 0) throw new Error(`no target ${id}`);
    if (i < 9) await press(String(i + 1), 150);
    else await page.evaluate((n) => window.__dev.game.walkTo(n), i);
  };
  const objcount = (done) => `${done} / ${required.length}`;
  console.log(`  level ${L.id} «${L.title}»: ${L.npcs.length} NPCs, ${L.terminals.length} terminals (${required.length} required), targets ${targets.join(' ')}`);

  // ───── boot → main menu ─────
  check('boot ends in the main menu', await waitState('menu'));
  check('main menu visible', await visible('.hx-menu-screen.is-open'));
  const items = await page.evaluate(() => [...document.querySelectorAll('.hx-menu-screen.is-open .hx-mm-root .hx-menu-item')].map((b) => b.dataset.id));
  check('fresh save: no "Продолжить"', !items.includes('continue') && items[0] === 'new', items.join(','));
  let m = await mark();
  await press('ArrowDown');
  await press('ArrowUp');
  check('menu navigation plays uiMove', (await eventsSince(m, 'sfx')).some((s) => s.name === 'uiMove'));
  check('active item is "Новая игра"', (await text('.hx-menu-screen.is-open .hx-mm-root .hx-menu-item.is-active .hx-menu-label')) === 'Новая игра');

  // ───── new game → intro → playing ─────
  m = await mark();
  await press('Enter');
  const play = await waitEvent(m, 'ui:play');
  check('Новая игра → ui:play {newGame:true}', play?.newGame === true, JSON.stringify(play));
  check('loading screen while the level builds', await visible('.hx-loading.is-open', 3000));
  check('intro card', await visible('.hx-intro.is-open'));
  check(`intro shows the level title «${L.title}»`, (await text('.hx-intro.is-open .hx-intro-title')) === L.title);
  m = await mark();
  await page.waitForTimeout(300);
  await press('Enter');
  check('Enter → ui:introDone', !!(await waitEvent(m, 'ui:introDone')));
  check('state playing', await waitState('playing'));

  // ───── HUD ─────
  const npc = L.npcs[0];
  check('HUD visible', await visible('.hx-hud.is-open'));
  check('HUD district', (await text('.hx-hud-district')) === L.title);
  check(`HUD objectives count required terminals only: ${objcount(0)}`, (await text('.hx-hud-objcount')) === objcount(0), await text('.hx-hud-objcount'));
  check(`HUD prompt: talk to ${npc.name}`, (await visible('.hx-hud-prompt.is-on')) && (await text('.hx-hud-prompt')).includes(npc.name), await text('.hx-hud-prompt'));
  check('HUD prompt verb', (await text('.hx-hud-prompt')).includes('Поговорить'), await text('.hx-hud-prompt'));

  // ───── dialog ─────
  m = await mark();
  await press('e', 200);
  check('E opens the dialog', await visible('.hx-dialog.is-open'));
  check(`dialog speaker ${npc.name}`, (await text('.hx-dlg-name')) === npc.name, await text('.hx-dlg-name'));
  await page.waitForTimeout(400);
  check('typewriter talk blips', (await eventsSince(m, 'sfx')).some((s) => s.name === 'talk'));
  for (let i = 0; i < 16 && (await state()) === 'dialog'; i++) await press('Enter', 260);
  const dlg = await waitEvent(m, 'ui:dialogDone');
  check(`dialog → ui:dialogDone {npcId:${npc.id}}`, dlg?.npcId === npc.id, JSON.stringify(dlg));
  check('back to playing', await waitState('playing'));

  // ───── pause → codex → settings ─────
  m = await mark();
  await press('Escape', 250);
  check('Esc → ui:pause', !!(await waitEvent(m, 'ui:pause')));
  check('pause menu', await visible('.hx-pause.is-open'));
  check('state paused', (await state()) === 'paused');
  await press('Tab', 250);
  check('Tab in pause → codex', await visible('.hx-codex.is-open'));
  const codexCounter = await text('.hx-codex-counter');
  check('codex counter (fresh save)', /^Открыто 0 из \d+$/.test(codexCounter), codexCounter);
  check('codex shows locked placeholders', (await count('.hx-codex.is-open .hx-ce.is-locked')) > 0);
  await page.keyboard.type('init', { delay: 20 });
  await page.waitForTimeout(150);
  check('codex filter hides locked entries', (await count('.hx-codex.is-open .hx-ce')) === 0 && (await count('.hx-codex-empty')) === 1);
  await press('Escape');
  check('Esc clears the filter first', (await page.evaluate(() => document.querySelector('.hx-codex-input').value)) === '' && (await count('.hx-codex.is-open')) === 1);
  await press('Escape', 250);
  check('Esc closes the codex, pause stays', (await count('.hx-codex.is-open')) === 0 && (await count('.hx-pause.is-open')) === 1 && (await state()) === 'paused');
  await press('ArrowDown');
  await press('ArrowDown');
  await press('Enter', 250);
  check('Настройки from pause', await visible('.hx-settings.is-open'));
  const before = await page.evaluate(() => window.__dev.store.settings.master);
  await press('ArrowRight');
  const after = await page.evaluate(() => window.__dev.store.settings.master);
  check('→ raises master volume via store.setSettings', after > before, `${before} → ${after}`);
  await press('ArrowDown');
  await press('ArrowDown');
  await press('ArrowDown');
  await press('ArrowRight');
  const quality = await page.evaluate(() => window.__dev.store.settings.quality);
  check('quality row changes quality', quality === 'low', quality);
  await press('Escape', 250);
  check('Esc closes settings, pause stays', (await count('.hx-settings.is-open')) === 0 && (await count('.hx-pause.is-open')) === 1);
  m = await mark();
  await press('Escape', 250);
  check('Esc in pause → ui:resume', !!(await waitEvent(m, 'ui:resume')));
  check('state playing after resume', await waitState('playing'));

  // ───── Tab codex from the game ─────
  m = await mark();
  await press('Tab', 250);
  check('Tab in game → codex + ui:pause', (await count('.hx-codex.is-open')) === 1 && !!(await waitEvent(m, 'ui:pause')));
  check('no pause menu behind the codex', (await count('.hx-pause.is-open')) === 0);
  m = await mark();
  await press('Tab', 250);
  check('Tab closes the codex → ui:resume', (await count('.hx-codex.is-open')) === 0 && !!(await waitEvent(m, 'ui:resume')));
  check('playing again', await waitState('playing'));

  // ───── t1: tailored wrong answer, hint, claude, mode cycle, every prompt → 2 stars ─────
  {
    const [s1, ...rest] = t1.steps;
    check(`prompt points at ${t1.id} «${t1.title}»`, (await text('.hx-hud-prompt')).includes(t1.title), await text('.hx-hud-prompt'));
    m = await mark();
    await press('e', 250);
    const open = await waitEvent(m, 'terminal:open');
    check(`E opens terminal ${t1.id}`, open?.terminalId === t1.id && (await visible(T)), JSON.stringify(open));
    check('HUD hidden behind the terminal', (await count('.hx-hud.is-open')) === 0);
    check('shell prompt first', s1.kind === 'command' && s1.prompt === 'shell' && (await visible(SEL.shell)));
    check('no session header before claude runs', (await count(`${T} .tl-header`)) === 0);
    check('terminal input focused', await terminalInputFocused());
    const cols = await page.evaluate(() => window.__dev.columns());
    check('terminal fits ≥ 82 columns at 1280×720', cols >= 82, `${cols} columns`);
    const typo = 'claude code';
    const tailored = s1.wrong?.find((w) => matches(w.match, typo))?.reply ?? '';
    await typeLine(typo);
    const coach = await text(`${T} .hx-coach`);
    check('tailored wrong reply «Команда короче»', tailored.includes('Команда короче') && coach.includes(tailored), coach);
    check('stepWrong sfx', (await eventsSince(m, 'sfx')).some((s) => s.name === 'stepWrong'));
    check('wrong input stays editable', (await inputValue()) === typo);
    check('3 stars before the hint', (await stars(`${T} .hx-task-stake-stars`)) === 3);
    await press('F1', 200);
    check('F1 shows the first hint', (await count(`${T} .hx-task-hint`)) === 1 && (await text(`${T} .hx-task-hint`)).includes(s1.hints[0]));
    check('stars at stake drop to 2', (await stars(`${T} .hx-task-stake-stars`)) === 2);
    check('hint sfx', (await eventsSince(m, 'sfx')).some((s) => s.name === 'hint'));
    await press('Escape');
    check('Esc clears the input', (await inputValue()) === '');
    await typeLine(s1.example);
    check(`session header after \`${s1.example}\``, await visible(`${T} .tl-header`));
    const label = MODE_LABEL[t1.startMode];
    check(`Claude prompt, status «${label}»`, (await visible(SEL.claude)) && (await text(`${T} .hx-status-left`)).includes(label), await text(`${T} .hx-status-left`));
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(120);
    const cycled = await text(`${T} .hx-status-left`);
    for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(120);
    check('Shift+Tab cycles the mode (and back after 4 presses)', cycled.includes('manual mode on') && (await text(`${T} .hx-status-left`)).includes(label), cycled);
    for (const [k, step] of rest.entries()) {
      const i = k + 1;
      const ready = await stepReady(i, step);
      if (!check(`${t1.id}/${step.id}: ${step.kind}${step.kind === 'command' ? ` «${step.example}»` : ''}`, ready && step.kind === 'command' && step.prompt === 'claude', await counter())) break;
      await typeLine(step.example);
      if (i === 1) {
        check('spinner while Claude works', await visible(`${T} .hx-spin.is-on`, 2000));
        const tool = (step.output ?? []).find((l) => typeof l === 'object' && l.style === 'tool')?.text;
        check(`tool line printed: ${tool}`, !!tool && (await waitFor((s) => [...document.querySelectorAll('.hx-terminal.is-open .tl-tool')].some((e) => e.textContent.includes(s)), tool, 10000)));
      }
    }
    check('success panel', await visible(SEL.success, 15000));
    const worked = await text(`${T} .tl-worked`);
    check('end-of-turn line', /^✻\s*\S+ for \d+s$/.test(worked), worked);
    check('success shows 2 stars (a hint was used)', (await stars(`${T} .hx-success-stars`)) === 2);
    m = await mark();
    await press('Enter', 250);
    const closed = await waitEvent(m, 'ui:terminalClosed');
    check(`${t1.id} → ui:terminalClosed completed, 2 stars`, closed?.terminalId === t1.id && closed?.completed === true && closed?.stars === 2, JSON.stringify(closed));
    check(`back to playing after ${t1.id}`, await waitState('playing'));
    check(`HUD objectives ${objcount(1)}`, (await text('.hx-hud-objcount')) === objcount(1), await text('.hx-hud-objcount'));
  }

  // ───── t2: shell first, /init, a quiz (wrong, then right), prompts → 3 stars ─────
  {
    check(`prompt points at ${t2.id} «${t2.title}»`, (await text('.hx-hud-prompt')).includes(t2.title), await text('.hx-hud-prompt'));
    m = await mark();
    await press('e', 250);
    check(`E opens terminal ${t2.id}`, (await waitEvent(m, 'terminal:open'))?.terminalId === t2.id);
    check('starts at the shell', await visible(SEL.shell));
    check('no session header before claude runs', (await count(`${T} .tl-header`)) === 0);
    for (const [i, step] of t2.steps.entries()) {
      const name = `${t2.id}/${step.id}: ${step.kind}${step.kind === 'command' ? ` «${step.example}»` : step.kind === 'choice' ? ` (${step.style})` : ''}`;
      if (!check(name, await stepReady(i, step), await counter())) break;
      if (step.kind === 'choice' && step.style === 'quiz') {
        const correct = step.options.findIndex((o) => o.correct);
        const wrong = step.options.findIndex((o) => !o.correct);
        check('quiz dialog', (await count(`${T} .hx-choice.is-quiz`)) === 1);
        await press(String(wrong + 1), 200);
        const coach = await text(`${T} .hx-coach`);
        check('wrong quiz option is marked and explained', (await count(`${T} .hx-opt.is-tried`)) === 1 && coach.includes(step.options[wrong].reply ?? ''), coach);
        await press(String(correct + 1), 200);
        check('right quiz option goes on', await waitFor((n) => document.querySelectorAll('.hx-terminal.is-open .hx-task-dots > i')[n]?.classList.contains('is-done'), i, 10000));
        continue;
      }
      await solve(i, step);
      if (i === 0) check(`session header after \`${step.example}\``, await visible(`${T} .tl-header`));
    }
    check(`success panel ${t2.id}`, await visible(SEL.success, 15000));
    check('success shows 3 stars', (await stars(`${T} .hx-success-stars`)) === 3);
    m = await mark();
    await press('Enter', 250);
    const closed = await waitEvent(m, 'ui:terminalClosed');
    check(`${t2.id} → ui:terminalClosed completed, 3 stars`, closed?.terminalId === t2.id && closed?.completed === true && closed?.stars === 3, JSON.stringify(closed));
    check(`playing after ${t2.id}`, await waitState('playing'));
    check(`HUD objectives ${objcount(2)}`, (await text('.hx-hud-objcount')) === objcount(2), await text('.hx-hud-objcount'));
  }

  // ───── t3: Claude first, permission dialogs, Esc = No, /exit as the last step → 3 stars ─────
  {
    check(`prompt points at ${t3.id} «${t3.title}»`, (await text('.hx-hud-prompt')).includes(t3.title), await text('.hx-hud-prompt'));
    m = await mark();
    await press('e', 250);
    check(`E opens terminal ${t3.id}`, (await waitEvent(m, 'terminal:open'))?.terminalId === t3.id);
    check('session header printed at once (the first step is at the Claude prompt)', await visible(`${T} .tl-header`));
    check(`status «${MODE_LABEL[t3.startMode]}» (startMode ${t3.startMode})`, (await text(`${T} .hx-status-left`)).includes(MODE_LABEL[t3.startMode]), await text(`${T} .hx-status-left`));
    let permissions = 0;
    for (const [i, step] of t3.steps.entries()) {
      const name = `${t3.id}/${step.id}: ${step.kind}${step.kind === 'command' ? ` «${step.example}»` : step.kind === 'choice' ? ` (${step.style})` : ''}`;
      if (!check(name, await stepReady(i, step), await counter())) break;
      if (step.kind === 'choice' && step.style === 'permission') {
        permissions++;
        const correct = step.options.findIndex((o) => o.correct);
        const esc = step.options.findIndex((o) => o.esc);
        if (permissions === 1) {
          check('permission dialog', (await count(`${T} .hx-choice.is-permission`)) === 1);
          check('dialog footer', (await text(`${T} .hx-choice-foot`)) === 'Esc to cancel · Tab to amend', await text(`${T} .hx-choice-foot`));
          // a wrong option picked with the arrows and Enter
          const wrong = step.options.length - 1 === correct ? 0 : step.options.length - 1;
          for (let k = 0; k < wrong; k++) await press('ArrowDown');
          check(`↓ selects option ${wrong + 1}`, (await text(`${T} .hx-opt.is-sel .hx-opt-num`)) === `${wrong + 1}.`);
          await press('Enter', 200);
          const coach = await text(`${T} .hx-coach`);
          check('wrong option is marked and explained', (await count(`${T} .hx-opt.is-tried`)) === 1 && coach.includes(step.options[wrong].reply ?? ''), coach);
          await press(String(correct + 1), 200);
        } else if (correct === esc) {
          await press('Escape', 200);
          check('Esc = No: the dialog is answered with its Esc option', (await count(`${T} .hx-opt.is-tried`)) === 0 && (await waitFor((n) => document.querySelectorAll('.hx-terminal.is-open .hx-task-dots > i')[n]?.classList.contains('is-done'), i, 10000)));
        } else await press(String(correct + 1), 200);
        continue;
      }
      await solve(i, step);
    }
    const last = t3.steps.at(-1);
    check('the last step teaches /exit (it completes, not leaves)', last.kind === 'command' && matches(last.accept[0], '/exit'));
    check(`success panel ${t3.id}`, await visible(SEL.success, 15000));
    check('success shows 3 stars', (await stars(`${T} .hx-success-stars`)) === 3);
    m = await mark();
    await press('Enter', 250);
    const closed = await waitEvent(m, 'ui:terminalClosed');
    check(`${t3.id} → ui:terminalClosed completed, 3 stars`, closed?.terminalId === t3.id && closed?.completed === true && closed?.stars === 3, JSON.stringify(closed));
    check(`playing after ${t3.id}`, await waitState('playing'));
    check(`HUD objectives ${objcount(3)}`, (await text('.hx-hud-objcount')) === objcount(3), await text('.hx-hud-objcount'));
    check('gate:opened', (await eventsSince(m, 'gate:opened')).length === 1);
    check('HUD: gate open', await waitFor(() => /Ворота открыты/.test(document.querySelector('.hx-hud-gate')?.textContent ?? ''), undefined, 3000));
  }

  // ───── leaving terminals: /exit and ✕ ─────
  await walkTo(t1.id);
  check(`digit ${targets.indexOf(t1.id) + 1} walks back to ${t1.id}`, (await text('.hx-hud-prompt')).includes(t1.title), await text('.hx-hud-prompt'));
  m = await mark();
  await press('e', 250);
  check('replay t1 shows the record', await visible(`${T} .hx-task-best .hx-stars`));
  await typeLine('/exit');
  const exit1 = await waitEvent(m, 'ui:terminalClosed');
  check('/exit → completed:false', exit1?.completed === false && exit1?.terminalId === t1.id, JSON.stringify(exit1));
  check('playing after /exit', await waitState('playing'));
  m = await mark();
  await press('e', 250);
  await visible(SEL.shell);
  await page.click(`${T} .hx-tw-close`);
  const exit2 = await waitEvent(m, 'ui:terminalClosed');
  check('✕ → completed:false', exit2?.completed === false, JSON.stringify(exit2));
  check('playing after ✕', await waitState('playing'));

  // ───── finish the level ─────
  const expectStars = { [t1.id]: 2, [t2.id]: 3, [t3.id]: 3 };
  const sum = Object.values(expectStars).reduce((a, b) => a + b, 0);
  await walkTo('gate');
  check(`digit ${targets.indexOf('gate') + 1} walks to the gate`, (await text('.hx-hud-prompt')).includes('Ворота'), await text('.hx-hud-prompt'));
  m = await mark();
  await press('e', 300);
  check('gate → level summary', await visible('.hx-summary.is-open'));
  const summaryStars = await text('.hx-summary-stat .hx-summary-value');
  check(`summary stars ${sum} / ${L.terminals.length * 3}`, summaryStars === `${sum} / ${L.terminals.length * 3}`, summaryStars);
  await page.waitForTimeout(400);
  await press('Enter', 300);
  check('summary → ui:nextLevel', !!(await waitEvent(m, 'ui:nextLevel')));

  guard();
  const store = await page.evaluate(() => JSON.parse(JSON.stringify(window.__dev.store.data)));
  const saved = store.levels[L.id]?.terminals ?? {};
  check(
    `UI never wrote progress itself (stars come from the game): ${Object.entries(expectStars).map(([id, s]) => `${id} ${s}`).join(', ')}`,
    Object.entries(expectStars).every(([id, s]) => saved[id] === s),
    JSON.stringify(saved),
  );
  check('zero console errors', problems.length === 0, problems.join(' | '));
  await page.context().close();
  return results;
}

const browser = await launchBrowser({ browser: opt('browser'), webgpu: false, headless: !headed });
let results = null;
try {
  for (let attempt = 1; attempt <= 3 && !results; attempt++) {
    try {
      if (attempt > 1) console.log(`\n— retry ${attempt} (the dev server reloaded the page) —`);
      results = await run(browser);
    } catch (err) {
      if (!(err instanceof Reloaded) || attempt === 3) throw err;
    }
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
for (const f of failed) console.log(`  FAIL ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
process.exitCode = failed.length ? 1 : 0;
