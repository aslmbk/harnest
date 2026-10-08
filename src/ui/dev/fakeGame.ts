/**
 * Dev-only stand-in for the 3D game: owns the state machine and plays the game side of the bus
 * protocol, so the real UI can be driven in ui-dev.html without a renderer.
 *
 * "Walking" is simulated with a current interact target (npc → terminals → gate). In 'playing':
 *   E — interact with the target · 1…9 — pick a target · 0 — nothing nearby
 *   C — collect the next chip · T — toast · B — bark · G — finish the level
 */
import type { DialogDef, LevelDef } from '../../content/types';
import type { GameBus, GameEvents, GameState, InteractKind } from '../../core/events';
import type { Store } from '../../core/store';
import type { UIContent } from '../context';

type Prompt = NonNullable<GameEvents['interact:prompt']>;

interface Target {
  kind: InteractKind;
  id: string;
  label: string;
}

const DIGITS = /^Digit([0-9])$/;

export class FakeGame {
  state: GameState = 'boot';
  levelId: string | null = null;
  /** Index into targets(); -1 = nothing nearby. */
  target = -1;
  /** performance.now() when the level started (the harness backdates it for a realistic summary). */
  startedAt = 0;
  private gateOpen = false;
  private timers = new Set<number>();
  private loadToken = 0;

  constructor(
    private readonly bus: GameBus,
    private readonly store: Store,
    private readonly content: UIContent,
  ) {
    bus.on('ui:play', ({ levelId, newGame }) => {
      if (this.state !== 'menu') return;
      if (newGame) this.store.resetProgress();
      const first = this.content.levels[0]?.id;
      const id = newGame ? first : (levelId ?? this.store.data.currentLevel ?? first);
      if (id) void this.loadLevel(id);
    });
    bus.on('ui:introDone', () => {
      if (this.state === 'intro') this.startPlaying();
    });
    bus.on('ui:dialogDone', () => {
      if (this.state !== 'dialog') return;
      this.setState('playing');
      this.walkTo(this.nextUseful());
    });
    bus.on('ui:terminalClosed', (p) => this.onTerminalClosed(p));
    bus.on('ui:pause', () => {
      if (this.state === 'playing') this.setState('paused');
    });
    bus.on('ui:resume', () => {
      if (this.state === 'paused') this.setState('playing');
    });
    bus.on('ui:restartLevel', () => {
      if (this.levelId && this.state === 'paused') void this.loadLevel(this.levelId);
    });
    bus.on('ui:quitToMenu', () => {
      if (this.state === 'paused' || this.state === 'ending' || this.state === 'levelComplete') this.toMenu();
    });
    bus.on('ui:nextLevel', () => {
      if (this.state !== 'levelComplete' || !this.levelId) return;
      const next = this.nextLevel(this.levelId);
      if (next) void this.loadLevel(next.id);
      else this.setState('ending');
    });
    window.addEventListener('keydown', this.onKey);
  }

  get level(): LevelDef | undefined {
    return this.content.levels.find((l) => l.id === this.levelId);
  }

  // ───────────── state ─────────────

  setState(to: GameState): void {
    const from = this.state;
    this.state = to;
    this.bus.emit('state:changed', { from, to });
  }

