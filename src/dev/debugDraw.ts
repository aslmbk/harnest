/**
 * `?debug=1`: collider wireframes (solid tiles, props, entities, the closed gate) and the robot's circle.
 */
import * as THREE from 'three/webgpu';
import { TILE } from '../content/types';
import type { ColliderSet } from '../world/collision';
import type { LevelPlan } from '../world/levelPlan';
import { HALF } from '../world/tiles';

export class DebugDraw {
  private readonly group = new THREE.Group();
  private static_: THREE.LineSegments | null = null;
  private dynamic: THREE.LineSegments | null = null;
  private readonly playerRing: THREE.Line;
  private colliders: ColliderSet | null = null;
  /** Box / circle counts the dynamic lines were built from. */
  private dynamicKey = '';
  private frame = 0;
  private readonly staticMat = this.lineMat('#ff3b30');
  private readonly dynamicMat = this.lineMat('#ffe14a');

  constructor(scene: THREE.Scene) {
    this.group.name = 'debug-draw';
    scene.add(this.group);
    const pts: THREE.Vector3[] = [];
    // closed by repeating the first point (the WebGPU renderer has no LineLoop)
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * 0.45, 0.06, Math.sin(a) * 0.45));
    }
    this.playerRing = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), this.lineMat('#ffffff'));
    this.group.add(this.playerRing);
  }

  private lineMat(hex: string): THREE.LineBasicNodeMaterial {
    const m = new THREE.LineBasicNodeMaterial();
    m.color = new THREE.Color(hex).multiplyScalar(3);
    m.fog = false;
    m.depthTest = false;
    m.transparent = true;
    return m;
  }

  setLevel(plan: LevelPlan, colliders: ColliderSet): void {
    this.colliders = colliders;
    const v: number[] = [];
    plan.grid.forEach((c, r) => {
      if (!plan.grid.solid(c, r)) return;
      const pad = plan.grid.isBuilding(c, r) ? 0.2 : 0;
      rect(v, c * TILE - HALF - pad, r * TILE - HALF - pad, c * TILE + HALF + pad, r * TILE + HALF + pad, 0.05);
    });
    if (this.static_) {
      this.group.remove(this.static_);
      this.static_.geometry.dispose();
    }
    this.static_ = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(v, 3)), this.staticMat);
    this.static_.renderOrder = 60;
    this.group.add(this.static_);
    this.rebuildDynamic(true);
  }

  private rebuildDynamic(force = false): void {
    if (!this.colliders) return;
    const boxes = this.colliders.allBoxes();
    const circles = this.colliders.allCircles();
    // rebuilt only when the set changes (the gate opens), not on a timer: a geometry disposed while the
    // level precompiles is picked up by that compile afterwards and never freed
    const key = `${boxes.length}/${circles.length}`;
    if (!force && key === this.dynamicKey) return;
    this.dynamicKey = key;
    const v: number[] = [];
    for (const b of boxes) rect(v, b.minX, b.minZ, b.maxX, b.maxZ, 0.08);
    for (const c of circles) {
      for (let i = 0; i < 24; i++) {
        const a0 = (i / 24) * Math.PI * 2;
        const a1 = ((i + 1) / 24) * Math.PI * 2;
        v.push(c.x + Math.cos(a0) * c.r, 0.08, c.z + Math.sin(a0) * c.r, c.x + Math.cos(a1) * c.r, 0.08, c.z + Math.sin(a1) * c.r);
      }
    }
    if (this.dynamic) {
      this.group.remove(this.dynamic);
      this.dynamic.geometry.dispose();
    }
    this.dynamic = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(v, 3)), this.dynamicMat);
    this.dynamic.renderOrder = 60;
    this.group.add(this.dynamic);
  }

  update(player: { x: number; z: number }): void {
    this.playerRing.position.set(player.x, 0, player.z);
    if (++this.frame % 30 === 0) this.rebuildDynamic();
  }
}

function rect(v: number[], x0: number, z0: number, x1: number, z1: number, y: number): void {
  v.push(x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0);
}
