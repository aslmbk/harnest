/**
 * HUD (state 'playing', partly 'dialog'): district + topic, objectives, chips, interact prompt,
 * key legend. Purely visual — pointer events pass through to the canvas (wheel zoom). The only
 * buttons are «Справочник» and «Пауза» top-right, shown with the touch controls instead of the
 * key legend (the same actions as Tab and Esc).
 */
import type { GameEvents, ObjectiveItem } from '../../core/events';
import type { UIContext } from '../context';
import { fill, h, pad2 } from '../dom';
import { icon, type IconName } from '../icons';

type Prompt = GameEvents['interact:prompt'];
type Objectives = GameEvents['objectives:changed'];

/** What the touch buttons do: the same as Esc and Tab while playing. */
export interface HudActions {
  pause(): void;
  codex(): void;
}

const VERBS: Record<'npc' | 'terminal' | 'gate', string> = {
  npc: 'Поговорить',
  terminal: 'Подключиться',
  gate: 'Пройти',
};

/** A touch-only HUD button (hidden by CSS unless the touch controls are on). */
function touchButton(name: IconName, label: string, action: () => void): HTMLButtonElement {
  return h(
    'button',
    {
      class: 'hx-hud-btn hx-glass',
      attrs: { type: 'button', 'aria-label': label },
      on: { click: () => action(), mousedown: (e) => e.preventDefault() },
    },
    [icon(name), h('span', { text: label })],
  );
}

export class Hud {
  readonly el: HTMLElement;
  private readonly kicker: HTMLElement;
  private readonly district: HTMLElement;
  private readonly topic: HTMLElement;
  private readonly objCount: HTMLElement;
  private readonly objList: HTMLElement;
  private readonly gate: HTMLElement;
  private readonly chips: HTMLElement;
  private readonly prompt: HTMLElement;
  private objectives: Objectives | null = null;
  private lastPrompt: Prompt = null;

  constructor(
    private readonly ctx: UIContext,
    actions: HudActions,
  ) {
    this.kicker = h('span', 'hx-hud-kicker');
    this.district = h('div', 'hx-hud-district');
    this.topic = h('div', 'hx-hud-topic');
    this.objCount = h('span', 'hx-hud-objcount');
    this.objList = h('ul', 'hx-hud-objlist');
    this.gate = h('div', 'hx-hud-gate');
    this.chips = h('span', 'hx-hud-chipcount');
    this.prompt = h('div', { class: 'hx-hud-prompt', attrs: { 'aria-live': 'polite' } });

    this.el = h('div', 'hx-hud', [
      h('div', 'hx-hud-tl', [
        h('div', 'hx-hud-level hx-glass', [this.kicker, this.district, this.topic]),
        h('div', 'hx-hud-obj hx-glass', [
          h('div', 'hx-hud-objhead', [h('span', { class: 'hx-hud-label', text: 'Задачи' }), this.objCount]),
          this.objList,
          this.gate,
        ]),
      ]),
      h('div', 'hx-hud-tr', [
        h('div', { class: 'hx-hud-chips hx-glass', title: 'Чипы памяти' }, [icon('chip'), this.chips, h('span', { class: 'hx-hud-label', text: 'чипы' })]),
        touchButton('book', 'Справочник', actions.codex),
        touchButton('pause', 'Пауза', actions.pause),
      ]),
      this.prompt,
      h('div', 'hx-hud-legend', [
        h('span', null, [h('kbd', { class: 'hx-kbd', text: 'WASD' }), ' ехать']),
        h('span', null, [h('kbd', { class: 'hx-kbd', text: 'E' }), ' действие']),
        h('span', null, [h('kbd', { class: 'hx-kbd', text: 'Tab' }), ' справочник']),
        h('span', null, [h('kbd', { class: 'hx-kbd', text: 'Esc' }), ' пауза']),
      ]),
    ]);
    ctx.root.append(this.el);
  }

  /** mode 'dialog' keeps the level info but hides the prompt and legend. */
  show(mode: 'full' | 'dialog'): void {
    this.el.classList.add('is-open');
    this.el.dataset.mode = mode;
  }

  hide(): void {
    this.el.classList.remove('is-open');
  }

  setLevel(levelId: string | null): void {
    const level = this.ctx.content.level(levelId);
    this.kicker.textContent = level ? `Район ${pad2(level.index)}` : 'Нижний город';
    this.district.textContent = level?.meta.title ?? '';
    this.topic.textContent = level?.meta.subtitle ?? '';
    this.objectives = null;
    this.setPrompt(null);
    this.refresh();
  }

