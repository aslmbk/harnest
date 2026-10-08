import { describe, expect, it } from 'vitest';
import { LEVELS, getTerminal } from '../src/content';
import type { ChallengeDef } from '../src/content/types';
import { ChallengeRunner, answerOf, commandNudge, isExitInput, sequencePrefix, type Outcome } from '../src/ui/terminal/runner';

/** The canonical answer of a command step of a real terminal. */
function example(levelId: string, terminalId: string, stepId: string): string {
  const step = getTerminal(levelId, terminalId).challenge.steps.find((s) => s.id === stepId);
  if (step?.kind !== 'command') throw new Error(`${levelId}/${terminalId}/${stepId} is not a command step`);
  return step.example;
}

const mixed: ChallengeDef = {
  title: 'Test',
  brief: 'Test challenge with every step kind.',
  cwd: '~/test',
  unlocks: [],
  steps: [
    {
      id: 'a',
      kind: 'command',
      prompt: 'claude',
      task: 'Make a memory file.',
      accept: ['/init'],
      example: '/init',
      hints: ['slash', 'initialize'],
      wrong: [{ match: '/help', reply: 'Help is not what we need.' }],
    },
    { id: 'b', kind: 'key', task: 'Cycle to plan mode.', keys: ['Shift+Tab', 'Shift+Tab'], example: 'Shift+Tab ×2', hints: ['two presses'], setMode: 'plan' },
    {
      id: 'c',
      kind: 'choice',
      style: 'permission',
      question: 'Do you want to proceed?',
      task: 'Allow once.',
      options: [
        { label: 'Yes', correct: true, reply: 'Done.' },
        { label: 'Yes, and don’t ask again', reply: 'Too broad.' },
        { label: 'No' },
      ],
      hints: [],
    },
    { id: 'd', kind: 'info', task: 'Read the result.', output: ['ok'] },
    { id: 'e', kind: 'key', task: 'Rewind.', keys: ['Escape', 'Escape'], example: 'Esc Esc', hints: ['twice'] },
  ],
};

