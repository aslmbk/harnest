// The player's cheat sheet: every codex entry of every level, in level order. Each level keeps its
// entries next to its lessons (`levels/l<n>/codex.ts`).
import { codex as codexL1 } from './levels/l1/codex';
import { codex as codexL2 } from './levels/l2/codex';
import { codex as codexL3 } from './levels/l3/codex';
import { codex as codexL4 } from './levels/l4/codex';
import { codex as codexL5 } from './levels/l5/codex';
import type { CodexEntry } from './types';

export const CODEX: CodexEntry[] = [...codexL1, ...codexL2, ...codexL3, ...codexL4, ...codexL5];
