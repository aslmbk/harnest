/**
 * Geometry helpers that do not pull in the WebGL build of three (BufferGeometryUtils imports bare 'three').
 */
import * as THREE from 'three/webgpu';

type AnyAttr = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

/**
 * Merge geometries into one indexed Float32 geometry. Attribute sets are unified: missing normals are
 * computed, missing UVs become 0, missing vertex colours become white (so baked AO on some parts and
 * none on others still merges).
 */
export function mergeGeometries(list: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  const anyUv = list.some((g) => g.getAttribute('uv'));
  const colorSize = list.reduce((n, g) => Math.max(n, (g.getAttribute('color') as AnyAttr | undefined)?.itemSize ?? 0), 0);
  let vertexCount = 0;
  let indexCount = 0;
  for (const g of list) {
    const n = g.getAttribute('position').count;
    vertexCount += n;
    indexCount += g.index ? g.index.count : n;
  }
  const pos = new Float32Array(vertexCount * 3);
  const nor = new Float32Array(vertexCount * 3);
  const uv = anyUv ? new Float32Array(vertexCount * 2) : null;
  const col = colorSize ? new Float32Array(vertexCount * colorSize).fill(1) : null;
  const index = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  let v = 0;
  let i = 0;
  for (const src of list) {
    const g = src.getAttribute('normal') ? src : src.clone();
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const p = g.getAttribute('position') as AnyAttr;
    const n = g.getAttribute('normal') as AnyAttr;
    const t = g.getAttribute('uv') as AnyAttr | undefined;
    const c = g.getAttribute('color') as AnyAttr | undefined;
    for (let k = 0; k < p.count; k++) {
      pos[(v + k) * 3] = p.getX(k);
      pos[(v + k) * 3 + 1] = p.getY(k);
      pos[(v + k) * 3 + 2] = p.getZ(k);
      nor[(v + k) * 3] = n.getX(k);
      nor[(v + k) * 3 + 1] = n.getY(k);
      nor[(v + k) * 3 + 2] = n.getZ(k);
      if (uv && t) {
        uv[(v + k) * 2] = t.getX(k);
        uv[(v + k) * 2 + 1] = t.getY(k);
      }
      if (col && c) {
        col[(v + k) * colorSize] = c.getX(k);
        col[(v + k) * colorSize + 1] = c.getY(k);
        col[(v + k) * colorSize + 2] = c.getZ(k);
        if (colorSize === 4) col[(v + k) * 4 + 3] = c.itemSize === 4 ? c.getW(k) : 1;
      }
    }
    if (g.index) for (let k = 0; k < g.index.count; k++) index[i++] = g.index.getX(k) + v;
    else for (let k = 0; k < p.count; k++) index[i++] = k + v;
    v += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, colorSize));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}
