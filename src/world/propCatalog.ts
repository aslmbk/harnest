/**
 * Prop catalog: asset id → collider, placeholder size and an optional light. Pure data.
 *
 * Add a prop: add an entry here (size is used for the placeholder box and the default collider), give
 * it a placeholder shape in `src/render/placeholders.ts` if a plain box would read badly, and model it
 * in `kit_props.glb` with the same root name. Sizes are [x, y, z] in metres, front +Z, origin per `mount`.
 */

export type PropMount =
  /** Origin bottom centre, stands on the ground (default). */
  | 'ground'
  /** Origin on the wall plane, sticks out toward +Z. */
  | 'wall'
  /** Origin at the top hook. */
  | 'hanging'
  /** Stands on a roof. */
  | 'roof';

export type ColliderSpec =
  /** Box footprint in local space (default: the size footprint), optional local offset. */
  | { kind: 'box'; size?: readonly [number, number]; offset?: readonly [number, number] }
  | { kind: 'circle'; r: number; offset?: readonly [number, number] };

export interface PropLight {
  color: string;
  /** Artist units; the builder scales them to the renderer's physical units. */
  intensity: number;
  distance: number;
  /** Local position of the light (metres, front +Z). */
  at: readonly [number, number, number];
  flicker?: boolean;
}

export interface PropInfo {
  size: readonly [number, number, number];
  mount?: PropMount;
  /** null = walk-through. Default: a box of the size footprint for ground props, none otherwise. */
  collider?: ColliderSpec | null;
  /**
   * Several footprints (a gantry crane's two legs, with the span between them open). Takes precedence
   * over `collider` wherever `propColliders` is used; keep `collider` as the fallback for older callers.
   */
  colliders?: readonly ColliderSpec[];
  /** Real lights of the prop (candidates for the level's light budget; the nearest ones are used). */
  light?: PropLight | readonly PropLight[];
  /** Main and accent material names for the placeholder box. */
  look?: readonly [main: string, accent?: string];
}

const WARM = '#ffc98a';
const STALL = '#ff8c40';

