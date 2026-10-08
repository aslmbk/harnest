/**
 * UI dev harness (ui-dev.html): the real UI over a static backdrop, driven by a fake game.
 *
 * URL params
 *   screen   boot (default: full flow) | loading | menu | levels | confirm | intro | hud | dialog |
 *            terminal | chip | codex | pause | settings | summary | ending
 *   level    level id (default: the first level)        terminal  terminal id (default t1)
 *   save     none | mid | done (default depends on the screen)
 *   mock=1   extra levels m2…m5 after the real ones, `mock-` codex entries with long strings and a
 *            showcase terminal (level m2)
 *   devbar=0 hide the dev bar          hold=1  freeze boot / loading progress
 *
 * Exposes window.__uiReady (true once the requested screen is up), window.__events (bus log)
 * and window.__dev (game, bus, store, helpers) for scripts/ui-*.mjs.
 */
import { EventBus, type GameEvents, type GameState } from '../../core/events';
import { Store, type SaveData } from '../../core/store';
import type { StepDef } from '../../content/types';
import { defaultContent, type UIContent } from '../context';
import { createUI } from '../index';
import { createBackdrop } from './backdrop';
import { FakeGame } from './fakeGame';
import { mockContent } from './mockContent';

interface LoggedEvent {
  t: number;
  type: string;
  payload: unknown;
}

declare global {
  interface Window {
    __uiReady?: boolean;
    __events?: LoggedEvent[];
    __dev?: unknown;
  }
}

const SAVE_KEY = 'harnest.save.v1';
const SCREENS = ['boot', 'loading', 'menu', 'levels', 'confirm', 'intro', 'hud', 'dialog', 'terminal', 'chip', 'codex', 'pause', 'settings', 'summary', 'ending'] as const;
type ScreenName = (typeof SCREENS)[number];

const params = new URLSearchParams(location.search);
const screen = (SCREENS as readonly string[]).includes(params.get('screen') ?? '') ? (params.get('screen') as ScreenName) : 'boot';
const content: UIContent = params.get('mock') === '1' ? mockContent(defaultContent) : defaultContent;
const levelId = content.levels.some((l) => l.id === params.get('level')) ? params.get('level')! : content.levels[0].id;
const terminalId = params.get('terminal') ?? 't1';
const hold = params.get('hold') === '1';

function defaultSave(s: ScreenName): 'none' | 'mid' | 'done' {
  if (s === 'boot' || s === 'loading' || s === 'terminal' || s === 'intro') return 'none';
  if (s === 'summary' || s === 'ending') return 'done';
  return 'mid';
}

/** A save in memory only: the harness never touches the real game's localStorage save. */
function buildSave(kind: string): SaveData | null {
  if (kind !== 'mid' && kind !== 'done') return null;
  const data: SaveData = { v: 1, currentLevel: null, levels: {}, codex: [], settings: { master: 0.8, music: 0.6, sfx: 0.8, quality: 'auto' } };
  const levels = content.levels;
  const target = levels.findIndex((l) => l.id === levelId);
  levels.forEach((level, i) => {
    const all = kind === 'done' || i < target;
    const current = kind === 'mid' && i === target;
    if (!all && !current) return;
    const terminals: Record<string, 1 | 2 | 3> = {};
    level.lessons.terminals.forEach((t, j) => {
      if (all) terminals[t.id] = j % 3 === 1 ? 2 : 3;
      else if (j === 0) terminals[t.id] = 2;
    });
    const chips = all ? level.lessons.chips.map((c) => c.id) : level.lessons.chips.slice(0, 1).map((c) => c.id);
    data.levels[level.id] = { terminals, chips, completed: all };
    for (const t of level.lessons.terminals) if (terminals[t.id]) data.codex.push(...t.challenge.unlocks);
    for (const c of level.lessons.chips) if (chips.includes(c.id)) data.codex.push(...(c.unlocks ?? []));
  });
  data.currentLevel = kind === 'done' ? levels[levels.length - 1].id : levelId;
  data.codex = [...new Set(data.codex)];
  return data;
}

function memoryStorage(initial: SaveData | null): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map<string, string>();
  if (initial) map.set(SAVE_KEY, JSON.stringify(initial));
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

// ───────────── wiring ─────────────

const events: LoggedEvent[] = [];
window.__events = events;
const bus = new EventBus<GameEvents>();
const emit = bus.emit.bind(bus);
bus.emit = ((type: keyof GameEvents, payload: GameEvents[keyof GameEvents]) => {
  events.push({ t: Math.round(performance.now()), type, payload });
  if (type !== 'sfx' && params.get('log') === '1') console.debug('[bus]', type, payload);
  emit(type, payload as never);
}) as typeof bus.emit;

const store = new Store(memoryStorage(buildSave(params.get('save') ?? defaultSave(screen))));
document.body.prepend(createBackdrop());
const root = document.getElementById('ui-root')!;
createUI({ root, bus, store, content });
const game = new FakeGame(bus, store, content);

function press(key: string, init: KeyboardEventInit = {}): void {
  const code = key.length === 1 ? (/[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : /\d/.test(key) ? `Digit${key}` : key) : key;
  window.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, ...init }));
  window.dispatchEvent(new KeyboardEvent('keyup', { key, code, bubbles: true, cancelable: true, ...init }));
}

function clickMenu(id: string): boolean {
  const all = document.querySelectorAll<HTMLButtonElement>(`.hx-screen.is-open .hx-menu-item[data-id="${id}"]`);
  const btn = all[all.length - 1];
  btn?.click();
  return !!btn;
}

