/**
 * DOM overlay entry point. The game owns the state machine: the UI shows and hides screens on
 * `state:changed` and the other game events, and answers with `ui:*` events. The UI never writes
 * progress to the store — only settings (store.setSettings).
 */
import '@fontsource-variable/tektur';
import '@fontsource-variable/jetbrains-mono';
import './styles/base.css';
import './styles/screens.css';
import './styles/hud.css';
import './styles/terminal.css';

import type { GameBus, GameEvents, GameState } from '../core/events';
import type { Store } from '../core/store';
import { ContentIndex, UIContext, defaultContent, type ConfirmOptions, type UIApp, type UIContent } from './context';
import { h } from './dom';
import { KeyRouter } from './keys';
import { ChipCard } from './screens/chipCard';
import { CodexScreen } from './screens/codex';
import { ConfirmDialog } from './screens/confirm';
import { DialogBox } from './screens/dialog';
import { EndingScreen } from './screens/ending';
import { Hud } from './screens/hud';
import { IntroCard } from './screens/intro';
import { LoadingScreen } from './screens/loading';
import { MainMenu } from './screens/mainMenu';
import { PauseMenu } from './screens/pause';
import { SettingsScreen } from './screens/settings';
import { SummaryScreen } from './screens/summary';
import { Toasts } from './screens/toasts';
import { Sfx } from './sfx';
import { TerminalScreen } from './terminal/terminal';
import { TouchSense } from './touch';

export type { UIContent } from './context';

export interface UIDeps {
  /** The #ui-root element (pointer-events: none; interactive children must re-enable them). */
  root: HTMLElement;
  bus: GameBus;
  store: Store;
  /** Content to read (levels, codex). Defaults to the game's content; the dev harness extends it. */
  content?: UIContent;
}

export interface UIHandle {
  dispose(): void;
}

export function createUI(deps: UIDeps): UIHandle {
  const app = new Overlay(deps);
  return { dispose: () => app.dispose() };
}

type Origin = 'menu' | 'pause' | 'playing';

class Overlay implements UIApp {
  private readonly ctx: UIContext;
  private readonly el: HTMLElement;
  private readonly keys: KeyRouter;
  private readonly offs: (() => void)[] = [];
  /** Why the UI asked for a pause: the pause menu (Esc) or the codex (Tab). */
  private pauseIntent: 'menu' | 'codex' | null = null;
  private codexOrigin: Origin | null = null;
  private settingsOrigin: Origin | null = null;
  /** The level the UI asked for (ui:play / ui:nextLevel), shown while it loads. */
  private pendingLevel: string | null = null;

  private readonly hud: Hud;
  private readonly chipCard: ChipCard;
  private readonly dialog: DialogBox;
  private readonly loading: LoadingScreen;
  private readonly menu: MainMenu;
  private readonly intro: IntroCard;
  private readonly summary: SummaryScreen;
  private readonly ending: EndingScreen;
  private readonly terminal: TerminalScreen;
  private readonly pause: PauseMenu;
  private readonly codex: CodexScreen;
  private readonly settings: SettingsScreen;
  private readonly confirmDialog: ConfirmDialog;
  private readonly toasts: Toasts;

  constructor({ root, bus, store, content }: UIDeps) {
    this.el = h('div', { class: 'hx-root', attrs: { lang: 'ru' } });
    root.append(this.el);
    this.keys = new KeyRouter(window);
    const touch = new TouchSense(this.el);
    const ctx = new UIContext(this.el, bus, store, new ContentIndex(content ?? defaultContent), this.keys, new Sfx(bus), touch);
    ctx.app = this;
    this.ctx = ctx;

    // DOM order = paint order.
    this.hud = new Hud(ctx, { pause: () => this.pauseFromPlay(), codex: () => this.codexFromPlay() });
    this.chipCard = new ChipCard(ctx);
    this.dialog = new DialogBox(ctx);
    this.loading = new LoadingScreen(ctx);
    this.menu = new MainMenu(ctx);
    this.intro = new IntroCard(ctx);
    this.summary = new SummaryScreen(ctx);
    this.ending = new EndingScreen(ctx);
    this.terminal = new TerminalScreen(ctx);
    this.pause = new PauseMenu(ctx);
    this.codex = new CodexScreen(ctx);
    this.settings = new SettingsScreen(ctx);
    this.confirmDialog = new ConfirmDialog(ctx);
    this.toasts = new Toasts(ctx);

    this.keys.setFallback((e) => this.onGlobalKey(e));

    const on = <K extends keyof GameEvents>(type: K, fn: (p: GameEvents[K]) => void) => this.offs.push(bus.on(type, fn));
    on('state:changed', ({ to }) => this.onState(to));
    on('loading:progress', (p) => this.loading.setProgress(p));
    on('level:ready', ({ levelId }) => this.onLevelReady(levelId));
    on('interact:prompt', (p) => this.hud.setPrompt(p));
    on('dialog:start', (p) => this.dialog.open(p));
    on('terminal:open', (p) => {
      this.terminal.open(p);
      this.syncHud();
    });
    on('toast', (t) => this.toasts.push(t));
    on('chip:collected', (c) => {
      this.chipCard.show(c);
      this.hud.refresh();
    });
    on('objectives:changed', (o) => this.hud.setObjectives(o));
    on('gate:opened', () => this.hud.refresh());
    on('level:completed', (p) => {
      this.summary.setData(p);
      if (this.ctx.state === 'levelComplete' && !this.summary.isOpen) this.summary.open();
    });
    // The UI's own requests tell which level is about to load.
    on('ui:play', ({ levelId, newGame }) => {
      const first = this.ctx.content.levels[0]?.id ?? null;
      this.pendingLevel = newGame ? first : (levelId ?? store.data.currentLevel ?? first);
    });
    on('ui:nextLevel', () => {
      this.pendingLevel = this.ctx.levelId ? (this.ctx.content.nextLevel(this.ctx.levelId)?.id ?? null) : null;
    });
    on('ui:restartLevel', () => (this.pendingLevel = this.ctx.levelId));
    this.offs.push(
      store.subscribe(() => {
        this.hud.refresh();
        this.menu.refresh();
      }),
    );

    this.onState('boot');
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.terminal.dispose();
    this.keys.dispose();
    this.ctx.touch.dispose();
    this.el.remove();
  }

