/**
 * Procedural placeholder assets: every asset id of the contract (design doc §7) has a stand-in of
 * plausible size, shape and material, with the same node names the game animates. They use the named
 * materials of the contract, so the material pipeline is exercised exactly as with real GLBs.
 * Real assets from `public/assets/models/*.glb` replace them automatically when present.
 */
import * as THREE from 'three/webgpu';
import { propInfo } from '../world/propCatalog';
import type { MaterialLibrary } from './materials';

type V3 = readonly [number, number, number];

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = make()));
  return g;
}

class Kit {
  constructor(private readonly lib: MaterialLibrary) {}

  group(name: string, parent?: THREE.Object3D, pos: V3 = [0, 0, 0]): THREE.Group {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(...pos);
    parent?.add(g);
    return g;
  }

  mesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: string, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], name = ''): THREE.Mesh {
    const m = new THREE.Mesh(geo, this.lib.get(mat));
    m.userData.matName = mat;
    m.name = name;
    m.position.set(...pos);
    m.rotation.set(...rot);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  box(parent: THREE.Object3D, mat: string, size: V3, pos: V3, rot: V3 = [0, 0, 0], name = ''): THREE.Mesh {
    const geo = cached(`b${size.join(',')}`, () => new THREE.BoxGeometry(...size));
    return this.mesh(parent, geo, mat, pos, rot, name);
  }

  /** Cylinder along `axis`. */
  cyl(parent: THREE.Object3D, mat: string, r: number, h: number, pos: V3, axis: 'x' | 'y' | 'z' = 'y', seg = 14, name = '', r2 = r): THREE.Mesh {
    const geo = cached(`c${r},${r2},${h},${seg}`, () => new THREE.CylinderGeometry(r2, r, h, seg));
    const rot: V3 = axis === 'x' ? [0, 0, Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, 0];
    return this.mesh(parent, geo, mat, pos, rot, name);
  }

  sphere(parent: THREE.Object3D, mat: string, r: number, pos: V3, scale: V3 = [1, 1, 1]): THREE.Mesh {
    const geo = cached(`s${r}`, () => new THREE.SphereGeometry(r, 14, 10));
    const m = this.mesh(parent, geo, mat, pos);
    m.scale.set(...scale);
    return m;
  }

  /** Flat quad facing +Z; UV like the GLB screens (u → right, v → down, v = 0 at the top). */
  plane(parent: THREE.Object3D, mat: string, w: number, h: number, pos: V3, rot: V3 = [0, 0, 0], name = ''): THREE.Mesh {
    const geo = cached(`p${w},${h}`, () => {
      const g = new THREE.PlaneGeometry(w, h);
      const uv = g.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
      return g;
    });
    const m = this.mesh(parent, geo, mat, pos, rot, name);
    m.castShadow = false;
    return m;
  }
}

