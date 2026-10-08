import { describe, expect, it } from 'vitest';
import { Store, type SaveData } from '../src/core/store';

const KEY = 'harnest.save.v1';
const DEFAULT_SETTINGS = { master: 0.8, music: 0.6, sfx: 0.8, quality: 'auto' };

function memory(initial?: string): Pick<Storage, 'getItem' | 'setItem'> & { map: Map<string, string> } {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set(KEY, initial);
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

/** A store loaded from a raw localStorage value. */
const loaded = (raw: string) => new Store(memory(raw));
const json = (v: unknown) => JSON.stringify(v);

describe('Store', () => {
  it('starts from the defaults without storage or without a save', () => {
    for (const store of [new Store(null), new Store(memory())]) {
      expect(store.data).toEqual({ v: 1, currentLevel: null, levels: {}, codex: [], settings: DEFAULT_SETTINGS });
      expect(store.hasProgress()).toBe(false);
      expect(store.level('l1')).toEqual({ terminals: {}, chips: [], completed: false });
    }
  });

  it('persists progress and loads it back unchanged', () => {
    const storage = memory();
    const a = new Store(storage);
    a.setCurrentLevel('l2');
    a.completeTerminal('l2', 't1', 2);
    a.completeTerminal('l2', 't1', 1); // keeps the best
    a.collectChip('l2', 'c3');
    a.unlockCodex(['slash-init']);
    a.unlockCodex(['slash-init', 'cli-claude']); // already unlocked ids are skipped
    a.completeLevel('l1');
    a.setSettings({ music: 0.25, quality: 'low' });
    const b = new Store(storage);
    expect(b.data).toEqual(a.data);
    expect(b.level('l2')).toEqual({ terminals: { t1: 2 }, chips: ['c3'], completed: false });
    expect(b.data.codex).toEqual(['slash-init', 'cli-claude']);
  });

  it('falls back to the defaults on invalid JSON, a non-object or another version', () => {
    for (const raw of ['{"v":1,', 'not json', 'null', '42', '"save"', '[1,2]', json({ v: 2, currentLevel: 'l3' }), json({ currentLevel: 'l3' })]) {
      const store = loaded(raw);
      expect(store.data.currentLevel, raw).toBeNull();
      expect(store.data.levels, raw).toEqual({});
      expect(store.data.settings, raw).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('survives levels: null — the other fields are kept and progress can be recorded', () => {
    const store = loaded(json({ v: 1, currentLevel: 'l2', levels: null, codex: ['slash-init'], settings: { master: 0.5 } }));
    expect(store.data.levels).toEqual({});
    expect(store.data.currentLevel).toBe('l2');
    expect(store.data.codex).toEqual(['slash-init']);
    expect(store.settings.master).toBe(0.5);
    expect(() => store.completeTerminal('l2', 't1', 3)).not.toThrow();
    expect(store.level('l2').terminals).toEqual({ t1: 3 });
  });

  it('survives a non-array codex', () => {
    for (const codex of ['slash-init', { 0: 'slash-init' }, null, 7]) {
      const store = loaded(json({ v: 1, currentLevel: null, levels: {}, codex, settings: DEFAULT_SETTINGS }));
      expect(store.data.codex).toEqual([]);
      expect(() => store.unlockCodex(['slash-init'])).not.toThrow();
      expect(store.data.codex).toEqual(['slash-init']);
    }
    expect(loaded(json({ v: 1, codex: ['a', 3, null, 'b'] })).data.codex).toEqual(['a', 'b']);
  });

  it('fills missing or broken settings field by field', () => {
    expect(loaded(json({ v: 1, currentLevel: 'l1', levels: {}, codex: [] })).settings).toEqual(DEFAULT_SETTINGS);
    expect(loaded(json({ v: 1, settings: null })).settings).toEqual(DEFAULT_SETTINGS);
    expect(loaded(json({ v: 1, settings: 'loud' })).settings).toEqual(DEFAULT_SETTINGS);
    expect(loaded(json({ v: 1, settings: { music: 0.3 } })).settings).toEqual({ ...DEFAULT_SETTINGS, music: 0.3 });
    expect(loaded(json({ v: 1, settings: { master: '1', music: null, sfx: 7, quality: 'ultra' } })).settings).toEqual({ ...DEFAULT_SETTINGS, sfx: 1 });
    expect(loaded(json({ v: 1, settings: { master: -2, quality: 'high' } })).settings).toEqual({ ...DEFAULT_SETTINGS, master: 0, quality: 'high' });
  });

  it('keeps the good parts of a partial save: currentLevel, level entries, stars, chips', () => {
    const store = loaded(
      json({
        v: 1,
        currentLevel: 5,
        levels: {
          l1: { terminals: { t1: 3, t2: 0, t3: '2', t4: 2.5, t5: 1 }, chips: ['c1', 2, 'c2'], completed: 'yes' },
          l2: { completed: true },
          l3: null,
          l4: 'done',
        },
      }),
    );
    expect(store.data.currentLevel).toBeNull();
    expect(store.hasProgress()).toBe(false);
    expect(store.data.levels).toEqual({
      l1: { terminals: { t1: 3, t5: 1 }, chips: ['c1', 'c2'], completed: false },
      l2: { terminals: {}, chips: [], completed: true },
    });
    expect(() => {
      store.collectChip('l2', 'c1');
      store.completeTerminal('l3', 't1', 2);
      store.completeLevel('l4');
    }).not.toThrow();
    expect(store.level('l2').chips).toEqual(['c1']);
  });

  it('round-trips a valid save exactly (nothing is dropped or reordered)', () => {
    const save: SaveData = {
      v: 1,
      currentLevel: 'l3',
      levels: {
        l1: { terminals: { t1: 3, t2: 2, t3: 1 }, chips: ['c2', 'c1'], completed: true },
        l2: { terminals: {}, chips: [], completed: false },
      },
      codex: ['cli-claude', 'slash-init'],
      settings: { master: 0, music: 1, sfx: 0.35, quality: 'medium' },
    };
    expect(loaded(json(save)).data).toEqual(save);
  });

  it('keeps working when storage throws', () => {
    const broken: Pick<Storage, 'getItem' | 'setItem'> = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const store = new Store(broken);
    expect(store.data.levels).toEqual({});
    expect(() => store.completeTerminal('l1', 't1', 3)).not.toThrow();
    expect(store.level('l1').terminals).toEqual({ t1: 3 }); // progress stays in memory
  });
});
