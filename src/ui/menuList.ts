/**
 * Vertical menu: arrows / Home / End move, Enter or Space activates, Esc goes back.
 * Mouse hover moves the selection, click activates. Tab is swallowed: focus never walks to the
 * buttons, so no focus ring ever differs from the highlighted item.
 */
import { ensureVisible, h } from './dom';
import type { Sfx } from './sfx';

export interface MenuItem {
  id: string;
  label: string;
  /** Dim text on the right. */
  hint?: string;
  /** Dim second line under the label. */
  sub?: string;
  /** Selectable but not activatable (e.g. a locked level). */
  disabled?: boolean;
  /** Custom content of the row instead of label + hint. */
  render?: () => Node;
  onSelect: () => void;
  /** Called when the item becomes active (keyboard or mouse). */
  onFocus?: () => void;
}

export interface MenuListOptions {
  className?: string;
  onBack?: () => void;
  /** Horizontal layout: Left/Right move instead of Up/Down. */
  horizontal?: boolean;
}

export class MenuList {
  readonly el: HTMLElement;
  private items: MenuItem[] = [];
  private buttons: HTMLButtonElement[] = [];
  private active = 0;

  constructor(
    private readonly sfx: Sfx,
    private readonly opts: MenuListOptions = {},
  ) {
    this.el = h('div', { class: `hx-menu ${opts.className ?? ''}`.trim(), attrs: { role: 'menu' } });
  }

  get activeId(): string | undefined {
    return this.items[this.active]?.id;
  }

  setItems(items: MenuItem[], activeId?: string): void {
    this.items = items;
    this.buttons = items.map((item, i) => {
      const btn = h(
        'button',
        {
          class: `hx-menu-item${item.disabled ? ' is-disabled' : ''}`,
          attrs: { type: 'button', role: 'menuitem', 'aria-disabled': item.disabled ? 'true' : undefined },
          data: { id: item.id },
          on: {
            pointerenter: () => this.setActive(i, true),
            click: () => this.activate(i),
            mousedown: (e) => e.preventDefault(),
          },
        },
        item.render
          ? [h('span', { class: 'hx-menu-ptr', text: '❯' }), item.render()]
          : [
              h('span', { class: 'hx-menu-ptr', text: '❯' }),
              item.sub
                ? h('span', 'hx-menu-label', [h('span', { text: item.label }), h('span', { class: 'hx-menu-sub', text: item.sub })])
                : h('span', { class: 'hx-menu-label', text: item.label }),
              item.hint ? h('span', { class: 'hx-menu-hint', text: item.hint }) : null,
            ],
      );
      return btn;
    });
    this.el.replaceChildren(...this.buttons);
    const start = activeId ? items.findIndex((it) => it.id === activeId) : -1;
    this.active = start >= 0 ? start : Math.max(0, items.findIndex((it) => !it.disabled));
    this.paint();
    this.items[this.active]?.onFocus?.();
  }

  handleKey(e: KeyboardEvent): boolean {
    const prev = this.opts.horizontal ? 'ArrowLeft' : 'ArrowUp';
    const next = this.opts.horizontal ? 'ArrowRight' : 'ArrowDown';
    switch (e.key) {
      case prev:
        e.preventDefault();
        this.move(-1);
        return true;
      case next:
        e.preventDefault();
        this.move(1);
        return true;
      case 'Home':
        e.preventDefault();
        this.setActive(0, true);
        return true;
      case 'End':
        e.preventDefault();
        this.setActive(this.items.length - 1, true);
        return true;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (!e.repeat) this.activate(this.active);
        return true;
      case 'Escape':
        e.preventDefault();
        if (!e.repeat && this.opts.onBack) {
          this.sfx.play('uiBack');
          this.opts.onBack();
        }
        return true;
      case 'Tab':
        e.preventDefault();
        return true;
    }
    return false;
  }

  select(id: string): void {
    const i = this.items.findIndex((it) => it.id === id);
    if (i >= 0) this.setActive(i, false);
  }

  private move(delta: number): void {
    const n = this.items.length;
    if (!n) return;
    this.setActive((this.active + delta + n) % n, true);
  }

  private setActive(i: number, withSound: boolean): void {
    if (i === this.active || i < 0 || i >= this.items.length) return;
    this.active = i;
    if (withSound) this.sfx.play('uiMove', 40);
    this.paint();
    this.items[i].onFocus?.();
  }

  private activate(i: number): void {
    const item = this.items[i];
    if (!item) return;
    if (i !== this.active) this.setActive(i, false);
    if (item.disabled) {
      this.sfx.play('locked');
      return;
    }
    this.sfx.play('uiSelect');
    item.onSelect();
  }

  private paint(): void {
    this.buttons.forEach((b, i) => {
      b.classList.toggle('is-active', i === this.active);
      if (i === this.active) ensureVisible(b);
    });
  }
}
