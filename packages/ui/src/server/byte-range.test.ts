import { describe, expect, it } from 'vitest';

import { parseByteRange } from './byte-range';

const SIZE = 1000;

describe('parseByteRange', () => {
  it('returns null (serve full 200) without a Range header', () => {
    expect(parseByteRange(null, SIZE)).toBeNull();
    expect(parseByteRange('', SIZE)).toBeNull();
  });

  it('parses a bounded range, inclusive on both ends', () => {
    expect(parseByteRange('bytes=0-1', SIZE)).toEqual({ start: 0, end: 1 });
    expect(parseByteRange('bytes=200-499', SIZE)).toEqual({
      start: 200,
      end: 499,
    });
  });

  it('parses an open-ended range to the last byte', () => {
    expect(parseByteRange('bytes=500-', SIZE)).toEqual({
      start: 500,
      end: SIZE - 1,
    });
  });

  it('parses a suffix range as the final n bytes', () => {
    expect(parseByteRange('bytes=-100', SIZE)).toEqual({
      start: 900,
      end: SIZE - 1,
    });
    // A suffix longer than the resource selects the whole resource.
    expect(parseByteRange('bytes=-5000', SIZE)).toEqual({
      start: 0,
      end: SIZE - 1,
    });
  });

  it('clamps an end past the resource to the last byte', () => {
    expect(parseByteRange('bytes=900-999999', SIZE)).toEqual({
      start: 900,
      end: SIZE - 1,
    });
  });

  it('flags a start at or past the size as unsatisfiable (→ 416)', () => {
    expect(parseByteRange('bytes=1000-', SIZE)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=5000-6000', SIZE)).toBe('unsatisfiable');
  });

  it('flags a zero-length suffix and any range on an empty file as unsatisfiable', () => {
    expect(parseByteRange('bytes=-0', SIZE)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=-100', 0)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=0-', 0)).toBe('unsatisfiable');
  });

  it('ignores non-bytes units, malformed specs, and inverted ranges', () => {
    expect(parseByteRange('items=0-10', SIZE)).toBeNull();
    expect(parseByteRange('bytes=abc-def', SIZE)).toBeNull();
    expect(parseByteRange('bytes=-', SIZE)).toBeNull();
    expect(parseByteRange('bytes=', SIZE)).toBeNull();
    expect(parseByteRange('bytes=5-2', SIZE)).toBeNull();
  });

  it('ignores multi-range requests (serve full 200 instead)', () => {
    expect(parseByteRange('bytes=0-1,5-9', SIZE)).toBeNull();
  });
});
