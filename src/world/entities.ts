/**
 * Runtime objects of a level the player interacts with: terminals, NPCs, chips and the gate.
 * Each can own a candidate of the level's light pool (`light`) and drives its colour and level.
 */
import * as THREE from 'three/webgpu';
import { color, float, length, smoothstep, uv } from 'three/tsl';
import type { InteractKind } from '../core/events';
import { TILE, type LevelLayout, type Mood, type NpcLesson, type TerminalLesson } from '../content/types';
import { findNode, type AssetLibrary } from '../engine/assets';
import { createBlobShadow } from '../render/blobShadow';
import {
  createGateLight,
  createNpcFace,
  createNpcPaint,
  createTerminalScreen,
  replaceMaterial,
  type GateLight,
  type NpcFace,
  type ScreenState,
  type TerminalScreen,
} from '../render/materials';
import type { MaterialLibrary } from '../render/materials';
import { PALETTE } from '../render/palette';
import { bakeEntity } from './bake';
import type { PlanLight } from './levelPlan';
import type { LightCandidate } from './lightPool';
import { facingToYaw } from './tiles';
import { terminalFront, terminalPose } from './levelPlan';
import type { TileGrid } from './tiles';

const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);

/** Something the player can press E at. */
export interface Interactable {
  kind: InteractKind;
  id: string;
  label: string;
  /** Where the robot must be near (metres). */
  x: number;
  z: number;
  radius: number;
  /** Point the robot's head looks at. */
  look: THREE.Vector3;
}

const SCREEN_LIGHT: Record<ScreenState, { color: string; level: number }> = {
  locked: { color: '#8ea2bb', level: 0.35 },
  available: { color: '#ff9a3c', level: 1 },
  done: { color: '#5dff7a', level: 0.75 },
};
/** The same colours parsed once (the per-frame light update must not parse CSS strings). */
const SCREEN_LIGHT_COLOR: Record<ScreenState, THREE.Color> = {
  locked: new THREE.Color(SCREEN_LIGHT.locked.color),
  available: new THREE.Color(SCREEN_LIGHT.available.color),
  done: new THREE.Color(SCREEN_LIGHT.done.color),
};

export class TerminalEntity {
  readonly object: THREE.Object3D;
  readonly screen: TerminalScreen;
  readonly pose: { x: number; z: number; yaw: number };
  readonly interact: Interactable;
  /** Light-pool candidate in front of the screen (set by the game). */
  light: LightCandidate | null = null;
  private readonly baked: THREE.BufferGeometry[];
  private state: ScreenState = 'locked';
  private time = Math.random() * 10;

  constructor(
    readonly lesson: TerminalLesson,
    spot: LevelLayout['terminals'][string],
    grid: TileGrid,
    assets: AssetLibrary,
    materials: MaterialLibrary,
    seed: number,
    /** 1-based number shown on the screen. */
    node = 1,
  ) {
    this.pose = terminalPose(grid, spot);
    this.object = assets.instantiate('terminal');
    this.object.position.set(this.pose.x, 0, this.pose.z);
    this.object.rotation.y = this.pose.yaw;
    this.screen = createTerminalScreen((seed * 0.618) % 1, lesson.title, node);
    replaceMaterial(this.object, 'M_TerminalScreen', this.screen.material);
    this.baked = bakeEntity(this.object, materials);
    const front = terminalFront(this.pose, 0.9);
    this.interact = {
      kind: 'terminal',
      id: lesson.id,
      label: lesson.title,
      x: front.x,
      z: front.z,
      radius: 1.25,
      look: new THREE.Vector3(this.pose.x, 1.15, this.pose.z),
    };
  }

  /** A soft light in front of the screen (its colour follows the state). */
  planLight(): PlanLight {
    const p = terminalFront(this.pose, 0.8);
    return { x: p.x, y: 1.1, z: p.z, color: SCREEN_LIGHT.locked.color, intensity: 0.7, distance: 3.2, priority: 0, source: `terminal:${this.lesson.id}` };
  }

  setState(s: ScreenState): void {
    this.state = s;
    this.screen.setState(s);
  }

  get screenState(): ScreenState {
    return this.state;
  }

  update(dt: number): void {
    this.time += dt;
    this.screen.update(dt);
    const c = this.light;
    if (c) {
      const want = SCREEN_LIGHT[this.state];
      c.color.lerp(SCREEN_LIGHT_COLOR[this.state], damp(5, dt));
      const pulse = this.state === 'available' ? 0.85 + 0.15 * Math.sin(this.time * 3.4) : 1;
      c.level += (want.level * pulse - c.level) * damp(6, dt);
    }
  }

