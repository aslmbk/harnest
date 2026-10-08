/**
 * Asset library: loads the GLB files, indexes assets by root node name, swaps materials by name, and
 * falls back to procedural placeholders for every missing file or id — the game runs with zero GLBs and
 * picks up real ones with no code change.
 *
 * Which files exist is read from `blender/manifest/*.json` (written next to every export by
 * `blender/scripts/common.py`), so missing files cause no requests and no console errors. A file that
 * still fails to load (or is not a GLB) is reported with a warning and replaced by placeholders.
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { MaterialLibrary } from '../render/materials';
import type { Placeholders } from '../render/placeholders';
import { mergeGeometries } from './geometry';

export const MODEL_FILES = ['robot.glb', 'npcs.glb', 'interactables.glb', 'kit_facades.glb', 'kit_props.glb'] as const;

export interface ManifestEntry {
  id: string;
  size: [number, number, number];
  min: [number, number, number];
  max: [number, number, number];
  tris: number;
  materials: string[];
  nodes?: string[];
}

const MANIFESTS = import.meta.glob('/blender/manifest/*.json', { eager: true, import: 'default' }) as Record<string, ManifestEntry[]>;

export function exportedFiles(): Set<string> {
  const out = new Set<string>();
  for (const path of Object.keys(MANIFESTS)) {
    const name = path.split('/').pop()!.replace(/\.json$/, '.glb');
    out.add(name);
  }
  return out;
}

/** One instancing part of an asset: all its triangles of one material, in the asset's root space. */
export interface AssetPart {
  geometry: THREE.BufferGeometry;
  matName: string;
}

export interface LoadReport {
  loaded: string[];
  skipped: string[];
  failed: string[];
  assets: string[];
}

/** Original (Blender) name of a node: GLTFLoader sanitises names and keeps the original in userData. */
export function nodeName(o: THREE.Object3D): string {
  return (o.userData.name as string | undefined) ?? o.name;
}

/** Find a descendant by contract node name; tolerates Blender duplicate suffixes like `TrackL.001`. */
export function findNode(root: THREE.Object3D, name: string): THREE.Object3D | undefined {
  let exact: THREE.Object3D | undefined;
  let loose: THREE.Object3D | undefined;
  const re = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[._]?\\d{1,3})?$`);
  root.traverse((o) => {
    if (exact) return;
    const n = nodeName(o);
    if (n === name || o.name === name) exact = o;
    else if (!loose && (re.test(n) || re.test(o.name))) loose = o;
  });
  return exact ?? loose;
}

export class AssetLibrary {
  private readonly real = new Map<string, THREE.Object3D>();
  private readonly fallback = new Map<string, THREE.Object3D>();
  private readonly partsCache = new Map<string, AssetPart[]>();
  readonly report: LoadReport = { loaded: [], skipped: [], failed: [], assets: [] };

  constructor(
    private readonly materials: MaterialLibrary,
    private readonly placeholders: Placeholders,
    private readonly baseUrl = 'assets/models/',
  ) {}

  async loadAll(opts: { useFiles: boolean; onProgress?: (ratio: number, label: string) => void }): Promise<LoadReport> {
    const exported = opts.useFiles ? exportedFiles() : new Set<string>();
    const loader = new GLTFLoader();
    let done = 0;
    await Promise.all(
      MODEL_FILES.map(async (file) => {
        if (!exported.has(file)) {
          this.report.skipped.push(file);
        } else {
          try {
            await this.loadFile(loader, file);
            this.report.loaded.push(file);
          } catch (err) {
            this.report.failed.push(file);
            console.warn(`[assets] ${file}: ${(err as Error).message} — using placeholders`);
          }
        }
        opts.onProgress?.(++done / MODEL_FILES.length, file);
      }),
    );
    this.report.assets = [...this.real.keys()].sort();
    const missing = this.report.skipped.length ? ` (placeholders for ${this.report.skipped.join(', ')})` : '';
    console.info(`[assets] ${this.report.assets.length} assets from ${this.report.loaded.length} GLB file(s)${missing}`);
    return this.report;
  }

  private async loadFile(loader: GLTFLoader, file: string): Promise<void> {
    const res = await fetch(this.baseUrl + file);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    const magic = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(4, buf.byteLength)));
    if (magic !== 'glTF') throw new Error('not a GLB file');
    const gltf = await loader.parseAsync(buf, this.baseUrl);
    for (const child of [...gltf.scene.children]) {
      const id = nodeName(child);
      if (!id) continue;
      this.prepare(child);
      child.removeFromParent();
      this.real.set(id, child);
      this.partsCache.delete(id);
    }
  }

  /** Swap glTF materials for library materials (by name) and set shadow flags. */
  private prepare(root: THREE.Object3D): void {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;
      const name = src?.name || 'M_Unknown';
      if (src) this.materials.learn(src);
      mesh.userData.matName = name;
      mesh.material = this.materials.get(name);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
  }

  /** True when the asset comes from a GLB (not a placeholder). */
  has(id: string): boolean {
    return this.real.has(id);
  }

  /** Shared template (do not modify): the real asset or its placeholder. */
  template(id: string): THREE.Object3D {
    const real = this.real.get(id);
    if (real) return real;
    let ph = this.fallback.get(id);
    if (!ph) {
      ph = this.placeholders.build(id);
      this.fallback.set(id, ph);
    }
    return ph;
  }

  /** A new object for an animated entity. Geometry and materials are shared with the template. */
  instantiate(id: string): THREE.Object3D {
    const obj = this.template(id).clone(true);
    obj.name = id;
    return obj;
  }

  /** Geometry merged per material in root space, for instancing static pieces. */
  parts(id: string): AssetPart[] {
    let parts = this.partsCache.get(id);
    if (parts) return parts;
    const root = this.template(id);
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const byMat = new Map<string, THREE.BufferGeometry[]>();
    const m = new THREE.Matrix4();
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.visible) return;
      const name = (mesh.userData.matName as string | undefined) ?? 'M_Unknown';
      m.multiplyMatrices(inv, mesh.matrixWorld);
      const g = mesh.geometry.clone().applyMatrix4(m);
      let list = byMat.get(name);
      if (!list) byMat.set(name, (list = []));
      list.push(g);
    });
    parts = [...byMat.entries()].map(([matName, list]) => {
      const geometry = list.length === 1 ? list[0] : mergeGeometries(list);
      if (list.length > 1) list.forEach((g) => g.dispose());
      return { geometry, matName };
    });
    this.partsCache.set(id, parts);
    return parts;
  }

  /** Local bounding box of an asset (template space). */
  bounds(id: string): THREE.Box3 {
    return new THREE.Box3().setFromObject(this.template(id));
  }
}
