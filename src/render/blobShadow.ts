/**
 * Soft blob shadow under characters (cheap contact shadow that reads on the wet ground).
 */
import * as THREE from 'three/webgpu';
import { float, length, smoothstep, uv, vec3 } from 'three/tsl';

let shared: THREE.MeshBasicNodeMaterial | null = null;

function blobMaterial(): THREE.MeshBasicNodeMaterial {
  if (shared) return shared;
  const m = new THREE.MeshBasicNodeMaterial();
  m.name = 'M_BlobShadow';
  m.transparent = true;
  m.depthWrite = false;
  m.fog = false;
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.polygonOffsetUnits = -2;
  const d = length(uv().sub(0.5)).mul(2);
  m.colorNode = vec3(0, 0, 0);
  m.opacityNode = smoothstep(1, 0.15, d).mul(float(0.6));
  shared = m;
  return m;
}

let unitPlane: THREE.PlaneGeometry | null = null;

/** Geometry and material are shared by every blob shadow (nothing to dispose with the entity). */
export function createBlobShadow(radius: number): THREE.Mesh {
  unitPlane ??= new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.Mesh(unitPlane, blobMaterial());
  mesh.name = 'blob-shadow';
  mesh.scale.set(radius * 2, radius * 2, 1);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.012;
  mesh.renderOrder = 2;
  return mesh;
}
