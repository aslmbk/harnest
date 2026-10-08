/**
 * Main menu: Продолжить / Новая игра / Уровни / Справочник / Настройки, plus the level picker.
 */
import type { LevelDef } from '../../content/types';
import { Screen, isLevelUnlocked, levelStars, type UIContext } from '../context';
import { h, pad2 } from '../dom';
import { icon, logoMark } from '../icons';
import { MenuList, type MenuItem } from '../menuList';

type View = 'root' | 'levels';

export class MainMenu extends Screen {
  private view: View = 'root';
  private readonly rootMenu: MenuList;
  private readonly levelMenu: MenuList;
  private readonly rootView: HTMLElement;
  private readonly levelsView: HTMLElement;
  private readonly details: HTMLElement;
  private lastRootId: string | undefined;

  constructor(ctx: UIContext) {
    super(ctx, 'hx-menu-screen');
    this.rootMenu = new MenuList(ctx.sfx, { className: 'hx-menu--main' });
    this.levelMenu = new MenuList(ctx.sfx, { className: 'hx-menu--levels', onBack: () => this.setView('root') });
    this.details = h('div', 'hx-levels-details');
    // «Esc назад» only in the level list (Esc does nothing at the root). With the touch controls it
    // is also the way back, as there is no Esc key.
    const back = h(
      'button',
      {
        class: 'hx-legend hx-mm-back',
        attrs: { type: 'button' },
        on: {
          click: () => {
            if (this.view !== 'levels') return;
            ctx.sfx.play('uiBack');
            this.setView('root');
          },
          mousedown: (e) => e.preventDefault(),
        },
      },
      [h('kbd', { class: 'hx-kbd', text: 'Esc' }), ' назад'],
    );

    this.rootView = h('div', 'hx-mm-view hx-mm-root', [
      h('header', 'hx-mm-brand', [
        logoMark('hx-mm-mark'),
        h('div', 'hx-mm-titles', [
          h('h1', { class: 'hx-mm-title', text: 'HARNEST' }),
          h('p', { class: 'hx-mm-tagline', text: 'Научись управлять Claude Code' }),
        ]),
      ]),
      this.rootMenu.el,
    ]);

    this.levelsView = h('div', 'hx-mm-view hx-mm-levels', [
      h('header', 'hx-mm-head', [
        h('span', { class: 'hx-kicker', text: 'Районы Нижнего города' }),
        h('h2', { class: 'hx-mm-h2', text: 'Уровни' }),
      ]),
      h('div', 'hx-levels-body', [this.levelMenu.el, this.details]),
    ]);

    this.el.append(
      h('div', 'hx-mm-panel hx-panel hx-panel--accent', [
        this.rootView,
        this.levelsView,
        h('footer', 'hx-mm-foot', [
          h('span', 'hx-legend', [h('kbd', { class: 'hx-kbd', text: '↑↓' }), ' выбор']),
          h('span', 'hx-legend', [h('kbd', { class: 'hx-kbd', text: 'Enter' }), ' ок']),
          back,
        ]),
      ]),
    );
  }

  open(): void {
    this.setView('root');
    this.show();
  }

  close(): void {
    this.hide();
  }

  /** Re-render after the save changed (e.g. a new game wiped progress). */
  refresh(): void {
    if (!this.isOpen) return;
    if (this.view === 'root') this.renderRoot();
    else this.renderLevels(this.levelMenu.activeId);
  }

  onKey(e: KeyboardEvent): void {
    const menu = this.view === 'root' ? this.rootMenu : this.levelMenu;
    menu.handleKey(e);
  }

  private setView(view: View): void {
    this.view = view;
    this.el.dataset.view = view;
    if (view === 'root') this.renderRoot();
    else this.renderLevels();
  }

