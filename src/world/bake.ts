/**
 * Draw-call diet for animated entities (robot, NPCs, terminals, gate, chips). Inside every node, the
 * glTF primitives that use plain library materials are merged into one mesh with the static uber
 * material (colour, roughness, metalness and emission per vertex — `render/staticMaterial.ts`). Nodes
 * keep their transforms, so animation is unchanged; parts with their own runtime material (eyes,
 * tracks, faces, screens, the gate lamp, pulsing glows) stay separate meshes.
 */
import * as THREE from 'three/webgpu';
import type { MaterialLibrary } from '../render/materials';
import { emptySurface, STATIC_KIND, staticMaterial } from '../render/staticMaterial';
import { appendPart, Batch } from './staticMesh';

/** Library materials with a shader of their own (pulsing, per-placement variety): never baked. */
const OWN_SHADER = new Set(['M_ChipGlow', 'M_HarniScreen', 'M_Wall', 'M_WindowLit', 'M_WindowLitCool']);

export interface BakeOptions {
  /** Materials baked with a colour multiplier (an NPC's paint in its tint), whatever mesh material they have now. */
  tints?: Readonly<Record<string, THREE.Color>>;
}

/** Merges the plain primitives of every node of `root`; returns the new geometries (dispose them with the entity). */
export function bakeEntity(root: THREE.Object3D, materials: MaterialLibrary, opts: BakeOptions = {}): THREE.BufferGeometry[] {
  const nodes: THREE.Object3D[] = [];
  root.traverse((o) => nodes.push(o));
  const made: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const nm = new THREE.Matrix3();
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const surf = emptySurface();
  for (const node of nodes) {
    // glTF primitives of a node are its unnamed, childless mesh children
    const prims = node.children.filter((c): c is THREE.Mesh => {
      const mesh = c as THREE.Mesh;
      if (!mesh.isMesh || mesh.children.length > 0 || mesh.userData.name !== undefined || !mesh.visible) return false;
      const name = mesh.userData.matName as string | undefined;
      if (!name || OWN_SHADER.has(name)) return false;
      return !!opts.tints?.[name] || mesh.material === materials.get(name);
    });
    if (prims.length < 2) continue;
    const b = new Batch(`${node.name}:baked`, [], true);
    for (const p of prims) {
      p.updateMatrix();
      m.copy(p.matrix);
      nm.getNormalMatrix(m);
      const name = p.userData.matName as string;
      appendPart(b, { geometry: p.geometry, matName: name }, m, nm, materials.spec(name), STATIC_KIND.plain, opts.tints?.[name] ?? null, 0, false, surf, v, n);
    }
    const geo = b.geometry();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, staticMaterial());
    mesh.name = `${node.name}:baked`;
    mesh.castShadow = prims.some((p) => p.castShadow);
    mesh.receiveShadow = true;
    mesh.layers.mask = prims[0].layers.mask;
    for (const p of prims) node.remove(p);
    node.add(mesh);
    made.push(geo);
  }
  return made;
}
