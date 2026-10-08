/**
 * Task panel beside the terminal: challenge title and brief, the current step's task, step counter,
 * hints (one at a time, then the answer), stars at stake and the "why it matters" note.
 * With the touch controls the footer also has buttons for the keys it names: Enter (info steps)
 * and «Выйти» (✕ / /exit); the hint button is F1.
 */
import type { StepDef, TerminalLesson } from '../../content/types';
import type { Stars } from '../../core/store';
import { ensureVisible, fill, h } from '../dom';
import { icon, starsRow } from '../icons';
import { formatCombo } from './lines';
import type { HintState } from './runner';

const STAKE_CAPTION: Record<Stars, string> = {
  3: 'без подсказок',
  2: 'с подсказкой',
  1: 'с ответом',
};

function kindTag(step: StepDef): string {
  switch (step.kind) {
    case 'command':
      return step.prompt === 'shell' ? 'команда оболочки' : 'запрос в Claude Code';
    case 'key':
      return 'сочетание клавиш';
    case 'choice':
      return step.style === 'permission' ? 'разрешение' : 'вопрос';
    case 'info':
      return 'вывод';
  }
}

export class TaskPanel {
  readonly el: HTMLElement;
  readonly hintButton: HTMLButtonElement;
  /** Touch only, info steps: Enter. */
  readonly enterButton: HTMLButtonElement;
  /** Touch only: leave the terminal (✕ / /exit). */
  readonly exitButton: HTMLButtonElement;
  private readonly kicker: HTMLElement;
  private readonly title: HTMLElement;
  private readonly brief: HTMLElement;
  private readonly stake: HTMLElement;
  private readonly stakeCaption: HTMLElement;
  private readonly best: HTMLElement;
  private readonly dots: HTMLElement;
  private readonly counter: HTMLElement;
  private readonly tag: HTMLElement;
  private readonly task: HTMLElement;
  private readonly keys: HTMLElement;
  private readonly hints: HTMLElement;
  private readonly answer: HTMLElement;
  private readonly feedback: HTMLElement;
  private readonly hintLabel: HTMLElement;
  private readonly hintCount: HTMLElement;
  private readonly scroller: HTMLElement;
  private stars: Stars = 3;

  constructor() {
    this.kicker = h('span', 'hx-task-kicker');
    this.title = h('h2', 'hx-task-title');
    this.brief = h('p', 'hx-task-brief');
    this.stake = h('span', 'hx-task-stake-stars');
    this.stakeCaption = h('span', 'hx-task-stake-caption');
    this.best = h('span', 'hx-task-best');
    this.dots = h('span', 'hx-task-dots');
    this.counter = h('span', 'hx-task-counter');
    this.tag = h('span', 'hx-task-tag');
    this.task = h('p', 'hx-task-text');
    this.keys = h('div', 'hx-task-keys');
    this.hints = h('ol', 'hx-task-hints');
    this.answer = h('div', 'hx-task-answer');
    this.feedback = h('div', 'hx-task-feedback');
    this.hintLabel = h('span', { text: 'Подсказка' });
    this.hintCount = h('span', 'hx-hint-count');
    this.hintButton = h('button', { class: 'hx-btn hx-hint-btn', attrs: { type: 'button' } }, [
      icon('bulb'),
      this.hintLabel,
      this.hintCount,
      h('kbd', { class: 'hx-kbd hx-kbd--inline', text: 'F1' }),
    ]);
    this.hintButton.addEventListener('mousedown', (e) => e.preventDefault());
    this.enterButton = h('button', { class: 'hx-btn hx-task-touch hx-task-enter', attrs: { type: 'button' } }, [icon('enter'), h('span', { text: 'Enter' })]);
    this.exitButton = h('button', { class: 'hx-btn hx-task-touch hx-task-leave', attrs: { type: 'button' } }, [icon('close'), h('span', { text: 'Выйти' })]);
    for (const b of [this.enterButton, this.exitButton]) b.addEventListener('mousedown', (e) => e.preventDefault());

    this.scroller = h('div', 'hx-task-scroll', [
      h('header', 'hx-task-head', [
        h('div', 'hx-task-kicker-row', [icon('terminal'), this.kicker]),
        this.title,
        this.brief,
      ]),
      h('div', 'hx-task-stake', [
        h('div', 'hx-task-stake-main', [h('span', { class: 'hx-task-stake-label', text: 'Награда' }), this.stake, this.stakeCaption]),
        this.best,
      ]),
      h('div', 'hx-task-progress', [this.dots, this.counter]),
      h('section', 'hx-task-current', [h('div', 'hx-task-current-head', [h('span', { class: 'hx-task-label', text: 'Задача' }), this.tag]), this.task, this.keys, this.hints, this.answer]),
      this.feedback,
    ]);

    this.el = h('aside', 'hx-task hx-panel', [
      this.scroller,
      h('footer', 'hx-task-foot', [
        this.hintButton,
        this.enterButton,
        this.exitButton,
        h('p', 'hx-task-exit', ['Выйти: ', h('span', { class: 'hx-code', text: '✕' }), ' или ', h('span', { class: 'hx-code', text: '/exit' })]),
      ]),
    ]);
  }

