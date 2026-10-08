/**
 * Camera rig (design doc §4): perspective, FOV 35°, fixed yaw looking north, pitched ~52°, ~17 m from the
 * robot, smooth follow with look-ahead, wheel zoom 12–24 m, eases closer in `terminal` / `dialog`, slow
 * drift over the level in `menu`. `map` is an orthographic top-down view of the whole level.
 */
import * as THREE from 'three/webgpu';
import { LAYER, setCameraLayers } from '../render/layers';
import { CAMERA } from './cameraParams';

export { CAMERA };

export type CameraMode = 'follow' | 'close' | 'menu' | 'map';

const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly mapCamera: THREE.OrthographicCamera;
  mode: CameraMode = 'follow';
  private readonly target = new THREE.Vector3();
  private readonly focus = new THREE.Vector3();
  private readonly lead = new THREE.Vector3();
  private readonly closeTarget = new THREE.Vector3();
  private zoom = CAMERA.distance;
  private dist = CAMERA.distance;
  private pitch = (CAMERA.pitchDeg * Math.PI) / 180;
  private yaw = 0;
  private menuTime = 0;
  private bounds = { minX: 0, maxX: 20, minZ: 0, maxZ: 20 };
  private walk: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;
  private aspect = 16 / 9;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, this.aspect, CAMERA.near, 260);
    this.mapCamera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.5, 200);
    // full-detail static geometry lives on its own layer (the reflection and shadows use stand-ins)
    setCameraLayers(this.camera, LAYER.MAIN);
    setCameraLayers(this.mapCamera, LAYER.MAIN);
  }

  /** The camera the renderer should use for the current mode. */
  get active(): THREE.Camera {
    return this.mode === 'map' ? this.mapCamera : this.camera;
  }

  /** `b`: the whole map (map view, menu drift); `walk`: the walkable area (follow clamp). */
  setLevelBounds(b: { minX: number; maxX: number; minZ: number; maxZ: number }, walk?: { minX: number; maxX: number; minZ: number; maxZ: number }): void {
    this.bounds = { ...b };
    this.walk = walk ? { ...walk } : null;
    this.fitMap();
  }

  /** Keeps the follow target inside the walkable area (soft: only near the edges). */
  private clampFocus(): void {
    const w = this.walk;
    if (!w) return;
    const minX = w.minX + CAMERA.edgeSide;
    const maxX = w.maxX - CAMERA.edgeSide;
    if (minX < maxX) this.focus.x = THREE.MathUtils.clamp(this.focus.x, minX, maxX);
    else this.focus.x = (w.minX + w.maxX) / 2;
    this.focus.z = Math.min(this.focus.z, Math.max(w.minZ, w.maxZ - CAMERA.edgeSouth));
  }

  setAspect(aspect: number): void {
    this.aspect = aspect;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.fitMap();
  }

  /** Wheel zoom steps (+ = out). */
  addZoom(steps: number): void {
    this.zoom = THREE.MathUtils.clamp(this.zoom + steps * CAMERA.zoomStep, CAMERA.minDistance, CAMERA.maxDistance);
  }

  /** Where to look in `close` mode (e.g. between the robot and the terminal). */
  setCloseTarget(x: number, y: number, z: number): void {
    this.closeTarget.set(x, y, z);
  }

  /** Jump to the target without easing (level start, teleport). */
  snap(x: number, z: number): void {
    this.focus.set(x, CAMERA.targetY, z);
    if (this.mode === 'follow') this.clampFocus();
    this.target.copy(this.focus);
    this.lead.set(0, 0, 0);
    this.dist = this.mode === 'close' ? CAMERA.closeDistance : this.zoom;
    this.apply();
  }

  update(dt: number, player: { x: number; z: number; vx: number; vz: number }): void {
    if (this.mode === 'map') return;
    let wantDist = this.zoom;
    let wantPitch = (CAMERA.pitchDeg * Math.PI) / 180;
    let wantYaw = 0;
    if (this.mode === 'menu') {
      this.menuTime += dt;
      const b = this.bounds;
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      const span = Math.max(4, (b.maxX - b.minX) * 0.32);
      this.focus.set(cx + Math.sin(this.menuTime * 0.06) * span, CAMERA.targetY, cz + Math.sin(this.menuTime * 0.043) * 2);
      wantDist = 25;
      wantPitch = (46 * Math.PI) / 180;
      wantYaw = Math.sin(this.menuTime * 0.05) * 0.12;
    } else if (this.mode === 'close') {
      this.focus.copy(this.closeTarget);
      wantDist = CAMERA.closeDistance;
      wantPitch = (44 * Math.PI) / 180;
    } else {
      const k = damp(3, dt);
      this.lead.x += (player.vx * CAMERA.lookAhead - this.lead.x) * k;
      this.lead.z += (player.vz * CAMERA.lookAhead - this.lead.z) * k;
      this.focus.set(player.x + this.lead.x, CAMERA.targetY, player.z + this.lead.z);
      this.clampFocus();
    }
    const kf = damp(this.mode === 'menu' ? 1.2 : CAMERA.follow, dt);
    this.target.lerp(this.focus, kf);
    const kz = damp(3.5, dt);
    this.dist += (wantDist - this.dist) * kz;
    this.pitch += (wantPitch - this.pitch) * kz;
    this.yaw += (wantYaw - this.yaw) * damp(1.5, dt);
    this.apply();
  }

  private apply(): void {
    const c = this.camera;
    const horiz = Math.cos(this.pitch) * this.dist;
    c.position.set(
      this.target.x + Math.sin(this.yaw) * horiz,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z + Math.cos(this.yaw) * horiz,
    );
    c.lookAt(this.target);
    c.updateMatrixWorld();
  }

  /** Camera look-at point (for audio listeners, rain volume…). */
  get lookAt(): THREE.Vector3 {
    return this.target;
  }

  private fitMap(): void {
    const b = this.bounds;
    const margin = 3;
    const w = b.maxX - b.minX + margin * 2;
    const h = b.maxZ - b.minZ + margin * 2;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const halfH = Math.max(h, w / this.aspect) / 2;
    const halfW = halfH * this.aspect;
    const m = this.mapCamera;
    m.left = -halfW;
    m.right = halfW;
    m.top = halfH;
    m.bottom = -halfH;
    m.near = 0.5;
    m.far = 200;
    m.position.set(cx, 80, cz);
    m.up.set(0, 0, -1);
    m.lookAt(cx, 0, cz);
    m.updateProjectionMatrix();
    m.updateMatrixWorld();
  }
}
