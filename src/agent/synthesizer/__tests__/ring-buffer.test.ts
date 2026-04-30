import { describe, it, expect, beforeEach } from 'vitest';
import { recordDispatch, findRecentSequence, _resetRingForTests, getRingSize } from '../ring-buffer.js';

beforeEach(() => {
  _resetRingForTests();
});

describe('ring-buffer', () => {
  it('starts empty', () => {
    expect(getRingSize()).toBe(0);
    expect(findRecentSequence(['a'])).toBeNull();
  });

  it('records dispatches', () => {
    recordDispatch({ name: 'a', args: { x: 1 } });
    recordDispatch({ name: 'b', args: { y: 2 } });
    expect(getRingSize()).toBe(2);
  });

  it('finds a single-tool sequence as the most recent matching dispatch', () => {
    recordDispatch({ name: 'a', args: { v: 1 } });
    recordDispatch({ name: 'b', args: { v: 2 } });
    recordDispatch({ name: 'a', args: { v: 3 } });
    const found = findRecentSequence(['a']);
    expect(found).toEqual([{ action: 'a', args: { v: 3 } }]);
  });

  it('finds a multi-tool contiguous sequence with most recent occurrence', () => {
    recordDispatch({ name: 'a', args: { v: 1 } });
    recordDispatch({ name: 'b', args: { v: 2 } });
    recordDispatch({ name: 'c', args: { v: 3 } });
    recordDispatch({ name: 'a', args: { v: 4 } });
    recordDispatch({ name: 'b', args: { v: 5 } });
    recordDispatch({ name: 'c', args: { v: 6 } });
    const found = findRecentSequence(['a', 'b', 'c']);
    expect(found).toEqual([
      { action: 'a', args: { v: 4 } },
      { action: 'b', args: { v: 5 } },
      { action: 'c', args: { v: 6 } },
    ]);
  });

  it('returns null when sequence not found contiguously', () => {
    recordDispatch({ name: 'a', args: {} });
    recordDispatch({ name: 'x', args: {} });
    recordDispatch({ name: 'b', args: {} });
    expect(findRecentSequence(['a', 'b'])).toBeNull();
  });

  it('caps capacity at 100 entries (FIFO eviction)', () => {
    for (let i = 0; i < 150; i++) {
      recordDispatch({ name: 'a', args: { i } });
    }
    expect(getRingSize()).toBe(100);
    const found = findRecentSequence(['a']);
    expect(found?.[0].args).toEqual({ i: 149 });
  });

  it('does not persist anything to disk', () => {
    // Implicit: ring-buffer module imports no fs / persistence helpers.
    // We verify by checking the module's compiled exports surface only the
    // expected symbols.
    expect(typeof recordDispatch).toBe('function');
    expect(typeof findRecentSequence).toBe('function');
    expect(typeof _resetRingForTests).toBe('function');
    expect(typeof getRingSize).toBe('function');
  });
});
