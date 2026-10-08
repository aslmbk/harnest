/**
 * Settings: master / music / sfx volume and graphics quality. Applied immediately via store.setSettings.
 * ↑↓ pick a row, ←→ adjust, Esc back. Sliders also drag with the mouse.
 */
import type { Quality, Settings } from '../../core/store';
import { Screen, type UIContext } from '../context';
import { h } from '../dom';

type VolumeKey = 'master' | 'music' | 'sfx';

const QUALITIES: { id: Quality; label: string }[] = [
  { id: 'auto', label: 'Авто' },
  { id: 'low', label: 'Низкое' },
  { id: 'medium', label: 'Среднее' },
  { id: 'high', label: 'Высокое' },
];

interface Row {
  el: HTMLElement;
  adjust(dir: number, big?: boolean): void;
  activate?(): void;
  sync(s: Readonly<Settings>): void;
}

export class SettingsScreen extends Screen {
  private rows: Row[] = [];
  private active = 0;
  private onClose: (() => void) | null = null;
  private unsub: (() => void) | null = null;

  constructor(ctx: UIContext) {
    super(ctx, 'hx-settings');
    const list = h('div', 'hx-set-list');
    this.rows = [
      this.volumeRow('master', 'Общая громкость'),
      this.volumeRow('music', 'Музыка'),
      this.volumeRow('sfx', 'Звуки'),
      this.qualityRow(),
      this.backRow(),
    ];
    this.rows.forEach((row, i) => {
      row.el.addEventListener('pointerenter', () => this.setActive(i, false));
      list.append(row.el);
    });
    this.el.append(
      h('div', 'hx-set-card hx-panel hx-panel--accent', [
        h('span', { class: 'hx-kicker', text: 'Система' }),
        h('h2', { class: 'hx-set-title', text: 'Настройки' }),
        list,
        h('p', 'hx-set-foot', [
          h('kbd', { class: 'hx-kbd', text: '↑↓' }),
          ' пункт  ',
          h('kbd', { class: 'hx-kbd', text: '←→' }),
          ' изменить  ',
          h('kbd', { class: 'hx-kbd', text: 'Esc' }),
          ' назад',
        ]),
      ]),
    );
  }

  open(onClose?: () => void): void {
    this.onClose = onClose ?? null;
    this.sync();
    this.unsub?.();
    this.unsub = this.ctx.store.subscribe(() => this.sync());
    this.setActive(0, false);
    this.show();
  }

  close(): void {
    if (!this.isOpen) return;
    this.unsub?.();
    this.unsub = null;
    this.hide();
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
  }

  onKey(e: KeyboardEvent): void {
    const row = this.rows[this.active];
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        this.setActive((this.active - 1 + this.rows.length) % this.rows.length, true);
        break;
      case 'ArrowDown':
      case 'Tab':
        e.preventDefault();
        this.setActive((this.active + 1) % this.rows.length, true);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        row.adjust(-1, e.shiftKey);
        break;
      case 'ArrowRight':
        e.preventDefault();
        row.adjust(1, e.shiftKey);
        break;
      case 'Home':
        e.preventDefault();
        row.adjust(-100);
        break;
      case 'End':
        e.preventDefault();
        row.adjust(100);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (!e.repeat) row.activate?.();
        break;
      case 'Escape':
        e.preventDefault();
        if (!e.repeat) {
          this.ctx.sfx.play('uiBack');
          this.close();
        }
        break;
    }
  }

  private sync(): void {
    const s = this.ctx.store.settings;
    for (const row of this.rows) row.sync(s);
  }

  private setActive(i: number, withSound: boolean): void {
    if (i !== this.active && withSound) this.ctx.sfx.play('uiMove', 40);
    this.active = i;
    this.rows.forEach((r, j) => r.el.classList.toggle('is-active', j === i));
  }

  private volumeRow(key: VolumeKey, label: string): Row {
    const fill = h('div', 'hx-slider-fill');
    const thumb = h('div', 'hx-slider-thumb');
    const track = h('div', 'hx-slider-track', [fill, thumb]);
    const value = h('span', 'hx-set-value');
    const slider = h('div', { class: 'hx-slider', attrs: { role: 'slider', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100 } }, track);
    const set = (v: number) => {
      const next = Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
      if (next === this.ctx.store.settings[key]) return;
      this.ctx.store.setSettings({ [key]: next } as Partial<Settings>);
      this.ctx.sfx.play('uiMove', 60);
    };
    const fromPointer = (e: PointerEvent) => {
      const r = track.getBoundingClientRect();
      set((e.clientX - r.left) / Math.max(1, r.width));
    };
    slider.addEventListener('pointerdown', (e) => {
      slider.setPointerCapture(e.pointerId);
      fromPointer(e);
    });
    slider.addEventListener('pointermove', (e) => {
      if (slider.hasPointerCapture(e.pointerId)) fromPointer(e);
    });
    const el = h('div', 'hx-set-row', [h('span', { class: 'hx-set-label', text: label }), slider, value]);
    return {
      el,
      adjust: (dir, big) => set(this.ctx.store.settings[key] + dir * (big ? 0.1 : 0.05)),
      sync: (s) => {
        const v = s[key];
        fill.style.transform = `scaleX(${v})`;
        thumb.style.left = `${v * 100}%`;
        value.textContent = `${Math.round(v * 100)}%`;
        slider.setAttribute('aria-valuenow', String(Math.round(v * 100)));
      },
    };
  }

  private qualityRow(): Row {
    const buttons = QUALITIES.map((q) =>
      h('button', {
        class: 'hx-seg-btn',
        text: q.label,
        attrs: { type: 'button' },
        on: {
          click: () => pick(q.id),
          mousedown: (e) => e.preventDefault(),
        },
      }),
    );
    const pick = (id: Quality) => {
      if (id === this.ctx.store.settings.quality) return;
      this.ctx.store.setSettings({ quality: id });
      this.ctx.sfx.play('uiMove', 40);
    };
    const step = (dir: number) => {
      const i = QUALITIES.findIndex((q) => q.id === this.ctx.store.settings.quality);
      const next = Math.min(QUALITIES.length - 1, Math.max(0, i + Math.sign(dir)));
      pick(QUALITIES[next].id);
    };
    const el = h('div', 'hx-set-row hx-set-row--seg', [
      h('span', { class: 'hx-set-label', text: 'Качество графики' }),
      h('div', 'hx-seg', buttons),
    ]);
    return {
      el,
      adjust: (dir) => step(dir),
      activate: () => {
        const i = QUALITIES.findIndex((q) => q.id === this.ctx.store.settings.quality);
        pick(QUALITIES[(i + 1) % QUALITIES.length].id);
      },
      sync: (s) => buttons.forEach((b, i) => b.classList.toggle('is-on', QUALITIES[i].id === s.quality)),
    };
  }

  private backRow(): Row {
    const btn = h('button', {
      class: 'hx-btn',
      text: 'Готово',
      attrs: { type: 'button' },
      on: {
        click: () => {
          this.ctx.sfx.play('uiBack');
          this.close();
        },
        mousedown: (e) => e.preventDefault(),
      },
    });
    const el = h('div', 'hx-set-row hx-set-row--back', btn);
    return {
      el,
      adjust: () => {},
      activate: () => {
        this.ctx.sfx.play('uiBack');
        this.close();
      },
      sync: () => {},
    };
  }
}
