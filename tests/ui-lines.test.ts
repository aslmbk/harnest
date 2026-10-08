import { describe, expect, it } from 'vitest';
import { getTerminal } from '../src/content';
import {
  continuedLine,
  formatCombo,
  groupBlocks,
  isShortcutCombo,
  keycapPalette,
  launchPrompt,
  modeStatus,
  nextMode,
  normLine,
  normLines,
  parseToolCall,
  ruleKind,
  splitCombo,
  statusText,
  stripMarker,
  workedLine,
  type BoxBlock,
} from '../src/ui/terminal/lines';

describe('normLine', () => {
  it('expands shorthand strings and fills the default style', () => {
    expect(normLine('hello')).toEqual({ text: 'hello', style: 'plain' });
    expect(normLine({ text: 'x', style: 'tool', delayMs: 300 })).toEqual({ text: 'x', style: 'tool', delayMs: 300 });
    expect(normLine({ text: 'y' })).toEqual({ text: 'y', style: 'plain', delayMs: undefined });
  });
});

describe('groupBlocks', () => {
  it('marks runs of claude and result lines; tool lines always start fresh', () => {
    const step = getTerminal('l1', 't1').challenge.steps[1];
    const blocks = groupBlocks(normLines(step.output));
    expect(blocks.map((b) => (b.kind === 'line' ? `${b.line.style}${b.cont ? '+' : ''}` : 'box'))).toEqual(['tool', 'result', 'claude']);

    const run = groupBlocks(
      normLines([
        { text: 'One', style: 'claude' },
        { text: 'Two', style: 'claude' },
        { text: 'Read(a.ts)', style: 'tool' },
        { text: 'Read 3 lines', style: 'result' },
        { text: 'more', style: 'result' },
        { text: 'Bash(npm test)', style: 'tool' },
        { text: 'Three', style: 'claude' },
      ]),
    );
    expect(run.map((b) => b.kind === 'line' && b.cont)).toEqual([false, true, false, false, true, false, false]);
  });

  it('frames consecutive box lines together, as bare text', () => {
    const blocks = groupBlocks(
      normLines([
        { text: 'before', style: 'dim' },
        { text: 'Plan: fix the pump', style: 'box', delayMs: 500 },
        { text: '1. Read pump.ts', style: 'box' },
        { text: '2. Add a pressure check', style: 'box' },
        { text: 'after', style: 'plain' },
        { text: 'Notice', style: 'box' },
      ]),
    );
    expect(blocks.map((b) => b.kind)).toEqual(['line', 'box', 'line', 'box']);
    const box = blocks[1] as BoxBlock;
    expect(box.delayMs).toBe(500);
    expect(box.rows).toEqual([
      { kind: 'text', text: 'Plan: fix the pump' },
      { kind: 'text', text: '1. Read pump.ts' },
      { kind: 'text', text: '2. Add a pressure check' },
    ]);
  });

  it('tolerates old box-drawing borders', () => {
    const blocks = groupBlocks(
      normLines([
        { text: '╭──────────╮', style: 'box' },
        { text: '│ Welcome  │', style: 'box' },
        { text: '├──────────┤', style: 'box' },
        { text: '│   cwd: ~ │', style: 'box' },
        { text: '╰──────────╯', style: 'box' },
      ]),
    );
    expect((blocks[0] as BoxBlock).rows).toEqual([{ kind: 'text', text: 'Welcome' }, { kind: 'sep' }, { kind: 'text', text: '  cwd: ~' }]);
  });
});

describe('stripMarker', () => {
  it('drops markers a writer typed anyway, keeps everything else', () => {
    expect(stripMarker('claude', '● Это контроллер')).toBe('Это контроллер');
    expect(stripMarker('claude', '  1. отступ остаётся')).toBe('  1. отступ остаётся');
    expect(stripMarker('tool', '⏺ Read(a.ts)')).toBe('Read(a.ts)');
    expect(stripMarker('result', '  ⎿ Read 42 lines')).toBe('Read 42 lines');
    expect(stripMarker('user', '❯ hello')).toBe('hello');
    expect(stripMarker('diffAdd', '- item: keep')).toBe('- item: keep');
  });
});

describe('parseToolCall', () => {
  it('splits tool name and arguments', () => {
    expect(parseToolCall('Read(src/pump.ts)')).toEqual({ name: 'Read', args: '(src/pump.ts)', rest: '' });
    expect(parseToolCall('Bash(npm test) · 3s')).toEqual({ name: 'Bash', args: '(npm test)', rest: ' · 3s' });
    expect(parseToolCall('Это не инструмент')).toBeNull();
    expect(parseToolCall('Reading the file')).toBeNull();
  });
});

