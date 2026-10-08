/**
 * The robot ХАРНИ: movement with sliding collision (design doc §4) and procedural animation on the
 * contract node names (§7.1) — works the same on the placeholder and on `robot.glb`:
 * treads scroll and wheels spin by distance, the body leans and bobs, the head looks at the nearest
 * interactable, eyes blink and tilt for emotion, the antenna wobbles, a headlamp lights the ground.
 */
import * as THREE from 'three/webgpu';
import { findNode, type AssetLibrary } from '../engine/assets';
import { createBlobShadow } from '../render/blobShadow';
import { createEyeGlow, createTrack, replaceMaterial, type EyeGlow, type MaterialLibrary, type TrackMaterial } from '../render/materials';
import { bakeEntity } from './bake';
import { moveCircle, type CollisionSource } from './collision';

export const PLAYER = {
  radius: 0.45,
  maxSpeed: 4.2,
  accel: 11,
  decel: 13,
  turn: 11,
  /** Length of one belt loop (m) and wheel radius (m) of robot.glb, for the scroll / spin rates. */
  trackLoop: 2.218,
  wheelRadius: 0.112,
  /** Flip if a model's tread UVs run the other way. */
  trackUvDirection: 1,
  /** Belt centre |x| (m). */
  halfTrack: 0.335,
  /** Head limits (rad): yaw ±60°, pitch 20° down / 15° up (positive pitch = down). */
  headYaw: Math.PI / 3,
  headDown: 0.35,
  headUp: 0.26,
  /** Eye pod roll limit (rad), ±20°. */
  eyeRoll: 0.35,
};

/**
 * Headlamp (a spot on the head, so it follows the gaze). Linear decay keeps the pool ahead bright without
 * a hot spot on walls right in front; it dims to `dimmed` when the head looks at something close (a
 * terminal screen, a face) so the target is not blown out.
 */
export const HEADLAMP = {
  color: '#ffe2b8',
  intensity: 10,
  distance: 12,
  angle: 0.6,
  penumbra: 0.6,
  decay: 1,
  dimmed: 0.22,
  /** Look-target distance (m): fully dimmed below `near`, full power beyond `far`. */
  near: 1.2,
  far: 3.5,
};

export type Emotion = 'neutral' | 'happy' | 'worried' | 'curious';

/** Eye pose per emotion: outer-edge-up roll of each pod (rad) and the lid shapes. */
const EMOTION_EYES: Record<Emotion, { rollL: number; rollR: number; happy: number; worried: number }> = {
  neutral: { rollL: 0, rollR: 0, happy: 0, worried: 0 },
  happy: { rollL: 0.3, rollR: 0.3, happy: 1, worried: 0 },
  worried: { rollL: -0.3, rollR: -0.3, happy: 0, worried: 0.85 },
  curious: { rollL: 0.24, rollR: -0.1, happy: 0, worried: 0 },
};

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** Scratch vector for the per-frame head aim (no allocation per frame). */
const LOOK_LOCAL = new THREE.Vector3();
const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);

class Spring {
  value = 0;
  vel = 0;
  constructor(
    private readonly stiffness: number,
    private readonly damping: number,
  ) {}
  step(target: number, dt: number, impulse = 0): number {
    const acc = (target - this.value) * this.stiffness - this.vel * this.damping + impulse;
    this.vel += acc * dt;
    this.value += this.vel * dt;
    return this.value;
  }
}

interface RobotNodes {
  chassis?: THREE.Object3D;
  trackL?: THREE.Object3D;
  trackR?: THREE.Object3D;
  wheelsL: THREE.Object3D[];
  wheelsR: THREE.Object3D[];
  body?: THREE.Object3D;
  armL?: THREE.Object3D;
  armR?: THREE.Object3D;
  antenna?: THREE.Object3D;
  neck?: THREE.Object3D;
  head?: THREE.Object3D;
  eyeL?: THREE.Object3D;
  eyeR?: THREE.Object3D;
}

/** Rest transforms, so animation is applied on top of whatever the model authored. */
interface Rest {
  bodyY: number;
  bodyRot: THREE.Euler;
  headRot: THREE.Euler;
  armLRot: THREE.Euler;
  armRRot: THREE.Euler;
  antennaRot: THREE.Euler;
  eyeLRot: THREE.Euler;
  eyeRRot: THREE.Euler;
  wheelsL: THREE.Euler[];
  wheelsR: THREE.Euler[];
}

