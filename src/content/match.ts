/**
 * Answer matching shared by the terminal simulator (UI) and the content tests.
 */
import type { CommandStep, KeyStep } from './types';

/** Trim, collapse whitespace, straighten curly quotes. */
export function normalizeInput(raw: string): string {
  return raw
    .replace(/[‘’]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Anchored, case-insensitive regex from an `accept` / `wrong.match` source. */
export function compilePattern(source: string): RegExp {
  return new RegExp(`^(?:${source})$`, 'i');
}

export function matchesCommand(step: Pick<CommandStep, 'accept'>, input: string): boolean {
  const value = normalizeInput(input);
  return step.accept.some((src) => compilePattern(src).test(value));
}

/** Tailored feedback for a known mistake, if any. */
export function wrongReply(step: Pick<CommandStep, 'wrong'>, input: string): string | undefined {
  const value = normalizeInput(input);
  return step.wrong?.find((w) => compilePattern(w.match).test(value))?.reply;
}

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);

/**
 * Canonical combo string for a key event, or null for a bare modifier press.
 * Format: [Ctrl+][Alt+][Shift+][Meta+]Key
 *   - letters are upper-cased:           'Ctrl+C', 'A'
 *   - named keys keep KeyboardEvent.key: 'Escape', 'Shift+Tab', 'Enter'
 *   - printable symbols never carry Shift: '!', '#', '@', '?', '/'
 */
export function comboFromEvent(e: KeyLike): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const isChar = e.key.length === 1;
  const isLetter = isChar && e.key.toLowerCase() !== e.key.toUpperCase();
  const key = isLetter ? e.key.toUpperCase() : e.key === ' ' ? 'Space' : e.key;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey && (!isChar || isLetter)) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');
  parts.push(key);
  return parts.join('+');
}

/** True when `pressed` (combos so far) completes the step's sequence. */
export function matchesKeys(step: Pick<KeyStep, 'keys'>, pressed: readonly string[]): boolean {
  if (pressed.length < step.keys.length) return false;
  const tail = pressed.slice(-step.keys.length);
  return step.keys.every((k, i) => k.toLowerCase() === tail[i].toLowerCase());
}