describe('status line', () => {
  it('matches the verified Claude Code wording for every mode', () => {
    expect(statusText('auto')).toBe('⏵⏵ auto mode on (shift+tab to cycle)');
    expect(statusText('manual')).toBe('⏸ manual mode on (shift+tab to cycle)');
    expect(statusText('default')).toBe('⏸ manual mode on (shift+tab to cycle)');
    expect(statusText('acceptEdits')).toBe('⏵⏵ accept edits on (shift+tab to cycle)');
    expect(statusText('plan')).toBe('⏸ plan mode on (shift+tab to cycle)');
    expect(statusText('dontAsk')).toBe("⏵⏵ don't ask on");
    expect(statusText('bypassPermissions')).toBe('⏵⏵ bypass permissions on');
    expect(modeStatus('plan').tone).toBe('plan');
  });

  it('cycles modes along MODE_CYCLE', () => {
    expect(nextMode('auto')).toBe('manual');
    expect(nextMode('default')).toBe('acceptEdits');
    expect(nextMode('plan')).toBe('auto');
    expect(nextMode('plan', ['bypassPermissions'])).toBe('bypassPermissions');
    expect(nextMode('bypassPermissions', ['bypassPermissions'])).toBe('auto');
    expect(nextMode('dontAsk')).toBe('auto');
  });
});

describe('rules and turn lines', () => {
  it('detects full-width rule lines', () => {
    expect(ruleKind('- - - - - - - -')).toBe('dashed');
    expect(ruleKind('--------')).toBe('dashed');
    expect(ruleKind('────────')).toBe('solid');
    expect(ruleKind('- item')).toBeNull();
    expect(ruleKind('--')).toBeNull();
  });

  it('formats the end-of-turn line', () => {
    expect(workedLine(31, 0)).toBe('✻ Worked for 31s');
    expect(workedLine(0.2, 0)).toBe('✻ Worked for 1s');
  });
});

describe('keys', () => {
  it('formats and splits combos', () => {
    expect(formatCombo('Escape')).toBe('Esc');
    expect(formatCombo('Shift+Tab')).toBe('Shift+Tab');
    expect(formatCombo('Ctrl+C')).toBe('Ctrl+C');
    expect(splitCombo('Ctrl++')).toEqual(['Ctrl', '+']);
  });

  it('tells shortcuts from typing', () => {
    expect(isShortcutCombo('Escape')).toBe(true);
    expect(isShortcutCombo('Shift+Tab')).toBe(true);
    expect(isShortcutCombo('Ctrl+C')).toBe(true);
    expect(isShortcutCombo('A')).toBe(false);
    expect(isShortcutCombo('?')).toBe(false);
    expect(isShortcutCombo('Backspace')).toBe(false);
    expect(isShortcutCombo('Ctrl+Alt+@')).toBe(false); // AltGr on Windows
  });

  it('builds a deterministic key cap palette that contains the answer', () => {
    const a = keycapPalette(['Escape', 'Escape'], 'l3/t2/s4');
    expect(a).toHaveLength(6);
    expect(a).toContain('Escape');
    expect(new Set(a).size).toBe(a.length);
    expect(keycapPalette(['Escape', 'Escape'], 'l3/t2/s4')).toEqual(a);
    expect(keycapPalette(['Ctrl+X'], 'seed')).toContain('Ctrl+X');
  });
});

describe('prompt input', () => {
  const step = (terminal: string, id: string) => {
    const found = getTerminal('l1', terminal).challenge.steps.find((s) => s.id === id);
    if (!found) throw new Error(`l1/${terminal}/${id} is missing`);
    return found;
  };
  const launch = step('t4', 's1'); // claude "почини табло"
  const newline = step('t4', 's5'); // example ends with a backslash
  const second = step('t4', 's6');

  it('claude "task" at the shell: the task becomes the first ❯ message', () => {
    expect(launchPrompt(launch, 'claude "почини табло"')).toBe('почини табло');
    expect(launchPrompt(launch, "claude  'почини   табло срочно' ")).toBe('почини табло срочно');
    expect(launchPrompt(launch, 'claude «почини табло»')).toBe('почини табло');
    expect(launchPrompt(launch, 'claude')).toBe('почини табло'); // any other shape: the example's task
    expect(launchPrompt(step('t1', 's1'), 'claude')).toBeNull(); // plain claude: an empty session
    expect(launchPrompt(second, 'claude "x"')).toBeNull();
  });

  it('\\ + Enter keeps the line without the backslash, only where the step teaches it', () => {
    expect(continuedLine(newline, 'исправь обновление кэша табло \\')).toBe('исправь обновление кэша табло');
    expect(continuedLine(newline, 'исправь кэш\\  ')).toBe('исправь кэш');
    expect(continuedLine(newline, 'исправь кэш')).toBeNull();
    expect(continuedLine(second, 'и добавь тест \\')).toBeNull();
    expect(continuedLine(launch, 'claude "x" \\')).toBeNull();
  });
});