export const PROP_CATALOG: Readonly<Record<string, PropInfo>> = {
  // ── street ──
  barrel: { size: [0.6, 0.9, 0.6], collider: { kind: 'circle', r: 0.32 }, look: ['M_MetalRust', 'M_MetalTeal'] },
  crate: { size: [0.8, 0.8, 0.8], look: ['M_Wood'] },
  crate_stack: { size: [1.4, 1.5, 1.0], look: ['M_Wood', 'M_TarpGreen'] },
  trash_bags: { size: [1.0, 0.6, 0.8], collider: { kind: 'circle', r: 0.45 }, look: ['M_Trash'] },
  dumpster: { size: [1.8, 1.3, 1.0], look: ['M_MetalTeal', 'M_MetalDark'] },
  vending: {
    size: [0.9, 1.9, 0.7],
    look: ['M_MetalRed', 'M_ScreenGlow'],
    light: [
      { color: '#40e6cc', intensity: 2.6, distance: 4.5, at: [-0.11, 1.2, 0.46] },
      { color: '#ff338c', intensity: 1.6, distance: 3.5, at: [0, 1.71, 0.46] },
    ],
  },
  streetlamp: {
    size: [0.5, 3.2, 0.5],
    collider: { kind: 'circle', r: 0.18 },
    look: ['M_MetalDark', 'M_LampWarm'],
    // bulb at the end of the 0.8 m arm (front +Z; turn it 180° on a south kerb so it reaches over the street)
    light: { color: '#ffc780', intensity: 7, distance: 10, at: [0, 2.86, 0.8] },
  },
  bench: { size: [1.6, 0.8, 0.6], look: ['M_Wood', 'M_MetalDark'] },
  stall: {
    size: [2.0, 2.3, 1.0],
    collider: { kind: 'box', size: [2.0, 0.9] },
    look: ['M_Wood', 'M_TarpOrange'],
    light: [
      { color: STALL, intensity: 2.6, distance: 4.5, at: [-0.25, 1.59, 0.54] },
      { color: STALL, intensity: 2.2, distance: 4, at: [0.98, 1.7, 0.72], flicker: true },
    ],
  },
  crt_stack: {
    size: [1.2, 1.3, 0.7],
    look: ['M_PlasticLight', 'M_ScreenGlow'],
    light: { color: '#37e6c8', intensity: 2, distance: 4, at: [0, 0.9, 0.55], flicker: true },
  },
  plant_pot: { size: [0.6, 0.9, 0.6], collider: { kind: 'circle', r: 0.3 }, look: ['M_ConcreteDark', 'M_Plant'] },
  cable_spool: { size: [0.9, 0.9, 0.6], collider: { kind: 'circle', r: 0.42 }, look: ['M_Wood', 'M_Cable'] },
  tires: { size: [0.9, 0.6, 0.9], collider: { kind: 'circle', r: 0.45 }, look: ['M_Rubber'] },
  steam_vent: { size: [0.8, 0.25, 0.8], collider: null, look: ['M_MetalDark'] },
  manhole: { size: [0.9, 0.05, 0.9], collider: null, look: ['M_MetalDark'] },

  // ── wall-mounted (origin on the wall plane, sticking out toward +Z) ──
  ac_unit: { size: [0.9, 0.6, 0.5], mount: 'wall', look: ['M_PlasticLight', 'M_MetalDark'] },
  pipe_v: { size: [0.25, 3.0, 0.25], mount: 'wall', look: ['M_MetalRust'] },
  pipe_h: { size: [2.0, 0.25, 0.25], mount: 'wall', look: ['M_MetalRust'] },
  awning: { size: [2.0, 0.5, 1.0], mount: 'wall', look: ['M_TarpBlue', 'M_MetalDark'] },
  wall_lamp: {
    size: [0.3, 0.4, 0.4],
    mount: 'wall',
    look: ['M_MetalDark', 'M_LampWarm'],
    light: { color: WARM, intensity: 4, distance: 7, at: [0, 0.12, 0.38] },
  },
  fuse_box: { size: [0.6, 0.8, 0.25], mount: 'wall', look: ['M_MetalGalv', 'M_MetalYellow'] },
  vines: { size: [1.5, 2.5, 0.2], mount: 'wall', look: ['M_PlantDark', 'M_Plant'] },

  // ── hanging (origin at the top hook) ──
  lantern: {
    size: [0.35, 0.6, 0.35],
    mount: 'hanging',
    look: ['M_LanternGlow', 'M_MetalDark'],
    light: { color: '#ff9440', intensity: 3, distance: 6, at: [0, -0.26, 0], flicker: true },
  },

  // ── rooftop ──
  water_tank: { size: [1.6, 2.2, 1.6], mount: 'roof', look: ['M_MetalGalv', 'M_MetalRust'] },
  roof_vent: { size: [0.8, 0.7, 0.8], mount: 'roof', look: ['M_MetalGalv'] },
  antenna: { size: [0.5, 3.0, 0.5], mount: 'roof', look: ['M_MetalDark', 'M_NeonRed'] },
  dish: { size: [1.0, 1.2, 0.8], mount: 'roof', look: ['M_PlasticLight', 'M_MetalDark'] },
  roof_ac: { size: [1.4, 1.0, 1.0], mount: 'roof', look: ['M_MetalGalv', 'M_MetalDark'] },

  // ── depot (district 3). Track runs along Z at rot 0: gauge 1 m (rails at x ±0.5), rail heads 0.06 m
  //    above the origin (0.112 m on the turntable), buffers 0.55 m up. rail_straight is 2 m long and tiles
  //    end to end; the locomotive stands on it at the same origin height, its nose (headlamp) toward +Z. ──
  rail_straight: { size: [1.5, 0.06, 2.0], collider: null, look: ['M_Wood', 'M_MetalSteel'] },
  rail_buffer: { size: [1.5, 1.2, 1.0], look: ['M_MetalYellow', 'M_MetalRust'] },
  rail_signal: {
    size: [0.4, 3.6, 0.4],
    look: ['M_MetalGalv', 'M_MetalRed'],
    // the arm and the lamp head reach over the track; the collider is the 0.4 m footing. The light sits
    // well in front of the lamp head (lenses at y 2.43 / 2.67) so it pools on the ground, not on the board.
    light: { color: '#5dff7a', intensity: 1.4, distance: 4.5, at: [0, 1.9, 0.9] },
  },
  turntable: { size: [5.0, 0.12, 5.0], collider: null, look: ['M_ConcreteDark', 'M_MetalYellow'] },
  locomotive: {
    size: [1.6, 2.4, 3.6],
    look: ['M_MetalTeal', 'M_MetalYellow'],
    // headlamp at [0, 1.6, 1.54]; the light is ahead of the buffers so it washes the track, not the hood
    light: { color: '#ffd08a', intensity: 3, distance: 7, at: [0, 1.4, 2.3] },
  },
  gantry_crane: {
    // 4 m span over a lane (x −2..2), 1 m deep; only the two legs block
    size: [4.0, 5.3, 1.0],
    collider: null,
    colliders: [
      { kind: 'box', size: [0.4, 1.0], offset: [-1.78, 0] },
      { kind: 'box', size: [0.4, 1.0], offset: [1.78, 0] },
    ],
    look: ['M_MetalYellow', 'M_MetalDark'],
  },

  // ── interactables and characters (colliders used by the game) ──
  terminal: { size: [0.8, 1.5, 0.6], look: ['M_PlasticLight', 'M_TerminalScreen'] },
  chip: { size: [0.35, 0.22, 0.06], collider: null, look: ['M_PlasticDark', 'M_ChipGlow'] },
  npc_tall: { size: [0.7, 1.7, 0.5], collider: { kind: 'circle', r: 0.42 }, look: ['M_NpcPaint', 'M_NpcFace'] },
  npc_round: { size: [0.9, 1.1, 0.9], collider: { kind: 'circle', r: 0.48 }, look: ['M_NpcPaint', 'M_NpcFace'] },
  npc_drone: { size: [0.6, 1.6, 0.6], collider: { kind: 'circle', r: 0.36 }, look: ['M_NpcPaint', 'M_NpcFace'] },
};

/** Size used for an unknown asset id (a crate-sized box that stands out as a placeholder). */
export const UNKNOWN_PROP: PropInfo = { size: [0.8, 0.8, 0.8], look: ['M_PlasticDark', 'M_NeonPink'] };

export function propInfo(asset: string): PropInfo {
  return PROP_CATALOG[asset] ?? UNKNOWN_PROP;
}

/** Every real light of a prop (0, 1 or more). */
export function propLights(asset: string): readonly PropLight[] {
  const l = propInfo(asset).light;
  if (!l) return [];
  return Array.isArray(l) ? l : [l as PropLight];
}

/** Collider of a prop, resolved against the defaults. */
export function propCollider(asset: string): ColliderSpec | null {
  const info = propInfo(asset);
  if (info.collider !== undefined) return info.collider;
  return (info.mount ?? 'ground') === 'ground' ? { kind: 'box' } : null;
}

/** Every collider of a prop: `colliders` when given, otherwise the single resolved `propCollider`. */
export function propColliders(asset: string): readonly ColliderSpec[] {
  const many = propInfo(asset).colliders;
  if (many) return many;
  const one = propCollider(asset);
  return one ? [one] : [];
}