export class Player {
  readonly object = new THREE.Group();
  readonly robot: THREE.Object3D;
  readonly headlamp: THREE.SpotLight;
  x = 0;
  z = 0;
  vx = 0;
  vz = 0;
  yaw = Math.PI;
  /** 0..1 of max speed. */
  speed01 = 0;
  private readonly nodes: RobotNodes;
  private readonly rest: Rest;
  private readonly trackL: TrackMaterial;
  private readonly trackR: TrackMaterial;
  private readonly eyeL: EyeGlow;
  private readonly eyeR: EyeGlow;
  private readonly eyes: readonly EyeGlow[];
  private trackDistL = 0;
  private trackDistR = 0;
  private prevYaw = Math.PI;
  private prevFwd = 0;
  private readonly leanPitch = new Spring(60, 9);
  private readonly leanRoll = new Spring(50, 8);
  private readonly antX = new Spring(140, 3.2);
  private readonly antZ = new Spring(140, 3.2);
  private headYaw = 0;
  private headPitch = 0;
  private blinkTimer = 2;
  private blinkPhase = -1;
  private emotion: Emotion = 'neutral';
  private emotionTime = 0;
  private rollL = 0;
  private rollR = 0;
  private lidHappy = 0;
  private lidWorried = 0;
  private talking = false;
  private talkBob = 0;
  private idleLook = 0;
  private idleTimer = 3;
  private time = 0;
  private lamp = 1;