/** Belt around a stadium loop in the YZ plane: UV.x runs along the loop, UV.y across. */
function trackGeometry(length: number, radius: number, width: number): THREE.BufferGeometry {
  const straight = length - radius * 2;
  const pts: { y: number; z: number; ny: number; nz: number }[] = [];
  const seg = 10;
  // bottom straight (front → back), back arc, top straight, front arc
  const half = straight / 2;
  const addArc = (cz: number, a0: number, a1: number) => {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + ((a1 - a0) * i) / seg;
      pts.push({ y: Math.sin(a) * radius, z: cz + Math.cos(a) * radius, ny: Math.sin(a), nz: Math.cos(a) });
    }
  };
  pts.push({ y: -radius, z: half, ny: -1, nz: 0 });
  pts.push({ y: -radius, z: -half, ny: -1, nz: 0 });
  addArc(-half, -Math.PI / 2, -Math.PI * 1.5);
  pts.push({ y: radius, z: half, ny: 1, nz: 0 });
  addArc(half, Math.PI / 2, -Math.PI / 2);
  const total = pts.reduce((acc, p, i) => (i === 0 ? 0 : acc + Math.hypot(p.y - pts[i - 1].y, p.z - pts[i - 1].z)), 0);
  const pos: number[] = [];
  const nor: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  let s = 0;
  pts.forEach((p, i) => {
    if (i > 0) s += Math.hypot(p.y - pts[i - 1].y, p.z - pts[i - 1].z);
    const u = s / total;
    pos.push(-width / 2, p.y, p.z, width / 2, p.y, p.z);
    nor.push(0, p.ny, p.nz, 0, p.ny, p.nz);
    uvs.push(u, 0, u, 1);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  // winding check: make faces point outward
  g.computeBoundingSphere();
  return g;
}

export class Placeholders {
  private readonly k: Kit;

  constructor(lib: MaterialLibrary) {
    this.k = new Kit(lib);
  }

  /** A fresh placeholder object for an asset id. */
  build(id: string): THREE.Object3D {
    const root = new THREE.Group();
    root.name = id;
    root.userData.placeholder = true;
    const make = (this as unknown as Record<string, ((r: THREE.Group) => void) | undefined>)[`_${id}`];
    if (typeof make === 'function') make.call(this, root);
    else this.genericProp(root, id);
    return root;
  }

  // ───────────── hero ─────────────

  _Harni(root: THREE.Group): void {
    const k = this.k;
    const chassis = k.group('Chassis', root);
    k.box(chassis, 'M_MetalDark', [0.42, 0.16, 0.66], [0, 0.22, 0]);
    const track = cached('track', () => trackGeometry(0.95, 0.165, 0.2));
    for (const [side, x] of [
      ['L', -0.32],
      ['R', 0.32],
    ] as const) {
      const t = k.mesh(chassis, track, 'M_Track', [x, 0.17, 0], [0, 0, 0], `Track${side}`);
      t.castShadow = true;
      k.box(t, 'M_HarniShellDark', [0.02, 0.2, 0.62], [x < 0 ? 0.11 : -0.11, 0, 0]);
      for (let i = 1; i <= 3; i++) {
        const w = k.group(`Wheel${side}${i}`, chassis, [x + (x < 0 ? -0.105 : 0.105), 0.17, (i - 2) * 0.3]);
        k.cyl(w, 'M_MetalSteel', 0.075, 0.03, [0, 0, 0], 'x', 12);
        k.box(w, 'M_MetalDark', [0.035, 0.12, 0.025], [0, 0, 0]);
      }
    }
    const body = k.group('Body', root, [0, 0.38, 0]);
    k.box(body, 'M_HarniShell', [0.56, 0.34, 0.62], [0, 0.17, 0]);
    k.box(body, 'M_HarniShellDark', [0.6, 0.05, 0.66], [0, 0.0, 0]);
    k.box(body, 'M_HarniCream', [0.42, 0.18, 0.02], [0, 0.18, 0.315]);
    k.box(body, 'M_HarniScreen', [0.16, 0.07, 0.02], [0, 0.2, 0.327]);
    k.box(body, 'M_MetalDark', [0.02, 0.12, 0.3], [0.285, 0.18, -0.08]);
    k.box(body, 'M_MetalDark', [0.02, 0.12, 0.3], [-0.285, 0.18, -0.08]);
    k.box(body, 'M_HarniShellDark', [0.3, 0.06, 0.2], [0, 0.35, -0.12]);
    for (const [side, x] of [
      ['L', -0.31],
      ['R', 0.31],
    ] as const) {
      const arm = k.group(`Arm${side}`, body, [x, 0.24, 0.08]);
      k.sphere(arm, 'M_MetalDark', 0.05, [0, 0, 0]);
      k.box(arm, 'M_HarniShellDark', [0.07, 0.07, 0.22], [0, -0.03, 0.1], [0.35, 0, 0]);
      const hand = k.group(`Hand${side}`, arm, [0, -0.08, 0.21]);
      k.box(hand, 'M_MetalSteel', [0.02, 0.025, 0.08], [-0.025, 0, 0.03]);
      k.box(hand, 'M_MetalSteel', [0.02, 0.025, 0.08], [0.025, 0, 0.03]);
    }
    const antenna = k.group('Antenna', body, [0.17, 0.36, -0.2]);
    k.cyl(antenna, 'M_MetalDark', 0.012, 0.34, [0, 0.17, 0], 'y', 6);
    k.sphere(antenna, 'M_NeonOrange', 0.032, [0, 0.35, 0]);
    const neck = k.group('Neck', body, [0, 0.34, 0.06]);
    k.cyl(neck, 'M_MetalDark', 0.04, 0.18, [0, 0.09, 0], 'y', 10);
    const head = k.group('Head', neck, [0, 0.18, 0]);
    k.box(head, 'M_HarniShell', [0.2, 0.09, 0.12], [0, 0.07, -0.01]);
    for (const [side, x] of [
      ['L', -0.135],
      ['R', 0.135],
    ] as const) {
      const eye = k.group(`Eye${side}`, head, [x, 0.08, 0.02]);
      k.cyl(eye, 'M_HarniShell', 0.088, 0.2, [0, 0, 0], 'z', 18);
      k.cyl(eye, 'M_HarniShellDark', 0.094, 0.04, [0, 0, 0.09], 'z', 18);
      k.cyl(eye, 'M_Glass', 0.07, 0.02, [0, 0, 0.105], 'z', 18);
      k.cyl(eye, 'M_EyeGlow', 0.046, 0.02, [0, 0, 0.112], 'z', 16);
    }
  }

  // ───────────── residents ─────────────

  private face(parent: THREE.Object3D, w: number, h: number, pos: V3, rot: V3 = [0, 0, 0]): void {
    this.k.plane(parent, 'M_NpcFace', w, h, pos, rot, 'Face');
  }

  _npc_tall(root: THREE.Group): void {
    const k = this.k;
    const body = k.group('Body', root);
    k.cyl(body, 'M_MetalDark', 0.04, 0.8, [-0.1, 0.4, 0], 'y', 8);
    k.cyl(body, 'M_MetalDark', 0.04, 0.8, [0.1, 0.4, 0], 'y', 8);
    k.box(body, 'M_Rubber', [0.12, 0.06, 0.2], [-0.1, 0.03, 0.04]);
    k.box(body, 'M_Rubber', [0.12, 0.06, 0.2], [0.1, 0.03, 0.04]);
    k.box(body, 'M_NpcPaint', [0.34, 0.5, 0.22], [0, 1.02, 0]);
    k.cyl(body, 'M_TarpOrange', 0.36, 0.48, [0, 1.02, 0], 'y', 10, '', 0.12);
    k.cyl(body, 'M_NpcPaint', 0.03, 0.55, [-0.27, 0.95, 0], 'y', 6);
    k.cyl(body, 'M_NpcPaint', 0.03, 0.55, [0.27, 0.95, 0], 'y', 6);
    k.cyl(body, 'M_MetalDark', 0.035, 0.12, [0, 1.32, 0], 'y', 8);
    const head = k.group('Head', body, [0, 1.36, 0]);
    k.box(head, 'M_PlasticLight', [0.44, 0.32, 0.3], [0, 0.17, 0]);
    k.box(head, 'M_PlasticDark', [0.38, 0.27, 0.02], [0, 0.17, 0.15]);
    this.face(head, 0.34, 0.24, [0, 0.17, 0.162]);
    k.cyl(head, 'M_MetalDark', 0.01, 0.2, [0.15, 0.42, 0], 'y', 5);
  }

  _npc_round(root: THREE.Group): void {
    const k = this.k;
    const body = k.group('Body', root);
    k.box(body, 'M_Rubber', [0.7, 0.14, 0.6], [0, 0.07, 0]);
    k.cyl(body, 'M_NpcPaint', 0.4, 0.62, [0, 0.45, 0], 'y', 16);
    k.cyl(body, 'M_MetalDark', 0.41, 0.05, [0, 0.3, 0], 'y', 16);
    k.cyl(body, 'M_MetalDark', 0.41, 0.05, [0, 0.62, 0], 'y', 16);
    k.box(body, 'M_TarpGreen', [0.5, 0.25, 0.08], [0, 0.42, 0.38]);
    const head = k.group('Head', body, [0, 0.76, 0]);
    k.cyl(head, 'M_PlasticLight', 0.3, 0.26, [0, 0.13, 0], 'y', 14);
    this.face(head, 0.3, 0.17, [0, 0.13, 0.302]);
    k.cyl(head, 'M_TarpGreen', 0.36, 0.08, [0, 0.29, 0], 'y', 14);
    k.cyl(head, 'M_TarpGreen', 0.2, 0.14, [0, 0.38, 0], 'y', 12, '', 0.16);
  }

  _npc_drone(root: THREE.Group): void {
    const k = this.k;
    const body = k.group('Body', root, [0, 1.3, 0]);
    k.sphere(body, 'M_NpcPaint', 0.24, [0, 0, 0], [1, 0.85, 1]);
    k.box(body, 'M_MetalDark', [0.9, 0.04, 0.06], [0, 0.12, 0]);
    k.box(body, 'M_MetalDark', [0.06, 0.04, 0.9], [0, 0.12, 0]);
    for (const [x, z] of [
      [0.45, 0],
      [-0.45, 0],
      [0, 0.45],
      [0, -0.45],
    ]) k.cyl(body, 'M_PlasticDark', 0.13, 0.02, [x, 0.15, z], 'y', 12);
    k.box(body, 'M_MetalYellow', [0.08, 0.14, 0.08], [0, -0.24, 0]);
    const head = k.group('Head', body, [0, 0, 0]);
    k.box(head, 'M_PlasticDark', [0.3, 0.2, 0.06], [0, 0.0, 0.2]);
    this.face(head, 0.26, 0.16, [0, 0.0, 0.232]);
  }

  // ───────────── interactables ─────────────

  _terminal(root: THREE.Group): void {
    const k = this.k;
    k.box(root, 'M_MetalDark', [0.46, 0.74, 0.36], [0, 0.37, -0.04]);
    k.box(root, 'M_MetalYellow', [0.48, 0.05, 0.38], [0, 0.1, -0.04]);
    k.box(root, 'M_PlasticDark', [0.8, 0.06, 0.56], [0, 0.77, 0]);
    k.box(root, 'M_PlasticLight', [0.52, 0.03, 0.18], [0, 0.815, 0.17], [0.12, 0, 0]);
    const monitor = k.group('Monitor', root, [0, 1.12, -0.05]);
    monitor.rotation.x = -0.2;
    k.box(monitor, 'M_PlasticLight', [0.64, 0.5, 0.44], [0, 0, -0.02]);
    k.box(monitor, 'M_PlasticDark', [0.56, 0.42, 0.02], [0, 0.01, 0.2]);
    k.plane(monitor, 'M_TerminalScreen', 0.48, 0.35, [0, 0.01, 0.213], [0, 0, 0], 'Screen');
    k.cyl(root, 'M_Cable', 0.025, 1.0, [0.18, 0.5, -0.26], 'y', 6);
    k.cyl(root, 'M_Cable', 0.02, 0.9, [-0.12, 0.45, -0.27], 'y', 6);
  }

  _gate(root: THREE.Group): void {
    const k = this.k;
    const frame = k.group('GateFrame', root);
    for (const x of [-2.18, 2.18]) {
      k.box(frame, 'M_MetalDark', [0.36, 3.7, 0.6], [x, 1.85, 0]);
      for (let i = 0; i < 6; i++) k.box(frame, i % 2 ? 'M_MetalYellow' : 'M_MetalDark', [0.38, 0.25, 0.62], [x, 0.3 + i * 0.5, 0]);
    }
    k.box(frame, 'M_MetalDark', [4.8, 0.45, 0.62], [0, 3.45, 0]);
    k.box(frame, 'M_MetalYellow', [4.0, 0.12, 0.64], [0, 3.28, 0]);
    k.box(frame, 'M_GateLight', [0.6, 0.18, 0.2], [0, 3.78, 0.12], [0, 0, 0], 'Lamp');
    for (const [name, x] of [
      ['DoorL', -1],
      ['DoorR', 1],
    ] as const) {
      const door = k.group(name, root, [x, 0, 0]);
      k.box(door, 'M_MetalGalv', [1.98, 3.2, 0.12], [0, 1.6, 0]);
      for (let i = 0; i < 5; i++) k.box(door, 'M_MetalSteel', [1.9, 0.08, 0.16], [0, 0.4 + i * 0.62, 0]);
      k.box(door, 'M_MetalYellow', [1.98, 0.3, 0.14], [0, 0.2, 0]);
      k.box(door, 'M_MetalDark', [0.08, 3.2, 0.15], [x < 0 ? 0.95 : -0.95, 1.6, 0]);
    }
  }

  _chip(root: THREE.Group): void {
    const k = this.k;
    k.box(root, 'M_PlasticDark', [0.3, 0.2, 0.04], [0, 0, 0]);
    k.box(root, 'M_MetalYellow', [0.22, 0.04, 0.042], [0, -0.07, 0]);
    k.box(root, 'M_ChipGlow', [0.2, 0.05, 0.046], [0, 0.03, 0]);
    k.box(root, 'M_ChipGlow', [0.05, 0.05, 0.046], [-0.09, -0.02, 0]);
  }

  // ───────────── facades (2 × 3 m, origin bottom centre on the wall plane) ─────────────

  private wall(root: THREE.Group, ground: boolean): void {
    const k = this.k;
    k.box(root, 'M_Wall', [2, 3, 0.25], [0, 1.5, -0.125]);
    if (ground) k.box(root, 'M_ConcreteDark', [2, 0.35, 0.06], [0, 0.175, 0.03]);
    k.box(root, 'M_Concrete', [2, 0.12, 0.12], [0, 2.94, 0.06]);
  }

  private window(root: THREE.Group, mat: string, w: number, h: number, y: number): void {
    const k = this.k;
    k.box(root, mat, [w, h, 0.03], [0, y, -0.02]);
    k.box(root, 'M_MetalDark', [w + 0.12, 0.06, 0.08], [0, y + h / 2 + 0.03, 0.02]);
    k.box(root, 'M_MetalDark', [0.06, h, 0.08], [-w / 2 - 0.03, y, 0.02]);
    k.box(root, 'M_MetalDark', [0.06, h, 0.08], [w / 2 + 0.03, y, 0.02]);
    k.box(root, 'M_MetalDark', [0.04, h, 0.04], [0, y, 0.0]);
    k.box(root, 'M_Concrete', [w + 0.22, 0.08, 0.16], [0, y - h / 2 - 0.04, 0.06]);
  }

  _fac_g_plain(root: THREE.Group): void {
    this.wall(root, true);
  }

  _fac_g_door(root: THREE.Group): void {
    const k = this.k;
    this.wall(root, true);
    k.box(root, 'M_MetalRust', [0.95, 2.1, 0.05], [0, 1.05, 0.0]);
    k.box(root, 'M_MetalDark', [1.1, 0.08, 0.1], [0, 2.14, 0.03]);
    k.box(root, 'M_MetalDark', [0.08, 2.1, 0.1], [-0.51, 1.05, 0.03]);
    k.box(root, 'M_MetalDark', [0.08, 2.1, 0.1], [0.51, 1.05, 0.03]);
    k.box(root, 'M_ConcreteDark', [1.2, 0.12, 0.3], [0, 0.06, 0.15]);
    k.box(root, 'M_MetalSteel', [0.04, 0.2, 0.04], [0.32, 1.0, 0.04]);
  }

  _fac_g_shutter(root: THREE.Group): void {
    const k = this.k;
    this.wall(root, true);
    k.box(root, 'M_MetalGalv', [1.7, 2.25, 0.04], [0, 1.15, 0.01]);
    for (let i = 0; i < 9; i++) k.box(root, 'M_MetalSteel', [1.7, 0.03, 0.05], [0, 0.15 + i * 0.25, 0.02]);
    k.box(root, 'M_MetalDark', [1.85, 0.3, 0.26], [0, 2.42, 0.13]);
  }

  _fac_g_window(root: THREE.Group): void {
    const k = this.k;
    this.wall(root, true);
    this.window(root, 'M_Glass', 1.5, 1.35, 1.35);
    k.box(root, 'M_WindowLit', [1.4, 0.08, 0.02], [0, 0.72, -0.01]);
    k.box(root, 'M_TarpBlue', [1.8, 0.06, 0.5], [0, 2.35, 0.25], [0.35, 0, 0]);
  }

  _fac_g_vent(root: THREE.Group): void {
    const k = this.k;
    this.wall(root, true);
    k.box(root, 'M_MetalDark', [1.0, 0.65, 0.05], [0.2, 1.7, 0.02]);
    for (let i = 0; i < 6; i++) k.box(root, 'M_MetalSteel', [0.95, 0.03, 0.06], [0.2, 1.45 + i * 0.1, 0.03]);
  }

  _fac_u_plain(root: THREE.Group): void {
    this.wall(root, false);
  }

  _fac_u_window(root: THREE.Group): void {
    this.wall(root, false);
    this.window(root, 'M_Glass', 0.9, 1.3, 1.55);
  }

  _fac_u_window_lit(root: THREE.Group): void {
    this.wall(root, false);
    this.window(root, 'M_WindowLit', 0.9, 1.3, 1.55);
  }

  _fac_u_balcony(root: THREE.Group): void {
    const k = this.k;
    this.wall(root, false);
    this.window(root, 'M_Glass', 0.85, 1.9, 1.15);
    k.box(root, 'M_Concrete', [1.7, 0.12, 0.3], [0, 0.06, 0.15]);
    k.box(root, 'M_MetalDark', [1.7, 0.05, 0.04], [0, 0.95, 0.28]);
    for (let i = 0; i < 9; i++) k.box(root, 'M_MetalDark', [0.025, 0.85, 0.025], [-0.8 + i * 0.2, 0.55, 0.28]);
  }

  _fac_u_ac(root: THREE.Group): void {
    const k = this.k;
    this.wall(root, false);
    this.window(root, 'M_Glass', 0.8, 1.2, 1.6);
    k.box(root, 'M_PlasticLight', [0.6, 0.42, 0.28], [0.55, 0.65, 0.14]);
    k.cyl(root, 'M_MetalDark', 0.15, 0.02, [0.55, 0.65, 0.285], 'z', 14);
  }

  _fac_u_pipes(root: THREE.Group): void {
    const k = this.k;
    this.wall(root, false);
    k.cyl(root, 'M_MetalRust', 0.07, 3, [-0.55, 1.5, 0.1], 'y', 10);
    k.cyl(root, 'M_MetalGalv', 0.05, 3, [-0.35, 1.5, 0.08], 'y', 10);
    for (const y of [0.5, 1.5, 2.5]) k.box(root, 'M_MetalDark', [0.4, 0.05, 0.16], [-0.45, y, 0.08]);
  }

  _fac_corner(root: THREE.Group): void {
    this.k.box(root, 'M_ConcreteDark', [0.3, 3, 0.3], [0, 1.5, 0]);
  }

  _roof_cap(root: THREE.Group): void {
    this.k.box(root, 'M_RoofTar', [2, 0.15, 2], [0, 0.075, 0]);
  }

  _roof_parapet(root: THREE.Group): void {
    this.k.box(root, 'M_Concrete', [2, 0.4, 0.2], [0, 0.2, -0.1]);
    this.k.box(root, 'M_ConcreteDark', [2, 0.05, 0.25], [0, 0.42, -0.1]);
  }

  _low_barrier(root: THREE.Group): void {
    const k = this.k;
    k.box(root, 'M_ConcreteDark', [1.95, 0.15, 1.95], [0, 0.075, 0]);
    for (const z of [-0.45, 0.45]) {
      k.box(root, 'M_Concrete', [1.9, 1.05, 0.55], [0, 0.66, z]);
      k.box(root, 'M_MetalYellow', [1.9, 0.12, 0.57], [0, 0.95, z]);
    }
  }

  _low_planter(root: THREE.Group): void {
    const k = this.k;
    k.box(root, 'M_ConcreteDark', [1.9, 0.85, 1.9], [0, 0.425, 0]);
    k.box(root, 'M_Trash', [1.7, 0.04, 1.7], [0, 0.86, 0]);
    k.sphere(root, 'M_Plant', 0.45, [-0.4, 1.05, -0.3], [1, 0.8, 1]);
    k.sphere(root, 'M_PlantDark', 0.4, [0.45, 1.0, 0.35], [1, 0.8, 1]);
    k.sphere(root, 'M_Plant', 0.3, [0.35, 1.0, -0.45]);
  }

  _low_crates(root: THREE.Group): void {
    const k = this.k;
    for (const [x, z] of [
      [-0.48, -0.48],
      [0.48, -0.48],
      [-0.48, 0.48],
      [0.48, 0.48],
    ]) k.box(root, 'M_Wood', [0.9, 0.7, 0.9], [x, 0.35, z]);
    k.box(root, 'M_Wood', [0.85, 0.55, 0.85], [-0.4, 0.98, 0.1]);
    k.box(root, 'M_TarpBlue', [1.0, 0.06, 1.95], [0.48, 0.73, 0]);
  }

  _railing(root: THREE.Group): void {
    const k = this.k;
    for (const x of [-0.95, 0, 0.95]) k.cyl(root, 'M_MetalGalv', 0.03, 1.0, [x, 0.5, 0], 'y', 6);
    k.box(root, 'M_MetalYellow', [2, 0.05, 0.06], [0, 1.0, 0]);
    k.box(root, 'M_MetalGalv', [2, 0.03, 0.03], [0, 0.55, 0]);
  }

  // ───────────── props ─────────────

  _barrel(root: THREE.Group): void {
    const k = this.k;
    k.cyl(root, 'M_MetalRust', 0.3, 0.9, [0, 0.45, 0], 'y', 16);
    k.cyl(root, 'M_MetalTeal', 0.31, 0.06, [0, 0.25, 0], 'y', 16);
    k.cyl(root, 'M_MetalTeal', 0.31, 0.06, [0, 0.68, 0], 'y', 16);
  }

  _crate(root: THREE.Group, size = 0.8, pos: V3 = [0, 0, 0]): void {
    const k = this.k;
    k.box(root, 'M_Wood', [size, size, size], [pos[0], pos[1] + size / 2, pos[2]]);
    k.box(root, 'M_MetalDark', [size + 0.02, 0.05, size + 0.02], [pos[0], pos[1] + size * 0.15, pos[2]]);
    k.box(root, 'M_MetalDark', [size + 0.02, 0.05, size + 0.02], [pos[0], pos[1] + size * 0.85, pos[2]]);
  }

  _crate_stack(root: THREE.Group): void {
    this._crate(root, 0.7, [-0.35, 0, 0]);
    this._crate(root, 0.7, [0.37, 0, 0.1]);
    this._crate(root, 0.65, [-0.1, 0.7, 0.05]);
    this.k.box(root, 'M_TarpGreen', [0.75, 0.04, 0.8], [-0.1, 1.37, 0.05]);
  }

  _trash_bags(root: THREE.Group): void {
    const k = this.k;
    k.sphere(root, 'M_Trash', 0.3, [-0.2, 0.25, 0], [1, 0.85, 1]);
    k.sphere(root, 'M_Trash', 0.27, [0.25, 0.22, 0.1], [1, 0.8, 1]);
    k.sphere(root, 'M_Trash', 0.24, [0.05, 0.45, -0.05], [1, 0.8, 1]);
  }

  _dumpster(root: THREE.Group): void {
    const k = this.k;
    k.box(root, 'M_MetalTeal', [1.8, 1.1, 1.0], [0, 0.65, 0]);
    k.box(root, 'M_MetalDark', [1.85, 0.08, 1.05], [0, 1.24, -0.02], [-0.08, 0, 0]);
    for (const x of [-0.75, 0.75]) k.cyl(root, 'M_Rubber', 0.08, 0.08, [x, 0.08, 0.35], 'x', 10);
  }

  _vending(root: THREE.Group): void {
    const k = this.k;
    k.box(root, 'M_MetalRed', [0.9, 1.9, 0.7], [0, 0.95, 0]);
    k.box(root, 'M_ScreenGlow', [0.58, 1.05, 0.02], [-0.08, 1.15, 0.351]);
    k.box(root, 'M_PlasticDark', [0.18, 0.5, 0.03], [0.32, 1.2, 0.352]);
    k.box(root, 'M_PlasticDark', [0.6, 0.18, 0.03], [-0.08, 0.35, 0.352]);
  }

  _streetlamp(root: THREE.Group): void {
    const k = this.k;
    k.cyl(root, 'M_MetalDark', 0.12, 0.25, [0, 0.12, 0], 'y', 10);
    k.cyl(root, 'M_MetalDark', 0.05, 3.1, [0, 1.55, 0], 'y', 8);
    k.box(root, 'M_MetalDark', [0.06, 0.06, 0.5], [0, 3.1, 0.22]);
    k.box(root, 'M_MetalDark', [0.26, 0.1, 0.3], [0, 3.05, 0.45]);
    k.box(root, 'M_LampWarm', [0.2, 0.04, 0.24], [0, 2.99, 0.45]);
  }

  _bench(root: THREE.Group): void {
    const k = this.k;
    k.box(root, 'M_Wood', [1.6, 0.06, 0.45], [0, 0.45, 0]);
    k.box(root, 'M_Wood', [1.6, 0.35, 0.05], [0, 0.72, -0.2], [-0.15, 0, 0]);
    for (const x of [-0.7, 0.7]) k.box(root, 'M_MetalDark', [0.06, 0.45, 0.45], [x, 0.22, 0]);
  }

  _stall(root: THREE.Group): void {
    const k = this.k;
    k.box(root, 'M_Wood', [2.0, 0.9, 0.85], [0, 0.45, 0]);
    k.box(root, 'M_TarpOrange', [2.2, 0.06, 1.3], [0, 2.2, 0.1], [0.18, 0, 0]);
    for (const x of [-0.95, 0.95]) k.cyl(root, 'M_MetalDark', 0.03, 2.2, [x, 1.1, -0.35], 'y', 6);
    k.box(root, 'M_PlasticLight', [0.4, 0.25, 0.3], [-0.5, 1.03, 0]);
    k.box(root, 'M_TarpGreen', [0.5, 0.2, 0.35], [0.4, 1.0, 0.05]);
    k.sphere(root, 'M_LanternGlow', 0.08, [0, 1.95, 0.4]);
  }

  _crt_stack(root: THREE.Group): void {
    const k = this.k;
    const tv = (x: number, y: number, s: number) => {
      k.box(root, 'M_PlasticLight', [s, s * 0.8, s * 0.8], [x, y + s * 0.4, 0]);
      k.box(root, 'M_ScreenGlow', [s * 0.75, s * 0.55, 0.02], [x, y + s * 0.42, s * 0.4 + 0.01]);
    };
    tv(-0.3, 0, 0.6);
    tv(0.33, 0, 0.55);
    tv(0, 0.48, 0.5);
  }

  _plant_pot(root: THREE.Group): void {
    const k = this.k;
    k.cyl(root, 'M_ConcreteDark', 0.28, 0.45, [0, 0.225, 0], 'y', 12, '', 0.3);
    k.sphere(root, 'M_Plant', 0.3, [0, 0.62, 0], [1, 1.1, 1]);
  }

  _cable_spool(root: THREE.Group): void {
    const k = this.k;
    k.cyl(root, 'M_Wood', 0.45, 0.06, [-0.25, 0.45, 0], 'x', 16);
    k.cyl(root, 'M_Wood', 0.45, 0.06, [0.25, 0.45, 0], 'x', 16);
    k.cyl(root, 'M_Cable', 0.32, 0.44, [0, 0.45, 0], 'x', 16);
  }

  _tires(root: THREE.Group): void {
    const k = this.k;
    const torus = cached('torus', () => new THREE.TorusGeometry(0.32, 0.12, 8, 16));
    for (let i = 0; i < 3; i++) k.mesh(root, torus, 'M_Rubber', [i === 2 ? 0.05 : 0, 0.12 + i * 0.2, 0], [Math.PI / 2, 0, 0]);
  }

  _steam_vent(root: THREE.Group): void {
    const k = this.k;
    k.box(root, 'M_MetalDark', [0.8, 0.12, 0.8], [0, 0.06, 0]);
    for (let i = 0; i < 5; i++) k.box(root, 'M_MetalSteel', [0.7, 0.03, 0.06], [0, 0.13, -0.28 + i * 0.14]);
  }

  _manhole(root: THREE.Group): void {
    this.k.cyl(root, 'M_MetalDark', 0.45, 0.04, [0, 0.02, 0], 'y', 20);
  }

  _ac_unit(root: THREE.Group): void {
    const k = this.k;
    k.box(root, 'M_PlasticLight', [0.9, 0.6, 0.45], [0, 0, 0.23]);
    k.cyl(root, 'M_MetalDark', 0.22, 0.03, [-0.15, 0, 0.46], 'z', 16);
    k.box(root, 'M_MetalDark', [0.9, 0.04, 0.5], [0, -0.33, 0.25]);
  }

  _pipe_v(root: THREE.Group): void {
    const k = this.k;
    k.cyl(root, 'M_MetalRust', 0.09, 3, [0, 1.5, 0.12], 'y', 10);
    for (const y of [0.4, 1.5, 2.6]) k.box(root, 'M_MetalDark', [0.24, 0.05, 0.14], [0, y, 0.07]);
  }

  _pipe_h(root: THREE.Group): void {
    const k = this.k;
    k.cyl(root, 'M_MetalRust', 0.09, 2, [0, 0, 0.12], 'x', 10);
    for (const x of [-0.8, 0.8]) k.box(root, 'M_MetalDark', [0.05, 0.24, 0.14], [x, 0, 0.07]);
  }

  _awning(root: THREE.Group): void {
    const k = this.k;
    k.box(root, 'M_TarpBlue', [2, 0.05, 1.05], [0, -0.2, 0.48], [0.38, 0, 0]);
    k.box(root, 'M_MetalDark', [2, 0.06, 0.06], [0, 0, 0.03]);
  }

  _wall_lamp(root: THREE.Group): void {
    const k = this.k;
    k.box(root, 'M_MetalDark', [0.16, 0.2, 0.06], [0, 0, 0.03]);
    k.box(root, 'M_MetalDark', [0.04, 0.04, 0.3], [0, 0.05, 0.18]);
    k.box(root, 'M_MetalDark', [0.24, 0.08, 0.2], [0, 0.04, 0.34]);
    k.box(root, 'M_LampWarm', [0.18, 0.03, 0.15], [0, -0.01, 0.34]);
  }

  _fuse_box(root: THREE.Group): void {
    const k = this.k;
    k.box(root, 'M_MetalGalv', [0.6, 0.8, 0.22], [0, 0, 0.11]);
    k.box(root, 'M_MetalYellow', [0.2, 0.12, 0.02], [0, 0.2, 0.225]);
    k.cyl(root, 'M_Cable', 0.025, 1.0, [0.2, -0.85, 0.08], 'y', 6);
  }

  _vines(root: THREE.Group): void {
    const k = this.k;
    k.box(root, 'M_PlantDark', [1.4, 1.6, 0.1], [0, 1.2, 0.05]);
    k.box(root, 'M_Plant', [0.8, 1.2, 0.14], [0.2, 0.8, 0.07]);
    k.box(root, 'M_Plant', [0.5, 0.9, 0.14], [-0.4, 1.7, 0.07]);
  }

  _lantern(root: THREE.Group): void {
    const k = this.k;
    k.cyl(root, 'M_Cable', 0.008, 0.15, [0, -0.075, 0], 'y', 4);
    k.cyl(root, 'M_MetalDark', 0.1, 0.05, [0, -0.17, 0], 'y', 10);
    k.sphere(root, 'M_LanternGlow', 0.16, [0, -0.36, 0], [1, 1.25, 1]);
    k.cyl(root, 'M_MetalDark', 0.08, 0.04, [0, -0.56, 0], 'y', 10);
  }

  _water_tank(root: THREE.Group): void {
    const k = this.k;
    for (const [x, z] of [
      [-0.5, -0.5],
      [0.5, -0.5],
      [-0.5, 0.5],
      [0.5, 0.5],
    ]) k.box(root, 'M_MetalDark', [0.08, 0.6, 0.08], [x, 0.3, z]);
    k.cyl(root, 'M_MetalGalv', 0.75, 1.5, [0, 1.35, 0], 'y', 18);
    k.cyl(root, 'M_MetalRust', 0.2, 0.35, [0, 2.18, 0], 'y', 10, '', 0.76);
  }

  _roof_vent(root: THREE.Group): void {
    const k = this.k;
    k.box(root, 'M_MetalGalv', [0.6, 0.45, 0.6], [0, 0.22, 0]);
    k.box(root, 'M_MetalDark', [0.8, 0.08, 0.8], [0, 0.6, 0]);
    k.cyl(root, 'M_MetalDark', 0.05, 0.15, [0, 0.5, 0], 'y', 6);
  }

  _antenna(root: THREE.Group): void {
    const k = this.k;
    k.cyl(root, 'M_MetalDark', 0.04, 3, [0, 1.5, 0], 'y', 6);
    for (const y of [1.6, 2.2, 2.7]) k.box(root, 'M_MetalDark', [0.9 - y * 0.2, 0.03, 0.03], [0, y, 0]);
    k.sphere(root, 'M_NeonRed', 0.05, [0, 3.02, 0]);
  }

  _dish(root: THREE.Group): void {
    const k = this.k;
    k.cyl(root, 'M_MetalDark', 0.04, 0.7, [0, 0.35, 0], 'y', 6);
    const dish = k.cyl(root, 'M_PlasticLight', 0.5, 0.18, [0, 0.85, 0.1], 'z', 18, '', 0.15);
    dish.rotation.x = Math.PI / 2 - 0.5;
  }

  _roof_ac(root: THREE.Group): void {
    const k = this.k;
    k.box(root, 'M_MetalGalv', [1.4, 0.85, 1.0], [0, 0.43, 0]);
    k.cyl(root, 'M_MetalDark', 0.32, 0.04, [0, 0.87, 0], 'y', 16);
    k.box(root, 'M_MetalDark', [1.42, 0.05, 1.02], [0, 0.1, 0]);
  }

  /** Box of the catalog size with an accent band; used for unknown ids too. */
  private genericProp(root: THREE.Group, id: string): void {
    const info = propInfo(id);
    const [sx, sy, sz] = info.size;
    const [main, accent] = info.look ?? ['M_PlasticDark', 'M_NeonPink'];
    const mount = info.mount ?? 'ground';
    const y = mount === 'hanging' ? -sy / 2 : mount === 'wall' ? 0 : sy / 2;
    const z = mount === 'wall' ? sz / 2 : 0;
    this.k.box(root, main, [sx, sy, sz], [0, y, z]);
    if (accent) this.k.box(root, accent, [sx * 1.02, Math.min(0.08, sy * 0.2), sz * 1.02], [0, y + sy * 0.25, z]);
  }
}
