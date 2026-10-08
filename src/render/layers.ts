/**
 * Render layers: which pass sees which geometry. The main camera, the street reflection's mirrored
 * camera and the key light's shadow camera each render layer 0 (characters, entities, signs, ground)
 * plus their own layer:
 *
 *   MAIN    full-detail static level geometry (main camera only)
 *   REFLECT cheap stand-ins seen in puddles: facade quads, lit windows, props (mirrored camera only)
 *   SHADOW  closed building blocks that cast the street's shadows (shadow camera only)
 *
 * A mesh can sit on several layers (props are on all three).
 */
import type * as THREE from 'three/webgpu';

export const LAYER = {
  MAIN: 1,
  REFLECT: 2,
  SHADOW: 3,
} as const;

/** Puts a camera on layer 0 plus the given layers. */
export function setCameraLayers(camera: THREE.Camera, ...layers: number[]): void {
  camera.layers.set(0);
  for (const l of layers) camera.layers.enable(l);
}

/** Puts an object on exactly the given layers. */
export function setObjectLayers(object: THREE.Object3D, ...layers: number[]): void {
  object.layers.disableAll();
  for (const l of layers) object.layers.enable(l);
}
