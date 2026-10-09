/**
 * Raster warm-up behind the loading screen.
 *
 * The first time Chrome rasterises a kind of DOM content (gradient panels, rounded borders, SVG icon
 * strokes, text…) the GPU process compiles a Skia program for it, and the frame waits for the
 * driver: the first HUD after the intro, the first dialog and the first terminal each froze the
 * game for 50–200 ms. While the (opaque) loading screen is up, this mounts a throw-away copy of
 * those overlays, filled with real content of the level and fully opened, directly UNDER the loading
 * screen: Chrome rasterises it (the programs are compiled and cached for the page), but nothing of it
 * can be seen. It is removed before the loading screen starts to fade out.
 *
 * The copies are ordinary instances of the same components on a private bus, keyboard router and
 * sound channel, inside an `inert` container: they never reach the game, the audio, the store or
 * the focus.
 */
import { EventBus, type GameEvents, type GameState } from '../core/events';
import type { LevelDef } from '../content/types';
import { UIContext, type UIApp } from './context';
import { h } from './dom';
import { KeyRouter } from './keys';
import { ChipCard } from './screens/chipCard';
import { DialogBox } from './screens/dialog';
import { Hud } from './screens/hud';
import { IntroCard } from './screens/intro';
import { PauseMenu } from './screens/pause';
import { SummaryScreen } from './screens/summary';
import { Toasts } from './screens/toasts';
import { Sfx } from './sfx';
import { TerminalScreen } from './terminal/terminal';
import { TouchSense } from './touch';

/** How long the copies stay mounted (raster + program compiles finish well within this). */
const HOLD_MS = 1500;
/** Shorter than this (the loading screen closed early) does not count: the next loading retries. */
const MIN_MS = 700;

const noopApp: UIApp = { openCodex() {}, openSettings() {}, confirm() {} };

export class RasterWarmup {
  private host: HTMLElement | null = null;
  private cleanup: (() => void)[] = [];
  private shownAt = 0;
  private done = false;
  private raf = 0;
  private timer = 0;

  constructor(
    private readonly ctx: UIContext,
    /** The loading screen: the copies go right before it (DOM order = paint order) and only while it is opaque. */
    private readonly cover: HTMLElement,
  ) {}

  /** Call while the loading screen is open; starts once it is fully opaque. */
  schedule(levelId: string | null): void {
    if (this.done || this.host || this.raf) return;
    const poll = () => {
      this.raf = 0;
      if (this.done || this.host || !isLoading(this.ctx.state)) return;
      if (!this.cover.classList.contains('is-open') || getComputedStyle(this.cover).opacity !== '1') {
        this.raf = requestAnimationFrame(poll);
        return;
      }
      this.mount(levelId);
    };
    this.raf = requestAnimationFrame(poll);
  }

