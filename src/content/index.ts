import { CODEX } from './codex';
import { level1 } from './levels/l1';
import { level2 } from './levels/l2';
import { level3 } from './levels/l3';
import { level4 } from './levels/l4';
import { level5 } from './levels/l5';
import type { CodexEntry, LevelDef, TerminalLesson } from './types';

/** All levels in play order (ascending `index`). */
export const LEVELS: LevelDef[] = [level1, level2, level3, level4, level5];

export { CODEX };

export function getLevel(levelId: string): LevelDef {
  const level = LEVELS.find((l) => l.id === levelId);
  if (!level) throw new Error(`Unknown level "${levelId}"`);
  return level;
}

export function getNextLevel(levelId: string): LevelDef | undefined {
  return LEVELS[LEVELS.findIndex((l) => l.id === levelId) + 1];
}

export function getTerminal(levelId: string, terminalId: string): TerminalLesson {
  const terminal = getLevel(levelId).lessons.terminals.find((t) => t.id === terminalId);
  if (!terminal) throw new Error(`Unknown terminal "${terminalId}" in level "${levelId}"`);
  return terminal;
}

export function getCodexEntry(id: string): CodexEntry | undefined {
  return CODEX.find((e) => e.id === id);
}
