// Level 3 «Депо Планов» — a rail depot on the terrace edge: yellow + green, steam, pipes, tanks, dry.
// The track is the route: the main line runs along the platform, a branch climbs north through the crane
// yard to the turntable in front of the gate.
//
// Route: Harni steps off the parked train at the west end of the platform (south; Лямбда at her hut, the
// steam valve hissing) → east along the main line to the switch post at the junction (t1, СТРЕЛКИ) → north
// up the branch into the crane yard: t2 at the foot of the gantry crane, a container still swinging on
// the hook → north to the turntable yard: the locomotive stuck askew on the turntable, t3 at the wall
// between the turntable and the gate (ДЕПО).
// Detours: the signal lane off the west end of the platform — Семафор at his signal, the parts store
// pocket east of him (t4 bonus), the dispatcher's balcony round the corner to the west (t5 bonus); the
// broken rail bridge at the end of the main line (c1), the aisle behind the containers (c2), the engine
// bay in the shed (c3), the dead track that runs off the east edge (c4).
//
// Camera: the lane, the crane yard and the engine bay run north–south (their walls never hide the robot);
// the turntable yard, the parts pocket and the dispatcher's balcony keep a low hazard kerb to the south,
// the platform has the drop. The tall shed faces the platform; its roofs step down toward the north.
import type { LevelLayout, PropPlacement } from '../../types';

/** A straight run of 2 m rail segments, one per tile: along a row (east–west, rot 90) or a column (north–south). */
function track(axis: 'row' | 'col', line: number, from: number, to: number, skip: readonly number[] = []): PropPlacement[] {
  const out: PropPlacement[] = [];
  for (let t = from; t <= to + 1e-6; t += 1) {
    if (skip.some((k) => Math.abs(k - t) < 1e-6)) continue;
    out.push(axis === 'row' ? { asset: 'rail_straight', at: [t, line], rot: 90 } : { asset: 'rail_straight', at: [line, t] });
  }
  return out;
}

