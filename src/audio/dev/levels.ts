/**
 * Audio inputs for every district, for the dev harness and the checks. Real content wins; districts
 * the content does not have yet get a stand-in mood following GAME_DESIGN §5 "Level moods".
 */
import { LEVELS } from '../../content';
import { levelInputFromContent } from '../director';
import type { LevelAudioInput } from '../profiles';

const STAND_INS: LevelAudioInput[] = [
  { id: 'l1', index: 1, mood: { rain: 0.5, fogDensity: 0.5 }, neonSigns: 3 }, // rainy narrow alley
  { id: 'l2', index: 2, mood: { rain: 0.15, fogDensity: 0.45 }, neonSigns: 8 }, // lantern-lit market
  { id: 'l3', index: 3, mood: { rain: 0, fogDensity: 0.55 }, neonSigns: 4 }, // industrial depot, steam, dry
  { id: 'l4', index: 4, mood: { rain: 0.6, fogDensity: 0.5 }, neonSigns: 10, flickerSigns: 3 }, // tech bazaar, rain
  { id: 'l5', index: 5, mood: { rain: 0.2, fogDensity: 0.85 }, neonSigns: 5 }, // tower plaza, fog
];

/** One input per district index 1..5. */
export function districtInputs(): LevelAudioInput[] {
  return STAND_INS.map((standIn) => {
    const real = LEVELS.find((l) => l.index === standIn.index);
    return (real && levelInputFromContent(real.id)) || standIn;
  });
}

/** Resolver for the harness director: real content first, then the stand-ins. */
export function devResolveLevel(levelId: string): LevelAudioInput | null {
  return levelInputFromContent(levelId) ?? STAND_INS.find((s) => s.id === levelId) ?? null;
}