  dispose(): void {
    this.screen.dispose();
    for (const g of this.baked) g.dispose();
  }
}

const GATE_CLOSED_COLOR = new THREE.Color('#ff3b30');
const GATE_OPEN_COLOR = new THREE.Color('#5dff7a');

/** Face targets per dialog mood. */
const MOOD_FACE: Record<Mood, { happy: number; slant: number; size: number; lookX: number; lookY: number; curve: number; width: number; tilt: number; open: number }> = {
  neutral: { happy: 0, slant: 0, size: 1, lookX: 0, lookY: 0, curve: 0.8, width: 0.2, tilt: 0, open: 0 },
  happy: { happy: 1, slant: 0, size: 1, lookX: 0, lookY: 0, curve: 2.6, width: 0.24, tilt: 0, open: 0.2 },
  worried: { happy: 0, slant: 0.9, size: 0.95, lookX: 0, lookY: -0.3, curve: -2.2, width: 0.18, tilt: 0, open: 0 },
  thinking: { happy: 0, slant: -0.3, size: 0.9, lookX: 0.7, lookY: 0.7, curve: 0.2, width: 0.13, tilt: 0.7, open: 0 },
  excited: { happy: 0, slant: -0.2, size: 1.12, lookX: 0, lookY: 0.15, curve: 2.2, width: 0.22, tilt: 0, open: 0.55 },
};

export class NpcEntity {
  readonly object: THREE.Object3D;
  readonly face: NpcFace;
  readonly interact: Interactable;
  private readonly paint: THREE.Material;
  private readonly baked: THREE.BufferGeometry[];
  private readonly body?: THREE.Object3D;
  private readonly head?: THREE.Object3D;
  private readonly rotors: { node: THREE.Object3D; rest: number; dir: number }[] = [];
  private readonly bodyY: number;
  private readonly headRot: THREE.Euler;
  private readonly baseYaw: number;
  private yaw: number;
  private headYaw = 0;
  private headNod = 0;
  private mood: Mood = 'neutral';
  private talking = false;
  private blinkTimer = 1 + Math.random() * 3;
  private blinkPhase = -1;
  private time = Math.random() * 10;
  private rotorAngle = Math.random() * 6;

  constructor(
    readonly lesson: NpcLesson,
    spot: LevelLayout['npcs'][string],
    assets: AssetLibrary,
    materials: MaterialLibrary,
  ) {
    this.object = assets.instantiate(lesson.model);
    const x = spot.at[0] * TILE;
    const z = spot.at[1] * TILE;
    this.baseYaw = facingToYaw(spot.facing);
    this.yaw = this.baseYaw;
    const tint = lesson.tint ?? '#37e6c8';
    this.paint = createNpcPaint(tint);
    replaceMaterial(this.object, 'M_NpcPaint', this.paint);
    this.face = createNpcFace(tint, faceAspect(this.object));
    replaceMaterial(this.object, 'M_NpcFace', this.face.material);
    this.baked = bakeEntity(this.object, materials, { tints: { M_NpcPaint: new THREE.Color(tint) } });
    this.object.position.set(x, 0, z);
    this.object.rotation.y = this.yaw;
    this.body = findNode(this.object, 'Body');
    this.head = findNode(this.object, 'Head');
    for (const [name, dir] of [
      ['RotorL', 1],
      ['RotorR', -1],
    ] as const) {
      const node = findNode(this.object, name);
      if (node) this.rotors.push({ node, rest: node.rotation.y, dir });
    }
    this.bodyY = this.body?.position.y ?? 0;
    this.headRot = this.head?.rotation.clone() ?? new THREE.Euler();
    this.object.add(createBlobShadow(lesson.model === 'npc_round' ? 0.6 : 0.5));
    const headH = lesson.model === 'npc_tall' ? 1.55 : lesson.model === 'npc_drone' ? 1.3 : 0.95;
    this.interact = { kind: 'npc', id: lesson.id, label: lesson.name, x, z, radius: 1.9, look: new THREE.Vector3(x, headH, z) };
  }

  setMood(m: Mood): void {
    this.mood = m;
  }

  setTalking(on: boolean): void {
    this.talking = on;
  }

