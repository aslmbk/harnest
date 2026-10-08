/**
 * Dithered occlusion cut-out (design doc §4b): tall materials discard pixels in a window around the
 * camera → player line, so a wall between the camera and the robot never hides him completely.
 *
 * The window is a cone with its apex at the camera, so it has a constant size on screen. Pixels fade
 * out with an interleaved-gradient-noise dither (no transparency sorting, works with MSAA).
 */
import { Vector3 } from 'three/webgpu';
import { bool, cameraPosition, dot, float, Fn, interleavedGradientNoise, length, positionWorld, screenCoordinate, smoothstep, uniform } from 'three/tsl';
import type { Node, NodeMaterial } from 'three/webgpu';

export const occlusion = {
  /** Point the camera must see (the robot's chest), world space. */
  target: uniform(new Vector3()),
  /** Window radius in metres at the target's distance. */
  radius: uniform(1.55),
  /** 0 = off (menu fly-over, map view), 1 = on. */
  strength: uniform(0),
};

/** Keep-mask node: false where the fragment is cut away. `weight` (0..1) scales the cut per fragment. */
function occlusionKeep(weight: Node<'float'> | null) {
  return Fn(() => {
    const cam = cameraPosition;
    const toTarget = occlusion.target.sub(cam);
    const len2 = dot(toTarget, toTarget).max(1e-4);
    const len = len2.sqrt();
    const rel = positionWorld.sub(cam);
    const t = dot(rel, toTarget).div(len2).max(0);
    const closest = toTarget.mul(t);
    const dist = length(rel.sub(closest));
    const radius = occlusion.radius.mul(t);
    const ahead = float(1).sub(t).mul(len); // metres in front of the target, toward the camera
    const inFront = smoothstep(0.35, 1.0, ahead);
    const inside = smoothstep(radius, radius.mul(0.5), dist);
    // the mirrored camera of the street reflection sits below the ground: no cut-out there
    const aboveGround = cam.y.greaterThan(0).select(float(1), float(0));
    let cut = inside.mul(inFront).mul(occlusion.strength).mul(aboveGround);
    if (weight) cut = cut.mul(weight);
    return cut.lessThan(interleavedGradientNoise(screenCoordinate.xy));
  })();
}

let keepNode: ReturnType<typeof occlusionKeep> | null = null;

/**
 * Makes a material an occluder: dithered cut-out in view, full shadows. With `weight` only fragments
 * whose weight is 1 are cut (the static level material marks its tall pieces per vertex).
 */
export function applyOcclusion(material: NodeMaterial, weight: Node<'float'> | null = null): void {
  if (weight) material.maskNode = occlusionKeep(weight);
  else material.maskNode = keepNode ??= occlusionKeep(null);
  material.maskShadowNode = bool(true);
}