describe('ChallengeRunner', () => {
  it('plays l1/t1 end to end with a tailored wrong reply and a hint', () => {
    const r = new ChallengeRunner(getTerminal('l1', 't1').challenge);
    expect(r.startsInClaude).toBe(false);
    expect(r.context).toBe('shell');
    expect(r.stars).toBe(3);

    const wrong = r.submit('claude code');
    expect(wrong).toMatchObject({ type: 'wrong', tailored: true });
    expect(r.stepIndex).toBe(0);
    expect(r.stars).toBe(3); // mistakes are free

    expect(r.hint()).toMatchObject({ type: 'hint', index: 1, total: 2 });
    expect(r.stars).toBe(2);
    expect(r.submit('  CLAUDE ')).toMatchObject({ type: 'ok', stepIndex: 0, finished: false });

    expect(r.context).toBe('claude');
    expect(r.hints).toEqual([]); // hints reset per step
    expect(r.submit('hi')).toMatchObject({ type: 'wrong', tailored: false });
    expect(r.submit('что делает этот проект?')).toMatchObject({ type: 'ok', stepIndex: 1, finished: false });
    expect(r.finished).toBe(false);
    expect(r.submit(example('l1', 't1', 's3'))).toMatchObject({ type: 'ok', stepIndex: 2, finished: false });
    expect(r.submit(example('l1', 't1', 's4'))).toMatchObject({ type: 'ok', stepIndex: 3, finished: true });
    expect(r.finished).toBe(true);
    expect(r.stars).toBe(2); // the hint on the first step counts for the whole challenge
    expect(r.submit('anything')).toEqual({ type: 'ignored' });
  });

  it('plays every l1 terminal with its examples and correct options for 3 stars', () => {
    for (const level of LEVELS) {
      for (const t of level.lessons.terminals) {
        const r = new ChallengeRunner(t.challenge);
        for (const step of t.challenge.steps) {
          let out: Outcome | undefined;
          if (step.kind === 'command') out = r.submit(step.example);
          else if (step.kind === 'key' && step.untilMode) {
            // a mode-cycling step: press Shift+Tab until the status line reaches the target mode
            for (let i = 0; i < 6 && out?.type !== 'ok'; i++) out = r.press('Shift+Tab');
          } else if (step.kind === 'key') for (const k of step.keys) out = r.press(k);
          else if (step.kind === 'choice') out = r.choose(step.options.findIndex((o) => o.correct));
          else out = r.submit('');
          expect(out?.type, `${level.id}/${t.id}/${step.id}`).toBe('ok');
        }
        expect(r.finished).toBe(true);
        expect(r.stars).toBe(3);
      }
    }
  });

  it('reveals hints one at a time, then the answer (1 star)', () => {
    const r = new ChallengeRunner(mixed);
    expect(r.hintState).toMatchObject({ shown: 0, total: 2, answerNext: false, exhausted: false });
    expect(r.hint()).toEqual({ type: 'hint', text: 'slash', index: 1, total: 2 });
    expect(r.hint()).toEqual({ type: 'hint', text: 'initialize', index: 2, total: 2 });
    expect(r.hintState.answerNext).toBe(true);
    expect(r.stars).toBe(2);
    expect(r.hint()).toEqual({ type: 'answer', text: '/init' });
    expect(r.answer).toBe('/init');
    expect(r.hintState.exhausted).toBe(true);
    expect(r.hint()).toEqual({ type: 'none' });
    expect(r.stars).toBe(1);
    r.submit('/init');
    expect(r.answer).toBeNull();
    expect(r.stars).toBe(1); // stays for the whole challenge
  });

  it('handles tailored and generic command replies', () => {
    const r = new ChallengeRunner(mixed);
    expect(r.submit('/help')).toEqual({ type: 'wrong', reply: 'Help is not what we need.', tailored: true });
    const generic = r.submit('create claude md');
    expect(generic).toMatchObject({ type: 'wrong', tailored: false });
    expect(generic.type === 'wrong' && generic.reply).toContain('«/»');
    expect(r.submit('   ')).toEqual({ type: 'ignored' });
    expect(r.wrongCount).toBe(2);
  });

  it('runs key sequences: partial, wrong shortcut, typing ignored, consecutive presses only', () => {
    const r = new ChallengeRunner(mixed);
    r.submit('/init');
    expect(r.step?.id).toBe('b');
    expect(r.context).toBe('claude');
    expect(r.mode).toBe('auto'); // sessions start in auto mode
    expect(r.press('Shift+Tab')).toMatchObject({ type: 'partial' });
    expect(r.mode).toBe('manual'); // every Shift+Tab cycles the status line
    expect(r.press('a')).toEqual({ type: 'ignored' });
    expect(r.press('Shift+Tab')).toMatchObject({ type: 'partial' }); // the sequence restarted after 'a'
    expect(r.press('Ctrl+C')).toMatchObject({ type: 'wrong', tailored: false });
    expect(r.press('Shift+Tab')).toMatchObject({ type: 'partial' });
    expect(r.press('shift+tab')).toMatchObject({ type: 'ok', stepIndex: 1 });
    expect(r.mode).toBe('plan'); // setMode applies on success
  });

  it('solves untilMode steps when the cycle reaches the target, and keeps cycling on overshoot', () => {
    const r = new ChallengeRunner({
      ...mixed,
      startMode: 'manual',
      steps: [
        { id: 'p', kind: 'key', task: 'Plan mode.', keys: ['Shift+Tab'], example: 'Shift+Tab', hints: ['cycle'], untilMode: 'plan' },
        { id: 'm', kind: 'key', task: 'Back to manual.', keys: ['Shift+Tab'], example: 'Shift+Tab', hints: ['cycle'], untilMode: 'default' },
      ],
    });
    expect(r.mode).toBe('manual');
    expect(r.press('Shift+Tab')).toMatchObject({ type: 'partial' });
    expect(r.mode).toBe('acceptEdits');
    expect(r.press('Escape')).toMatchObject({ type: 'wrong' });
    expect(r.press('Shift+Tab')).toMatchObject({ type: 'ok', stepIndex: 0 });
    expect(r.mode).toBe('plan');
    // 'default' is Manual: plan → auto → manual
    expect(r.press('Shift+Tab')).toMatchObject({ type: 'partial' });
    expect(r.mode).toBe('auto');
    expect(r.press('Shift+Tab')).toMatchObject({ type: 'ok', finished: true });
    expect(r.mode).toBe('manual');
  });

  it('cycles the mode on Shift+Tab at a Claude prompt, not at the shell', () => {
    const atClaude = new ChallengeRunner(mixed);
    expect(atClaude.press('Shift+Tab')).toEqual({ type: 'ignored' });
    expect(atClaude.mode).toBe('manual');
    const atShell = new ChallengeRunner(getTerminal('l1', 't1').challenge);
    atShell.press('Shift+Tab');
    expect(atShell.mode).toBe('auto');
  });

  it('asks for keys, not text, during a key step and knows which keys it expects', () => {
    const r = new ChallengeRunner(mixed);
    r.submit('/init');
    expect(r.expectsKey('shift+tab')).toBe(true);
    expect(r.expectsKey('Enter')).toBe(false);
    expect(r.submit('shift tab')).toMatchObject({ type: 'wrong' });
    expect(r.submit('/exit')).toEqual({ type: 'exit' });
  });

  it('handles choices: wrong options give their reply and can be retried', () => {
    const r = new ChallengeRunner(mixed);
    r.submit('/init');
    r.press('Shift+Tab');
    r.press('Shift+Tab');
    expect(r.step?.id).toBe('c');
    expect(r.submit('1')).toEqual({ type: 'ignored' });
    expect(r.choose(1)).toEqual({ type: 'wrong', reply: 'Too broad.', tailored: true, optionIndex: 1 });
    expect(r.choose(2)).toMatchObject({ type: 'wrong', tailored: false, optionIndex: 2 });
    expect([...r.triedOptions]).toEqual([1, 2]);
    expect(r.choose(9)).toEqual({ type: 'ignored' });
    expect(answerOf(r.step)).toBe('1. Yes');
    expect(r.hint()).toEqual({ type: 'answer', text: '1. Yes' }); // no hints → straight to the answer
    expect(r.choose(0)).toMatchObject({ type: 'ok', reply: 'Done.' });
    expect(r.triedOptions.size).toBe(0);
  });

  it('finds the option Esc picks in a permission dialog', () => {
    const t3 = new ChallengeRunner(getTerminal('l1', 't3').challenge);
    expect(t3.escIndex()).toBe(-1); // not a dialog yet
    expect(t3.submit(example('l1', 't3', 's1'))).toMatchObject({ type: 'ok', stepIndex: 0 });
    expect(t3.step?.kind).toBe('choice');
    expect(t3.escIndex()).toBe(2); // marked with esc: true

    const r = new ChallengeRunner(mixed);
    r.submit('/init');
    r.press('Shift+Tab');
    r.press('Shift+Tab');
    expect(r.escIndex()).toBe(2); // falls back to the "No" option
  });

  it('continues info steps on Enter and finishes on the last step', () => {
    const r = new ChallengeRunner(mixed);
    r.submit('/init');
    r.press('Shift+Tab');
    r.press('Shift+Tab');
    r.choose(0);
    expect(r.step?.kind).toBe('info');
    expect(r.hint()).toEqual({ type: 'none' });
    expect(r.hintState.exhausted).toBe(true);
    expect(r.submit('')).toMatchObject({ type: 'ok', finished: false });
    expect(r.press('Escape')).toMatchObject({ type: 'partial' });
    expect(r.press('Escape')).toMatchObject({ type: 'ok', finished: true });
    expect(r.stars).toBe(3); // info steps have nothing to reveal
  });

  it('leaves with /exit, /quit or exit unless the step expects it', () => {
    const r = new ChallengeRunner(mixed);
    expect(r.submit('/exit')).toEqual({ type: 'exit' });
    expect(r.submit('/QUIT')).toEqual({ type: 'exit' });
    const shell = new ChallengeRunner(getTerminal('l1', 't1').challenge);
    expect(shell.submit('exit')).toEqual({ type: 'exit' });
    expect(shell.submit('/exit')).toEqual({ type: 'exit' }); // the panel promises /exit everywhere
    expect(new ChallengeRunner(mixed).submit('exit')).toMatchObject({ type: 'wrong' }); // plain 'exit' only in the shell

    const teachesExit = new ChallengeRunner({
      ...mixed,
      steps: [{ id: 'x', kind: 'command', prompt: 'claude', task: 'Leave.', accept: ['/exit'], example: '/exit', hints: ['a', 'b'] }],
    });
    expect(teachesExit.submit('/exit')).toMatchObject({ type: 'ok', finished: true });

    const tailoredExit = new ChallengeRunner({
      ...mixed,
      steps: [
        { id: 'y', kind: 'command', prompt: 'claude', task: 'Stay.', accept: ['/init'], example: '/init', hints: ['a', 'b'], wrong: [{ match: '/exit', reply: 'Not yet!' }] },
      ],
    });
    expect(tailoredExit.submit('/exit')).toEqual({ type: 'wrong', reply: 'Not yet!', tailored: true });
  });

  it('cycles the permission mode with Shift+Tab, adding bypass only when the challenge uses it', () => {
    const r = new ChallengeRunner(mixed);
    expect(r.mode).toBe('auto');
    expect(r.cycleMode()).toBe('manual');
    expect(r.cycleMode()).toBe('acceptEdits');
    expect(r.cycleMode()).toBe('plan');
    expect(r.cycleMode()).toBe('auto');
    const withBypass = new ChallengeRunner({ ...mixed, steps: [{ ...mixed.steps[3], setMode: 'bypassPermissions' }] });
    withBypass.cycleMode();
    withBypass.cycleMode();
    withBypass.cycleMode();
    expect(withBypass.cycleMode()).toBe('bypassPermissions');
    expect(withBypass.cycleMode()).toBe('auto');
    expect(new ChallengeRunner({ ...mixed, startMode: 'dontAsk' }).cycleMode()).toBe('auto');
  });
});