  update(dt: number, player: { x: number; z: number }, facePlayer: boolean): void {
    this.time += dt;
    const dx = player.x - this.object.position.x;
    const dz = player.z - this.object.position.z;
    const dist = Math.hypot(dx, dz);
    const toPlayer = Math.atan2(dx, dz);
    // turn the whole body toward the player while talking, the head when near
    const wantYaw = facePlayer ? toPlayer : this.baseYaw;
    this.yaw += Math.atan2(Math.sin(wantYaw - this.yaw), Math.cos(wantYaw - this.yaw)) * damp(4, dt);
    this.object.rotation.y = this.yaw;
    const rel = Math.atan2(Math.sin(toPlayer - this.yaw), Math.cos(toPlayer - this.yaw));
    const wantHead = dist < 6 ? THREE.MathUtils.clamp(rel, -1.1, 1.1) : Math.sin(this.time * 0.4) * 0.4;
    this.headYaw += (wantHead - this.headYaw) * damp(5, dt);
    // a small nod while speaking, a tilt while thinking
    const nod = this.talking ? Math.sin(this.time * 7.5) * 0.045 : 0;
    this.headNod += (nod - this.headNod) * damp(12, dt);
    const tilt = this.mood === 'thinking' ? 0.12 : this.mood === 'worried' ? -0.05 : 0;
    if (this.head) this.head.rotation.set(this.headRot.x + this.headNod, this.headRot.y + this.headYaw, this.headRot.z + tilt);
    if (this.body) {
      const hover = this.lesson.model === 'npc_drone' ? Math.sin(this.time * 2.2) * 0.07 : Math.sin(this.time * 1.6) * 0.012;
      this.body.position.y = this.bodyY + hover;
    }
    // drone rotors: counter-rotating about the vertical axis
    if (this.rotors.length) {
      this.rotorAngle += dt * 21;
      for (const r of this.rotors) r.node.rotation.y = r.rest + this.rotorAngle * r.dir;
    }
    // face: blink, mood, mouth while speaking
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0 && this.blinkPhase < 0) {
      this.blinkPhase = 0;
      this.blinkTimer = 2.5 + Math.random() * 3;
    }
    let blink = 0;
    if (this.blinkPhase >= 0) {
      this.blinkPhase += dt;
      blink = Math.sin(Math.min(1, this.blinkPhase / 0.18) * Math.PI);
      if (this.blinkPhase > 0.18) this.blinkPhase = -1;
    }
    const f = MOOD_FACE[this.mood];
    const F = this.face;
    const k = damp(9, dt);
    F.eyeHappy.value += (f.happy - F.eyeHappy.value) * k;
    F.eyeSlant.value += (f.slant - F.eyeSlant.value) * k;
    F.eyeSize.value += (f.size - F.eyeSize.value) * k;
    F.look.value.x += (f.lookX - F.look.value.x) * k;
    F.look.value.y += (f.lookY - F.look.value.y) * k;
    F.mouthCurve.value += (f.curve - F.mouthCurve.value) * k;
    F.mouthWidth.value += (f.width - F.mouthWidth.value) * k;
    F.mouthTilt.value += (f.tilt - F.mouthTilt.value) * k;
    const talk = this.talking ? Math.abs(Math.sin(this.time * 13)) * (0.55 + 0.3 * Math.sin(this.time * 5.3)) : 0;
    F.mouthOpen.value += (Math.max(f.open, talk) - F.mouthOpen.value) * damp(16, dt);
    F.eyeOpen.value = 1 - blink;
  }

  dispose(): void {
    this.paint.dispose();
    this.face.material.dispose();
    for (const g of this.baked) g.dispose();
  }
}

/** Width / height of the face screen (M_NpcFace) in metres, from the model. */
function faceAspect(root: THREE.Object3D): number {
  let aspect = 1.3;
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.userData.matName === 'M_NpcFace') {
      const size = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
      const h = Math.hypot(size.y, size.z * 0.3);
      if (size.x > 0 && h > 0) aspect = size.x / h;
    }
  });
  return THREE.MathUtils.clamp(aspect, 0.6, 2.5);
}

