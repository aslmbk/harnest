/**
 * Progress inside the current level (pure): done terminals, chips, gate, fired zones, play time.
 * Starts from the saved progress so re-entering a level restores it.
 */
import type { ObjectiveItem } from '../core/events';
import type { LevelProgress } from '../core/store';
import type { DialogDef, LevelDef, TilePos, ZoneLesson } from '../content/types';
import { allRequiredDone, buildObjectives, inZone, isTerminalLocked, pickDialog, zonesToFire, type ProgressView } from './conditions';

export class LevelSession implements ProgressView {
  readonly level: LevelDef;
  readonly done = new Set<string>();
  readonly chips = new Set<string>();
  readonly firedZones = new Set<string>();
  /** Repeating zones (`once: false`) that barked and that the robot has not left since. */
  private readonly stay = new Set<string>();
  gateOpen = false;
  elapsed = 0;
  completed = false;

  constructor(level: LevelDef, saved?: Readonly<LevelProgress>) {
    this.level = level;
    const ids = new Set(level.lessons.terminals.map((t) => t.id));
    for (const id of Object.keys(saved?.terminals ?? {})) if (ids.has(id)) this.done.add(id);
    const chipIds = new Set(level.lessons.chips.map((c) => c.id));
    for (const id of saved?.chips ?? []) if (chipIds.has(id)) this.chips.add(id);
    this.gateOpen = allRequiredDone(level.lessons, this.done);
  }

  get levelId(): string {
    return this.level.id;
  }

  terminal(id: string) {
    return this.level.lessons.terminals.find((t) => t.id === id);
  }

  isLocked(terminalId: string): boolean {
    const t = this.terminal(terminalId);
    return !!t && !this.done.has(t.id) && isTerminalLocked(t, this.done);
  }

  /** Records a finished terminal. `openGate` is true when this completion should open the gate now. */
  completeTerminal(id: string): { fresh: boolean; openGate: boolean } {
    if (!this.terminal(id)) return { fresh: false, openGate: false };
    const fresh = !this.done.has(id);
    this.done.add(id);
    const openGate = !this.gateOpen && allRequiredDone(this.level.lessons, this.done);
    return { fresh, openGate };
  }

  collectChip(id: string): boolean {
    if (this.chips.has(id) || !this.level.lessons.chips.some((c) => c.id === id)) return false;
    this.chips.add(id);
    return true;
  }

  objectives(): ObjectiveItem[] {
    return buildObjectives(this.level.lessons, this.done);
  }

  dialogFor(npcId: string): DialogDef | undefined {
    const npc = this.level.lessons.npcs.find((n) => n.id === npcId);
    return npc ? pickDialog(npc, this) : undefined;
  }

  /** Zones entered at `pos` that should bark now; marks them as fired. */
  enterZones(pos: { col: number; row: number }): ZoneLesson[] {
    const spots = this.level.layout.zones;
    for (const id of this.stay) if (!spots[id] || !inZone(spots[id], pos)) this.stay.delete(id);
    const fire = zonesToFire(this.level.lessons.zones, spots, pos, this.firedZones, this).filter((z) => !this.stay.has(z.id));
    for (const z of fire) {
      this.firedZones.add(z.id);
      if (z.once === false) this.stay.add(z.id);
    }
    return fire;
  }

  /**
   * True when `pos` (tile coords) is on the exit while the gate is open. The exit is wide across the
   * passage (the gate opening is 2 tiles) and shallow along it.
   */
  atExit(pos: { col: number; row: number }): boolean {
    if (!this.gateOpen) return false;
    const exit: TilePos = this.level.layout.exit;
    const across = this.level.layout.gate.axis === 'x' ? Math.abs(pos.col - exit[0]) : Math.abs(pos.row - exit[1]);
    const along = this.level.layout.gate.axis === 'x' ? Math.abs(pos.row - exit[1]) : Math.abs(pos.col - exit[0]);
    return across <= 1.0 && along <= 0.6;
  }
}
