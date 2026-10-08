/**
 * Toasts (top centre) and robot barks (speech line above the interact prompt), from `toast` events.
 */
import type { GameEvents } from '../../core/events';
import type { UIContext } from '../context';
import { h } from '../dom';
import { icon, type IconName } from '../icons';

type Toast = GameEvents['toast'];

const MAX_VISIBLE = 3;

function lifetime(text: string, bark: boolean): number {
  const base = bark ? 2600 : 2400;
  return Math.min(bark ? 7000 : 6500, Math.max(3000, base + text.length * 45));
}

const ICON: Record<'info' | 'success' | 'warn', IconName> = { info: 'bulb', success: 'check', warn: 'warn' };

export class Toasts {
  readonly el: HTMLElement;
  private readonly stack: HTMLElement;
  private readonly bark: HTMLElement;
  private readonly barkSpeaker: HTMLElement;
  private readonly barkText: HTMLElement;
  private barkTimer = 0;

  constructor(ctx: UIContext) {
    this.stack = h('div', { class: 'hx-toasts', attrs: { role: 'status', 'aria-live': 'polite' } });
    this.barkSpeaker = h('span', 'hx-bark-speaker');
    this.barkText = h('span', 'hx-bark-text');
    this.bark = h('div', { class: 'hx-bark', attrs: { 'aria-live': 'polite' } }, [this.barkSpeaker, this.barkText]);
    this.el = h('div', 'hx-toast-layer', [this.stack, this.bark]);
    ctx.root.append(this.el);
  }

  push(t: Toast): void {
    const text = t.text.trim();
    if (!text) return;
    if (t.kind === 'bark') {
      this.showBark(text, t.speaker ?? 'ХАРНИ');
      return;
    }
    const kind = t.kind ?? 'info';
    const el = h('div', `hx-toast hx-toast--${kind}`, [
      icon(ICON[kind], 'hx-toast-icon'),
      h('div', 'hx-toast-body', [t.speaker ? h('span', { class: 'hx-toast-speaker', text: t.speaker }) : null, h('span', { text })]),
    ]);
    this.stack.append(el);
    while (this.stack.children.length > MAX_VISIBLE) this.stack.firstElementChild?.remove();
    requestAnimationFrame(() => el.classList.add('is-in'));
    window.setTimeout(() => this.dismiss(el), lifetime(text, false));
  }

  clear(): void {
    this.stack.replaceChildren();
    this.bark.classList.remove('is-in');
    window.clearTimeout(this.barkTimer);
  }

  private dismiss(el: HTMLElement): void {
    if (!el.isConnected) return;
    el.classList.remove('is-in');
    el.classList.add('is-out');
    window.setTimeout(() => el.remove(), 200);
  }

  private showBark(text: string, speaker: string): void {
    this.barkSpeaker.textContent = speaker;
    this.barkText.textContent = text;
    this.bark.classList.remove('is-in');
    void this.bark.offsetWidth;
    this.bark.classList.add('is-in');
    window.clearTimeout(this.barkTimer);
    this.barkTimer = window.setTimeout(() => this.bark.classList.remove('is-in'), lifetime(text, true));
  }
}
