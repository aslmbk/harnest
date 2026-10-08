/**
 * Dialog box (dialog:start): speaker, mood portrait, typewriter text.
 * Enter / Space / E / click completes the line, then advances; after the last line → ui:dialogDone.
 * Every line that starts is reported with ui:dialogLine (the game shows the robot's emotion).
 */
import type { DialogLine, Mood } from '../../content/types';
import type { GameEvents } from '../../core/events';
import { Screen, type UIContext } from '../context';
import { h } from '../dom';
import { isConfirmKey } from '../keys';
import { portrait, type PortraitKind } from '../portrait';

const CPS = 52; // characters per second
const HARNI = 'ХАРНИ';
const HARNI_COLOR = '#ffb48f';
const DEFAULT_TINT = '#37e6c8';

function charDelay(ch: string): number {
  if ('.!?…'.includes(ch)) return 220;
  if (',;:—'.includes(ch)) return 90;
  return 1000 / CPS;
}

export class DialogBox extends Screen {
  private readonly box: HTMLElement;
  private readonly portraitEl: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly shownEl: HTMLElement;
  private readonly restEl: HTMLElement;
  private npcId = '';
  private npcName = '';
  private lines: DialogLine[] = [];
  /** Index of each shown line in the dialog:start lines (empty lines are skipped). */
  private sourceIndex: number[] = [];
  private index = 0;
  private text = '';
  private shown = 0;
  private nextAt = 0;
  private raf = 0;
  private openedAt = 0;
  private sinceTalk = 0;

  constructor(ctx: UIContext) {
    super(ctx, 'hx-dialog');
    this.portraitEl = h('div', 'hx-dlg-portrait');
    this.nameEl = h('span', 'hx-dlg-name');
    this.countEl = h('span', 'hx-dlg-count');
    this.shownEl = h('span', 'hx-dlg-shown');
    this.restEl = h('span', { class: 'hx-dlg-rest', attrs: { 'aria-hidden': 'true' } });
    this.box = h('div', 'hx-dlg-box hx-panel', [
      this.portraitEl,
      h('div', 'hx-dlg-main', [
        h('div', 'hx-dlg-head', [this.nameEl, this.countEl]),
        h('p', 'hx-dlg-text', [this.shownEl, this.restEl]),
        h('div', 'hx-dlg-next', [h('span', { class: 'hx-dlg-caret', text: '▼' }), h('kbd', { class: 'hx-kbd', text: 'Enter' })]),
      ]),
    ]);
    this.box.addEventListener('click', () => this.advance());
    this.el.append(this.box);
  }

  open({ npcId, name, lines }: GameEvents['dialog:start']): void {
    this.npcId = npcId;
    this.npcName = name;
    this.lines = [];
    this.sourceIndex = [];
    lines.forEach((line, i) => {
      if (!line.text.trim()) return;
      this.lines.push(line);
      this.sourceIndex.push(i);
    });
    if (!this.lines.length) {
      this.ctx.bus.emit('ui:dialogDone', { npcId });
      return;
    }
    this.openedAt = performance.now();
    this.show();
    this.startLine(0);
  }

  /** Hides without reporting (the game left the dialog state on its own). */
  close(): void {
    cancelAnimationFrame(this.raf);
    this.hide();
  }

  onKey(e: KeyboardEvent): void {
    if (e.key === 'Tab') e.preventDefault(); // focus never walks to buttons
    if (!isConfirmKey(e)) return;
    e.preventDefault();
    if (e.repeat) return;
    this.advance();
  }

  private startLine(i: number): void {
    const line = this.lines[i];
    this.index = i;
    this.text = line.text;
    this.shown = 0;
    this.nextAt = performance.now() + 60;
    this.sinceTalk = 0;
    const speaker = line.speaker?.trim() || this.npcName;
    const isHarni = speaker.toUpperCase() === HARNI;
    this.nameEl.textContent = speaker;
    this.countEl.textContent = this.lines.length > 1 ? `${i + 1} / ${this.lines.length}` : '';
    this.setPortrait(speaker, isHarni, line.mood ?? 'neutral');
    this.box.classList.toggle('is-harni', isHarni);
    this.box.classList.add('is-typing');
    this.paint();
    this.ctx.bus.emit('ui:dialogLine', { npcId: this.npcId, index: this.sourceIndex[i] ?? i });
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  private setPortrait(speaker: string, isHarni: boolean, mood: Mood): void {
    let kind: PortraitKind = 'harni';
    let color = HARNI_COLOR;
    if (!isHarni) {
      const npc = this.ctx.content.npc(this.ctx.levelId, this.npcId);
      const isNpc = speaker === this.npcName || !npc;
      kind = isNpc ? (npc?.model ?? 'npc_tall') : 'npc_round';
      color = isNpc ? (npc?.tint ?? DEFAULT_TINT) : DEFAULT_TINT;
    }
    const el = portrait(kind, mood);
    this.portraitEl.style.color = color;
    this.portraitEl.dataset.mood = mood;
    this.portraitEl.replaceChildren(el);
  }

  private tick(now: number): void {
    if (!this.isOpen) return;
    let advanced = false;
    while (this.shown < this.text.length && now >= this.nextAt) {
      const ch = this.text[this.shown++];
      this.nextAt += charDelay(ch);
      advanced = true;
      if (/[\p{L}\p{N}]/u.test(ch) && ++this.sinceTalk >= 3) {
        this.sinceTalk = 0;
        this.ctx.sfx.play('talk', 55);
      }
    }
    if (advanced) this.paint();
    if (this.shown < this.text.length) this.raf = requestAnimationFrame((t) => this.tick(t));
    else this.box.classList.remove('is-typing');
  }

  private paint(): void {
    this.shownEl.textContent = this.text.slice(0, this.shown);
    this.restEl.textContent = this.text.slice(this.shown);
  }

  private advance(): void {
    if (!this.isOpen || performance.now() - this.openedAt < 160) return;
    if (this.shown < this.text.length) {
      this.shown = this.text.length;
      cancelAnimationFrame(this.raf);
      this.box.classList.remove('is-typing');
      this.paint();
      return;
    }
    if (this.index < this.lines.length - 1) {
      this.ctx.sfx.play('uiMove', 40);
      this.startLine(this.index + 1);
      return;
    }
    const npcId = this.npcId;
    this.close();
    this.ctx.bus.emit('ui:dialogDone', { npcId });
  }
}
