/**
 * Codex (Справочник): the player's cheat sheet. Unlocked entries come from store.data.codex;
 * locked ones are placeholders that say where they are learned.
 * Typing filters, ↑↓ select, ←→ switch category (with an empty filter), Esc clears / closes, Tab closes.
 */
import type { CodexCategory, CodexEntry } from '../../content/types';
import { Screen, type UIContext } from '../context';
import { add, ensureVisible, h, pad2 } from '../dom';
import { icon } from '../icons';

type Cat = 'all' | CodexCategory;

const CATS: { id: Cat; label: string }[] = [
  { id: 'all', label: 'Всё' },
  { id: 'cli', label: 'Командная строка' },
  { id: 'slash', label: 'Слэш-команды' },
  { id: 'keys', label: 'Клавиши' },
  { id: 'files', label: 'Файлы' },
  { id: 'concepts', label: 'Понятия' },
];

const CAT_SHORT: Record<CodexCategory, string> = {
  cli: 'CLI',
  slash: 'слэш',
  keys: 'клавиши',
  files: 'файлы',
  concepts: 'понятие',
};

export class CodexScreen extends Screen {
  private readonly input: HTMLInputElement;
  private readonly list: HTMLElement;
  private readonly cats: HTMLElement;
  private readonly counter: HTMLElement;
  private cat: Cat = 'all';
  private selected = 0;
  private visible: { entry: CodexEntry; locked: boolean }[] = [];
  private rows: HTMLElement[] = [];
  private fromPlaying = false;
  private onClose: (() => void) | null = null;

  constructor(ctx: UIContext) {
    super(ctx, 'hx-codex');
    this.input = h('input', {
      class: 'hx-codex-input',
      attrs: { type: 'text', placeholder: 'Фильтр: команда или слово…', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Фильтр справочника' },
      on: { input: () => this.render(true) },
    });
    this.list = h('div', { class: 'hx-codex-list', attrs: { role: 'listbox' } });
    this.cats = h('nav', 'hx-codex-cats');
    this.counter = h('span', 'hx-codex-counter');
    const closeBtn = h(
      'button',
      {
        class: 'hx-icon-btn',
        title: 'Закрыть (Esc)',
        attrs: { type: 'button', 'aria-label': 'Закрыть' },
        on: { click: () => this.close(), mousedown: (e) => e.preventDefault() },
      },
      icon('close'),
    );
    this.el.append(
      h('div', 'hx-codex-card hx-panel hx-panel--accent', [
        h('header', 'hx-codex-head', [
          h('div', 'hx-codex-titles', [
            h('span', { class: 'hx-kicker', text: 'Справочник' }),
            h('h2', { class: 'hx-codex-title', text: 'Шпаргалка оператора' }),
          ]),
          this.counter,
          closeBtn,
        ]),
        h('div', 'hx-codex-body', [
          this.cats,
          h('div', 'hx-codex-main', [h('label', 'hx-codex-search', [icon('search'), this.input]), this.list]),
        ]),
        h('footer', 'hx-codex-foot', [
          h('span', 'hx-legend', [h('kbd', { class: 'hx-kbd', text: '↑↓' }), ' запись']),
          h('span', 'hx-legend', [h('kbd', { class: 'hx-kbd', text: '←→' }), ' раздел']),
          h('span', 'hx-legend', [h('kbd', { class: 'hx-kbd', text: 'Esc' }), ' закрыть']),
        ]),
      ]),
    );
    this.el.addEventListener('pointerup', () => {
      if (this.isOpen && !this.ctx.touch.on && document.activeElement !== this.input && !window.getSelection()?.toString()) this.focusInput();
    });
  }

  open(opts: { fromPlaying?: boolean; onClose?: () => void } = {}): void {
    this.fromPlaying = !!opts.fromPlaying;
    this.onClose = opts.onClose ?? null;
    this.input.value = '';
    this.cat = 'all';
    this.selected = 0;
    this.render(false);
    this.show();
  }

  /** Closes; reports ui:resume when it was opened with Tab from the game. */
  close(silent = false): void {
    if (!this.isOpen) return;
    this.hide();
    this.input.blur();
    if (!silent) this.ctx.sfx.play('uiBack');
    const cb = this.onClose;
    const resume = this.fromPlaying && !silent;
    this.onClose = null;
    this.fromPlaying = false;
    cb?.();
    if (resume) this.ctx.bus.emit('ui:resume', {});
  }

  get openedFromPlaying(): boolean {
    return this.isOpen && this.fromPlaying;
  }

  onTop(): void {
    // Touch: focus would cover the list with the on-screen keyboard; a tap on the filter focuses it.
    if (!this.ctx.touch.on) this.focusInput();
  }

  onKey(e: KeyboardEvent): void {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        if (e.repeat) return;
        if (this.input.value) {
          this.input.value = '';
          this.render(true);
        } else this.close();
        return;
      case 'Tab':
        e.preventDefault();
        if (!e.repeat) this.close();
        return;
      case 'ArrowDown':
        e.preventDefault();
        this.select(this.selected + 1, true);
        return;
      case 'ArrowUp':
        e.preventDefault();
        this.select(this.selected - 1, true);
        return;
      case 'PageDown':
        e.preventDefault();
        this.select(this.selected + 5, true);
        return;
      case 'PageUp':
        e.preventDefault();
        this.select(this.selected - 5, true);
        return;
      case 'ArrowLeft':
      case 'ArrowRight':
        if (this.input.value) return;
        e.preventDefault();
        this.switchCat(e.key === 'ArrowRight' ? 1 : -1);
        return;
    }
  }

