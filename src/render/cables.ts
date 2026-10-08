/**
 * Hanging cables (planned by `dressCables` / `dressLanternStrings`): every span becomes a thin sagging
 * tube; all spans of a level are one mesh with the static level material (one draw call, shared
 * pipeline). Seen by the main camera and mirrored in puddles; too thin to cast stable shadows.
 */
import * as THREE from 'three/webgpu';
import { cablePoint, type CableSpan } from '../world/levelPlan';
import { LAYER, setObjectLayers } from './layers';
import { EMISSIVE_SCALE, type MaterialLibrary } from './materials';
import { emptySurface, STATIC_KIND, staticMaterial, surfaceBytes } from './staticMaterial';

const SIDES = 5;

export function createCables(spans: readonly CableSpan[], materials: MaterialLibrary): THREE.Mesh | null {
  if (!spans.length) return null;
  const pos: number[] = [];
  const nor: number[] = [];
  const index: number[] = [];
  const surf = surfaceBytes(materials.spec('M_Cable'), STATIC_KIND.plain, 0, false, EMISSIVE_SCALE, emptySurface());
  const p = new THREE.Vector3();
  const prev = new THREE.Vector3();
  const next = new THREE.Vector3();
  const t = new THREE.Vector3();
  const side = new THREE.Vector3();
  const lift = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (const span of spans) {
    const length = Math.hypot(span.b[0] - span.a[0], span.b[1] - span.a[1], span.b[2] - span.a[2]);
    const segs = Math.max(8, Math.min(24, Math.round(length / 0.3)));
    const base = pos.length / 3;
    for (let i = 0; i <= segs; i++) {
      p.fromArray(cablePoint(span, i / segs));
      prev.fromArray(cablePoint(span, Math.max(0, i - 1) / segs));
      next.fromArray(cablePoint(span, Math.min(segs, i + 1) / segs));
      t.subVectors(next, prev).normalize();
      side.crossVectors(t, up).normalize();
      lift.crossVectors(side, t).normalize();
      for (let k = 0; k < SIDES; k++) {
        const a = (k / SIDES) * Math.PI * 2;
        const nx = side.x * Math.cos(a) + lift.x * Math.sin(a);
        const ny = side.y * Math.cos(a) + lift.y * Math.sin(a);
        const nz = side.z * Math.cos(a) + lift.z * Math.sin(a);
        pos.push(p.x + nx * span.radius, p.y + ny * span.radius, p.z + nz * span.radius);
        nor.push(nx, ny, nz);
      }
    }
    for (let i = 0; i < segs; i++) {
      for (let k = 0; k < SIDES; k++) {
        const a = base + i * SIDES + k;
        const b = base + i * SIDES + ((k + 1) % SIDES);
        const c = a + SIDES;
        const d = b + SIDES;
        index.push(a, c, b, b, c, d);
      }
    }
  }
  const count = pos.length / 3;
  const sc = new Uint8Array(count * 4);
  const se = new Uint8Array(count * 4);
  const sm = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    sc.set(surf.sc, i * 4);
    se.set(surf.se, i * 4);
    sm.set(surf.sm, i * 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('sc', new THREE.BufferAttribute(sc, 4, true));
  geo.setAttribute('se', new THREE.BufferAttribute(se, 4, true));
  geo.setAttribute('sm', new THREE.BufferAttribute(sm, 4, true));
  geo.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1));
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, staticMaterial());
  mesh.name = 'cables';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  setObjectLayers(mesh, LAYER.MAIN, LAYER.REFLECT);
  return mesh;
}
