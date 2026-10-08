/**
 * Follow-camera numbers (design doc §4). Pure data, no three.js: the level planner derives its building
 * height clamp from the same rig the player sees (`maxBuildingHeight` in `src/world/tiles.ts`).
 */
export const CAMERA = {
  fov: 35,
  pitchDeg: 52,
  distance: 17,
  minDistance: 12,
  maxDistance: 24,
  zoomStep: 1.5,
  closeDistance: 9.5,
  lookAhead: 0.32,
  follow: 5,
  /** Height (m) of the point the follow camera looks at, above the robot's feet. */
  targetY: 0.6,
  /** Near clip plane (m). */
  near: 0.5,
  /**
   * How far (m) the follow target stays inside the walkable area: at the south edge the frame shows
   * ~5.5 m below the target, so the drop is visible but does not fill a third of the screen.
   */
  edgeSouth: 3.5,
  edgeSide: 6,
};