  setChallenge(terminal: TerminalLesson, best: Stars | undefined): void {
    this.kicker.textContent = `Терминал · ${terminal.title}`;
    this.title.textContent = terminal.challenge.title;
    this.brief.textContent = terminal.challenge.brief;
    this.best.replaceChildren(...(best ? [h('span', { text: 'Рекорд' }), starsRow(best, 3, 'hx-stars--inline')] : []));
    this.feedback.replaceChildren();
    this.feedback.className = 'hx-task-feedback';
    this.setStars(3, false);
    this.dots.replaceChildren(...terminal.challenge.steps.map(() => h('i')));
    this.scroller.scrollTop = 0;
  }

  setStep(index: number, count: number, step: StepDef, hint: HintState): void {
    this.el.dataset.kind = step.kind;
    this.counter.textContent = `Шаг ${Math.min(index + 1, count)} из ${count}`;
    Array.from(this.dots.children).forEach((d, i) => {
      d.className = i < index ? 'is-done' : i === index ? 'is-now' : '';
    });
    this.tag.textContent = kindTag(step);
    this.task.textContent = step.task;
    this.hints.replaceChildren();
    this.answer.replaceChildren();
    this.answer.classList.remove('is-on');
    this.keys.replaceChildren();
    this.setHintState(hint);
    this.hintButton.classList.remove('is-nudge');
  }

  /** All steps done. */
  complete(count: number): void {
    delete this.el.dataset.kind;
    this.counter.textContent = `Готово: ${count} из ${count}`;
    Array.from(this.dots.children).forEach((d) => (d.className = 'is-done'));
    this.hintButton.disabled = true;
  }

  setKeycaps(keys: readonly string[], onPress: (combo: string) => void): void {
    this.keys.replaceChildren(
      h('span', 'hx-task-keys-label', [
        h('span', { class: 'hx-task-keys-desk', text: 'Если клавиши не срабатывают — нажми здесь:' }),
        h('span', { class: 'hx-task-keys-touch', text: 'Нажми нужную клавишу:' }),
      ]),
      h(
        'div',
        'hx-task-keys-row',
        keys.map((k) =>
          h('button', {
            class: 'hx-keycap',
            text: formatCombo(k),
            attrs: { type: 'button' },
            data: { combo: k },
            on: { click: () => onPress(k), mousedown: (e) => e.preventDefault() },
          }),
        ),
      ),
    );
  }

  addHint(text: string, index: number): void {
    const li = h('li', 'hx-task-hint', [h('span', { class: 'hx-task-hint-n', text: String(index) }), h('span', { text })]);
    this.hints.append(li);
    this.reveal(li);
  }

  showAnswer(text: string): void {
    this.answer.replaceChildren(h('span', { class: 'hx-task-answer-label', text: 'Ответ' }), h('code', { class: 'hx-task-answer-code', text }));
    this.answer.classList.add('is-on');
    this.reveal(this.answer);
  }

  setHintState(s: HintState): void {
    this.hintButton.disabled = s.exhausted;
    this.hintButton.classList.toggle('is-answer', s.answerNext);
    if (s.total === 0 && !s.answerNext && s.exhausted) {
      this.hintLabel.textContent = 'Подсказок нет';
      this.hintCount.textContent = '';
    } else if (s.answerNext) {
      this.hintLabel.textContent = 'Показать ответ';
      this.hintCount.textContent = '';
    } else if (s.exhausted) {
      this.hintLabel.textContent = 'Ответ показан';
      this.hintCount.textContent = '';
    } else {
      this.hintLabel.textContent = 'Подсказка';
      this.hintCount.textContent = s.total > 1 ? `${s.shown + 1}/${s.total}` : '';
    }
  }

  setStars(stars: Stars, animate = true): void {
    const dropped = stars < this.stars;
    this.stars = stars;
    this.stake.replaceChildren(starsRow(stars, 3));
    this.stakeCaption.textContent = STAKE_CAPTION[stars];
    if (animate && dropped) {
      this.stake.classList.remove('is-drop');
      void this.stake.offsetWidth;
      this.stake.classList.add('is-drop');
    }
  }

  /** Gently points at the hint button after a few misses. */
  nudgeHint(): void {
    if (!this.hintButton.disabled) this.hintButton.classList.add('is-nudge');
  }

  showFeedback(reply: string | undefined, explain: string | undefined): void {
    if (!reply && !explain) {
      this.feedback.replaceChildren();
      this.feedback.className = 'hx-task-feedback';
      return;
    }
    fill(
      this.feedback,
      h('div', 'hx-task-fb-head', [icon('check'), h('span', { text: reply || 'Получилось' })]),
      explain ? h('p', 'hx-task-fb-text', [h('span', { class: 'hx-task-fb-why', text: 'Зачем это: ' }), explain]) : null,
    );
    this.feedback.className = 'hx-task-feedback is-on';
    this.reveal(this.feedback);
  }

  private reveal(el: HTMLElement): void {
    el.classList.remove('is-new');
    void el.offsetWidth;
    el.classList.add('is-new');
    ensureVisible(el, 8);
  }
}
