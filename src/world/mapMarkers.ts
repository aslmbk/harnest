/**
 * `?view=map` overlay: flat markers for every gameplay spot so a layout can be checked at a glance.
 * spawn = white arrow · terminal = orange square (+ facing tick) · NPC = cyan disc · chip = green diamond ·
 * zone = yellow ring (true radius) · gate = red bar · exit = green bar.
 */
import * as THREE from 'three/webgpu';
import { TILE, type LevelDef } from '../content/types';
import type { LevelPlan } from './levelPlan';
import { gateCollider, terminalPose } from './levelPlan';
import { facingToYaw } from './tiles';

function mat(hex: string): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial();
  m.color = new THREE.Color(hex).multiplyScalar(2.2);
  m.fog = false;
  m.depthTest = false;
  m.transparent = true;
  m.opacity = 0.9;
  return m;
}

export function buildMapMarkers(level: LevelDef, plan: LevelPlan): THREE.Group {
  const g = new THREE.Group();
  g.name = 'map-markers';
  g.renderOrder = 50;
  const flat = (geo: THREE.BufferGeometry, color: string, x: number, z: number, yaw = 0) => {
    const m = new THREE.Mesh(geo, mat(color));
    m.rotation.set(-Math.PI / 2, 0, yaw);
    m.position.set(x, 0.3, z);
    m.renderOrder = 50;
    g.add(m);
    return m;
  };
  const L = level.layout;
  const arrow = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, 0.8), new THREE.Vector2(0.5, -0.5), new THREE.Vector2(-0.5, -0.5)]));
  flat(arrow, '#ffffff', L.spawn.at[0] * TILE, L.spawn.at[1] * TILE, facingToYaw(L.spawn.facing) + Math.PI);
  for (const spot of Object.values(L.terminals)) {
    const pose = terminalPose(plan.grid, spot);
    flat(new THREE.PlaneGeometry(0.8, 0.6), '#ff8a1f', pose.x, pose.z, pose.yaw);
    flat(new THREE.PlaneGeometry(0.12, 0.7), '#ffd9a3', pose.x + Math.sin(pose.yaw) * 0.6, pose.z + Math.cos(pose.yaw) * 0.6, pose.yaw);
  }
  for (const spot of Object.values(L.npcs)) flat(new THREE.CircleGeometry(0.45, 20), '#19e3ff', spot.at[0] * TILE, spot.at[1] * TILE);
  for (const spot of Object.values(L.chips)) flat(new THREE.PlaneGeometry(0.4, 0.4), '#5dff7a', spot.at[0] * TILE, spot.at[1] * TILE, Math.PI / 4);
  for (const spot of Object.values(L.zones)) {
    const r = spot.radius * TILE;
    flat(new THREE.RingGeometry(r - 0.08, r, 40), '#ffe14a', spot.at[0] * TILE, spot.at[1] * TILE);
  }
  const gate = gateCollider(L.gate);
  flat(new THREE.PlaneGeometry(gate.maxX - gate.minX, gate.maxZ - gate.minZ), '#ff3b30', (gate.minX + gate.maxX) / 2, (gate.minZ + gate.maxZ) / 2);
  flat(new THREE.PlaneGeometry(L.gate.axis === 'x' ? 3.6 : 0.3, L.gate.axis === 'x' ? 0.3 : 3.6), '#5dff7a', L.exit[0] * TILE, L.exit[1] * TILE);
  return g;
}