  // ───────────── UIApp ─────────────

  openCodex(opts: { fromPlaying?: boolean } = {}): void {
    const fromPlaying = !!opts.fromPlaying;
    this.codexOrigin = fromPlaying ? 'playing' : this.ctx.state === 'menu' ? 'menu' : 'pause';
    if (fromPlaying) {
      // Pause the game first (no pause menu: the codex is the overlay); closing it sends ui:resume.
      this.pauseIntent = 'codex';
      this.ctx.bus.emit('ui:pause', {});
    }
    this.codex.open({ fromPlaying, onClose: () => (this.codexOrigin = null) });
  }

  openSettings(): void {
    this.settingsOrigin = this.ctx.state === 'menu' ? 'menu' : 'pause';
    this.settings.open(() => (this.settingsOrigin = null));
  }

  confirm(opts: ConfirmOptions): void {
    this.confirmDialog.ask(opts);
  }

  // ───────────── state ─────────────

  private onState(to: GameState): void {
    const from = this.ctx.state;
    this.ctx.state = to;

    // Leave what belongs to the previous state.
    if (to !== 'dialog') this.dialog.close();
    if (to !== 'terminal') this.terminal.close();
    if (to !== 'intro') this.intro.close();
    if (to !== 'levelComplete') this.summary.close();
    if (to !== 'ending') this.ending.close();
    if (to !== 'menu') this.menu.close();
    if (to !== 'paused') this.pause.close();
    if (this.codex.isOpen && !this.keepOverlay(this.codexOrigin, to, true)) this.codex.close(true);
    if (this.settings.isOpen && !this.keepOverlay(this.settingsOrigin, to, false)) this.settings.close();
    if (from !== to) this.confirmDialog.close();
    if (from === 'paused' && to !== 'paused') this.pauseIntent = null;

    switch (to) {
      case 'boot':
        this.loading.open('boot');
        break;
      case 'loading':
        this.loading.open('level', this.pendingLevel ?? this.ctx.levelId);
        break;
      case 'menu':
        this.resetLevelUi();
        this.menu.open();
        break;
      case 'intro':
        this.intro.open(this.ctx.levelId);
        break;
      case 'paused':
        if (this.pauseIntent !== 'codex') this.pause.open();
        break;
      case 'levelComplete':
        this.hud.setPrompt(null);
        this.chipCard.dismiss(); // a card picked up just before the gate must not linger behind the summary
        if (this.summary.hasData) this.summary.open();
        break;
      case 'ending':
        this.resetLevelUi();
        this.ending.open();
        break;
    }
    if (to !== 'boot' && to !== 'loading') this.loading.close();
    this.chipCard.setRunning(to === 'playing');
    this.syncHud();
  }

  /** Whether a codex / settings overlay survives the move to `to`. */
  private keepOverlay(origin: Origin | null, to: GameState, isCodex: boolean): boolean {
    if (origin === 'menu') return to === 'menu';
    if (origin === 'pause') return to === 'paused';
    if (origin === 'playing') return isCodex && to === 'paused';
    return false;
  }

  private syncHud(): void {
    const s = this.ctx.state;
    if ((s === 'playing' || s === 'dialog') && !this.terminal.isOpen) this.hud.show(s === 'dialog' ? 'dialog' : 'full');
    else this.hud.hide();
  }

  private onLevelReady(levelId: string): void {
    this.ctx.levelId = levelId;
    this.pendingLevel = null;
    this.summary.clear();
    this.toasts.clear();
    this.chipCard.dismiss();
    this.hud.setLevel(levelId);
    if (this.loading.isOpen) this.loading.setLevel(levelId);
  }

  private resetLevelUi(): void {
    this.hud.setPrompt(null);
    this.toasts.clear();
    this.chipCard.dismiss();
  }

  /** Hotkeys of the UI while the game is being played (no overlay open). */
  private onGlobalKey(e: KeyboardEvent): void {
    if (this.ctx.state !== 'playing') return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) this.pauseFromPlay();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) this.codexFromPlay();
    }
  }

  /** Esc while playing, or the HUD's «Пауза» button (touch): the pause menu. */
  private pauseFromPlay(): void {
    if (this.ctx.state !== 'playing') return;
    this.pauseIntent = 'menu';
    this.ctx.sfx.play('uiSelect');
    this.ctx.bus.emit('ui:pause', {});
  }

  /** Tab while playing, or the HUD's «Справочник» button (touch): the codex over the paused game. */
  private codexFromPlay(): void {
    if (this.ctx.state !== 'playing') return;
    this.ctx.sfx.play('uiSelect');
    this.openCodex({ fromPlaying: true });
  }
}
