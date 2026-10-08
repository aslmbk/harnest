/** Level intro card (state 'intro'). Enter / Space / click → ui:introDone. */
import { Screen, type UIContext } from '../context';
import { fill, h, pad2 } from '../dom';
import { isConfirmKey } from '../keys';

export class IntroCard extends Screen {
  private readonly card: HTMLElement;
  private openedAt = 0;
  private done = false;

  constructor(ctx: UIContext) {
    super(ctx, 'hx-intro');
    this.card = h('article', 'hx-intro-card hx-panel hx-panel--accent');
    this.el.append(this.card);
    this.el.addEventListener('click', () => this.finish());
  }

  open(levelId: string | null): void {
    const level = this.ctx.content.level(levelId);
    this.done = false;
    this.openedAt = performance.now();
    if (!level) {
      this.card.replaceChildren(h('h1', { class: 'hx-intro-title', text: 'Нижний город' }), this.startButton());
    } else {
      const { meta } = level;
      fill(
        this.card,
        h('div', 'hx-intro-kicker', [
          h('span', { class: 'hx-kicker hx-kicker--cyan', text: `Район ${pad2(level.index)} из ${pad2(this.ctx.content.levels.length)}` }),
        ]),
        h('h1', { class: 'hx-intro-title', text: meta.title }),
        h('p', { class: 'hx-intro-sub', text: meta.subtitle }),
        h(
          'div',
          'hx-intro-text',
          meta.intro.map((p) => h('p', { text: p })),
        ),
        meta.topics.length
          ? h('div', 'hx-intro-topics', [
              h('span', { class: 'hx-kicker', text: 'Ты научишься' }),
              h(
                'ul',
                'hx-topics',
                meta.topics.map((t) => h('li', { text: t })),
              ),
            ])
          : null,
        this.startButton(),
      );
    }
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

  private startButton(): HTMLElement {
    return h('div', 'hx-intro-actions', [
      h('button', { class: 'hx-btn hx-btn--primary hx-pulse', attrs: { type: 'button' } }, [
        'Начать',
        h('kbd', { class: 'hx-kbd hx-kbd--inline', text: 'Enter' }),
      ]),
    ]);
  }

  private finish(): void {
    if (this.done || performance.now() - this.openedAt < 250) return;
    this.done = true;
    this.ctx.sfx.play('uiSelect');
    this.close();
    this.ctx.bus.emit('ui:introDone', {});
  }
}
