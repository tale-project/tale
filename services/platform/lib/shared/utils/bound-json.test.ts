import { describe, expect, it } from 'vitest';

import { boundJson, type BoundJsonLimits } from './bound-json';

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
