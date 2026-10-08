/**
 * Shared context of the overlay: bus, store, content lookups, keyboard router, sounds,
 * and the current game state / level as the UI last heard them.
 */
import { CODEX, LEVELS } from '../content';
import type { ChipLesson, CodexEntry, LevelDef, NpcLesson, TerminalLesson } from '../content/types';
import type { GameBus, GameState } from '../core/events';
import type { Stars, Store } from '../core/store';
import { h } from './dom';
import type { KeyLayer, KeyRouter } from './keys';
import type { Sfx } from './sfx';
import type { TouchSense } from './touch';

/** Content the UI reads. Defaults to the game's content; the dev harness can extend it. */
export interface UIContent {
  levels: readonly LevelDef[];
  codex: readonly CodexEntry[];
}

export const defaultContent: UIContent = { levels: LEVELS, codex: CODEX };

/** Non-throwing lookups (the UI must survive unknown ids). */
export class ContentIndex {
  constructor(readonly src: UIContent) {}

  get levels(): readonly LevelDef[] {
    return this.src.levels;
  }

  get codex(): readonly CodexEntry[] {
    return this.src.codex;
  }

  level(id: string | null | undefined): LevelDef | undefined {
    return id ? this.src.levels.find((l) => l.id === id) : undefined;
  }

  levelByIndex(index: number): LevelDef | undefined {
    return this.src.levels.find((l) => l.index === index);
  }

  nextLevel(id: string): LevelDef | undefined {
    const i = this.src.levels.findIndex((l) => l.id === id);
    return i < 0 ? undefined : this.src.levels[i + 1];
  }

  terminal(levelId: string | null | undefined, terminalId: string): TerminalLesson | undefined {
    return this.level(levelId)?.lessons.terminals.find((t) => t.id === terminalId);
  }

  chip(levelId: string | null | undefined, chipId: string): ChipLesson | undefined {
    return this.level(levelId)?.lessons.chips.find((c) => c.id === chipId);
  }

  npc(levelId: string | null | undefined, npcId: string): NpcLesson | undefined {
    return this.level(levelId)?.lessons.npcs.find((n) => n.id === npcId);
  }

  codexEntry(id: string): CodexEntry | undefined {
    return this.src.codex.find((e) => e.id === id);
  }

  /** Max stars of a level: 3 per terminal. */
  maxStars(level: LevelDef): number {
    return level.lessons.terminals.length * 3;
  }
}

/** Sum of the best stars of a level in the save. */
export function levelStars(store: Store, level: LevelDef): number {
  const terminals = store.level(level.id).terminals;
  return level.lessons.terminals.reduce((sum, t) => sum + (terminals[t.id] ?? 0), 0);
}

export function bestStars(store: Store, levelId: string, terminalId: string): Stars | undefined {
  return store.level(levelId).terminals[terminalId];
}

/** Levels unlock in order: the first one, any level after a completed one, and the save's level. */
export function isLevelUnlocked(store: Store, levels: readonly LevelDef[], index: number): boolean {
  const level = levels[index];
  if (!level) return false;
  if (index === 0 || store.data.currentLevel === level.id) return true;
  if (store.level(level.id).completed) return true;
  return store.level(levels[index - 1].id).completed;
}

export interface UIApp {
  openCodex(opts?: { fromPlaying?: boolean }): void;
  openSettings(): void;
  confirm(opts: ConfirmOptions): void;
}

export interface ConfirmOptions {
  title: string;
  text: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
}

export class UIContext {
  state: GameState = 'boot';
  levelId: string | null = null;
  app!: UIApp;

  constructor(
    readonly root: HTMLElement,
    readonly bus: GameBus,
    readonly store: Store,
    readonly content: ContentIndex,
    readonly keys: KeyRouter,
    readonly sfx: Sfx,
    /** Touch controls on (the engine's rule): on-screen buttons for what the keyboard does elsewhere. */
    readonly touch: TouchSense,
  ) {}

  get level(): LevelDef | undefined {
    return this.content.level(this.levelId);
  }
}

/** A full-screen overlay that takes the keyboard while open. */
export abstract class Screen implements KeyLayer {
  readonly el: HTMLElement;
  private opened = false;

  constructor(
    protected readonly ctx: UIContext,
    cls: string,
  ) {
    this.el = h('section', { class: `hx-screen ${cls}`, attrs: { 'aria-hidden': 'true' } });
    ctx.root.append(this.el);
  }

  get isOpen(): boolean {
    return this.opened;
  }

  protected show(): void {
    if (this.opened) return;
    this.opened = true;
    this.el.classList.add('is-open');
    this.el.removeAttribute('aria-hidden');
    this.ctx.keys.push(this);
  }

  protected hide(): void {
    if (!this.opened) return;
    this.opened = false;
    this.el.classList.remove('is-open');
    this.el.setAttribute('aria-hidden', 'true');
    this.ctx.keys.remove(this);
  }

  abstract onKey(e: KeyboardEvent): void;
  onTop?(): void;
}