  /** First boot: a short fake asset load, then the menu. */
  async boot(ms = 700): Promise<void> {
    const labels = ['Шрифты', 'Модели города', 'Неон', 'Звук'];
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
      this.bus.emit('loading:progress', { ratio: i / steps, label: labels[Math.min(labels.length - 1, Math.floor((i / steps) * labels.length))] });
      await this.sleep(ms / steps);
    }
    this.setState('menu');
  }

  toMenu(): void {
    this.levelId = null;
    this.bus.emit('interact:prompt', null);
    this.setState('menu');
  }

  async loadLevel(levelId: string, ms = 650): Promise<void> {
    const token = ++this.loadToken;
    this.setState('loading');
    const labels = ['Геометрия района', 'Неон и свет', 'Жители', 'Терминалы'];
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      if (token !== this.loadToken) return;
      this.bus.emit('loading:progress', { ratio: i / steps, label: labels[Math.min(labels.length - 1, Math.floor((i / steps) * labels.length))] });
      if (ms > 0) await this.sleep(ms / steps);
    }
    if (token !== this.loadToken) return;
    this.enterLevel(levelId);
    this.setState('intro');
  }

  /** The level becomes current (store + level:ready) without a loading screen. */
  enterLevel(levelId: string): void {
    this.levelId = levelId;
    this.store.setCurrentLevel(levelId);
    this.gateOpen = this.requiredDone();
    this.target = -1;
    this.bus.emit('level:ready', { levelId });
  }

  startPlaying(): void {
    this.startedAt = performance.now();
    this.setState('playing');
    this.emitObjectives();
    this.walkTo(this.targets().findIndex((t) => t.kind === 'npc'));
    const zone = this.level?.lessons.zones[0];
    if (zone) this.after(900, () => this.state === 'playing' && this.bus.emit('toast', { text: zone.text, kind: 'bark', speaker: zone.speaker }));
  }

  // ───────────── world simulation ─────────────

  targets(): Target[] {
    const level = this.level;
    if (!level) return [];
    const out: Target[] = level.lessons.npcs.map((n) => ({ kind: 'npc' as const, id: n.id, label: n.name }));
    for (const t of level.lessons.terminals) out.push({ kind: 'terminal', id: t.id, label: t.title });
    out.push({ kind: 'gate', id: 'gate', label: 'Ворота' });
    return out;
  }

  walkTo(index: number): void {
    const list = this.targets();
    this.target = index >= 0 && index < list.length ? index : -1;
    this.emitPrompt();
  }

  emitPrompt(): void {
    const t = this.targets()[this.target];
    if (!t || this.state !== 'playing') {
      this.bus.emit('interact:prompt', null);
      return;
    }
    const prompt: Prompt = { kind: t.kind, id: t.id, label: t.label, locked: this.isLocked(t) };
    this.bus.emit('interact:prompt', prompt);
  }

  interact(): void {
    if (this.state !== 'playing') return;
    const t = this.targets()[this.target];
    if (!t) return;
    if (this.isLocked(t)) {
      this.bus.emit('sfx', { name: 'locked' });
      return;
    }
    this.bus.emit('sfx', { name: 'interact' });
    if (t.kind === 'npc') this.openDialog(t.id);
    else if (t.kind === 'terminal') this.openTerminal(t.id);
    else this.completeLevel();
  }

  openDialog(npcId: string): void {
    const npc = this.level?.lessons.npcs.find((n) => n.id === npcId);
    if (!npc || !this.levelId) return;
    const dialog = npc.dialogs.find((d) => this.holds(d)) ?? npc.dialogs[npc.dialogs.length - 1];
    this.bus.emit('interact:prompt', null);
    this.setState('dialog');
    this.bus.emit('dialog:start', { npcId, name: npc.name, lines: dialog?.lines ?? [] });
  }

  openTerminal(terminalId: string): void {
    if (!this.levelId) return;
    this.bus.emit('interact:prompt', null);
    this.setState('terminal');
    this.bus.emit('terminal:open', { levelId: this.levelId, terminalId });
  }

  /** Picks up the next chip of the level (or `chipId`). */
  collectChip(chipId?: string): void {
    const level = this.level;
    if (!level) return;
    const have = this.store.level(level.id).chips;
    const chip = chipId ? level.lessons.chips.find((c) => c.id === chipId) : (level.lessons.chips.find((c) => !have.includes(c.id)) ?? level.lessons.chips[0]);
    if (!chip) return;
    this.store.collectChip(level.id, chip.id);
    if (chip.unlocks?.length) this.store.unlockCodex(chip.unlocks);
    this.bus.emit('sfx', { name: 'chip' });
    this.bus.emit('chip:collected', { levelId: level.id, chipId: chip.id });
  }

  completeLevel(): void {
    const level = this.level;
    if (!level) return;
    const progress = this.store.level(level.id);
    const stars = level.lessons.terminals.reduce((s, t) => s + (progress.terminals[t.id] ?? 0), 0);
    this.store.completeLevel(level.id);
    this.bus.emit('interact:prompt', null);
    this.bus.emit('sfx', { name: 'levelComplete' });
    this.setState('levelComplete');
    this.bus.emit('level:completed', {
      levelId: level.id,
      isLast: !this.nextLevel(level.id),
      stats: {
        stars,
        maxStars: level.lessons.terminals.length * 3,
        chips: progress.chips.length,
        maxChips: level.lessons.chips.length,
        timeSec: this.startedAt ? (performance.now() - this.startedAt) / 1000 : 754,
      },
    });
  }

  emitObjectives(): void {
    const level = this.level;
    if (!level) return;
    const done = this.store.level(level.id).terminals;
    const items = level.lessons.terminals.map((t) => ({
      id: t.id,
      label: t.title,
      done: !!done[t.id],
      required: t.required,
      locked: (t.requires ?? []).some((r) => !done[r]),
    }));
    this.bus.emit('objectives:changed', { levelId: level.id, items, gateOpen: this.requiredDone() });
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    for (const t of this.timers) window.clearTimeout(t);
  }

  // ───────────── internals ─────────────

  private onTerminalClosed({ terminalId, completed, stars }: GameEvents['ui:terminalClosed']): void {
    if (this.state !== 'terminal') return;
    const level = this.level;
    if (level && completed && stars) {
      const terminal = level.lessons.terminals.find((t) => t.id === terminalId);
      this.store.completeTerminal(level.id, terminalId, stars);
      if (terminal) this.store.unlockCodex(terminal.challenge.unlocks);
      this.emitObjectives();
      this.bus.emit('toast', { text: `«${terminal?.title ?? terminalId}» снова работает`, kind: 'success' });
      if (!this.gateOpen && this.requiredDone()) {
        this.gateOpen = true;
        this.bus.emit('sfx', { name: 'gateOpen' });
        this.bus.emit('gate:opened', { levelId: level.id });
        this.after(700, () => this.bus.emit('toast', { text: 'Ворота района открыты — к выходу!', kind: 'info' }));
      }
    }
    this.setState('playing');
    this.walkTo(completed ? this.nextUseful() : this.target);
  }

  /** The next thing worth walking to: an unfinished unlocked terminal, else the gate. */
  private nextUseful(): number {
    const list = this.targets();
    const done = this.levelId ? this.store.level(this.levelId).terminals : {};
    const i = list.findIndex((t) => t.kind === 'terminal' && !done[t.id] && !this.isLocked(t));
    return i >= 0 ? i : list.findIndex((t) => t.kind === 'gate');
  }

  private isLocked(t: Target): boolean {
    const level = this.level;
    if (!level) return true;
    const done = this.store.level(level.id).terminals;
    if (t.kind === 'gate') return !this.requiredDone();
    if (t.kind === 'terminal') {
      const def = level.lessons.terminals.find((x) => x.id === t.id);
      return (def?.requires ?? []).some((r) => !done[r]);
    }
    return false;
  }

  private requiredDone(): boolean {
    const level = this.level;
    if (!level) return false;
    const done = this.store.level(level.id).terminals;
    return level.lessons.terminals.filter((t) => t.required).every((t) => !!done[t.id]);
  }

  private holds(d: DialogDef): boolean {
    const w = d.when;
    if (!w || !this.levelId) return true;
    const done = this.store.level(this.levelId).terminals;
    if (w.done && !w.done.every((id) => done[id])) return false;
    if (w.notDone && w.notDone.some((id) => done[id])) return false;
    if (w.gateOpen !== undefined && w.gateOpen !== this.requiredDone()) return false;
    return true;
  }

  private nextLevel(id: string): LevelDef | undefined {
    const i = this.content.levels.findIndex((l) => l.id === id);
    return i < 0 ? undefined : this.content.levels[i + 1];
  }

  private readonly onKey = (e: KeyboardEvent) => {
    // The UI stops propagation while its overlays are open, so this only sees free keys.
    if (this.state !== 'playing' || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
    const digit = DIGITS.exec(e.code);
    if (digit) {
      const n = Number(digit[1]);
      this.walkTo(n - 1);
      return;
    }
    switch (e.code) {
      case 'KeyE':
        this.interact();
        break;
      case 'KeyC':
        this.collectChip();
        break;
      case 'KeyT':
        this.bus.emit('toast', { text: 'Связь с ядром города восстановлена на 12%.', kind: 'info' });
        break;
      case 'KeyB':
        this.bus.emit('toast', { text: 'Кажется, тут кто-то есть…', kind: 'bark' });
        break;
      case 'KeyG':
        this.completeLevel();
        break;
    }
  };

  private after(ms: number, fn: () => void): void {
    const t = window.setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => this.after(ms, resolve));
  }
}