export const layout: LevelLayout = {
  map: [
    // 0         1         2         3
    // 012345678901234567890123456789012345
    '  665556655566665..66655566665556655', // 0  skyline · the dispatcher tower · exit
    '  664445544455554..55544455554445544', // 1  gate
    '  66...........................     ', // 2  turntable yard
    '  66..................===......=====', // 3  the turntable · east catwalk
    '  66..................==============', // 4  the dead track runs off the edge
    '  66..................===......     ', // 5
    '  66...ooooooooooooooo.=..ooooo     ', // 6  the yard's kerb · lane and crane yard mouths
    '  .....###############.=.....##     ', // 7  dispatcher's balcony · signal lane · crane yard
    '  .........###########.=.....##     ', // 8  parts store pocket
    '  oo.......22222222222.=.....22     ', // 9
    '  11.......22222222222.=.....22     ', // 10
    '  11...oooo222222..222.=.....22     ', // 11 the pocket's kerb · engine bay
    '  22...####33####..333.=.....33     ', // 12
    '  22...####335555..333.=.....33     ', // 13
    '  22...####335555..333.=.....33     ', // 14
    '    ...................=........    ', // 15 platform
    '    ...................=........    ', // 16
    '====...................=........    ', // 17 the broken rail bridge
    '==============================o.    ', // 18 main line · buffer stop
    '    ............................    ', // 19
    '                                    ', // 20 the drop
  ],
  spawn: { at: [8, 17], facing: 'N' },
  gate: { at: [17.5, 1], axis: 'x' },
  exit: [17.5, 0],
  terminals: {
    t1: { at: [21, 15], facing: 'S' }, // the switch post by the junction
    t2: { at: [22, 10], facing: 'S' }, // at the foot of the gantry crane
    t3: { at: [20, 2], facing: 'S' }, // the turntable drive, between the turntable and the gate
    t4: { at: [9, 8], facing: 'S' }, // the parts store
    t5: { at: [3, 7], facing: 'S' }, // the dispatcher's desk on the balcony
  },
  npcs: {
    lambda: { at: [11.9, 15.4], facing: 'S' }, // at her hut, the first one Harni meets
    semafor: { at: [5.3, 8.3], facing: 'S' }, // at his signal, between the store and the dispatcher
  },
  chips: {
    c1: { at: [0.4, 17.5] }, // end of the broken rail bridge
    c2: { at: [28.1, 7.3] }, // the aisle behind the containers
    c3: { at: [17.5, 11.35] }, // back of the engine bay
    c4: { at: [35.3, 3.5] }, // end of the dead track over the abyss
  },
  zones: {
    z1: { at: [8, 17], radius: 2 },
    z2: { at: [23, 4.6], radius: 2 },
    z3: { at: [17.5, 3.2], radius: 1.9 },
  },
  props: [
    // ── the track: 2 m segments on the grate bed (one per tile); props on the turntable stand 0.052 higher ──
    ...track('row', 18, 4, 29, [5]), // the main line along the platform (the parked locomotive covers col 5)
    ...track('col', 23, 5.75, 17.75), // the branch: from the main line up through the crane yard to the turntable rim
    ...track('row', 4, 24.75, 25.75), // the dead track off the turntable (bare catwalk beyond)
    { asset: 'rail_buffer', at: [29.25, 18], rot: 90 }, // the main line's dead end, before the buffer stop
    { asset: 'locomotive', at: [5, 18], rot: -90 }, // the parked train Harni steps off, headlamp toward the platform

    // ── platform, north side (wall plane at row 14.5): Лямбда's hut ──
    { asset: 'crate_stack', at: [7.6, 14.85] },
    { asset: 'fuse_box', at: [9.6, 14.5], y: 1.1 },
    { asset: 'crt_stack', at: [10.6, 14.8] },
    { asset: 'wall_lamp', at: [11.9, 14.5], y: 2.7 },
    { asset: 'bench', at: [13.4, 14.76] },
    { asset: 'vending', at: [14.9, 14.82] },
    // the switch post: t1, its cabinet, the signal over the branch
    { asset: 'pipe_v', at: [19.3, 14.5] },
    { asset: 'fuse_box', at: [20.2, 14.5], y: 1.1 },
    { asset: 'rail_signal', at: [22.4, 16.9] }, // west of the branch, the arm reaching over it
    { asset: 'dumpster', at: [29.8, 14.9] },
    // ── platform floor and the south strip (railing at row 19.5) ──
    { asset: 'steam_vent', at: [9.8, 16.7] }, // the hissing valve
    // streetlamps at scale 1.25: the catalog bulb (intensity 7) hangs at 3.6 m instead of 2.9 m, off the ground
    { asset: 'streetlamp', at: [6.5, 19.32], rot: 180, scale: 1.25 },
    { asset: 'streetlamp', at: [16.5, 19.32], rot: 180, scale: 1.25 },
    { asset: 'streetlamp', at: [27.5, 19.32], rot: 180, scale: 1.25 },

    // ── crane yard (west wall plane x 21.5, east wall plane x 28.5): the gantry straddles the branch ──
    { asset: 'gantry_crane', at: [23, 9.3] }, // legs at x ±1.78 m, t2 at the foot of the west one
    { asset: 'dumpster', at: [23.2, 9.3], y: 2.1, scale: 0.65, rot: 10, solid: false }, // a container on the hook
    { asset: 'crate_stack', at: [27.0, 7.6], rot: 90 },
    { asset: 'crate_stack', at: [27.0, 7.6], y: 1.48, rot: 90, solid: false },
    { asset: 'crate_stack', at: [27.0, 11.6], rot: 90 },
    { asset: 'crate_stack', at: [27.0, 11.6], y: 1.48, rot: 90, solid: false },
    { asset: 'dumpster', at: [27.0, 13.5], rot: 90 },
    { asset: 'crate_stack', at: [25.3, 12.0], rot: 28 }, // the dropped one
    { asset: 'crate', at: [24.4, 12.7], rot: 40 },
    { asset: 'wall_lamp', at: [21.5, 8.0], rot: -90, y: 2.5 },
    { asset: 'wall_lamp', at: [21.5, 12.9], rot: -90, y: 2.5 }, // the dark west wall along the branch
    { asset: 'wall_lamp', at: [28.5, 8.6], rot: 90, y: 2.5 },
    { asset: 'wall_lamp', at: [28.5, 11.5], rot: 90, y: 2.5 }, // the dark east wall behind the containers

    // ── turntable yard (north wall plane at row 1.5, kerb at row 5.5) ──
    // the turntable overshot: its bridge and the locomotive on it stand askew to every track
    { asset: 'turntable', at: [23, 4], rot: 35 },
    { asset: 'locomotive', at: [23, 4], y: 0.052, rot: 35 },
    { asset: 'steam_vent', at: [24.2, 5.0] },
    { asset: 'water_tank', at: [6.4, 2.0], scale: 1.3, solid: true },
    { asset: 'water_tank', at: [8.1, 2.0], scale: 1.3, solid: true },
    { asset: 'pipe_v', at: [7.25, 1.5] },
    { asset: 'crate_stack', at: [13.0, 1.85] },
    { asset: 'bench', at: [9.5, 5.26], rot: 180 },
    { asset: 'streetlamp', at: [12.0, 5.35], rot: 180, scale: 1.25 },
    { asset: 'streetlamp', at: [19.4, 5.35], rot: 180, scale: 1.25 },
    // rail stock on the dead track
    { asset: 'tires', at: [27.0, 4.0] },
    { asset: 'cable_spool', at: [28.8, 4.0], rot: 90 },

    // ── signal lane (west wall plane x 3.5, east wall plane x 6.5) ──
    { asset: 'rail_signal', at: [4.4, 8.0] }, // Семафор's signal
    { asset: 'ac_unit', at: [3.5, 13.0], rot: -90, y: 3.4 },
    { asset: 'barrel', at: [4.35, 13.2] },
    { asset: 'wall_lamp', at: [6.5, 13.6], rot: 90, y: 2.5 },
    // the parts store pocket (north wall plane at row 7.5)
    { asset: 'crate_stack', at: [7.6, 7.85] },
    { asset: 'fuse_box', at: [10.0, 7.5], y: 1.0 }, // the key cabinet
    { asset: 'cable_spool', at: [10.16, 10.1], rot: 90 },
    // the dispatcher's balcony
    { asset: 'crt_stack', at: [2.0, 6.8] },

    // ── engine bay (walls x 16.5 / 18.5, back wall at row 10.5) ──
    { asset: 'wall_lamp', at: [17.5, 10.5], y: 2.5 },
  ],
  signs: [
    // turntable yard
    { text: 'ДЕПО', at: [15.6, 1.67], y: 3.6, facing: 'S', color: 'yellow', size: 0.6, light: true },
    { text: 'Esc', at: [19.2, 1.67], y: 3.15, facing: 'S', color: 'red', size: 0.4, light: true },
    { text: '/rewind', at: [21.0, 1.67], y: 3.2, facing: 'S', color: 'green', size: 0.32 },
    { text: 'ultrathink', at: [7.25, 1.67], y: 3.4, facing: 'S', color: 'yellow', size: 0.28 },
    // crane yard: on the front face of the gantry's girder
    { text: '/plan', at: [23, 9.48], y: 4.64, facing: 'S', color: 'yellow', size: 0.45 },
    // platform
    { text: 'СТРЕЛКИ', at: [21.0, 14.67], y: 3.3, facing: 'S', color: 'green', size: 0.42, light: true },
    { text: 'shift+tab', at: [11.2, 14.67], y: 3.4, facing: 'S', color: 'yellow', size: 0.34 },
    // signal lane: the parts store and the dispatcher
    { text: 'СКЛАД', at: [7.7, 7.67], y: 2.55, facing: 'S', color: 'yellow', size: 0.4, light: true },
    { text: '/permissions', at: [9.6, 7.67], y: 2.85, facing: 'S', color: 'green', size: 0.2 },
    { text: 'ДИСПЕТЧЕРСКАЯ', at: [2.5, 6.67], y: 3.25, facing: 'S', color: 'green', size: 0.26, light: true },
  ],
  lights: [
    { at: [11.4, 15.7], y: 3.0, color: '#ffd36b', intensity: 4, distance: 8 }, // Лямбда's hut, spawn
    { at: [21.6, 15.5], y: 2.8, color: '#5dff7a', intensity: 4, distance: 7 }, // the switch post
    // the crane's work light (the model has none): over t2, two metres in front of the girder so its face keeps its paint
    { at: [22.6, 10.5], y: 3.6, color: '#ffd34a', intensity: 4, distance: 10 },
    { at: [25.0, 13.6], y: 3.0, color: '#ffd34a', intensity: 3.5, distance: 7 }, // crane yard, south
    // the turntable, from the drive side: right over the locomotive it burnt the cab roof white
    { at: [21.2, 5.0], y: 4.2, color: '#c8ff7a', intensity: 4.5, distance: 9 },
    { at: [17.5, 3.2], y: 4.2, color: '#ffd98a', intensity: 5, distance: 11 }, // the gate
    { at: [5.0, 12.4], y: 3.0, color: '#ffd36b', intensity: 3.5, distance: 7 }, // signal lane, south
    { at: [8.8, 9.2], y: 2.8, color: '#ffc84a', intensity: 4, distance: 7 }, // the parts store
    { at: [2.6, 8.0], y: 2.6, color: '#7dff9a', intensity: 3, distance: 6 }, // the dispatcher's balcony
    { at: [17.5, 12.2], y: 2.6, color: '#ffb84a', intensity: 3, distance: 6 }, // the engine bay
    { at: [1.4, 17.5], y: 2.4, color: '#ffd34a', intensity: 3, distance: 6 }, // the broken bridge
    { at: [33.6, 3.5], y: 2.4, color: '#5dff7a', intensity: 3, distance: 6 }, // the dead track
    { at: [7.2, 3.3], y: 3.2, color: '#ffd36b', intensity: 3.5, distance: 8 }, // the water tanks
    { at: [28.4, 16.4], y: 3.0, color: '#ffd36b', intensity: 3.5, distance: 8 }, // platform, east
  ],
  mood: {
    fogColor: '#11150d',
    fogDensity: 0.5,
    ambient: '#3d4a2c',
    ambientIntensity: 0.62,
    keyLight: { color: '#eaffb8', intensity: 0.75 },
    accentA: 'yellow',
    accentB: 'green',
    rain: 0,
    seed: 346,
  },
};
