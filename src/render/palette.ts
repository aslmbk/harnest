/**
 * Material palette of the asset contract (design doc §7.6) as pure data, plus neon and wall tints.
 * Keep in sync with `blender/scripts/common.py` PALETTE. No three.js imports: the level planner uses it too.
 */
import type { NeonColor } from '../content/types';

export interface MatSpec {
  color: string;
  metal: number;
  rough: number;
  emissive?: string;
  /** Emission strength as authored in Blender (× colour). */
  strength?: number;
}

export const PALETTE: Readonly<Record<string, MatSpec>> = {
  M_Wall: { color: '#9a968f', metal: 0, rough: 0.9 },
  M_NpcPaint: { color: '#8a9496', metal: 0.3, rough: 0.6 },
  M_Concrete: { color: '#6c7074', metal: 0, rough: 0.92 },
  M_ConcreteDark: { color: '#3b3e42', metal: 0, rough: 0.95 },
  M_Plaster: { color: '#8c8377', metal: 0, rough: 0.9 },
  M_PlasterTeal: { color: '#3d6763', metal: 0, rough: 0.88 },
  M_PlasterRust: { color: '#8a4a36', metal: 0, rough: 0.9 },
  M_PlasterOchre: { color: '#a8843f', metal: 0, rough: 0.9 },
  M_Brick: { color: '#6b4335', metal: 0, rough: 0.95 },
  M_RoofTar: { color: '#26282b', metal: 0, rough: 0.85 },
  M_MetalDark: { color: '#2c3035', metal: 0.85, rough: 0.5 },
  M_MetalSteel: { color: '#7d858c', metal: 0.9, rough: 0.4 },
  M_MetalGalv: { color: '#8f979c', metal: 0.8, rough: 0.5 },
  M_MetalRust: { color: '#7b4b2c', metal: 0.35, rough: 0.85 },
  M_MetalYellow: { color: '#c9a227', metal: 0.3, rough: 0.6 },
  M_MetalRed: { color: '#9c3327', metal: 0.3, rough: 0.6 },
  M_MetalTeal: { color: '#2f6f73', metal: 0.3, rough: 0.6 },
  M_Rubber: { color: '#19191b', metal: 0, rough: 0.95 },
  M_PlasticDark: { color: '#202327', metal: 0, rough: 0.6 },
  M_PlasticLight: { color: '#c9c4b8', metal: 0, rough: 0.55 },
  M_Wood: { color: '#6a4a30', metal: 0, rough: 0.85 },
  M_WoodLight: { color: '#93704b', metal: 0, rough: 0.85 },
  M_Cardboard: { color: '#a5865a', metal: 0, rough: 0.95 },
  M_TarpBlue: { color: '#2c4d78', metal: 0, rough: 0.8 },
  M_TarpOrange: { color: '#c2672c', metal: 0, rough: 0.8 },
  M_TarpGreen: { color: '#3d6b4f', metal: 0, rough: 0.8 },
  M_Paper: { color: '#d9cfbd', metal: 0, rough: 0.9 },
  M_Plant: { color: '#3c7a3b', metal: 0, rough: 0.8 },
  M_PlantDark: { color: '#24512b', metal: 0, rough: 0.85 },
  M_Trash: { color: '#1e2126', metal: 0, rough: 0.5 },
  M_Cable: { color: '#121214', metal: 0, rough: 0.7 },
  M_Glass: { color: '#0f1a22', metal: 0, rough: 0.08 },
  M_WindowLit: { color: '#ffb866', metal: 0, rough: 0.5, emissive: '#ffb866', strength: 4 },
  M_WindowLitCool: { color: '#8fd8ff', metal: 0, rough: 0.5, emissive: '#8fd8ff', strength: 3 },
  M_LampWarm: { color: '#ffd9a3', metal: 0, rough: 0.5, emissive: '#ffd9a3', strength: 12 },
  M_LanternGlow: { color: '#ff9440', metal: 0, rough: 0.7, emissive: '#ff9440', strength: 6 },
  M_ScreenGlow: { color: '#37e6c8', metal: 0, rough: 0.3, emissive: '#37e6c8', strength: 3 },
  M_NeonPink: { color: '#ff2e88', metal: 0, rough: 0.4, emissive: '#ff2e88', strength: 10 },
  M_NeonCyan: { color: '#19e3ff', metal: 0, rough: 0.4, emissive: '#19e3ff', strength: 10 },
  M_NeonOrange: { color: '#ff8a1f', metal: 0, rough: 0.4, emissive: '#ff8a1f', strength: 10 },
  M_NeonGreen: { color: '#5dff7a', metal: 0, rough: 0.4, emissive: '#5dff7a', strength: 8 },
  M_NeonYellow: { color: '#ffe14a', metal: 0, rough: 0.4, emissive: '#ffe14a', strength: 8 },
  M_NeonViolet: { color: '#a66bff', metal: 0, rough: 0.4, emissive: '#a66bff', strength: 10 },
  M_NeonRed: { color: '#ff3b30', metal: 0, rough: 0.4, emissive: '#ff3b30', strength: 10 },
  M_HarniShell: { color: '#d97757', metal: 0.2, rough: 0.55 },
  M_HarniShellDark: { color: '#8f4a33', metal: 0.2, rough: 0.65 },
  M_HarniCream: { color: '#e8dcc6', metal: 0.1, rough: 0.6 },
  M_Track: { color: '#1a1a1c', metal: 0, rough: 0.9 },
  M_EyeGlow: { color: '#ffe9c4', metal: 0, rough: 0.2, emissive: '#ffe9c4', strength: 6 },
  M_HarniScreen: { color: '#19e3ff', metal: 0, rough: 0.3, emissive: '#19e3ff', strength: 3 },
  M_TerminalScreen: { color: '#ff9a3c', metal: 0, rough: 0.3, emissive: '#ff9a3c', strength: 2.5 },
  M_NpcFace: { color: '#37e6c8', metal: 0, rough: 0.3, emissive: '#37e6c8', strength: 2 },
  M_GateLight: { color: '#ff3b30', metal: 0, rough: 0.4, emissive: '#ff3b30', strength: 6 },
  M_ChipGlow: { color: '#5dff7a', metal: 0, rough: 0.4, emissive: '#5dff7a', strength: 6 },
};

export const NEON_HEX: Readonly<Record<NeonColor, string>> = {
  pink: '#ff2e88',
  cyan: '#19e3ff',
  orange: '#ff8a1f',
  green: '#5dff7a',
  yellow: '#ffe14a',
  red: '#ff3b30',
  violet: '#a66bff',
  white: '#e8f4ff',
};

/**
 * Per-building tints multiplied into M_Wall (#9a968f). Chosen to read as painted plaster at night:
 * muted, never saturated, so neon stays the loudest thing on screen.
 */
export const WALL_TINTS: readonly string[] = [
  '#9fc4c0', // teal
  '#d6a08a', // rust
  '#d8c08a', // ochre
  '#a6b2cc', // blue grey
  '#c79fa8', // dusty pink
  '#b2c09a', // olive
  '#e4dccf', // pale
  '#8e9aa0', // dark grey
];