  constructor(assets: AssetLibrary, materials: MaterialLibrary) {
    this.object.name = 'player';
    this.robot = assets.instantiate('Harni');
    this.object.add(this.robot);
    const n = (name: string) => findNode(this.robot, name);
    this.nodes = {
      chassis: n('Chassis'),
      trackL: n('TrackL'),
      trackR: n('TrackR'),
      wheelsL: [1, 2, 3].map((i) => n(`WheelL${i}`)).filter((o): o is THREE.Object3D => !!o),
      wheelsR: [1, 2, 3].map((i) => n(`WheelR${i}`)).filter((o): o is THREE.Object3D => !!o),
      body: n('Body'),
      armL: n('ArmL'),
      armR: n('ArmR'),
      antenna: n('Antenna'),
      neck: n('Neck'),
      head: n('Head'),
      eyeL: n('EyeL'),
      eyeR: n('EyeR'),
    };
    const r = this.nodes;
    this.rest = {
      bodyY: r.body?.position.y ?? 0,
      bodyRot: r.body?.rotation.clone() ?? new THREE.Euler(),
      headRot: r.head?.rotation.clone() ?? new THREE.Euler(),
      armLRot: r.armL?.rotation.clone() ?? new THREE.Euler(),
      armRRot: r.armR?.rotation.clone() ?? new THREE.Euler(),
      antennaRot: r.antenna?.rotation.clone() ?? new THREE.Euler(),
      eyeLRot: r.eyeL?.rotation.clone() ?? new THREE.Euler(),
      eyeRRot: r.eyeR?.rotation.clone() ?? new THREE.Euler(),
      wheelsL: r.wheelsL.map((w) => w.rotation.clone()),
      wheelsR: r.wheelsR.map((w) => w.rotation.clone()),
    };

    // per-robot materials: each tread scrolls on its own, the eyes blink
    this.trackL = createTrack();
    this.trackR = createTrack();
    if (r.trackL) replaceMaterial(r.trackL, 'M_Track', this.trackL.material);
    if (r.trackR) replaceMaterial(r.trackR, 'M_Track', this.trackR.material);
    if (!r.trackL || !r.trackR) replaceMaterial(this.robot, 'M_Track', this.trackL.material);
    // one lens material per eye: the lids are drawn in the shader and the worried slant is mirrored
    this.eyeL = createEyeGlow(1);
    this.eyeR = createEyeGlow(-1);
    this.eyes = [this.eyeL, this.eyeR];
    if (r.eyeL && r.eyeR) {
      replaceMaterial(r.eyeL, 'M_EyeGlow', this.eyeL.material);
      replaceMaterial(r.eyeR, 'M_EyeGlow', this.eyeR.material);
    } else replaceMaterial(this.robot, 'M_EyeGlow', this.eyeL.material);
    // fewer draw calls: the plain parts of every node become one mesh
    bakeEntity(this.robot, materials);
    this.robot.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });

    // headlamp
    const L = HEADLAMP;
    this.headlamp = new THREE.SpotLight(L.color, L.intensity, L.distance, L.angle, L.penumbra, L.decay);
    this.headlamp.castShadow = false;
    const lampParent = r.head ?? this.robot;
    this.headlamp.position.set(0, r.head ? 0.08 : 0.9, r.head ? 0.15 : 0.3);
    this.headlamp.target.position.set(0, r.head ? -1.4 : -0.5, 4.5);
    lampParent.add(this.headlamp, this.headlamp.target);

    this.object.add(createBlobShadow(0.62));
  }

  place(x: number, z: number, yaw: number): void {
    this.x = x;
    this.z = z;
    this.vx = 0;
    this.vz = 0;
    this.yaw = yaw;
    this.prevYaw = yaw;
    this.speed01 = 0;
    this.sync();
  }

  emote(e: Emotion, seconds = 2.5): void {
    this.emotion = e;
    this.emotionTime = seconds;
  }

  /** The robot speaks a dialog line: the head bobs and the eyes pulse. */
  setTalking(on: boolean): void {
    this.talking = on;
  }

  /**
   * One step. `move` is the screen-relative input (length ≤ 1), `look` the point the head should
   * turn to (null = look around).
   */
  update(dt: number, move: { x: number; z: number }, sources: readonly CollisionSource[], look: THREE.Vector3 | null): void {
    this.time += dt;
    // ── movement ──
    const wantX = move.x * PLAYER.maxSpeed;
    const wantZ = move.z * PLAYER.maxSpeed;
    const k = damp(move.x || move.z ? PLAYER.accel : PLAYER.decel, dt);
    this.vx += (wantX - this.vx) * k;
    this.vz += (wantZ - this.vz) * k;
    if (Math.hypot(this.vx, this.vz) < 0.02 && !move.x && !move.z) {
      this.vx = 0;
      this.vz = 0;
    }
    if (dt > 0 && (this.vx || this.vz)) {
      const res = moveCircle(sources, this.x, this.z, this.vx * dt, this.vz * dt, PLAYER.radius);
      const ax = (res.x - this.x) / dt;
      const az = (res.z - this.z) / dt;
      this.x = res.x;
      this.z = res.z;
      if (res.blocked) {
        this.vx = ax;
        this.vz = az;
      }
    }
    const speed = Math.hypot(this.vx, this.vz);
    this.speed01 = Math.min(1, speed / PLAYER.maxSpeed);
    if (speed > 0.15) {
      const target = Math.atan2(this.vx, this.vz);
      this.yaw += wrapAngle(target - this.yaw) * damp(PLAYER.turn, dt);
    }
    this.animate(dt, look);
    this.sync();
  }

  /** Idle animation only (menu, dialogs, terminals). */
  idle(dt: number, look: THREE.Vector3 | null): void {
    this.time += dt;
    this.vx *= 1 - damp(PLAYER.decel, dt);
    this.vz *= 1 - damp(PLAYER.decel, dt);
    this.speed01 = Math.min(1, Math.hypot(this.vx, this.vz) / PLAYER.maxSpeed);
    this.animate(dt, look);
    this.sync();
  }

  private sync(): void {
    this.object.position.set(this.x, 0, this.z);
    this.object.rotation.y = this.yaw;
  }

  private animate(dt: number, look: THREE.Vector3 | null): void {
    const r = this.nodes;
    const rest = this.rest;
    if (dt <= 0) return;
    const yawRate = wrapAngle(this.yaw - this.prevYaw) / dt;
    this.prevYaw = this.yaw;
    const fwd = this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw);
    const accel = (fwd - this.prevFwd) / dt;
    this.prevFwd = fwd;

    // treads and wheels: the left track is on +X (the robot faces +Z); turning left (yaw rate > 0)
    // slows the left track and speeds up the right one. Wheels spin about local X (+ = rolling forward).
    const vl = fwd - yawRate * PLAYER.halfTrack;
    const vr = fwd + yawRate * PLAYER.halfTrack;
    this.trackDistL += vl * dt;
    this.trackDistR += vr * dt;
    this.trackL.offset.value = (this.trackDistL / PLAYER.trackLoop) * PLAYER.trackUvDirection;
    this.trackR.offset.value = (this.trackDistR / PLAYER.trackLoop) * PLAYER.trackUvDirection;
    r.wheelsL.forEach((w, i) => (w.rotation.x = rest.wheelsL[i].x + this.trackDistL / PLAYER.wheelRadius));
    r.wheelsR.forEach((w, i) => (w.rotation.x = rest.wheelsR[i].x + this.trackDistR / PLAYER.wheelRadius));

    // body: lean into acceleration and turns, bob while driving
    const pitch = this.leanPitch.step(THREE.MathUtils.clamp(accel * 0.012, -0.12, 0.12), dt);
    const roll = this.leanRoll.step(THREE.MathUtils.clamp(-yawRate * fwd * 0.012, -0.1, 0.1), dt);
    if (r.body) {
      r.body.rotation.set(rest.bodyRot.x + pitch, rest.bodyRot.y, rest.bodyRot.z + roll);
      r.body.position.y = rest.bodyY + Math.sin(this.time * 17) * 0.007 * this.speed01 + Math.sin(this.time * 1.7) * 0.004;
    }

    // arms swing a little
    const swing = Math.sin(this.time * 9) * 0.18 * this.speed01;
    if (r.armL) r.armL.rotation.set(rest.armLRot.x + swing - pitch, rest.armLRot.y, rest.armLRot.z);
    if (r.armR) r.armR.rotation.set(rest.armRRot.x - swing - pitch, rest.armRRot.y, rest.armRRot.z);

    // antenna wobble driven by acceleration and turning
    const ax = this.antX.step(0, dt, -accel * 0.9);
    const az = this.antZ.step(0, dt, yawRate * fwd * 0.6);
    if (r.antenna) r.antenna.rotation.set(rest.antennaRot.x + THREE.MathUtils.clamp(ax, -0.5, 0.5), rest.antennaRot.y, rest.antennaRot.z + THREE.MathUtils.clamp(az, -0.5, 0.5));

    // head: look at the target, or glance around
    let wantYaw = 0;
    let wantPitch = 0;
    if (look && r.head?.parent) {
      const local = r.head.parent.worldToLocal(LOOK_LOCAL.copy(look));
      const headPos = r.head.position;
      const dx = local.x - headPos.x;
      const dy = local.y - headPos.y;
      const dz = local.z - headPos.z;
      wantYaw = THREE.MathUtils.clamp(Math.atan2(dx, dz), -PLAYER.headYaw, PLAYER.headYaw);
      wantPitch = THREE.MathUtils.clamp(-Math.atan2(dy, Math.hypot(dx, dz)), -PLAYER.headUp, PLAYER.headDown);
    } else {
      this.idleTimer -= dt;
      if (this.idleTimer <= 0) {
        this.idleLook = this.speed01 > 0.3 ? 0 : (Math.random() - 0.5) * 1.2;
        this.idleTimer = 1.5 + Math.random() * 3;
      }
      wantYaw = this.idleLook - yawRate * 0.08;
    }
    this.headYaw += (wantYaw - this.headYaw) * damp(6, dt);
    this.headPitch += (wantPitch - this.headPitch) * damp(6, dt);
    const bob = this.talking ? Math.sin(this.time * 8) * 0.05 : 0;
    this.talkBob += (bob - this.talkBob) * damp(12, dt);
    if (r.head) r.head.rotation.set(rest.headRot.x + this.headPitch + this.talkBob, rest.headRot.y + this.headYaw, rest.headRot.z);

    // headlamp: dim while looking at something close
    const L = HEADLAMP;
    const lampWant = look ? L.dimmed + (1 - L.dimmed) * THREE.MathUtils.smoothstep(Math.hypot(look.x - this.x, look.z - this.z), L.near, L.far) : 1;
    this.lamp += (lampWant - this.lamp) * damp(4, dt);
    this.headlamp.intensity = L.intensity * this.lamp;

    // eyes: blink + emotion tilt
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0 && this.blinkPhase < 0) {
      this.blinkPhase = 0;
      this.blinkTimer = 2 + Math.random() * 4;
    }
    let lid = 1;
    if (this.blinkPhase >= 0) {
      this.blinkPhase += dt;
      const t = this.blinkPhase / 0.16;
      lid = t < 0.4 ? 1 - t / 0.4 : Math.min(1, (t - 0.4) / 0.6);
      if (t >= 1) this.blinkPhase = -1;
    }
    if (this.emotionTime > 0) {
      this.emotionTime -= dt;
      if (this.emotionTime <= 0) this.emotion = 'neutral';
    }
    const want = EMOTION_EYES[this.emotion];
    const ke = damp(8, dt);
    const lim = PLAYER.eyeRoll;
    this.rollL += (THREE.MathUtils.clamp(want.rollL, -lim, lim) - this.rollL) * ke;
    this.rollR += (THREE.MathUtils.clamp(want.rollR, -lim, lim) - this.rollR) * ke;
    this.lidHappy += (want.happy - this.lidHappy) * ke;
    this.lidWorried += (want.worried - this.lidWorried) * ke;
    const glow = this.talking ? 1 + 0.25 * Math.abs(Math.sin(this.time * 13)) : 1;
    for (const e of this.eyes) {
      e.open.value = 0.06 + 0.94 * lid;
      e.happy.value = this.lidHappy;
      e.worried.value = this.lidWorried;
      e.glow.value = glow;
    }
    // roll about local Z: + lifts EyeL's outer (+X) edge; EyeR mirrors it
    if (r.eyeL) r.eyeL.rotation.set(rest.eyeLRot.x, rest.eyeLRot.y, rest.eyeLRot.z + this.rollL);
    if (r.eyeR) r.eyeR.rotation.set(rest.eyeRRot.x, rest.eyeRRot.y, rest.eyeRRot.z - this.rollR);
  }

  /** Head world position (for the camera in close-ups). */
  headWorld(out = new THREE.Vector3()): THREE.Vector3 {
    return (this.nodes.head ?? this.robot).getWorldPosition(out);
  }

  dispose(): void {
    this.trackL.material.dispose();
    this.trackR.material.dispose();
    this.eyeL.material.dispose();
    this.eyeR.material.dispose();
    this.headlamp.dispose();
  }
}
