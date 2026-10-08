// Level 2 «Рынок Памяти» — a lantern-lit night market: warm orange + pink, stalls, awnings, paper
// lanterns, light drizzle. A ladder of two market rows between two squares.
//
// Route: spawn at the east end of the Entrance Square (south, on the terrace edge, under РЫНОК) → west
// along the stalls to the price board on the market hall's front (t1, Дед Кэш beside it) → north into
// Lantern Row: the lantern keeper's booth (t2) halfway up, paper lanterns overhead → the Clock Square:
// the gate under the stopped clock (00:00), t3 on the clock works right next to it.
// Detours: Battery Row, the parallel east row, leads to the luggage storage yard (t4 bonus, Свап);
// catwalks over the abyss: west off the Entrance Square (c1), east off the storage yard (c2), east off
// the Clock Square (c4); a dead-end passage into the market hall (c3).
//
// Camera: the rows run north–south (their walls never hide the robot, and the dressing strings lanterns
// and cables across them); the squares and the storage yard are east–west with a low kerb to the south
// (or the drop), so everything on them stays in view. Vertical signs on the corners mark the two rows.
import type { LevelLayout } from '../../types';

export const layout: LevelLayout = {
  map: [
    // 0         1         2         3
    // 0123456789012345678901234567890123
    '5566655566665555..6666555665566655', // 0  skyline · exit
    '4455544455554444..5555444554455544', // 1  gate under the clock
    '####..........................    ', // 2  Clock Square
    '####..........................====', // 3  east catwalk
    '####..........................====', // 4
    '####ooooo...ooooooooo..ooooooo    ', // 5  the square's kerb · row mouths
    '#########...#########..#######    ', // 6  Lantern Row · market hall · Battery Row
    '#########...#########..#######    ', // 7
    '222222222...222222222..2222222    ', // 8
    '222222222#..222222222........2    ', // 9  the lantern keeper's booth · storage yard
    '######333...#########........=====', // 10 east catwalk
    '######333.,.#########........=====', // 11
    '######333...######..#..oooooo##   ', // 12 dead-end passage into the hall · the yard's kerb
    '######333...555555.,5..########   ', // 13
    '55555#333,..555555..5..########   ', // 14
    '55555#333...666666..6..########   ', // 15
    '  .............................   ', // 16 Entrance Square
    '==......,..............,.......   ', // 17 west catwalk
    '==.............................   ', // 18
    '                                  ', // 19 the drop
  ],
  spawn: { at: [28, 17], facing: 'N' },
  gate: { at: [16.5, 1], axis: 'x' },
  exit: [16.5, 0],
  terminals: {
    t1: { at: [15, 16], facing: 'S' }, // the price board on the market hall's front
    t2: { at: [9, 10], facing: 'S' }, // the lantern keeper's booth in Lantern Row
    t3: { at: [19, 2], facing: 'S' }, // the clock works, next to the gate
    t4: { at: [25, 9], facing: 'S' }, // the luggage storage
  },
  npcs: {
    kesh: { at: [12.6, 16.3], facing: 'S' }, // by the price board, the first stop
    swap: { at: [27.3, 10.45], facing: 'S' }, // his storage yard
  },
  chips: {
    c1: { at: [0.4, 17.5] }, // west catwalk off the Entrance Square
    c2: { at: [33.3, 10.5] }, // east catwalk off the storage yard
    c3: { at: [18.5, 12.4] }, // dead end of the passage into the market hall
    c4: { at: [33.3, 3.5] }, // east catwalk off the Clock Square
  },
  zones: {
    z1: { at: [28, 17], radius: 2 },
    z2: { at: [15, 17.2], radius: 1.6 },
    z3: { at: [16.5, 3.2], radius: 1.9 },
  },
  props: [
    // ── Entrance Square, west part (north wall at row 15.5, railing at 18.5) ──
    { asset: 'vending', at: [2.9, 15.85] },
    { asset: 'stall', at: [4.4, 16.05] },
    { asset: 'lantern', at: [3.85, 16.55], y: 2.35 },
    { asset: 'lantern', at: [4.95, 16.55], y: 2.35 },
    { asset: 'stall', at: [6.8, 16.05] },
    { asset: 'lantern', at: [7.35, 16.55], y: 2.35 },
    { asset: 'crate_stack', at: [7.95, 15.95] },
    { asset: 'bench', at: [3.6, 18.22], rot: 180 },
    { asset: 'plant_pot', at: [5.2, 18.25] },
    // streetlamps at scale 1.25: the catalog bulb (intensity 7) hangs at 3.6 m instead of 2.9 m, off the wet ground
    { asset: 'streetlamp', at: [7.4, 18.32], rot: 180, scale: 1.25 },
    // ── Entrance Square: the price board on the market hall ──
    { asset: 'crt_stack', at: [13.75, 15.85] },
    { asset: 'crt_stack', at: [16.25, 15.85] },
    { asset: 'pipe_v', at: [12.2, 15.5] },
    { asset: 'plant_pot', at: [17.45, 15.95] },
    { asset: 'barrel', at: [20.0, 15.95] },
    { asset: 'bench', at: [14.2, 18.22], rot: 180 },
    { asset: 'streetlamp', at: [19.6, 18.32], rot: 180, scale: 1.25 },
    // ── Entrance Square, east part: the market entrance ──
    { asset: 'stall', at: [24.3, 16.05] },
    { asset: 'lantern', at: [23.75, 16.55], y: 2.35 },
    { asset: 'lantern', at: [24.85, 16.55], y: 2.35 },
    { asset: 'stall', at: [26.6, 16.05] },
    { asset: 'lantern', at: [27.15, 16.55], y: 2.35 },
    { asset: 'crate_stack', at: [29.6, 15.95] },
    { asset: 'barrel', at: [30.3, 16.7] },
    { asset: 'crate', at: [29.95, 17.7], rot: 20 },
    { asset: 'bench', at: [25.6, 18.22], rot: 180 },
    { asset: 'plant_pot', at: [23.5, 18.25] },
    // ── dead-end passage into the market hall (walls col 17.5 / 19.5) ──
    { asset: 'trash_bags', at: [19.2, 13.7], rot: 90 },
    { asset: 'crate', at: [18.15, 14.6], rot: 15 },
    { asset: 'wall_lamp', at: [17.5, 13.2], rot: -90, y: 2.6 },

    // ── Lantern Row (west wall col 8.5, east wall col 11.5) ──
    { asset: 'stall', at: [8.95, 13.5], rot: -90 },
    { asset: 'stall', at: [11.05, 11.6], rot: 90 },
    { asset: 'awning', at: [8.5, 11.6], rot: -90, y: 2.4 },
    { asset: 'awning', at: [11.5, 14.3], rot: 90, y: 2.4 },
    { asset: 'crate', at: [9.0, 15.1], rot: 10 },
    { asset: 'ac_unit', at: [8.5, 10.4], rot: -90, y: 3.6 },
    { asset: 'pipe_v', at: [11.5, 9.4], rot: 90 },
    { asset: 'awning', at: [8.5, 6.95], rot: -90, y: 2.4 }, // over the shutter, clear of the wall lamp at row 8
    { asset: 'barrel', at: [9.1, 6.4] },
    { asset: 'crate_stack', at: [10.95, 7.4], rot: 90 },

    // ── Battery Row (west wall col 20.5, east wall col 22.5) ──
    { asset: 'vending', at: [20.8, 11.4], rot: -90 },
    { asset: 'awning', at: [20.5, 13.9], rot: -90, y: 2.4 },
    { asset: 'crate', at: [22.15, 14.2], rot: 80 },
    { asset: 'barrel', at: [20.85, 7.2] },
    { asset: 'wall_lamp', at: [20.5, 9.9], rot: -90, y: 2.5 }, // the row's dark middle, by the yard
    { asset: 'wall_lamp', at: [22.5, 6.9], rot: 90, y: 2.5 }, // the north mouth, east side

    // ── storage yard (north wall at row 8.5) ──
    { asset: 'crate_stack', at: [23.6, 8.95] },
    { asset: 'crate_stack', at: [26.55, 8.95] },
    { asset: 'crate_stack', at: [28.0, 9.15], rot: 90 },
    { asset: 'crate', at: [24.0, 11.15], rot: 20 },
    { asset: 'crate', at: [26.2, 11.2], rot: -15 },
    { asset: 'wall_lamp', at: [28.3, 8.5], y: 2.5 }, // clear of ХРАНЕНИЕ

    // ── Clock Square (north wall at row 1.5, gate at cols 16–17) ──
    { asset: 'stall', at: [6.65, 2.05] }, // clear of the crate the street dressing leans on the wall at (5.8, 1.8)
    { asset: 'lantern', at: [6.1, 2.55], y: 2.35 },
    { asset: 'stall', at: [8.4, 2.05] },
    { asset: 'lantern', at: [8.95, 2.55], y: 2.35 },
    { asset: 'crate_stack', at: [10.6, 2.0] },
    { asset: 'bench', at: [12.6, 2.2] },
    { asset: 'plant_pot', at: [13.85, 2.15] },
    { asset: 'fuse_box', at: [19.35, 1.5], y: 1.1 }, // the dressing already hangs one left of the kiosk
    { asset: 'pipe_v', at: [19.65, 1.5] },
    { asset: 'pipe_h', at: [20.6, 1.5], y: 2.65 },
    { asset: 'plant_pot', at: [21.4, 2.15] },
    { asset: 'bench', at: [22.6, 2.2] },
    { asset: 'plant_pot', at: [23.8, 2.15] },
    { asset: 'stall', at: [26.0, 2.05] },
    { asset: 'lantern', at: [26.55, 2.55], y: 2.35 },
    { asset: 'crate', at: [27.9, 2.1], rot: 15 },
    { asset: 'barrel', at: [28.6, 2.75] },
    { asset: 'manhole', at: [11, 3.6] },
    { asset: 'steam_vent', at: [24.6, 3.8] },
  ],
  signs: [
    // Entrance Square (the market entrance is a one-storey row: РЫНОК stays under its parapet)
    // no sign light: 0.4 m over the stall canopy it burnt the canopy pink-white right at the spawn
    { text: 'РЫНОК', at: [26.5, 15.67], y: 2.95, facing: 'S', color: 'pink', size: 0.55 },
    { text: 'ЦЕНЫ', at: [15, 15.67], y: 3.55, facing: 'S', color: 'orange', size: 0.45, light: true },
    { text: '@', at: [13.3, 15.67], y: 2.95, facing: 'S', color: 'cyan', size: 0.55 },
    { text: '/clear', at: [4.6, 15.67], y: 3.3, facing: 'S', color: 'cyan', size: 0.36 },
    // the mouths of the two rows: vertical signs on the corners
    { text: 'ФОНАРИ', at: [8, 15.67], y: 5.0, facing: 'S', color: 'orange', size: 0.42, vertical: true, light: true },
    { text: 'БАТАРЕЙКИ', at: [20, 15.67], y: 5.6, facing: 'S', color: 'pink', size: 0.36, vertical: true, light: true },
    // high on the booth: any lower and the lantern string across the row hangs in front of it
    { text: '/compact', at: [9, 9.67], y: 3.1, facing: 'S', color: 'pink', size: 0.24 },
    // a blade sign on the west wall: it keeps the automatic wall lamp off the stall below (it burnt the canopy white)
    { text: 'ЧАЙ', at: [8.605, 14.15], y: 3.3, facing: 'S', color: 'pink', size: 0.36, vertical: true },
    // storage yard (a one-storey row: the signs stay under the parapet)
    { text: 'claude -c', at: [24.6, 8.67], y: 2.95, facing: 'S', color: 'cyan', size: 0.34 },
    { text: 'ХРАНЕНИЕ', at: [27.2, 8.67], y: 3.0, facing: 'S', color: 'pink', size: 0.32, light: true },
    // Clock Square
    { text: 'ЧАСЫ', at: [14.7, 1.67], y: 3.5, facing: 'S', color: 'orange', size: 0.45, light: true },
    { text: '00:00', at: [18.4, 1.67], y: 3.55, facing: 'S', color: 'red', size: 0.42, flicker: true, light: true },
    { text: '/memory', at: [22.6, 1.67], y: 3.25, facing: 'S', color: 'pink', size: 0.34 },
  ],
  lights: [
    { at: [27, 17.3], y: 3.2, color: '#ffb066', intensity: 4.5, distance: 9 }, // the market entrance
    { at: [15, 17.1], y: 3.2, color: '#ff9a5c', intensity: 4, distance: 8 }, // the price board
    { at: [21.5, 12.2], y: 3.2, color: '#ff5fa0', intensity: 3.5, distance: 7 }, // Battery Row
    { at: [21.0, 10.3], y: 5.2, color: '#ffb066', intensity: 3, distance: 6 }, // Battery Row, the lit windows up the west wall
    { at: [26.5, 10.4], y: 2.8, color: '#ff5fa0', intensity: 4, distance: 8 }, // storage yard, Свап
    { at: [16.5, 3.2], y: 4.2, color: '#ffc98a', intensity: 5, distance: 11 }, // the gate
    { at: [18.5, 13.2], y: 3.0, color: '#ff9a3c', intensity: 3, distance: 6 }, // the hall passage
    { at: [1.2, 17.5], y: 2.4, color: '#ffb066', intensity: 3, distance: 6 }, // west catwalk
    { at: [31.6, 10.5], y: 2.4, color: '#ffb066', intensity: 3, distance: 6 }, // storage catwalk
    { at: [32, 3.5], y: 2.4, color: '#ff5fa0', intensity: 3, distance: 6 }, // Clock Square catwalk
  ],
  mood: {
    fogColor: '#1c1016',
    fogDensity: 0.45,
    ambient: '#4b3346',
    ambientIntensity: 0.62,
    keyLight: { color: '#ffb8a0', intensity: 0.72 },
    accentA: 'orange',
    accentB: 'pink',
    rain: 0.25,
    seed: 999,
  },
};
