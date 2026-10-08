// Level 5 «Башня Ядра» — the plaza at the foot of the Core tower: white-cyan + red, fog, little rain.
// Cleaner and more monumental than the bazaar: one straight tram avenue on the gate axis, symmetric
// tanks, lamps and benches, the tower wall across the whole north edge.
//
// Route: spawn on the lower plaza (south) → Kron at the mouth of the tram avenue → t1 under the vent
// annex (rooftop ACs, west) → up the avenue, east along the pump street to t2 (tanks and pipes) → back
// across the avenue, west along the tram depot to t3 (tires, cable spools, the siding) → north up the
// avenue to the Core forecourt: t4 at the tower foot, two steps from the gate (the tower entrance).
// Detours: the mail pier at the east end of the pump street (t5 bonus, Pul, c2), catwalks over the
// abyss: west off the lower plaza (c1), west off the depot (c3), east off the forecourt (c4).
//
// Camera: the E–W streets (lower plaza, pump street, depot, forecourt) are 3–4 rows deep with void or
// clamp-lowered blocks to their south; the avenue is N–S, so its walls never hide the robot.
import type { LevelLayout } from '../../types';

export const layout: LevelLayout = {
  map: [
    // 0         1         2         3
    // 0123456789012345678901234567890123
    '    444455556666..666655554444    ', // 0  skyline · the Core tower · exit
    '    444455556666..666655554444    ', // 1  gate (tower entrance)
    '    ..........................    ', // 2  Core forecourt
    '    ....o................o....====', // 3  east catwalk
    '    ..........................====', // 4
    '    ..........................    ', // 5
    '    ###########.==.###########    ', // 6  tram avenue
    '    ###########.==.###########    ', // 7
    '    ###########.==.###########    ', // 8
    '====............==.###########    ', // 9  tram depot · west catwalk
    '====..============.###########    ', // 10 siding
    '    ............==.###########=== ', // 11 mail pier
    '    ###########.==............=== ', // 12 pump street
    '    ###########.==............=== ', // 13
    '    ###########.==............=== ', // 14
    '    ###########.==.###########=== ', // 15
    '    #11111#####.==.###########    ', // 16 vent annex
    '    ............==............    ', // 17 lower plaza
    '====.....o..o...==...o..o.....    ', // 18 west catwalk
    '====............==............    ', // 19
    '    ............==............    ', // 20
    '                                  ', // 21
  ],
  spawn: { at: [20, 19], facing: 'N' },
  gate: { at: [16.5, 1], axis: 'x' },
  exit: [16.5, 0],
  terminals: {
    t1: { at: [7, 17], facing: 'S' }, // under the vent annex and its rooftop ACs
    t2: { at: [22, 12], facing: 'S' }, // pump street, between the tanks
    t3: { at: [11, 9], facing: 'S' }, // tram depot, by the siding
    t4: { at: [14, 2], facing: 'S' }, // the Core console at the tower foot, next to the gate
    t5: { at: [31, 11], facing: 'S' }, // end of the mail pier
  },
  npcs: {
    kron: { at: [14.4, 17.6], facing: 'S' }, // watchman at the avenue mouth, the first one the player meets
    pul: { at: [31, 12.6], facing: 'S' }, // mail drone on its pier
  },
  chips: {
    c1: { at: [0.6, 18.5] }, // west catwalk off the lower plaza
    c2: { at: [32, 15] }, // far corner of the mail pier
    c3: { at: [0.6, 9.5] }, // west catwalk past the depot
    c4: { at: [33, 3.5] }, // east catwalk off the forecourt
  },
  zones: {
    z1: { at: [20, 19], radius: 2 },
    z2: { at: [16.5, 3.5], radius: 2 },
    z3: { at: [29, 13], radius: 1.8 },
  },
  props: [
    // ── Core forecourt: coolant tanks either side of the gate, the console between fuse boxes ──
    { asset: 'water_tank', at: [11.6, 2.0], solid: true },
    { asset: 'water_tank', at: [21.4, 2.0], solid: true },
    { asset: 'pipe_v', at: [10.85, 1.5] }, // clear of the fuse box the dressing hangs at x 11.13
    { asset: 'pipe_v', at: [12.1, 1.5] },
    { asset: 'pipe_v', at: [20.9, 1.5] },
    { asset: 'pipe_v', at: [21.9, 1.5] },
    { asset: 'fuse_box', at: [13.35, 1.5], y: 1.1 },
    { asset: 'fuse_box', at: [14.65, 1.5], y: 1.1 },
    { asset: 'pipe_h', at: [14, 1.5], y: 2.75 },
    { asset: 'vending', at: [5.5, 1.78] },
    { asset: 'crate_stack', at: [27.6, 1.85] },
    { asset: 'barrel', at: [28.9, 1.8] },
    { asset: 'bench', at: [9.5, 4.2], rot: 180 },
    { asset: 'bench', at: [23.5, 4.2], rot: 180 },
    { asset: 'plant_pot', at: [8.2, 4.25] },
    { asset: 'plant_pot', at: [10.8, 4.25] },
    { asset: 'plant_pot', at: [22.2, 4.25] },
    { asset: 'plant_pot', at: [24.8, 4.25] },

    // ── tram avenue ──
    // streetlamps at scale 1.25: the catalog bulb (intensity 7) hangs at 3.6 m instead of 2.9 m, off the wet ground
    { asset: 'streetlamp', at: [14.78, 7.7], rot: -90, scale: 1.25 }, // clear of the barrel the street dressing leans at (14.8, 6.9)
    { asset: 'streetlamp', at: [18.22, 15.2], rot: 90, scale: 1.25 },
    { asset: 'bench', at: [18.25, 9.4], rot: 90 },
    { asset: 'manhole', at: [15, 13.6] },

    // ── tram depot: tires, cable spools, the dispatcher screens ──
    { asset: 'tires', at: [4.75, 8.83] },
    { asset: 'tires', at: [5.6, 8.83], rot: 20 },
    { asset: 'barrel', at: [6.9, 8.75] },
    { asset: 'cable_spool', at: [8.1, 8.75] },
    { asset: 'cable_spool', at: [9.05, 8.75], rot: 10 },
    { asset: 'crt_stack', at: [12.55, 8.78] },
    { asset: 'crate_stack', at: [13.85, 8.85] },
    { asset: 'fuse_box', at: [10.2, 8.5], y: 1.3 },
    { asset: 'pipe_v', at: [9.0, 8.5] },
    { asset: 'pipe_v', at: [4.6, 8.5] },
    { asset: 'ac_unit', at: [9.45, 8.5], y: 1.9 }, // on the plain wall between the spools and the fuse box
    { asset: 'manhole', at: [8, 9.6] },

    // ── pump street: tanks and pipes along the north wall ──
    { asset: 'water_tank', at: [20.0, 12.0], solid: true },
    { asset: 'water_tank', at: [25.6, 12.0], solid: true },
    { asset: 'pipe_v', at: [19.3, 11.5] },
    { asset: 'pipe_v', at: [20.7, 11.5] },
    { asset: 'pipe_v', at: [25.0, 11.5] },
    { asset: 'pipe_v', at: [26.2, 11.5] },
    { asset: 'pipe_h', at: [21.5, 11.5], y: 2.45 },
    { asset: 'fuse_box', at: [23.1, 11.5], y: 1.2 },
    { asset: 'ac_unit', at: [27.0, 11.5], y: 2.3 },
    { asset: 'barrel', at: [27.4, 12.25] },
    { asset: 'barrel', at: [28.1, 12.3] },
    { asset: 'steam_vent', at: [23.5, 13.4] },
    { asset: 'steam_vent', at: [27.0, 13.6] },
    { asset: 'manhole', at: [20.5, 13.6] },

    // ── mail pier: parcels ──
    { asset: 'crate', at: [32.25, 11.35], rot: -10 },
    { asset: 'crate_stack', at: [32.2, 12.3], rot: 90 },
    { asset: 'crate_stack', at: [30.2, 14.6], rot: 90 },
    { asset: 'crate', at: [30.25, 15.2], rot: 12 },
    { asset: 'crate', at: [30.3, 12.0] },
    { asset: 'cable_spool', at: [32.2, 13.8] },
    { asset: 'streetlamp', at: [30.15, 13.0], rot: -90, scale: 1.25 },

    // ── lower plaza: the vent annex (t1), Kron's corner, benches facing the tower ──
    { asset: 'ac_unit', at: [5.6, 16.5], y: 1.9 },
    { asset: 'ac_unit', at: [8.6, 16.5], y: 2.0 },
    { asset: 'pipe_v', at: [6.2, 16.5] },
    { asset: 'steam_vent', at: [5.5, 18.2] },
    { asset: 'steam_vent', at: [8.0, 18.6] },
    { asset: 'manhole', at: [6, 19.4] },
    { asset: 'fuse_box', at: [13.6, 16.5], y: 1.3 },
    { asset: 'bench', at: [10.5, 20.25], rot: 180 },
    { asset: 'bench', at: [22.5, 20.25], rot: 180 },
    { asset: 'plant_pot', at: [9.1, 20.25] },
    { asset: 'plant_pot', at: [11.9, 20.25] },
    { asset: 'plant_pot', at: [21.1, 20.25] },
    { asset: 'plant_pot', at: [23.9, 20.25] },
    { asset: 'streetlamp', at: [14.2, 20.3], rot: 180, scale: 1.25 },
    { asset: 'streetlamp', at: [18.8, 20.3], rot: 180, scale: 1.25 },
    { asset: 'vending', at: [27.5, 16.78] },
    { asset: 'trash_bags', at: [28.65, 16.9] },
  ],
  signs: [
    // the tower entrance
    { text: 'ЯДРО', at: [15.1, 1.67], y: 2.95, facing: 'S', color: 'red', size: 0.5, vertical: true, light: true },
    { text: 'ЯДРО', at: [17.9, 1.67], y: 2.95, facing: 'S', color: 'red', size: 0.5, vertical: true },
    // on top of the gate header (top 3.9): it also keeps the automatic paper lanterns out of the tower entrance
    { text: 'ВХОД', at: [16.5, 1.0], y: 4.21, facing: 'S', color: 'cyan', size: 0.42 },
    // tram depot (a one-storey row: the signs stay under the parapet)
    { text: 'ТРАМВАЙ', at: [6.3, 8.67], y: 2.95, facing: 'S', color: 'cyan', size: 0.45, light: true },
    { text: '--worktree', at: [11, 8.67], y: 3.1, facing: 'S', color: 'white', size: 0.3 },
    { text: '/tasks', at: [13.85, 8.67], y: 2.9, facing: 'S', color: 'cyan', size: 0.3 },
    // pump street and the mail pier
    { text: 'НОЧНАЯ СМЕНА', at: [20, 11.67], y: 3.55, facing: 'S', color: 'red', size: 0.3 },
    { text: 'claude -p', at: [23.2, 11.67], y: 3.3, facing: 'S', color: 'cyan', size: 0.4, light: true },
    { text: 'ПОЧТА', at: [28.2, 11.67], y: 3.3, facing: 'S', color: 'red', size: 0.4, light: true },
    // lower plaza
    { text: 'ВЕНТИЛЯЦИЯ', at: [7, 16.67], y: 2.5, facing: 'S', color: 'cyan', size: 0.24 },
    { text: '@agent-', at: [11.3, 16.67], y: 3.2, facing: 'S', color: 'white', size: 0.36, light: true },
    { text: 'БАШНЯ ЯДРА', at: [24, 16.67], y: 2.6, facing: 'S', color: 'white', size: 0.3 },
  ],
  lights: [
    { at: [16.5, 3.4], y: 4.6, color: '#dff6ff', intensity: 4.5, distance: 12 }, // forecourt, the gate
    { at: [7.5, 3.4], y: 3.8, color: '#cfefff', intensity: 3.5, distance: 9 }, // forecourt, west wing
    { at: [25.5, 3.4], y: 3.8, color: '#cfefff', intensity: 3.5, distance: 9 }, // forecourt, east wing (toward c4)
    { at: [16.5, 9.8], y: 3.6, color: '#8fe3ff', intensity: 5, distance: 9 }, // avenue × depot
    { at: [8.5, 10.2], y: 3.2, color: '#bfefff', intensity: 5, distance: 9 }, // depot
    { at: [24, 13.2], y: 3.4, color: '#6fd6ff', intensity: 5, distance: 9 }, // pump street
    { at: [31, 13.4], y: 3.4, color: '#ff4a3a', intensity: 4.5, distance: 9 }, // mail pier
    { at: [7, 18.4], y: 3.0, color: '#7fe9ff', intensity: 4, distance: 8, flicker: true }, // dead vents
    { at: [22, 18.8], y: 3.6, color: '#e6f6ff', intensity: 5, distance: 10 }, // lower plaza
  ],
  mood: {
    fogColor: '#0c1a22',
    fogDensity: 0.8,
    ambient: '#2c4f63',
    ambientIntensity: 0.6,
    keyLight: { color: '#cfefff', intensity: 0.85 },
    accentA: 'cyan',
    accentB: 'red',
    rain: 0.15,
    seed: 505,
  },
};
