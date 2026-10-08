/**
 * Chip tip card (chip:collected): non-blocking, fades by itself. The timer only runs while the
 * game is in 'playing' and the pointer is not over the card; ✕ dismisses it at once.
 */
import type { CodexEntry } from '../../content/types';
import type { UIContext } from '../context';
import { h } from '../dom';
import { icon } from '../icons';

export class ChipCard {
  readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly text: HTMLElement;
  private readonly unlocks: HTMLElement;
  private readonly timerFill: HTMLElement;
  private remaining = 0;
  private total = 1;
  private running = false;
  private hovered = false;
  private last = 0;
  private raf = 0;

  constructor(private readonly ctx: UIContext) {
    this.title = h('h3', 'hx-chip-title');
    this.text = h('p', 'hx-chip-text');
    this.unlocks = h('div', 'hx-chip-unlocks');
    this.timerFill = h('div', 'hx-chip-timer-fill');
    const close = h(
      'button',
      {
        class: 'hx-icon-btn hx-icon-btn--sm',
        title: 'Закрыть',
        attrs: { type: 'button', 'aria-label': 'Закрыть' },
        on: { click: () => this.dismiss(), mousedown: (e) => e.preventDefault() },
      },
      icon('close'),
    );
    this.el = h('aside', { class: 'hx-chipcard hx-panel', attrs: { 'aria-live': 'polite' } }, [
      h('div', 'hx-chip-head', [icon('chip', 'hx-chip-icon'), h('span', { class: 'hx-kicker hx-kicker--ok', text: 'Чип памяти' }), close]),
      this.title,
      this.text,
      this.unlocks,
      h('div', 'hx-chip-timer', this.timerFill),
    ]);
    this.el.addEventListener('pointerenter', () => (this.hovered = true));
    this.el.addEventListener('pointerleave', () => (this.hovered = false));
    ctx.root.append(this.el);
  }

  show({ levelId, chipId }: { levelId: string; chipId: string }): void {
    const chip = this.ctx.content.chip(levelId, chipId);
    if (!chip) return;
    this.title.textContent = chip.title;
    this.text.textContent = chip.text;
    const entries = (chip.unlocks ?? []).map((id) => this.ctx.content.codexEntry(id)).filter((e): e is CodexEntry => !!e);
    this.unlocks.replaceChildren(
      ...(entries.length
        ? [h('span', { class: 'hx-chip-unlocks-label', text: '+ в справочник:' }), ...entries.map((e) => h('span', { class: 'hx-tag', text: e.syntax ?? e.title }))]
        : []),
    );
    this.total = Math.min(14000, Math.max(6000, 3500 + chip.text.length * 55));
    this.remaining = this.total;
    this.el.classList.add('is-open');
    this.last = performance.now();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  /** The countdown only runs while the game is being played. */
  setRunning(running: boolean): void {
    this.running = running;
  }

  dismiss(): void {
    cancelAnimationFrame(this.raf);
    this.el.classList.remove('is-open');
  }

  private tick(now: number): void {
    const dt = now - this.last;
    this.last = now;
    if (this.running && !this.hovered) this.remaining -= dt;
    this.timerFill.style.transform = `scaleX(${Math.max(0, this.remaining / this.total)})`;
    if (this.remaining <= 0) {
      this.dismiss();
      return;
    }
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }
}
