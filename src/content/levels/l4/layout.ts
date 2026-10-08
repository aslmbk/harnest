// Level 4 «Квартал Инструментов» — a tech bazaar on the edge of the terrace: violet + green neon, rain.
//
// Route: spawn at the west end of Market Row (south) → Sima's stall at the mouth of the north lane →
// east along the row into the drain yard (t1, steam vents, manholes, pipes) → back to Sima's stall
// (t2, the market scales) → up the north lane → the gate plaza: t3 under the noodle-shop sign ЛАПША
// (Sima: "терминал там же, у ворот") → the gate.
// Detours: Jason's yard off the lane (t4 bonus), a dead-end nook across the lane (c3), catwalks over the
// abyss: south off Market Row (c2), east off the drain yard (c1), west off the gate plaza (c4).
//
// Camera: the only E–W streets (Market Row, the gate plaza, Jason's yard) are 3–4 rows deep with void,
// low roofs or the clamp-lowered blocks to their south; the lane is N–S, so its walls never hide the robot.
import type { LevelLayout } from '../../types';

export const layout: LevelLayout = {
  map: [
    // 0         1         2         3
    // 01234567890123456789012345678901
    '     56656665..56655665566556655', // 0  skyline · exit
    '     45545554..55455665566556655', // 1  gate
    '=====.................##########', // 2  west catwalk · gate plaza
    '=====.................##########', // 3
    '     o...............o##########', // 4
    '############...#################', // 5  north lane
    '############...#################', // 6
    '#####............###############', // 7  Jason's yard · lane · nook
    '#####............######5555555##', // 8
    '#####..........########.,.....  ', // 9  drain yard
    '############...########,,..,,.  ', // 10
    '############...########.,,,,,,  ', // 11
    '############...########..,,.,,==', // 12 east catwalk
    '############...########.,,,,..==', // 13
    ' ..............,..........,,..  ', // 14 Market Row
    ' ....,......................,.  ', // 15
    ' ..............,,..........,..  ', // 16
    ' ...........................o.  ', // 17
    '                 ==             ', // 18 south catwalk
    '                 ==             ', // 19
  ],
  spawn: { at: [4, 16], facing: 'N' },
  gate: { at: [13.5, 1], axis: 'x' },
  exit: [13.5, 0],
  terminals: {
    t1: { at: [26, 9], facing: 'S' }, // drain yard, against the pipe wall
    t2: { at: [11, 14], facing: 'S' }, // next to Sima's stall (the scales)
    t3: { at: [18, 2], facing: 'S' }, // under ЛАПША, by the gate
    t4: { at: [7, 7], facing: 'S' }, // Jason's till
  },
  npcs: {
    sima: { at: [9.6, 14.75], facing: 'S' },
    jason: { at: [9.2, 7.75], facing: 'S' },
  },
  chips: {
    c1: { at: [31, 12.5] }, // east catwalk past the drains
    c2: { at: [17.5, 19] }, // south catwalk off Market Row
    c3: { at: [16, 8] }, // dead-end nook across the lane
    c4: { at: [0.6, 2.5] }, // west catwalk off the gate plaza
  },
  zones: {
    z1: { at: [4, 16], radius: 2 },
    z2: { at: [13.5, 3.2], radius: 1.9 },
    z3: { at: [11, 8], radius: 2 },
  },
  props: [
    // ── Market Row, north side (wall plane at row 13.5) ──
    { asset: 'vending', at: [1.55, 13.86] },
    { asset: 'awning', at: [3, 13.5], y: 2.45 }, // between the wall lamps the dressing hangs at x 2 and 4
    { asset: 'crt_stack', at: [3.0, 13.85] }, // under the awning, a tile from either wall lamp: its glow does not stack on theirs
    { asset: 'crate_stack', at: [4.25, 13.95] },
    { asset: 'stall', at: [6.2, 14.05] },
    { asset: 'stall', at: [8.4, 14.05] }, // Sima's stall
    { asset: 'barrel', at: [10.1, 13.95] },
    { asset: 'pipe_v', at: [11.35, 13.5] }, // on the corner block, not standing loose in the lane mouth
    { asset: 'stall', at: [16, 14.05] },
    { asset: 'crate', at: [17.55, 13.9], rot: 15 },
    { asset: 'awning', at: [19, 13.5], y: 2.45 },
    { asset: 'vending', at: [18.75, 13.86] },
    { asset: 'crate_stack', at: [20.45, 13.95] },
    { asset: 'trash_bags', at: [21.8, 14.05] },
    // ── Market Row, south side (railing at row 17.5) ──
    { asset: 'crate', at: [2.4, 17.15], rot: -20 },
    { asset: 'barrel', at: [1.45, 16.9] },
    { asset: 'plant_pot', at: [5.3, 17.2] },
    { asset: 'bench', at: [7, 17.22], rot: 180 },
    // streetlamps at scale 1.25: the catalog bulb (intensity 7) hangs at 3.6 m instead of 2.9 m, off the wet ground
    { asset: 'streetlamp', at: [12.5, 17.32], rot: 180, scale: 1.25 },
    { asset: 'manhole', at: [14.2, 16.3] },
    { asset: 'crate', at: [9.4, 17.2], rot: 10 },
    { asset: 'trash_bags', at: [15.6, 17.15] },
    { asset: 'bench', at: [20.5, 17.22], rot: 180 },
    { asset: 'plant_pot', at: [22.2, 17.2] },

    // ── drain yard (north pipe wall at row 8.5, west wall at col 22.5) ──
    { asset: 'pipe_v', at: [24.75, 8.5] },
    { asset: 'pipe_v', at: [24.75, 8.5], y: 3 },
    { asset: 'pipe_v', at: [27.25, 8.5] },
    { asset: 'pipe_v', at: [27.25, 8.5], y: 3 },
    { asset: 'pipe_h', at: [26, 8.5], y: 3.05 },
    { asset: 'pipe_h', at: [28.4, 8.5], y: 2.2 },
    { asset: 'fuse_box', at: [25.05, 8.5], y: 0.9 },
    { asset: 'water_tank', at: [28.6, 9.45], solid: true },
    { asset: 'barrel', at: [23.45, 9.35] },
    { asset: 'barrel', at: [23.5, 10.05], rot: 40 },
    { asset: 'steam_vent', at: [24.6, 11.3] },
    { asset: 'steam_vent', at: [27.7, 12.4] },
    { asset: 'steam_vent', at: [25.3, 15.1] },
    { asset: 'manhole', at: [28.3, 11] },
    { asset: 'manhole', at: [24.2, 13.6] },
    { asset: 'manhole', at: [27.6, 15.9] },
    { asset: 'pipe_v', at: [22.5, 10.3], rot: -90 },
    { asset: 'pipe_v', at: [22.5, 10.3], rot: -90, y: 3 },
    { asset: 'pipe_h', at: [22.5, 11.3], rot: -90, y: 2.7 },
    { asset: 'ac_unit', at: [22.5, 12.2], rot: -90, y: 3.6 },
    { asset: 'streetlamp', at: [29.3, 14.6], rot: 90, scale: 1.25 },
    { asset: 'cable_spool', at: [23.7, 16.7], rot: 20 },

    // ── north lane (west wall col 11.5, east wall col 14.5) ──
    { asset: 'pipe_v', at: [11.5, 11.2], rot: -90 },
    { asset: 'pipe_v', at: [14.5, 12.3], rot: 90 },
    { asset: 'ac_unit', at: [14.5, 11.0], rot: 90, y: 2.0 }, // the lane's walls are one storey: on the ground storey
    { asset: 'barrel', at: [12.05, 12.5] },
    { asset: 'crate', at: [14.15, 11.3], rot: -10 },

    // ── Jason's yard (shopfront at row 6.5, west wall col 4.5; a one-storey row) ──
    { asset: 'awning', at: [6.5, 6.5], y: 2.15 }, // a metre clear of the НАБОРЫ light
    { asset: 'awning', at: [9.2, 6.5], y: 2.15 },
    { asset: 'crt_stack', at: [5.4, 6.83] },
    { asset: 'crt_stack', at: [4.92, 8.6], rot: -90 },
    { asset: 'vending', at: [10.65, 6.86] },
    { asset: 'crate', at: [8.35, 6.95] },
    { asset: 'crate_stack', at: [5.5, 9.55], rot: 180 },
    { asset: 'fuse_box', at: [4.5, 7.4], rot: -90, y: 1 },

    // ── nook across the lane ──
    { asset: 'dumpster', at: [15.9, 6.98] },
    { asset: 'wall_lamp', at: [16.0, 6.5], y: 2.5 }, // over the back door: the dead end is otherwise dark once c3 is taken
    { asset: 'trash_bags', at: [16.55, 8.55], rot: 30 },

    // ── gate plaza (skyline wall at row 1.5) ──
    { asset: 'stall', at: [20.15, 2.05] }, // the noodle stall
    { asset: 'lantern', at: [19.6, 2.55], y: 2.35 },
    { asset: 'lantern', at: [20.8, 2.55], y: 2.35 },
    { asset: 'bench', at: [16.2, 2.0] },
    // the street dressing leans a crate and trash bags on this wall at x 7.1, 8.1 and 10.9: keep clear
    { asset: 'crate_stack', at: [11.75, 2.0] },
    { asset: 'barrel', at: [15.55, 2.05] },
    { asset: 'plant_pot', at: [5.4, 2.0] },
    { asset: 'trash_bags', at: [6.4, 4.3] },
    { asset: 'awning', at: [9.25, 1.5], y: 2.5 }, // clear of the pipe the dressing runs up the wall at x 8.63
    { asset: 'fuse_box', at: [12, 1.5], y: 1.0 },
  ],
  signs: [
    // drain yard — MCP
    { text: 'claude mcp add', at: [26, 8.67], y: 3.75, facing: 'S', color: 'green', size: 0.42, light: true },
    { text: '/mcp', at: [28.65, 8.67], y: 3.3, facing: 'S', color: 'cyan', size: 0.5 },
    { text: 'ПЕРЕХОДНИКИ', at: [21.55, 13.67], y: 3.35, facing: 'S', color: 'violet', size: 0.34 },
    // the small signs over the vending machine, the first stall and the noodle stall also keep the automatic
    // wall lamps off them (a lamp half a metre above a canopy burns it white)
    { text: '24/7', at: [1.5, 13.67], y: 2.6, facing: 'S', color: 'green', size: 0.26 },
    { text: 'ПАЙКА', at: [6.2, 13.67], y: 2.95, facing: 'S', color: 'cyan', size: 0.3 },
    // Sima's stall — skills (a one-storey row: the signs stay under the parapet)
    { text: 'РЕЦЕПТЫ', at: [7.3, 13.67], y: 2.95, facing: 'S', color: 'green', size: 0.46, light: true },
    { text: 'SKILL.md', at: [11, 13.67], y: 2.95, facing: 'S', color: 'violet', size: 0.34 },
    { text: '$ARGUMENTS', at: [16.3, 13.67], y: 3.25, facing: 'S', color: 'pink', size: 0.28 },
    // gate plaza — hooks
    { text: 'ЛАПША', at: [18.7, 1.67], y: 3.55, facing: 'S', color: 'pink', size: 0.5, flicker: true, light: true },
    { text: 'КРЮЧКИ', at: [9, 1.67], y: 3.55, facing: 'S', color: 'violet', size: 0.5, light: true },
    { text: '/hooks', at: [16.1, 1.67], y: 3.35, facing: 'S', color: 'cyan', size: 0.4 },
    { text: 'ВОК', at: [20.15, 1.67], y: 2.85, facing: 'S', color: 'green', size: 0.3 },
    // on top of the gate header (top 3.9): it also keeps the automatic lantern string out of the gate
    { text: 'ВЫХОД', at: [13.5, 1.0], y: 4.21, facing: 'S', color: 'violet', size: 0.42 },
    // Jason's shop — settings and plugins (one storey: НАБОРЫ between the awnings and the parapet)
    { text: 'НАБОРЫ', at: [7.5, 6.67], y: 3.07, facing: 'S', color: 'green', size: 0.42, light: true },
    { text: '/plugin', at: [5.6, 6.67], y: 2.95, facing: 'S', color: 'violet', size: 0.3 },
    { text: '/config', at: [10.2, 6.67], y: 3.0, facing: 'S', color: 'cyan', size: 0.28 },
  ],
  lights: [
    // drain yard: higher and softer, the puddles turned it into a white glint in front of t1
    { at: [26, 10.6], y: 4.4, color: '#5fe0ff', intensity: 3.5, distance: 9 },
    { at: [9.6, 15.4], y: 3.2, color: '#ffb066', intensity: 4.5, distance: 9 }, // Sima's stall
    { at: [15, 3.2], y: 3.8, color: '#c08bff', intensity: 5, distance: 10 }, // gate plaza
    { at: [8, 8.3], y: 3, color: '#a66bff', intensity: 5, distance: 8 }, // Jason's yard
    { at: [13, 11.5], y: 3.2, color: '#7dff9a', intensity: 4, distance: 8, flicker: true }, // north lane
  ],
  mood: {
    fogColor: '#130c22',
    fogDensity: 0.5,
    ambient: '#3b2f66',
    ambientIntensity: 0.62,
    keyLight: { color: '#b7a3ff', intensity: 0.75 },
    accentA: 'violet',
    accentB: 'green',
    rain: 0.7,
    seed: 404,
  },
};