  private focusInput(): void {
    this.input.focus({ preventScroll: true });
  }

  private switchCat(dir: number): void {
    const i = CATS.findIndex((c) => c.id === this.cat);
    this.cat = CATS[(i + dir + CATS.length) % CATS.length].id;
    this.selected = 0;
    this.ctx.sfx.play('uiMove', 40);
    this.render(false);
  }

  private render(fromTyping: boolean): void {
    const { content, store } = this.ctx;
    const unlocked = new Set(store.data.codex);
    const query = this.input.value.trim().toLowerCase();
    const all = [...content.codex].sort((a, b) => a.level - b.level);
    const inCat = (e: CodexEntry) => this.cat === 'all' || e.category === this.cat;

    this.visible = all
      .filter(inCat)
      .map((entry) => ({ entry, locked: !unlocked.has(entry.id) }))
      .filter(({ entry, locked }) => {
        if (!query) return true;
        if (locked) return false;
        return [entry.title, entry.syntax ?? '', entry.summary, entry.details ?? ''].some((s) => s.toLowerCase().includes(query));
      });
    if (fromTyping) this.selected = 0;
    this.selected = Math.min(this.selected, Math.max(0, this.visible.length - 1));

    const openCount = content.codex.filter((e) => unlocked.has(e.id)).length;
    this.counter.textContent = `Открыто ${openCount} из ${content.codex.length}`;

    this.cats.replaceChildren(
      ...CATS.map((c) => {
        const entries = content.codex.filter((e) => c.id === 'all' || e.category === c.id);
        const open = entries.filter((e) => unlocked.has(e.id)).length;
        return h(
          'button',
          {
            class: `hx-codex-cat${c.id === this.cat ? ' is-on' : ''}`,
            attrs: { type: 'button' },
            on: {
              click: () => {
                this.cat = c.id;
                this.selected = 0;
                this.ctx.sfx.play('uiMove', 40);
                this.render(false);
              },
              mousedown: (e) => e.preventDefault(),
            },
          },
          [h('span', { class: 'hx-codex-cat-label', text: c.label }), h('span', { class: 'hx-codex-cat-count', text: `${open}/${entries.length}` })],
        );
      }),
    );

    if (!this.visible.length) {
      this.rows = [];
      this.list.replaceChildren(
        h('p', {
          class: 'hx-codex-empty',
          text: query ? 'Ничего не нашлось. Попробуй другое слово — или открой больше записей в пути.' : 'Здесь пока пусто.',
        }),
      );
      return;
    }

    this.rows = this.visible.map(({ entry, locked }, i) => this.entryRow(entry, locked, i));
    this.list.replaceChildren(...this.rows);
    this.paintSelection(false);
  }

  private entryRow(entry: CodexEntry, locked: boolean, i: number): HTMLElement {
    const row = h('article', {
      class: `hx-ce${locked ? ' is-locked' : ''}`,
      attrs: { role: 'option' },
      on: {
        click: () => this.select(i, false),
        mousedown: (e) => e.preventDefault(),
      },
    });
    if (locked) {
      const level = this.ctx.content.levelByIndex(entry.level);
      row.append(
        h('div', 'hx-ce-head', [h('span', 'hx-ce-redacted'), icon('lock', 'hx-ce-lock')]),
        h('p', {
          class: 'hx-ce-summary',
          text: level ? `Откроется в районе ${pad2(level.index)} · ${level.meta.title}` : `Откроется на уровне ${entry.level}`,
        }),
      );
      return row;
    }
    const showSyntax = entry.syntax && entry.syntax !== entry.title;
    add(
      row,
      h('div', 'hx-ce-head', [
        h('span', { class: `hx-ce-title${entry.category === 'concepts' ? ' is-word' : ''}`, text: entry.title }),
        h('span', { class: 'hx-ce-cat', text: CAT_SHORT[entry.category] }),
      ]),
      showSyntax ? h('code', { class: 'hx-ce-syntax', text: entry.syntax }) : null,
      h('p', { class: 'hx-ce-summary', text: entry.summary }),
      entry.details
        ? h(
            'div',
            'hx-ce-details',
            entry.details.split(/\n\s*\n/).map((p) => h('p', { text: p.trim() })),
          )
        : null,
    );
    return row;
  }

  private select(i: number, withSound: boolean): void {
    if (!this.visible.length) return;
    const next = Math.min(this.visible.length - 1, Math.max(0, i));
    if (next === this.selected) return;
    this.selected = next;
    if (withSound) this.ctx.sfx.play('uiMove', 40);
    this.paintSelection(true);
  }

  private paintSelection(scroll: boolean): void {
    this.rows.forEach((r, j) => r.classList.toggle('is-selected', j === this.selected));
    const row = this.rows[this.selected];
    if (row && scroll) ensureVisible(row, 8);
  }
}
