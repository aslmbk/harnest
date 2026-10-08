/**
 * Dialog portraits: a small face screen drawn in SVG, expression by mood. Colour comes from
 * `currentColor` (set from the NPC tint through CSSOM, never interpolated into markup).
 */
import type { Mood, NpcModel } from '../content/types';
import { svg } from './dom';

export type PortraitKind = NpcModel | 'harni';

const FRAMES: Record<NpcModel, string> = {
  npc_tall:
    '<rect x="7" y="9" width="50" height="40" rx="6" class="pf"/><rect x="11" y="13" width="42" height="32" rx="3" class="ps"/><path d="M26 49v6h12v-6" class="pf"/><path d="M32 9V4" class="pl"/><circle cx="32" cy="3.5" r="2" class="pd"/>',
  npc_round:
    '<circle cx="32" cy="32" r="27" class="pf"/><circle cx="32" cy="32" r="22" class="ps"/><path d="M8 32h-4M60 32h-4" class="pl"/>',
  npc_drone:
    '<rect x="4" y="16" width="56" height="34" rx="17" class="pf"/><rect x="9" y="21" width="46" height="24" rx="12" class="ps"/><path d="M14 16l-6-7M50 16l6-7" class="pl"/>',
};

function eyes(mood: Mood): string {
  switch (mood) {
    case 'happy':
      return '<path d="M20 31q4-6 8 0M36 31q4-6 8 0" class="pe-l"/>';
    case 'worried':
      return '<rect x="21" y="27" width="6" height="6" rx="2" class="pe"/><rect x="37" y="27" width="6" height="6" rx="2" class="pe"/><path d="M19 24l8-3M45 24l-8-3" class="pe-l"/>';
    case 'thinking':
      return '<rect x="23" y="24" width="5" height="7" rx="2" class="pe"/><rect x="39" y="24" width="5" height="7" rx="2" class="pe"/><circle cx="48" cy="18" r="1.4" class="pe"/><circle cx="52" cy="15" r="1.1" class="pe"/>';
    case 'excited':
      return '<path d="M24 23l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6zM40 23l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z" class="pe"/>';
    default:
      return '<rect x="21" y="25" width="6" height="8" rx="2" class="pe"/><rect x="37" y="25" width="6" height="8" rx="2" class="pe"/>';
  }
}

function mouth(mood: Mood): string {
  switch (mood) {
    case 'happy':
      return '<path d="M25 39q7 6 14 0" class="pe-l"/>';
    case 'worried':
      return '<path d="M25 41q3.5-3 7 0t7 0" class="pe-l"/>';
    case 'thinking':
      return '<path d="M30 40h7" class="pe-l"/>';
    case 'excited':
      return '<path d="M25 37h14q0 7-7 7t-7-7z" class="pe"/>';
    default:
      return '<path d="M26 40h12" class="pe-l"/>';
  }
}

/** Harni: two binocular eye pods; the lids change with mood. */
function harni(mood: Mood): string {
  const lids: Record<Mood, string> = {
    neutral: '',
    happy: '<path d="M10 30h20v-7H10zM34 30h20v-7H34z" class="hl"/>',
    worried: '<path d="M10 22l20 6v-8H10zM54 22l-20 6v-8h20z" class="hl"/>',
    thinking: '<path d="M34 28h20v-8H34z" class="hl"/>',
    excited: '',
  };
  const pupil = mood === 'excited' ? 5.2 : 4;
  return (
    '<rect x="4" y="14" width="56" height="36" rx="9" class="hh"/>' +
    '<rect x="29" y="27" width="6" height="10" class="hd"/>' +
    '<circle cx="20" cy="32" r="11" class="hd"/><circle cx="44" cy="32" r="11" class="hd"/>' +
    '<circle cx="20" cy="32" r="8" class="hg"/><circle cx="44" cy="32" r="8" class="hg"/>' +
    `<circle cx="21" cy="31" r="${pupil}" class="hp"/><circle cx="45" cy="31" r="${pupil}" class="hp"/>` +
    lids[mood] +
    '<path d="M32 14V7" class="hl-s"/><circle cx="32" cy="6" r="2.4" class="ha"/>'
  );
}

export function portrait(kind: PortraitKind, mood: Mood): SVGSVGElement {
  const body = kind === 'harni' ? harni(mood) : FRAMES[kind] + '<g class="pface">' + eyes(mood) + mouth(mood) + '</g>';
  return svg(`<svg viewBox="0 0 64 64" class="hx-portrait-svg">${body}</svg>`);
}
