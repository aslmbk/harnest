/** Ending (state 'ending'): closing text, total stars, what next. Enter → ui:quitToMenu. */
import { Screen, levelStars, type UIContext } from '../context';
import { h } from '../dom';
import { icon, logoMark } from '../icons';
import { isConfirmKey } from '../keys';

const TEXT = [
  'Ядро перезапустилось. Над Нижним городом один за другим зажигаются фонари — в переулках, на рынке, в депо и у самой башни.',
  'Ты не написал ни строчки кода сам. Ты научился другому: ясно ставить задачу, давать Claude контекст, проверять его работу и вовремя говорить «стоп».',
  'Жители до сих пор спорят, кто кого починил — ты город или город тебя. А где-то внизу наверняка мигает ещё один старый терминал.',
];

export class EndingScreen extends Screen {
  private readonly card: HTMLElement;
  private openedAt = 0;
  private done = false;

  constructor(ctx: UIContext) {
    super(ctx, 'hx-ending');
    this.card = h('article', 'hx-ending-card');
    this.el.append(this.card);
  }

  open(): void {
    const { content, store } = this.ctx;
    const stars = content.levels.reduce((sum, l) => sum + levelStars(store, l), 0);
    const maxStars = content.levels.reduce((sum, l) => sum + content.maxStars(l), 0);
    const chips = content.levels.reduce((sum, l) => sum + store.level(l.id).chips.length, 0);
    const maxChips = content.levels.reduce((sum, l) => sum + l.lessons.chips.length, 0);
    this.done = false;
    this.openedAt = performance.now();
    this.card.replaceChildren(
      logoMark('hx-ending-mark'),
      h('span', { class: 'hx-kicker hx-kicker--cyan', text: 'Ядро: онлайн' }),
      h('h1', { class: 'hx-ending-title', text: 'Город снова светится' }),
      h(
        'div',
        'hx-ending-text',
        TEXT.map((p) => h('p', { text: p })),
      ),
      h('div', 'hx-ending-stats', [
        h('span', 'hx-stat hx-stat--star', [icon('star'), h('span', { text: `Звёзды: ${stars} / ${maxStars}` })]),
        h('span', 'hx-stat', [icon('chip'), h('span', { text: `Чипы памяти: ${chips} / ${maxChips}` })]),
        h('span', 'hx-stat', [icon('bulb'), h('span', { text: `Справочник: ${store.data.codex.length} / ${content.codex.length}` })]),
      ]),
      h('div', 'hx-ending-next hx-panel', [
        h('span', { class: 'hx-kicker', text: 'Что дальше' }),
        h('p', { text: 'Настоящий Claude Code ждёт в твоём терминале. Всё, что ты здесь выучил, работает там точно так же.' }),
        h('p', 'hx-ending-docs', ['Документация: ', h('span', { class: 'hx-code', text: 'code.claude.com/docs' })]),
      ]),
      h('div', 'hx-ending-actions', [
        h(
          'button',
          {
            class: 'hx-btn hx-btn--primary',
            attrs: { type: 'button' },
            on: { click: () => this.finish(), mousedown: (e) => e.preventDefault() },
          },
          ['В главное меню', h('kbd', { class: 'hx-kbd hx-kbd--inline', text: 'Enter' })],
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

  private finish(): void {
    if (this.done || performance.now() - this.openedAt < 600) return;
    this.done = true;
    this.ctx.sfx.play('uiSelect');
    this.ctx.bus.emit('ui:quitToMenu', {});
  }
}
