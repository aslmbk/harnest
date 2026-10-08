/** A small yes/no modal. Cancel is selected by default; Esc cancels. */
import { Screen, type ConfirmOptions, type UIContext } from '../context';
import { h } from '../dom';
import { MenuList } from '../menuList';

export class ConfirmDialog extends Screen {
  private readonly title: HTMLElement;
  private readonly text: HTMLElement;
  private readonly menu: MenuList;
  private opts: ConfirmOptions | null = null;

  constructor(ctx: UIContext) {
    super(ctx, 'hx-confirm');
    this.title = h('h2', 'hx-confirm-title');
    this.text = h('p', 'hx-confirm-text');
    this.menu = new MenuList(ctx.sfx, { className: 'hx-menu--row', horizontal: true, onBack: () => this.finish(false) });
    this.el.append(h('div', 'hx-confirm-card hx-panel hx-panel--accent', [this.title, this.text, this.menu.el]));
  }

  ask(opts: ConfirmOptions): void {
    this.opts = opts;
    this.title.textContent = opts.title;
    this.text.textContent = opts.text;
    this.el.classList.toggle('is-danger', !!opts.danger);
    this.menu.setItems(
      [
        { id: 'cancel', label: opts.cancelLabel ?? 'Отмена', onSelect: () => this.finish(false) },
        { id: 'ok', label: opts.confirmLabel, onSelect: () => this.finish(true) },
      ],
      'cancel',
    );
    this.show();
  }

  close(): void {
    this.opts = null;
    this.hide();
  }

  onKey(e: KeyboardEvent): void {
    if (e.key === 'Tab') {
      e.preventDefault();
      this.menu.handleKey(new KeyboardEvent('keydown', { key: e.shiftKey ? 'ArrowLeft' : 'ArrowRight' }));
      return;
    }
    this.menu.handleKey(e);
  }

  private finish(ok: boolean): void {
    const opts = this.opts;
    this.close();
    if (!opts) return;
    if (ok) opts.onConfirm();
    else opts.onCancel?.();
  }
}