function answers(lvl = levelId, term = terminalId) {
  const terminal = content.levels.find((l) => l.id === lvl)?.lessons.terminals.find((t) => t.id === term);
  return (terminal?.challenge.steps ?? []).map((s: StepDef) => {
    switch (s.kind) {
      case 'command':
        return { id: s.id, kind: s.kind, prompt: s.prompt, example: s.example, wrong: s.wrong?.map((w) => w.match) ?? [] };
      case 'key':
        return { id: s.id, kind: s.kind, keys: s.keys, untilMode: s.untilMode ?? null };
      case 'choice':
        return { id: s.id, kind: s.kind, style: s.style, correct: s.options.findIndex((o) => o.correct), count: s.options.length };
      case 'info':
        return { id: s.id, kind: s.kind };
    }
  });
}

/** Monospace columns that fit in the terminal transcript (layout check). */
function columns(): number {
  const log = document.querySelector('.hx-terminal.is-open .hx-tw-log');
  if (!log) return 0;
  const probe = document.createElement('span');
  probe.className = 'tl-probe';
  probe.textContent = '0'.repeat(100);
  log.append(probe);
  const per = probe.getBoundingClientRect().width / 100;
  probe.remove();
  return per > 0 ? Math.floor(log.clientWidth / per) : 0;
}

window.__dev = { game, bus, store, content, press, clickMenu, answers, columns, state: (): GameState => game.state };

// ───────────── screens ─────────────

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

async function setup(): Promise<void> {
  const first = content.levels[0].id;
  switch (screen) {
    case 'boot':
      if (hold) bus.emit('loading:progress', { ratio: 0.42, label: 'Модели города' });
      else void game.boot();
      return;
    case 'loading':
      game.setState('menu');
      game.setState('loading');
      game.enterLevel(levelId);
      bus.emit('loading:progress', { ratio: 0.64, label: 'Неон и свет' });
      if (!hold) {
        await wait(400);
        bus.emit('loading:progress', { ratio: 1, label: 'Терминалы' });
      }
      return;
    case 'menu':
      game.setState('menu');
      return;
    case 'levels':
      game.setState('menu');
      clickMenu('levels');
      return;
    case 'confirm':
      game.setState('menu');
      clickMenu('new');
      return;
    case 'intro':
      game.setState('menu');
      game.setState('loading');
      game.enterLevel(levelId);
      game.setState('intro');
      return;
    case 'ending':
      game.setState('menu');
      game.enterLevel(content.levels[content.levels.length - 1].id ?? first);
      game.setState('ending');
      return;
  }
  // In-level screens.
  game.setState('menu');
  game.setState('loading');
  game.enterLevel(levelId);
  game.setState('intro');
  game.startPlaying();
  switch (screen) {
    case 'hud': {
      const t = game.targets().findIndex((x) => x.kind === 'terminal' && !store.level(levelId).terminals[x.id]);
      game.walkTo(t);
      // the terminal the 'mid' save has just repaired: «Фонари переулка» in level 1
      const repaired = game.level?.lessons.terminals.find((x) => store.level(levelId).terminals[x.id]) ?? game.level?.lessons.terminals[0];
      bus.emit('toast', { text: `«${repaired?.title ?? 'Фонари переулка'}» снова работает`, kind: 'success' });
      bus.emit('toast', { text: 'Системы запущены. Где это я?..', kind: 'bark' });
      return;
    }
    case 'dialog': {
      const npc = game.level?.lessons.npcs[0];
      if (npc) game.openDialog(npc.id);
      await wait(260);
      press('Enter'); // finish the typewriter for a stable picture
      return;
    }
    case 'terminal':
      game.openTerminal(terminalId);
      return;
    case 'chip':
      game.walkTo(-1);
      game.collectChip();
      return;
    case 'codex':
      press('Tab');
      return;
    case 'pause':
      press('Escape');
      return;
    case 'settings':
      press('Escape');
      await frame();
      clickMenu('settings');
      return;
    case 'summary':
      game.startedAt = performance.now() - 754_000;
      game.completeLevel();
      return;
  }
}

function devbar(): void {
  if (params.get('devbar') === '0') return;
  const bar = document.createElement('details');
  bar.id = 'devbar';
  const summary = document.createElement('summary');
  summary.textContent = 'UI dev';
  bar.append(summary);
  const links = document.createElement('div');
  links.className = 'links';
  for (const s of SCREENS) {
    const a = document.createElement('a');
    const p = new URLSearchParams(params);
    p.set('screen', s);
    a.href = `?${p.toString()}`;
    a.textContent = s;
    if (s === screen) a.className = 'on';
    links.append(a);
  }
  const mock = document.createElement('a');
  const mp = new URLSearchParams(params);
  if (mp.get('mock') === '1') mp.delete('mock');
  else mp.set('mock', '1');
  mock.href = `?${mp.toString()}`;
  mock.textContent = params.get('mock') === '1' ? 'mock: on' : 'mock: off';
  links.append(mock);
  const help = document.createElement('p');
  help.textContent = 'В игре: E — действие · 1…9 — цель · 0 — ничего · C — чип · T — тост · B — реплика · G — финиш уровня';
  bar.append(links, help);
  bar.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).tagName !== 'A' && (e.target as HTMLElement).tagName !== 'SUMMARY') e.preventDefault();
  });
  document.body.append(bar);
}

async function main(): Promise<void> {
  devbar();
  await setup();
  await document.fonts.ready;
  await frame();
  await frame();
  await wait(230); // screen fade-ins are ≤ 200 ms
  window.__uiReady = true;
}

void main();