let chipGlowMaterial: THREE.SpriteNodeMaterial | null = null;
let chipFloorMaterial: THREE.MeshBasicNodeMaterial | null = null;
/** Shared halo (camera-facing) and floor-glow materials of the chips. */
function chipMaterials(): { glow: THREE.SpriteNodeMaterial; floor: THREE.MeshBasicNodeMaterial } {
  if (!chipGlowMaterial || !chipFloorMaterial) {
    const glowColor = color(PALETTE.M_ChipGlow.emissive ?? '#5dff7a');
    const d = length(uv().sub(0.5)).mul(2);
    const g = new THREE.SpriteNodeMaterial();
    g.name = 'M_ChipHalo';
    g.transparent = true;
    g.depthWrite = false;
    g.blending = THREE.AdditiveBlending;
    g.fog = false;
    g.colorNode = glowColor.mul(smoothstep(1, 0, d).pow(2.2).mul(0.9));
    chipGlowMaterial = g;
    const f = new THREE.MeshBasicNodeMaterial();
    f.name = 'M_ChipFloorGlow';
    f.transparent = true;
    f.depthWrite = false;
    f.blending = THREE.AdditiveBlending;
    f.fog = false;
    f.polygonOffset = true;
    f.polygonOffsetFactor = -2;
    f.polygonOffsetUnits = -2;
    f.colorNode = glowColor.mul(smoothstep(1, 0.1, d).mul(float(0.32)));
    chipFloorMaterial = f;
  }
  return { glow: chipGlowMaterial, floor: chipFloorMaterial };
}

export class ChipEntity {
  readonly object: THREE.Object3D;
  readonly x: number;
  readonly z: number;
  /** Point the robot's head looks at (the floating cartridge). */
  readonly look: THREE.Vector3;
  collected = false;
  /** Light-pool candidate above the chip (set by the game; switched off once picked up). */
  light: LightCandidate | null = null;
  private pickup = -1;
  private time = Math.random() * 6;
  private readonly model: THREE.Object3D;
  private readonly halo: THREE.Sprite;
  private readonly floorGlow: THREE.Mesh;
  private readonly baked: THREE.BufferGeometry[];

  constructor(
    readonly id: string,
    at: readonly [number, number],
    assets: AssetLibrary,
    materials: MaterialLibrary,
  ) {
    this.x = at[0] * TILE;
    this.z = at[1] * TILE;
    this.look = new THREE.Vector3(this.x, 0.75, this.z);
    this.object = new THREE.Group();
    this.object.name = `chip:${id}`;
    this.object.position.set(this.x, 0, this.z);
    this.model = assets.instantiate('chip');
    this.baked = bakeEntity(this.model, materials);
    const mats = chipMaterials();
    this.halo = new THREE.Sprite(mats.glow);
    this.halo.name = 'chip-halo';
    this.halo.scale.setScalar(0.95);
    this.halo.renderOrder = 6;
    this.floorGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), mats.floor);
    this.floorGlow.name = 'chip-floor-glow';
    this.floorGlow.rotation.x = -Math.PI / 2;
    this.floorGlow.position.y = 0.015;
    this.floorGlow.renderOrder = 3;
    this.object.add(this.model, this.halo, this.floorGlow, createBlobShadow(0.28));
  }

  planLight(): PlanLight {
    return { x: this.x, y: 0.8, z: this.z, color: PALETTE.M_ChipGlow.emissive ?? '#5dff7a', intensity: 0.9, distance: 2.6, priority: 1, source: `chip:${this.id}` };
  }

  /** Starts the pick-up animation. */
  collect(): void {
    if (this.collected) return;
    this.collected = true;
    this.pickup = 0;
  }

  /** Hide at once (restored progress). */
  hide(): void {
    this.collected = true;
    this.object.visible = false;
    if (this.light) this.light.enabled = false;
  }

  /** Back in the world (level restart). */
  show(): void {
    this.collected = false;
    this.pickup = -1;
    this.object.visible = true;
    this.model.scale.setScalar(1);
    this.halo.scale.setScalar(0.95);
    if (this.light) {
      this.light.enabled = true;
      this.light.level = 1;
    }
  }

  update(dt: number): void {
    this.time += dt;
    if (!this.object.visible) return;
    if (this.pickup >= 0) {
      this.pickup += dt;
      const t = Math.min(1, this.pickup / 0.45);
      this.model.position.y = 0.75 + t * 0.9;
      this.model.scale.setScalar(Math.max(0.001, 1 - t));
      this.model.rotation.y += dt * 14;
      this.halo.position.y = this.model.position.y;
      this.halo.scale.setScalar(0.95 + t * 1.6);
      this.floorGlow.scale.setScalar(Math.max(0.001, 1 - t));
      if (this.light) this.light.level = 1 + t * 1.5 - t * t * 2.5;
      if (t >= 1) {
        this.object.visible = false;
        if (this.light) this.light.enabled = false;
      }
      return;
    }
    const bob = Math.sin(this.time * 2.4);
    this.model.position.y = 0.75 + bob * 0.08;
    this.model.rotation.y += dt * 1.6;
    this.halo.position.y = this.model.position.y;
    this.halo.scale.setScalar(0.9 + 0.1 * Math.sin(this.time * 4));
    if (this.light) this.light.level = 0.85 + 0.15 * Math.sin(this.time * 4);
  }

  dispose(): void {
    this.floorGlow.geometry.dispose();
    for (const g of this.baked) g.dispose();
  }
}

