import { describe, expect, it } from 'vitest';
import { parseParams } from '../src/engine/params';
import { touchAtStart } from '../src/ui/touch';

describe('UI touch controls', () => {
  it('start by the engine rule: ?touch=1 / ?touch=0 force them, otherwise a coarse pointer turns them on', () => {
    const at = (search: string, coarse: boolean) => touchAtStart(parseParams(search).touch, coarse);
    expect(at('?touch=1', false)).toBe(true);
    expect(at('?touch=0', true)).toBe(false);
    expect(at('?touch=auto', true)).toBe(true);
    expect(at('', true)).toBe(true);
    expect(at('', false)).toBe(false); // desktop: off until the first touch
  });
});