describe('runner helpers', () => {
  it('detects exit input per prompt', () => {
    expect(isExitInput(' /exit ', 'claude')).toBe(true);
    expect(isExitInput('exit', 'claude')).toBe(false);
    expect(isExitInput('exit', 'shell')).toBe(true);
    expect(isExitInput('/exit', 'shell')).toBe(true);
    expect(isExitInput('/quit', 'claude')).toBe(true);
  });

  it('measures key sequence prefixes', () => {
    expect(sequencePrefix(['Escape', 'Escape'], ['Escape'])).toBe(1);
    expect(sequencePrefix(['Escape', 'Escape'], ['Escape', 'A'])).toBe(0);
    expect(sequencePrefix(['Ctrl+C'], ['Ctrl+C'])).toBe(0); // a full match is not a prefix
  });

  it('gives kind nudges that fit the prompt', () => {
    expect(commandNudge({ prompt: 'shell', accept: ['claude'] }, '/init')).toContain('Слэш-команды');
    expect(commandNudge({ prompt: 'shell', accept: ['claude'] }, 'запусти')).toContain('Оболочка');
    expect(commandNudge({ prompt: 'claude', accept: ['/init'] }, 'init')).toContain('«/»');
    expect(commandNudge({ prompt: 'claude', accept: ['(/init|/memory)'] }, 'memory')).toContain('«/»');
    expect(commandNudge({ prompt: 'claude', accept: ['.{8,}'] }, 'hi')).toContain('подробнее');
    expect(commandNudge({ prompt: 'claude', accept: ['.{8,}'] }, '/init')).toContain('обычными словами');
  });
});