  /** Removes the copies at once (call before the loading screen starts to close). */
  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.clearTimeout(this.timer);
    if (!this.host) return;
    if (performance.now() - this.shownAt >= MIN_MS) this.done = true;
    for (const fn of this.cleanup.splice(0)) {
      try {
        fn();
      } catch {
        // a copy that fails to close must not keep the rest mounted
      }
    }
    this.host.remove();
    this.host = null;
  }

  private mount(levelId: string | null): void {
    const { content, store } = this.ctx;
    const level = content.level(levelId) ?? content.level(store.data.currentLevel) ?? content.levels[0];
    if (!level) return;
    const host = h('div', { class: 'hx-warm', attrs: { 'aria-hidden': 'true', inert: true } });
    this.cover.before(host);
    this.host = host;
    this.shownAt = performance.now();
    try {
      this.build(host, level);
    } catch (err) {
      console.warn('[ui] raster warm-up skipped', err);
      this.stop();
      this.done = true;
      return;
    }
    this.timer = window.setTimeout(() => this.stop(), HOLD_MS);
  }

  private build(host: HTMLElement, level: LevelDef): void {
    const bus = new EventBus<GameEvents>();
    const keys = new KeyRouter(new EventTarget() as unknown as Window);
    const touch = new TouchSense(host);
    const ctx = new UIContext(host, bus, this.ctx.store, this.ctx.content, keys, new Sfx(bus), touch);
    ctx.app = noopApp;
    ctx.levelId = level.id;
    ctx.state = 'playing' satisfies GameState;
    this.cleanup.push(() => keys.dispose(), () => touch.dispose());

    const { terminals, npcs, chips } = level.lessons;
    const t0 = terminals[0];
    const label = (i: number) => terminals[i % terminals.length]?.title ?? level.meta.title;

    // HUD as while playing: every objective state, both gate lines, both kinds of prompt.
    const actions = { pause() {}, codex() {} };
    const items = [
      { id: 'a', label: label(0), done: true, required: true, locked: false },
      { id: 'b', label: label(1), done: false, required: true, locked: false },
      { id: 'c', label: label(2), done: false, required: true, locked: true },
      { id: 'd', label: label(3), done: false, required: false, locked: false },
    ];
    const hudA = new Hud(ctx, actions);
    hudA.setLevel(level.id);
    hudA.setObjectives({ levelId: level.id, items, gateOpen: false });
    hudA.setPrompt({ kind: 'terminal', id: t0?.id ?? 'x', label: t0?.title ?? level.meta.title, locked: false });
    hudA.show('full');
    const hudB = new Hud(ctx, actions);
    hudB.setLevel(level.id);
    hudB.setObjectives({ levelId: level.id, items, gateOpen: true });
    hudB.setPrompt({ kind: 'gate', id: 'gate', label: '', locked: true });
    hudB.show('dialog');

    const toasts = new Toasts(ctx);
    toasts.push({ text: level.meta.subtitle || level.meta.title, kind: 'info' });
    toasts.push({ text: level.meta.title, kind: 'success', speaker: 'ХАРНИ' });
    toasts.push({ text: level.meta.title, kind: 'warn' });
    toasts.push({ text: level.meta.subtitle || level.meta.title, kind: 'bark' });
    this.cleanup.push(() => toasts.clear());

    const chip = chips[0];
    if (chip) {
      const card = new ChipCard(ctx);
      card.show({ levelId: level.id, chipId: chip.id });
      this.cleanup.push(() => card.dismiss());
    }

    const npc = npcs[0];
    const lines = npc?.dialogs[0]?.lines.filter((l) => l.text.trim()) ?? [];
    if (npc && lines.length) {
      const npcLine = lines.find((l) => (l.speaker ?? npc.name).toUpperCase() !== 'ХАРНИ') ?? lines[0];
      const dlgNpc = new DialogBox(ctx);
      dlgNpc.open({ npcId: npc.id, name: npc.name, lines: [npcLine, npcLine] });
      const dlgHarni = new DialogBox(ctx);
      dlgHarni.open({ npcId: npc.id, name: npc.name, lines: [{ text: npcLine.text, speaker: 'ХАРНИ', mood: 'happy' }] });
      this.cleanup.push(
        () => dlgNpc.close(),
        () => dlgHarni.close(),
      );
    }

    if (t0) {
      const term = new TerminalScreen(ctx);
      term.open({ levelId: level.id, terminalId: t0.id });
      this.cleanup.push(() => term.dispose());
    }

    const intro = new IntroCard(ctx);
    intro.open(level.id);
    this.cleanup.push(() => intro.close());

    const pause = new PauseMenu(ctx);
    pause.open();
    this.cleanup.push(() => pause.close());

    const summary = new SummaryScreen(ctx);
    const maxStars = terminals.length * 3;
    summary.setData({ levelId: level.id, stats: { stars: Math.max(0, maxStars - 1), maxStars, chips: 0, maxChips: chips.length, timeSec: 0 }, isLast: false });
    summary.open();
    this.cleanup.push(() => summary.close());
  }
}

function isLoading(s: GameState): boolean {
  return s === 'boot' || s === 'loading';
}