/** How far each door slides (a 2 m leaf clears the 4 m opening with a little overlap). */
export const GATE_SLIDE = 2.05;

export class GateEntity {
  readonly object: THREE.Object3D;
  readonly gateLight: GateLight;
  readonly interact: Interactable;
  /** Light-pool candidate at the lamp (red while closed, green when open). */
  light: LightCandidate | null = null;
  isOpen = false;
  private readonly doorL?: THREE.Object3D;
  private readonly doorR?: THREE.Object3D;
  private readonly restL: number;
  private readonly restR: number;
  private readonly lampAt = new THREE.Vector3();
  private readonly baked: THREE.BufferGeometry[];
  private t = 0;
  private time = 0;
  private opening = false;

  constructor(gate: LevelLayout['gate'], assets: AssetLibrary, materials: MaterialLibrary) {
    this.object = assets.instantiate('gate');
    const x = gate.at[0] * TILE;
    const z = gate.at[1] * TILE;
    this.object.position.set(x, 0, z);
    this.object.rotation.y = gate.axis === 'x' ? 0 : Math.PI / 2;
    this.gateLight = createGateLight();
    replaceMaterial(this.object, 'M_GateLight', this.gateLight.material);
    this.baked = bakeEntity(this.object, materials);
    this.doorL = findNode(this.object, 'DoorL');
    this.doorR = findNode(this.object, 'DoorR');
    this.restL = this.doorL?.position.x ?? 0;
    this.restR = this.doorR?.position.x ?? 0;
    // the lamp (M_GateLight) position, a little in front of it
    this.object.updateMatrixWorld(true);
    const box = new THREE.Box3();
    this.object.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.userData.matName === 'M_GateLight') box.expandByObject(o);
    });
    if (box.isEmpty()) this.lampAt.set(x, 3.5, z);
    else {
      box.getCenter(this.lampAt);
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.object.quaternion);
      this.lampAt.addScaledVector(fwd, 0.35);
    }
    this.interact = { kind: 'gate', id: 'gate', label: 'Ворота', x, z, radius: 2.6, look: new THREE.Vector3(x, 2, z) };
  }

  planLight(): PlanLight {
    return { x: this.lampAt.x, y: this.lampAt.y, z: this.lampAt.z, color: '#ff3b30', intensity: 2.2, distance: 7, priority: 0, source: 'gate:lamp' };
  }

  open(animated: boolean): void {
    this.isOpen = true;
    if (animated) this.opening = true;
    else this.setAmount(1);
  }

  close(): void {
    this.isOpen = false;
    this.opening = false;
    this.setAmount(0);
  }

  private setAmount(t: number): void {
    this.t = t;
    const e = t * t * (3 - 2 * t);
    if (this.doorL) this.doorL.position.x = this.restL - GATE_SLIDE * e;
    if (this.doorR) this.doorR.position.x = this.restR + GATE_SLIDE * e;
    this.gateLight.open.value = e;
  }

  update(dt: number): void {
    this.time += dt;
    if (this.opening) {
      this.setAmount(Math.min(1, this.t + dt / 2.4));
      if (this.t >= 1) this.opening = false;
    }
    const c = this.light;
    if (c) {
      const e = this.gateLight.open.value;
      c.color.copy(GATE_CLOSED_COLOR).lerp(GATE_OPEN_COLOR, e);
      const pulse = 0.65 + 0.35 * Math.sin(this.time * 5);
      c.level = pulse + (1 - pulse) * e;
    }
  }

  dispose(): void {
    this.gateLight.material.dispose();
    for (const g of this.baked) g.dispose();
  }
}
