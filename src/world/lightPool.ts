/**
 * Point-light budget: a level has many light candidates (layout lights, neon signs, prop lamps,
 * terminals, chips, the gate) but a quality preset allows only a few real lights. A fixed pool of
 * `PointLight`s is re-pointed every frame at the candidates nearest the camera's focus; lights entering
 * or leaving the selection fade instead of popping. Everything else glows through emissive materials
 * and bloom. With `DynamicLighting` the shaders do not depend on how many lights are on.
 */
import * as THREE from 'three/webgpu';
import type { PlanLight } from './levelPlan';

/** Physical intensity (candela) per artist unit of `lights[]` / catalog lights. */
export const LIGHT_UNIT = 5.5;
export const LIGHT_DECAY = 1.5;

export interface LightCandidate {
  readonly def: PlanLight;
  /** Live colour (the gate and terminals change theirs). */
  readonly color: THREE.Color;
  /** Live strength multiplier (flicker, a sign's level, a terminal's state…). */
  level: number;
  /** Off candidates are never picked (a collected chip). */
  enabled: boolean;
  /** Something whose `level` the light copies (a neon sign's flicker) instead of its own flicker. */
  follows: { readonly level: number } | null;
  /** Fade weight 0..1 (internal). */
  weight: number;
  /** Pick score of the last update, lower is better (internal). */
  score: number;
  phase: number;
}

const byScore = (a: LightCandidate, b: LightCandidate) => a.score - b.score;
const byWeight = (a: LightCandidate, b: LightCandidate) => b.weight - a.weight;

const FADE_RATE = 5;
/** A chosen light keeps its place unless another one is clearly closer. */
const STICKY = 0.82;

export class LightPool {
  readonly group = new THREE.Group();
  readonly candidates: LightCandidate[] = [];
  private readonly slots: THREE.PointLight[] = [];
  private budget: number;
  private readonly chosen = new Set<LightCandidate>();
  // scratch lists, reused every frame
  private readonly order: LightCandidate[] = [];
  private readonly lit: LightCandidate[] = [];
  /** Lights switched on in the last update (for stats). */
  active = 0;

  constructor(
    defs: readonly PlanLight[],
    budget: number,
    private readonly maxSlots: number,
  ) {
    this.group.name = 'lights';
    for (let i = 0; i < maxSlots; i++) {
      const l = new THREE.PointLight('#ffffff', 0, 5, LIGHT_DECAY);
      l.castShadow = false;
      // slot 0 never hides (it goes dark instead): with DynamicLighting the shaders depend on which light
      // types are in the scene, so a point light must exist while the level precompiles, or every lit
      // material recompiles (and the GPU stalls) the moment the first lamp comes on
      l.visible = i === 0;
      l.name = `light-slot-${i}`;
      this.slots.push(l);
      this.group.add(l);
    }
    defs.forEach((d) => this.add(d));
    this.budget = budget;
  }

  add(def: PlanLight): LightCandidate {
    const c: LightCandidate = {
      def,
      color: new THREE.Color(def.color),
      level: 1,
      enabled: true,
      follows: null,
      weight: 0,
      score: 0,
      phase: this.candidates.length * 1.7,
    };
    this.candidates.push(c);
    return c;
  }

  setBudget(n: number): void {
    this.budget = Math.max(0, Math.min(n, this.maxSlots));
  }

  /** Re-pick the lights around `focus` (the camera target) and drive the pool. */
  update(dt: number, time: number, focus: { x: number; z: number }, snap = false): void {
    // [freeze] a snap picks from scratch (no stickiness from earlier frames)
    if (snap) this.chosen.clear();
    // score: distance to the focus, authored lights slightly preferred, current picks sticky
    this.order.length = 0;
    for (const c of this.candidates) {
      if (!c.enabled || c.level <= 0.001) continue;
      const d = Math.hypot(c.def.x - focus.x, c.def.z - focus.z) - c.def.distance * 0.25;
      let score = d * (1 + 0.12 * c.def.priority);
      if (this.chosen.has(c)) score *= STICKY;
      c.score = score;
      this.order.push(c);
    }
    this.order.sort(byScore);
    this.chosen.clear();
    for (let i = 0; i < Math.min(this.budget, this.order.length); i++) this.chosen.add(this.order[i]);

    // fade weights; fading-out lights keep a slot while there is room
    const k = snap ? 1 : 1 - Math.exp(-FADE_RATE * dt);
    let used = 0;
    for (const c of this.candidates) {
      const want = this.chosen.has(c) ? 1 : 0;
      c.weight += (want - c.weight) * k;
      if (c.weight < 0.01 && want === 0) c.weight = 0;
    }
    // a little headroom over the budget so lights can fade out while others fade in
    const cap = Math.min(this.slots.length, this.budget + 3);
    const lit = this.lit;
    lit.length = 0;
    for (const c of this.candidates) if (c.weight > 0) lit.push(c);
    lit.sort(byWeight);
    for (const c of lit) {
      if (used >= cap) break;
      const slot = this.slots[used++];
      const d = c.def;
      let flicker = 1;
      if (c.follows) {
        flicker = c.follows.level;
      } else if (d.flicker) {
        const n = Math.sin(time * 13.1 + c.phase) * Math.sin(time * 7.3 + c.phase * 2.1);
        flicker = n > 0.82 ? 0.25 : 0.92 + 0.08 * Math.sin(time * 31 + c.phase);
      }
      slot.visible = true;
      slot.position.set(d.x, d.y, d.z);
      slot.color.copy(c.color);
      slot.distance = d.distance;
      slot.intensity = d.intensity * LIGHT_UNIT * c.level * c.weight * flicker;
    }
    for (let i = used; i < this.slots.length; i++) {
      const slot = this.slots[i];
      slot.visible = i === 0;
      slot.intensity = 0;
    }
    this.active = used;
  }

  dispose(): void {
    for (const l of this.slots) l.dispose();
  }
}
