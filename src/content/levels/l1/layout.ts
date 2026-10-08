// Level 1 «Переулок Загрузки» — the player's first district: a rainy back alley behind a repair shop that
// winds north past a noodle stall and opens into a small plaza at the alley gate. Orange + cyan, rain.
//
// Route: Harni wakes in the junk pile behind the repair shop (south, Ping hovers there) → t1, the alley
// lights' switchboard at the mouth of the alley → north up the narrow wet alley → the noodle lane:
// Mama Socket's stall under the blinking ЛАПША, t2 beside it (the sign) → the short upper alley → the
// plaza: the gate with ВЫХОД, t3 on the gate drive right next to it.
// Detours: the info booth at the dead east end of the noodle lane (t4 bonus), catwalks over the abyss:
// west off the junk yard (c1), east off the noodle lane (c2), along the repair shop's back wall (c3),
// east off the plaza (c4).
//
// Camera: the alleys run north–south, so their walls never hide the robot and the dressing hangs cables
// and lanterns across them; the two east–west spaces (noodle lane, plaza) keep everything on their north
// side, with clamp-lowered one-storey roofs to their south. The junk yard sits on the terrace edge.
import type { LevelLayout } from '../../types';

export const layout: LevelLayout = {
  map: [
    // 0         1         2
    // 012345678901234567890123456789
    '66655566665555666655..66655566', // 0  skyline · exit
    '55544455554444555544..55544455', // 1  gate
    '#############5.............   ', // 2  plaza
    '#############5.............===', // 3  east catwalk
    '#############4.............===', // 4
    '#############4.............   ', // 5
    '#############4..ooooooooooo   ', // 6  upper alley · the plaza's kerb
    '#############4..11111111111   ', // 7
    '######34445444..22222222222   ', // 8
    '######3.,..............       ', // 9  noodle lane · info booth (east end)
    '######3........,.......===    ', // 10 east catwalk
    '######3................===    ', // 11
    '######4..oooooooooooooo       ', // 12 lower alley · the lane's kerb
    '######4,.##############       ', // 13
    '######3..##############       ', // 14
    '######4.,22222222222222       ', // 15
    '######4..22222222222222       ', // 16
    '4444444..22222222222222       ', // 17
    '  ............======          ', // 18 junk yard · catwalk along the back wall
    '  ..,.........======          ', // 19
    '==............                ', // 20 west catwalk
    '==.......,....                ', // 21
    '  ............                ', // 22
    '                              ', // 23 the drop
  ],
  spawn: { at: [5, 20], facing: 'N' },
  gate: { at: [20.5, 1], axis: 'x' },
  exit: [20.5, 0],
  terminals: {
    t1: { at: [10, 18], facing: 'S' }, // the alley lights' switchboard at the mouth of the alley
    t2: { at: [12, 9], facing: 'S' }, // beside the noodle stall, under its sign
    t3: { at: [23, 2], facing: 'S' }, // the gate drive, next to the gate
    t4: { at: [20, 9], facing: 'S' }, // the info booth at the dead end of the noodle lane
  },
  npcs: {
    ping: { at: [7.4, 19.3], facing: 'S' }, // hovers over the junk pile where Harni wakes
    socket: { at: [8.6, 9.55], facing: 'S' }, // at her stall
  },
  chips: {
    c1: { at: [0.4, 20.5] }, // west catwalk off the junk yard
    c2: { at: [25.3, 10.5] }, // east catwalk off the noodle lane
    c3: { at: [19.2, 18.5] }, // end of the catwalk along the repair shop's back wall
    c4: { at: [29.3, 3.5] }, // east catwalk off the plaza
  },
  zones: {
    z1: { at: [5, 20], radius: 2 },
    z2: { at: [7.5, 11], radius: 1.5 },
    z3: { at: [20.5, 3.2], radius: 1.9 },
  },
  props: [
    // ── junk yard: the pile Harni wakes in (wall plane at row 17.5) ──
    { asset: 'crt_stack', at: [2.95, 17.85] },
    { asset: 'crate_stack', at: [4.65, 17.95] },
    { asset: 'crate', at: [5.85, 18.2], rot: 35 },
    { asset: 'barrel', at: [2.55, 19.15], rot: 40 },
    { asset: 'tires', at: [3.55, 19.3], rot: 20 },
    { asset: 'barrel', at: [2.7, 20.25] },
    { asset: 'tires', at: [3.35, 20.95], rot: -25 },
    { asset: 'trash_bags', at: [4.0, 20.6], rot: 15 },
    { asset: 'trash_bags', at: [2.75, 21.85] },
    { asset: 'crate', at: [3.95, 22.0], rot: -30 },
    { asset: 'tires', at: [4.75, 21.45], rot: 10 },
    { asset: 'crate', at: [5.85, 21.7], rot: 25 },
    { asset: 'barrel', at: [6.7, 22.0] },
    { asset: 'cable_spool', at: [5.95, 19.05], rot: 30 },
    { asset: 'steam_vent', at: [8.0, 19.7] },
    { asset: 'manhole', at: [10.6, 20.6] },
    // ── junk yard: the repair shop and the alley lights' switchboard ──
    { asset: 'fuse_box', at: [9.4, 17.5], y: 1.0 },
    { asset: 'fuse_box', at: [10.6, 17.5], y: 1.25 },
    { asset: 'pipe_v', at: [11.15, 17.5] },
    { asset: 'dumpster', at: [12.5, 18.1] },
    { asset: 'awning', at: [12.4, 17.5], y: 2.5 },
    // streetlamps at scale 1.25: the catalog bulb (intensity 7) hangs at 3.6 m instead of 2.9 m, off the wet ground
    { asset: 'streetlamp', at: [9.6, 22.25], rot: 180, scale: 1.25 },
    { asset: 'cable_spool', at: [12.2, 21.5], rot: -20 },
    { asset: 'trash_bags', at: [13.1, 21.85] },
    // ── catwalk along the back wall ──
    { asset: 'crate', at: [15.2, 17.95], rot: 10 },
    { asset: 'barrel', at: [16.8, 17.85] },

    // ── lower alley (west wall col 6.5, east wall col 8.5) ──
    { asset: 'streetlamp', at: [6.78, 15.6], rot: -90, scale: 1.25 },
    { asset: 'streetlamp', at: [8.22, 12.6], rot: 90, scale: 1.25 },
    { asset: 'pipe_v', at: [6.5, 13.4], rot: -90 },
    { asset: 'pipe_v', at: [6.5, 13.4], rot: -90, y: 3 },
    { asset: 'ac_unit', at: [6.5, 15.0], rot: -90, y: 3.6 }, // on the tall west wall (the east row is one storey)
    { asset: 'wall_lamp', at: [8.5, 16.2], rot: 90, y: 2.6 },
    { asset: 'vines', at: [6.5, 16.4], rot: -90, y: 0.3 },
    { asset: 'trash_bags', at: [8.1, 16.7], rot: 90 },
    { asset: 'crate', at: [6.9, 12.9], rot: 10 },

    // ── noodle lane: Mama Socket's stall (north wall at row 8.5) ──
    { asset: 'stall', at: [10, 9.0] },
    { asset: 'lantern', at: [9.35, 9.5], y: 2.45 },
    { asset: 'lantern', at: [10.65, 9.5], y: 2.45 },
    { asset: 'awning', at: [7.9, 8.5], y: 2.45 },
    { asset: 'barrel', at: [7.35, 9.05] },
    { asset: 'plant_pot', at: [13.35, 9.15] },
    { asset: 'pipe_v', at: [13.3, 8.5] },
    { asset: 'ac_unit', at: [11.2, 8.5], y: 4.2 },
    // ── noodle lane: the info booth at the dead east end ──
    { asset: 'bench', at: [17.6, 9.2] },
    { asset: 'plant_pot', at: [18.85, 9.15] },
    { asset: 'crt_stack', at: [21.2, 8.85] },
    { asset: 'wall_lamp', at: [19.2, 8.5], y: 2.5 },

    // ── upper alley (west wall col 13.5, east wall col 15.5) ──
    { asset: 'pipe_v', at: [13.5, 7.2], rot: -90 },
    { asset: 'wall_lamp', at: [13.5, 6.5], rot: -90, y: 2.6 },
    { asset: 'trash_bags', at: [15.15, 7.6], rot: -90 },
    { asset: 'vines', at: [15.5, 8.2], rot: 90, y: 0.3 },

    // ── plaza (north wall at row 1.5, west wall col 13.5) ──
    { asset: 'bench', at: [16.0, 2.2] },
    { asset: 'plant_pot', at: [14.8, 2.15] },
    { asset: 'plant_pot', at: [17.3, 2.15] },
    { asset: 'awning', at: [16, 1.5], y: 2.5 },
    { asset: 'streetlamp', at: [18.7, 2.25], scale: 1.25 },
    { asset: 'vending', at: [14.35, 3.7], rot: -90 },
    { asset: 'fuse_box', at: [22.35, 1.5], y: 1.1 },
    { asset: 'pipe_h', at: [23.0, 1.5], y: 2.7 },
    { asset: 'pipe_v', at: [23.75, 1.5] },
    { asset: 'crate_stack', at: [25.6, 2.0] },
    { asset: 'barrel', at: [26.4, 2.85] },
    { asset: 'trash_bags', at: [24.7, 2.25] },
    { asset: 'manhole', at: [17.5, 4.0] },
    { asset: 'steam_vent', at: [24.0, 4.2] },
  ],
  signs: [
    // junk yard
    { text: 'claude', at: [10, 17.67], y: 2.95, facing: 'S', color: 'orange', size: 0.42, light: true },
    // close enough over the awning that no automatic wall lamp grows through the awning into it; no sign light:
    // 0.2 m over the awning it burnt the cloth white (the claude sign and the switchboard light keep the shop lit)
    { text: 'РЕМОНТ', at: [12.3, 17.67], y: 3.5, facing: 'S', color: 'orange', size: 0.42, flicker: true },
    // noodle lane
    // no sign light: right over the stall canopy it burnt the canopy white (the lane light below does its job)
    { text: 'ЛАПША', at: [10, 8.67], y: 3.5, facing: 'S', color: 'cyan', size: 0.55, flicker: true },
    { text: '/init', at: [12.2, 8.67], y: 2.85, facing: 'S', color: 'orange', size: 0.34 },
    { text: 'CLAUDE.md', at: [7.9, 8.67], y: 3.3, facing: 'S', color: 'cyan', size: 0.3 },
    // info booth (a one-storey row: the signs stay on the ground storey, under the parapet)
    { text: 'СПРАВКА', at: [20, 8.67], y: 2.95, facing: 'S', color: 'cyan', size: 0.42, light: true },
    { text: '/help', at: [18.0, 8.67], y: 2.85, facing: 'S', color: 'orange', size: 0.34 },
    { text: '?', at: [21.6, 8.67], y: 2.85, facing: 'S', color: 'orange', size: 0.5 },
    // plaza
    // on top of the gate header (top 3.9): it also keeps the automatic lantern string out of the gate
    { text: 'ВЫХОД', at: [20.5, 1.0], y: 4.21, facing: 'S', color: 'red', size: 0.42 },
    { text: 'Esc', at: [22.4, 1.67], y: 3.55, facing: 'S', color: 'orange', size: 0.32 },
    { text: '/exit', at: [24.6, 1.67], y: 3.3, facing: 'S', color: 'cyan', size: 0.36, light: true },
  ],
  lights: [
    { at: [3.7, 20.1], y: 2.6, color: '#ff8a3c', intensity: 3.5, distance: 7, flicker: true }, // the junk pile
    { at: [7.3, 19.4], y: 2.4, color: '#5fe0ff', intensity: 4, distance: 7 }, // Ping over the junk pile
    { at: [10.5, 19.4], y: 3.2, color: '#ffb066', intensity: 4, distance: 8 }, // t1, the switchboard
    // the noodle lane in ЛАПША's cyan, high and in front of the stall so its canopy keeps its stripes
    // (the stall's own lights and its two lanterns make the warm core)
    { at: [10, 10.6], y: 4.8, color: '#5fe0ff', intensity: 3.5, distance: 9 },
    { at: [19.5, 10.2], y: 3.2, color: '#5fe0ff', intensity: 4.5, distance: 8 }, // info booth
    { at: [14.5, 7.2], y: 3.2, color: '#5fe0ff', intensity: 3.5, distance: 7 }, // upper alley
    { at: [20.5, 3.4], y: 4.2, color: '#ffc98a', intensity: 5, distance: 11 }, // the gate
    { at: [24.5, 10.6], y: 2.4, color: '#5fe0ff', intensity: 3, distance: 6 }, // lane catwalk
    { at: [28, 3.5], y: 2.4, color: '#5fe0ff', intensity: 3, distance: 6 }, // plaza catwalk
    { at: [17.5, 18.6], y: 2.4, color: '#ff9a3c', intensity: 3, distance: 6 }, // back-wall catwalk
  ],
  mood: {
    fogColor: '#0b1a22',
    fogDensity: 0.55,
    ambient: '#27455a',
    ambientIntensity: 0.6,
    keyLight: { color: '#8fb8ff', intensity: 0.8 },
    accentA: 'orange',
    accentB: 'cyan',
    rain: 0.8,
    seed: 101,
  },
};
