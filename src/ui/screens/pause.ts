/** Pause menu (state 'paused' after Esc). Esc → ui:resume. */
import { Screen, type UIContext } from '../context';
import { h, pad2 } from '../dom';
import { icon } from '../icons';
import { MenuList } from '../menuList';

export class PauseMenu extends Screen {
  private readonly menu: MenuList;
  private readonly sub: HTMLElement;
  private readonly stats: HTMLElement;

  constructor(ctx: UIContext) {
    super(ctx, 'hx-pause');
    this.menu = new MenuList(ctx.sfx, { className: 'hx-menu--pause', onBack: () => this.resume() });
    // MenuList already plays uiBack / uiSelect; resume() itself stays silent.
    this.sub = h('p', 'hx-pause-sub');
    this.stats = h('div', 'hx-pause-stats');
    this.el.append(
      h('div', 'hx-pause-card hx-panel hx-panel--accent', [
        h('span', { class: 'hx-kicker', text: 'Пауза' }),
        h('h2', { class: 'hx-pause-title', text: 'Система ждёт' }),
        this.sub,
        this.stats,
        this.menu.el,
      ]),
    );
  }

  open(): void {
    const { bus, app, store } = this.ctx;
    const level = this.ctx.level;
    this.sub.textContent = level ? `Район ${pad2(level.index)} · ${level.meta.title}` : '';
    if (level) {
      const progress = store.level(level.id);
      const required = level.lessons.terminals.filter((t) => t.required);
      const done = required.filter((t) => progress.terminals[t.id]).length;
      this.stats.replaceChildren(
        h('span', 'hx-stat', [icon('terminal'), h('span', { text: `Терминалы ${done} / ${required.length}` })]),
        h('span', 'hx-stat', [icon('chip'), h('span', { text: `Чипы ${progress.chips.length} / ${level.lessons.chips.length}` })]),
      );
    } else this.stats.replaceChildren();
    this.menu.setItems(
      [
        { id: 'resume', label: 'Продолжить', hint: 'Esc', onSelect: () => this.resume() },
        { id: 'codex', label: 'Справочник', hint: 'Tab', onSelect: () => app.openCodex() },
        { id: 'settings', label: 'Настройки', onSelect: () => app.openSettings() },
        { id: 'restart', label: 'Начать уровень заново', onSelect: () => bus.emit('ui:restartLevel', {}) },
        { id: 'menu', label: 'В главное меню', onSelect: () => bus.emit('ui:quitToMenu', {}) },
      ],
      'resume',
    );
    this.show();
  }

  close(): void {
    this.hide();
  }

  onKey(e: KeyboardEvent): void {
    if (e.key === 'Tab') {
      e.preventDefault();
      if (!e.repeat) {
        this.ctx.sfx.play('uiSelect');
        this.ctx.app.openCodex();
      }
      return;
    }
    this.menu.handleKey(e);
  }

  private resume(): void {
    this.ctx.bus.emit('ui:resume', {});
  }
}
