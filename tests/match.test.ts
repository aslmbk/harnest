import { describe, expect, it } from 'vitest';
import { comboFromEvent, matchesCommand, matchesKeys, normalizeInput, wrongReply } from '../src/content/match';

describe('normalizeInput', () => {
  it('trims, collapses whitespace and straightens quotes', () => {
    expect(normalizeInput('  claude   -p  “привет”  ')).toBe('claude -p "привет"');
  });
});

describe('matchesCommand', () => {
  it('anchors patterns and ignores case', () => {
    expect(matchesCommand({ accept: ['/init'] }, ' /INIT ')).toBe(true);
    expect(matchesCommand({ accept: ['/init'] }, '/init now')).toBe(false);
    expect(matchesCommand({ accept: ['claude -p ["\'].+["\']'] }, "claude -p 'fix the bug'")).toBe(true);
  });

  it('finds tailored replies', () => {
    expect(wrongReply({ wrong: [{ match: 'claude code', reply: 'короче' }] }, 'Claude Code')).toBe('короче');
    expect(wrongReply({ wrong: [] }, 'x')).toBeUndefined();
  });
});

describe('comboFromEvent', () => {
  it('builds canonical combos', () => {
    expect(comboFromEvent({ key: 'Tab', shiftKey: true })).toBe('Shift+Tab');
    expect(comboFromEvent({ key: 'c', ctrlKey: true })).toBe('Ctrl+C');
    expect(comboFromEvent({ key: 'Escape' })).toBe('Escape');
    expect(comboFromEvent({ key: '!', shiftKey: true })).toBe('!');
    expect(comboFromEvent({ key: 'Shift', shiftKey: true })).toBeNull();
  });
});

describe('matchesKeys', () => {
  it('matches the tail of the pressed sequence', () => {
    expect(matchesKeys({ keys: ['Escape', 'Escape'] }, ['A', 'Escape', 'Escape'])).toBe(true);
    expect(matchesKeys({ keys: ['Escape', 'Escape'] }, ['Escape'])).toBe(false);
    expect(matchesKeys({ keys: ['Shift+Tab'] }, ['shift+tab'])).toBe(true);
  });
});