  private renderRoot(): void {
    const { store, content, bus, app } = this.ctx;
    const hasSave = store.hasProgress();
    const current = content.level(store.data.currentLevel);
    const items: MenuItem[] = [];
    if (hasSave) {
      items.push({
        id: 'continue',
        label: 'Продолжить',
        sub: current ? `Район ${pad2(current.index)} · ${current.meta.title}` : undefined,
        onSelect: () => bus.emit('ui:play', {}),
      });
    }
    items.push(
      {
        id: 'new',
        label: 'Новая игра',
        onSelect: () => {
          if (!store.hasProgress()) {
            bus.emit('ui:play', { newGame: true });
            return;
          }
          app.confirm({
            title: 'Начать заново?',
            text: 'Весь прогресс — звёзды, чипы и справочник — будет стёрт. Настройки останутся.',
            confirmLabel: 'Стереть и начать',
            cancelLabel: 'Отмена',
            danger: true,
            onConfirm: () => bus.emit('ui:play', { newGame: true }),
          });
        },
      },
      { id: 'levels', label: 'Уровни', hint: `${this.unlockedCount()} / ${content.levels.length}`, onSelect: () => this.setView('levels') },
      { id: 'codex', label: 'Справочник', hint: `${store.data.codex.length} / ${content.codex.length}`, onSelect: () => app.openCodex() },
      { id: 'settings', label: 'Настройки', onSelect: () => app.openSettings() },
    );
    const keep = this.lastRootId && items.some((i) => i.id === this.lastRootId) ? this.lastRootId : items[0].id;
    this.rootMenu.setItems(
      items.map((it) => ({ ...it, onFocus: () => (this.lastRootId = it.id) })),
      keep,
    );
  }

  private unlockedCount(): number {
    const levels = this.ctx.content.levels;
    return levels.filter((_, i) => isLevelUnlocked(this.ctx.store, levels, i)).length;
  }

  private renderLevels(activeId?: string): void {
    const { store, content, bus } = this.ctx;
    const levels = content.levels;
    const items: MenuItem[] = levels.map((level, i) => {
      const unlocked = isLevelUnlocked(store, levels, i);
      const stars = levelStars(store, level);
      const max = content.maxStars(level);
      const done = store.level(level.id).completed;
      return {
        id: level.id,
        label: level.meta.title,
        disabled: !unlocked,
        onSelect: () => bus.emit('ui:play', { levelId: level.id }),
        onFocus: () => this.renderDetails(level, unlocked, i),
        render: () =>
          h('span', 'hx-level-row', [
            h('span', { class: 'hx-level-num', text: pad2(level.index) }),
            h('span', 'hx-level-names', [
              h('span', { class: 'hx-level-title', text: level.meta.title }),
              h('span', { class: 'hx-level-sub', text: level.meta.subtitle }),
            ]),
            unlocked
              ? h('span', `hx-level-stars${done ? ' is-done' : ''}`, [icon('star'), h('span', { text: `${stars}/${max}` })])
              : h('span', 'hx-level-lock', [icon('lock')]),
          ]),
      };
    });
    const firstOpen = [...levels].reverse().find((_, ri) => isLevelUnlocked(store, levels, levels.length - 1 - ri));
    this.levelMenu.setItems(items, activeId ?? store.data.currentLevel ?? firstOpen?.id);
  }

  private renderDetails(level: LevelDef, unlocked: boolean, index: number): void {
    const { store, content } = this.ctx;
    const progress = store.level(level.id);
    const doneTerminals = level.lessons.terminals.filter((t) => progress.terminals[t.id]).length;
    const prev = content.levels[index - 1];
    this.details.replaceChildren(
      h('span', { class: 'hx-kicker', text: `Район ${pad2(level.index)}` }),
      h('h3', { class: 'hx-levels-dtitle', text: level.meta.title }),
      h('p', { class: 'hx-levels-dsub', text: level.meta.subtitle }),
      h(
        'ul',
        'hx-topics',
        level.meta.topics.map((t) => h('li', { text: t })),
      ),
      unlocked
        ? h('div', 'hx-levels-progress', [
            h('span', 'hx-stat hx-stat--star', [icon('star'), h('span', { text: `${levelStars(store, level)} / ${content.maxStars(level)}` })]),
            h('span', 'hx-stat', [icon('terminal'), h('span', { text: `${doneTerminals} / ${level.lessons.terminals.length}` })]),
            h('span', 'hx-stat', [icon('chip'), h('span', { text: `${progress.chips.length} / ${level.lessons.chips.length}` })]),
          ])
        : h('p', 'hx-levels-locked', [icon('lock'), h('span', { text: prev ? `Сначала почини район «${prev.meta.title}».` : 'Пока закрыто.' })]),
    );
  }
}
