/**
 * Loading screen for 'boot' (first asset load) and 'loading' (a level is being built).
 * Not interactive: it takes no keys.
 */
import type { UIContext } from '../context';
import { h, pad2 } from '../dom';
import { logoMark } from '../icons';

const TIPS = [
  'Справочник (Tab) хранит всё, что ты выучил в пути.',
  'Подсказки стоят звезду, но не прогресса. Не стесняйся просить.',
  'Claude Code работает с файлами той папки, где его запустили.',
  'CLAUDE.md загружается в каждую сессию — держи его коротким и полезным.',
  'Терминал можно покинуть в любой момент: ✕ или /exit.',
  'Пройденные терминалы можно пройти снова — ради трёх звёзд.',
];

export class LoadingScreen {
  readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly pct: HTMLElement;
  private readonly label: HTMLElement;
  private readonly tip: HTMLElement;
  private tipIndex = Math.floor(Math.random() * TIPS.length);
  private mode: 'boot' | 'level' = 'boot';

  constructor(private readonly ctx: UIContext) {
    this.title = h('h1', { class: 'hx-load-title', text: 'HARNEST' });
    this.sub = h('div', 'hx-load-sub');
    this.fill = h('div', 'hx-load-fill');
    this.pct = h('span', { class: 'hx-load-pct', text: '00%' });
    this.label = h('span', 'hx-load-label');
    this.tip = h('p', 'hx-load-tip');
    this.el = h('section', { class: 'hx-screen hx-loading hx-scan', attrs: { 'aria-live': 'polite' } }, [
      h('div', 'hx-load-center', [
        h('div', 'hx-load-brand', [logoMark('hx-load-mark'), this.title]),
        this.sub,
        h('div', 'hx-load-bar', this.fill),
        h('div', 'hx-load-meta', [this.label, this.pct]),
      ]),
      this.tip,
    ]);
    ctx.root.append(this.el);
  }

  get isOpen(): boolean {
    return this.el.classList.contains('is-open');
  }

  open(mode: 'boot' | 'level', levelId?: string | null): void {
    const wasOpen = this.isOpen;
    this.el.classList.toggle('is-level', mode === 'level');
    this.mode = mode;
    this.setLevel(levelId ?? null);
    if (!wasOpen) {
      this.tipIndex = (this.tipIndex + 1) % TIPS.length;
      this.tip.textContent = `Совет: ${TIPS[this.tipIndex]}`;
      this.setProgress({ ratio: 0 });
    }
    this.el.classList.add('is-open');
  }

  /** Updates the district line (the level becomes known with level:ready). */
  setLevel(levelId: string | null): void {
    const level = this.mode === 'level' ? this.ctx.content.level(levelId) : undefined;
    this.sub.textContent = level
      ? `Район ${pad2(level.index)} · ${level.meta.title}`
      : this.mode === 'level'
        ? 'Сборка района'
        : 'Научись управлять Claude Code';
  }

  close(): void {
    this.el.classList.remove('is-open');
  }

  setProgress({ ratio, label }: { ratio: number; label?: string }): void {
    const r = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0));
    this.fill.style.transform = `scaleX(${r})`;
    this.pct.textContent = `${pad2(Math.round(r * 100))}%`;
    if (label !== undefined) this.label.textContent = label;
    else if (r === 0) this.label.textContent = '';
  }
}
