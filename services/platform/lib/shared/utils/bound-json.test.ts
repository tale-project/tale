import { describe, expect, it } from 'vitest';

import {
  boundJson,
  boundJsonOutOfBand,
  type BoundJsonLimits,
} from './bound-json';

/**
 * These lock the algorithm that was previously inlined in the chat tool loop
 * (`boundToolResult`) and is now shared with the automations run log. It had no
 * tests before the extraction, so the marker text and the pass-through cases
 * are pinned here — the chat window sizing depends on both.
 */

const LIMITS: BoundJsonLimits = {
  maxString: 10,
  maxItems: 3,
  maxDepth: 2,
};

describe('boundJson', () => {
  it('leaves a short string untouched', () => {
    expect(boundJson('short', LIMITS)).toBe('short');
  });

  it('leaves a string exactly at the limit untouched', () => {
    expect(boundJson('0123456789', LIMITS)).toBe('0123456789');
  });

  it('cuts a long string and reports the dropped character count', () => {
    expect(boundJson('0123456789abcde', LIMITS)).toBe('0123456789…(+5 chars)');
  });

  it('caps an array and reports the dropped item count', () => {
    expect(boundJson([1, 2, 3, 4, 5], LIMITS)).toEqual([
      1,
      2,
      3,
      '…(+2 more items)',
    ]);
  });

  it('leaves an array exactly at the limit uncapped', () => {
    expect(boundJson([1, 2, 3], LIMITS)).toEqual([1, 2, 3]);
  });

  it('walks nested objects and bounds their strings', () => {
    expect(boundJson({ a: { b: '0123456789abc' } }, LIMITS)).toEqual({
      a: { b: '0123456789…(+3 chars)' },
    });
  });

  it('elides a subtree past the depth limit', () => {
    // depth 0 = root object, 1 = a, 2 = b, 3 = c -> elided
    expect(boundJson({ a: { b: { c: { d: 'deep' } } } }, LIMITS)).toEqual({
      a: { b: { c: '…' } },
    });
  });

  it('preserves null and undefined rather than turning them into markers', () => {
    expect(boundJson(null, LIMITS)).toBeNull();
    expect(boundJson(undefined, LIMITS)).toBeUndefined();
    expect(boundJson({ a: null }, LIMITS)).toEqual({ a: null });
  });

  it('passes non-string primitives through untouched', () => {
    expect(boundJson(42, LIMITS)).toBe(42);
    expect(boundJson(true, LIMITS)).toBe(true);
  });

  /**
   * NOT idempotent, and the second pass MISREPORTS the loss: the marker itself
   * is long enough to be re-cut, so `+90 chars` becomes `+12 chars` and the
   * reader is told a smaller value was dropped than really was. Pinned here as
   * a hazard, not an aspiration — callers must bound a value exactly once, at
   * the point it first enters storage, and never re-bound a value read back
   * out. `boundCheckpointTrace` relies on this.
   */
  it('is NOT idempotent — re-bounding re-cuts the marker and misreports the count', () => {
    const once = boundJson({ big: 'x'.repeat(100) }, LIMITS);
    expect(once).toEqual({ big: 'xxxxxxxxxx…(+90 chars)' });

    const twice = boundJson(once, LIMITS);
    expect(twice).toEqual({ big: 'xxxxxxxxxx…(+12 chars)' });
    expect(twice).not.toEqual(once);
  });
});

describe('boundJsonOutOfBand', () => {
  it('leaves a value inside the limits as it was, with no cuts', () => {
    const value = { a: 'short', list: [1, 2, 3], nested: { b: null } };
    expect(boundJsonOutOfBand(value, LIMITS)).toEqual({ value, cuts: [] });
  });

  it('cuts a long string without a marker and says how much it dropped', () => {
    expect(boundJsonOutOfBand({ s: '0123456789abcde' }, LIMITS)).toEqual({
      value: { s: '0123456789' },
      cuts: [{ pointer: '/s', kind: 'string', dropped: 5 }],
    });
  });

  it('never splits a character that takes two UTF-16 units', () => {
    const text = `012345678${'😀'}tail`;
    const { value, cuts } = boundJsonOutOfBand(text, LIMITS);
    expect(value).toBe('012345678');
    expect(cuts).toEqual([
      { pointer: '', kind: 'string', dropped: text.length - 9 },
    ]);
  });

  it('keeps the first items of a long list', () => {
    expect(boundJsonOutOfBand([1, 2, 3, 4, 5], LIMITS)).toEqual({
      value: [1, 2, 3],
      cuts: [{ pointer: '', kind: 'items', dropped: 2 }],
    });
  });

  it('replaces a value past the depth limit by null, with its size', () => {
    const { value, cuts } = boundJsonOutOfBand(
      { a: { b: { c: { d: 1 } } } },
      LIMITS,
    );
    expect(value).toEqual({ a: { b: { c: null } } });
    expect(cuts).toEqual([
      { pointer: '/a/b/c', kind: 'depth', dropped: '{"d":1}'.length },
    ]);
  });

  it('escapes keys in the pointers it reports', () => {
    expect(
      boundJsonOutOfBand({ 'a/b': { '~': '0123456789abc' } }, LIMITS).cuts,
    ).toEqual([{ pointer: '/a~1b/~0', kind: 'string', dropped: 3 }]);
  });

  it('cuts as boundJson does, marker aside', () => {
    const value = { s: 'x'.repeat(30), list: [1, 2, 3, 4], deep: [[['z']]] };
    const marked = boundJson(value, LIMITS);
    const { value: quiet } = boundJsonOutOfBand(value, LIMITS);
    expect(quiet).toEqual({
      s: 'x'.repeat(10),
      list: [1, 2, 3],
      deep: [[null]],
    });
    expect(marked).toEqual({
      s: `${'x'.repeat(10)}…(+20 chars)`,
      list: [1, 2, 3, '…(+1 more items)'],
      deep: [['…']],
    });
  });

  it('lists at most maxCuts cuts', () => {
    const value = Array.from({ length: 3 }, () => 'y'.repeat(20));
    expect(boundJsonOutOfBand(value, LIMITS, 2).cuts).toHaveLength(2);
  });
});