  setObjectives(payload: Objectives): void {
    this.objectives = payload;
    this.renderObjectives();
  }

  setPrompt(prompt: Prompt): void {
    this.lastPrompt = prompt;
    if (!prompt) {
      this.prompt.classList.remove('is-on');
      return;
    }
    const label = prompt.label.trim();
    this.prompt.classList.toggle('is-locked', prompt.locked);
    if (prompt.locked) {
      const reason = this.lockReason(prompt.kind, prompt.id);
      fill(
        this.prompt,
        icon('lock', 'hx-prompt-lock'),
        h('span', { class: 'hx-prompt-label', text: label || (prompt.kind === 'gate' ? 'Ворота' : 'Закрыто') }),
        reason ? h('span', { class: 'hx-prompt-reason', text: reason }) : null,
      );
    } else {
      fill(
        this.prompt,
        h('kbd', { class: 'hx-kbd hx-kbd--key', text: 'E' }),
        h('span', { class: 'hx-prompt-verb', text: VERBS[prompt.kind] }),
        label ? h('span', { class: 'hx-prompt-label', text: label }) : null,
      );
    }
    this.prompt.classList.add('is-on');
  }

  /** Chips counter (and objectives fallback) from the store. */
  refresh(): void {
    const level = this.ctx.level;
    if (!level) {
      this.chips.textContent = '0 / 0';
      return;
    }
    const got = this.ctx.store.level(level.id).chips.length;
    this.chips.textContent = `${got} / ${level.lessons.chips.length}`;
    if (!this.objectives) this.renderObjectives();
    if (this.lastPrompt?.locked) this.setPrompt(this.lastPrompt);
  }

  private derivedObjectives(): Objectives | null {
    const level = this.ctx.level;
    if (!level) return null;
    const done = this.ctx.store.level(level.id).terminals;
    const items: ObjectiveItem[] = level.lessons.terminals.map((t) => ({
      id: t.id,
      label: t.title,
      done: !!done[t.id],
      required: t.required,
      locked: (t.requires ?? []).some((r) => !done[r]),
    }));
    const gateOpen = items.filter((i) => i.required).every((i) => i.done);
    return { levelId: level.id, items, gateOpen };
  }

  private renderObjectives(): void {
    const data = this.objectives ?? this.derivedObjectives();
    if (!data) {
      this.objList.replaceChildren();
      this.objCount.textContent = '';
      this.gate.replaceChildren();
      return;
    }
    const required = data.items.filter((i) => i.required);
    const optional = data.items.filter((i) => !i.required);
    const doneReq = required.filter((i) => i.done).length;
    this.objCount.textContent = `${doneReq} / ${required.length}`;
    this.objList.replaceChildren(...[...required, ...optional].map((item) => this.objectiveRow(item)));
    this.gate.classList.toggle('is-open', data.gateOpen);
    this.gate.replaceChildren(
      icon('gate'),
      h('span', {
        text: data.gateOpen ? 'Ворота открыты — к выходу' : `Ворота закрыты · осталось ${required.length - doneReq}`,
      }),
    );
  }

  private objectiveRow(item: ObjectiveItem): HTMLElement {
    const state = item.done ? 'is-done' : item.locked ? 'is-locked' : 'is-todo';
    return h('li', `hx-obj ${state}${item.required ? '' : ' is-optional'}`, [
      icon(item.done ? 'check' : item.locked ? 'lock' : 'ring', 'hx-obj-icon'),
      h('span', { class: 'hx-obj-label', text: item.label }),
      item.required ? null : h('span', { class: 'hx-obj-badge', text: 'бонус' }),
    ]);
  }

  private lockReason(kind: 'npc' | 'terminal' | 'gate', id: string): string {
    const level = this.ctx.level;
    if (kind === 'gate') return 'Сначала почини обязательные терминалы';
    if (kind !== 'terminal' || !level) return '';
    const terminal = level.lessons.terminals.find((t) => t.id === id);
    const done = this.ctx.store.level(level.id).terminals;
    const missing = (terminal?.requires ?? [])
      .filter((r) => !done[r])
      .map((r) => level.lessons.terminals.find((t) => t.id === r)?.title)
      .filter((t): t is string => !!t);
    return missing.length ? `Сначала: ${missing.map((m) => `«${m}»`).join(', ')}` : 'Пока заблокировано';
  }
}
