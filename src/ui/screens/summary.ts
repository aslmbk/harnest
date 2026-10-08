/** Level summary (state 'levelComplete' + level:completed). Enter → ui:nextLevel. */
import type { CodexEntry } from '../../content/types';
import type { GameEvents } from '../../core/events';
import { Screen, type UIContext } from '../context';
import { fill, formatTime, h, pad2, plural } from '../dom';
import { icon } from '../icons';
import { isConfirmKey } from '../keys';

type Payload = GameEvents['level:completed'];

export class SummaryScreen extends Screen {
  private readonly card: HTMLElement;
  private data: Payload | null = null;
  private openedAt = 0;
  private done = false;

  constructor(ctx: UIContext) {
    super(ctx, 'hx-summary');
    this.card = h('article', 'hx-summary-card hx-panel hx-panel--accent');
    this.el.append(this.card);
  }

  setData(data: Payload): void {
    this.data = data;
  }

  get hasData(): boolean {
    return this.data !== null;
  }

  clear(): void {
    this.data = null;
  }

  open(): void {
    const data = this.data;
    if (!data) return;
    const { content, store } = this.ctx;
    const level = content.level(data.levelId);
    const { stats } = data;
    this.done = false;
    this.openedAt = performance.now();

    const unlocked = new Set(store.data.codex);
    const learnedIds = level
      ? [...level.lessons.terminals.flatMap((t) => t.challenge.unlocks), ...level.lessons.chips.flatMap((c) => c.unlocks ?? [])]
      : [];
    const learned = [...new Set(learnedIds)]
      .filter((id) => unlocked.has(id))
      .map((id) => content.codexEntry(id))
      .filter((e): e is CodexEntry => !!e);

    const starRatio = stats.maxStars > 0 ? stats.stars / stats.maxStars : 0;
    fill(
      this.card,
      h('span', { class: 'hx-kicker hx-kicker--ok', text: level ? `Район ${pad2(level.index)} восстановлен` : 'Район восстановлен' }),
      h('h1', { class: 'hx-summary-title', text: level?.meta.title ?? 'Готово' }),
      h('div', 'hx-summary-stats', [
        this.stat('star', 'Звёзды', `${stats.stars} / ${stats.maxStars}`, starRatio >= 1 ? 'is-star is-gold' : 'is-star'),
        this.stat('chip', 'Чипы памяти', `${stats.chips} / ${stats.maxChips}`, stats.chips >= stats.maxChips ? 'is-gold' : ''),
        this.stat('ring', 'Время', formatTime(stats.timeSec)),
      ]),
      level?.meta.outro.length
        ? h(
            'div',
            'hx-summary-text',
            level.meta.outro.map((p) => h('p', { text: p })),
          )
        : null,
      learned.length
        ? h('div', 'hx-summary-learned', [
            h('span', { class: 'hx-kicker', text: `Новое в справочнике · ${learned.length} ${plural(learned.length, ['запись', 'записи', 'записей'])}` }),
            h(
              'ul',
              'hx-tags',
              learned.map((e) => h('li', { class: 'hx-tag', text: e.syntax ?? e.title, title: e.summary })),
            ),
          ])
        : null,
      h('div', 'hx-summary-actions', [
        h(
          'button',
          {
            class: 'hx-btn hx-btn--primary hx-pulse',
            attrs: { type: 'button' },
            on: { click: () => this.finish(), mousedown: (e) => e.preventDefault() },
          },
          [data.isLast ? 'К финалу' : 'Следующий район', h('kbd', { class: 'hx-kbd hx-kbd--inline', text: 'Enter' })],
        ),
      ]),
    );
    this.show();
  }

  close(): void {
    this.hide();
  }

  onKey(e: KeyboardEvent): void {
    if (e.key === 'Tab') e.preventDefault(); // focus never walks to buttons
    if (!isConfirmKey(e)) return;
    e.preventDefault();
    if (!e.repeat) this.finish();
  }

  private stat(name: 'star' | 'chip' | 'ring', label: string, value: string, cls = ''): HTMLElement {
    return h('div', `hx-summary-stat ${cls}`.trim(), [
      icon(name),
      h('span', { class: 'hx-summary-value', text: value }),
      h('span', { class: 'hx-summary-label', text: label }),
    ]);
  }

  private finish(): void {
    if (this.done || performance.now() - this.openedAt < 350) return;
    this.done = true;
    this.ctx.sfx.play('uiSelect');
    this.close();
    this.ctx.bus.emit('ui:nextLevel', {});
  }
}
