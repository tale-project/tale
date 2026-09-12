import { describe, expect, it } from 'vitest';

import {
  formatRangeHeader,
  ifRangeMatches,
  parseRangeHeader,
  unsatisfiableContentRange,
} from './range';

describe('parseRangeHeader', () => {
  it('parses a closed range', () => {
    expect(parseRangeHeader('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
  });

  it('clamps a last position past the end to the end', () => {
    expect(parseRangeHeader('bytes=0-100000', 1000)).toEqual({
      start: 0,
      end: 999,
    });
  });

  it('reads a suffix range as the last N bytes, or the whole thing when shorter', () => {
    expect(parseRangeHeader('bytes=-100', 1000)).toEqual({
      start: 900,
      end: 999,
    });
    expect(parseRangeHeader('bytes=-5000', 1000)).toEqual({
      start: 0,
      end: 999,
    });
  });

  it('reads an open range to the end', () => {
    expect(parseRangeHeader('bytes=500-', 1000)).toEqual({
      start: 500,
      end: 999,
    });
  });

  it('is unsatisfiable from the first position at or past the end — what a completed resume sends', () => {
    expect(parseRangeHeader('bytes=1000-', 1000)).toBe('unsatisfiable');
    expect(parseRangeHeader('bytes=1000-1000', 1000)).toBe('unsatisfiable');
    expect(parseRangeHeader('bytes=2000-', 1000)).toBe('unsatisfiable');
  });

  it('is unsatisfiable against an empty representation', () => {
    expect(parseRangeHeader('bytes=0-', 0)).toBe('unsatisfiable');
    expect(parseRangeHeader('bytes=-1', 0)).toBe('unsatisfiable');
  });

  it('ignores what it cannot read: no header, another unit, a multi-range, a malformed spec', () => {
    expect(parseRangeHeader(null, 1000)).toBeNull();
    expect(parseRangeHeader(undefined, 1000)).toBeNull();
    expect(parseRangeHeader('items=0-9', 1000)).toBeNull();
    expect(parseRangeHeader('bytes=0-99,200-299', 1000)).toBeNull();
    expect(parseRangeHeader('bytes=abc', 1000)).toBeNull();
    expect(parseRangeHeader('bytes=-', 1000)).toBeNull();
    expect(parseRangeHeader('bytes=-0', 1000)).toBeNull();
    expect(parseRangeHeader('bytes=9-5', 1000)).toBeNull();
    expect(parseRangeHeader('', 1000)).toBeNull();
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseRangeHeader('  bytes=0-1 ', 10)).toEqual({ start: 0, end: 1 });
  });
});

describe('formatRangeHeader / unsatisfiableContentRange', () => {
  it('spells the normalised request and the 416 answer', () => {
    expect(formatRangeHeader({ start: 900, end: 999 })).toBe('bytes=900-999');
    expect(unsatisfiableContentRange(1000)).toBe('bytes */1000');
  });
});

describe('ifRangeMatches', () => {
  const lastModified = new Date('2026-01-01T00:00:00.500Z');

  it('matches a strong entity tag byte for byte', () => {
    expect(ifRangeMatches('"abc123"', '"abc123"', lastModified)).toBe(true);
    expect(ifRangeMatches('"old"', '"abc123"', lastModified)).toBe(false);
  });

  it('never matches a weak tag on either side', () => {
    expect(ifRangeMatches('W/"abc"', 'W/"abc"', lastModified)).toBe(false);
    expect(ifRangeMatches('"abc"', 'W/"abc"', lastModified)).toBe(false);
    expect(ifRangeMatches('W/"abc"', '"abc"', lastModified)).toBe(false);
  });

  it('matches an HTTP-date the representation was not modified after, at whole seconds', () => {
    expect(
      ifRangeMatches('Thu, 01 Jan 2026 00:00:00 GMT', '"x"', lastModified),
    ).toBe(true);
    expect(
      ifRangeMatches('Wed, 31 Dec 2025 00:00:00 GMT', '"x"', lastModified),
    ).toBe(false);
  });

  it('does not hold without the validator it names, or for a value that is neither', () => {
    expect(ifRangeMatches('"abc"', null, lastModified)).toBe(false);
    expect(ifRangeMatches('Thu, 01 Jan 2026 00:00:00 GMT', '"x"', null)).toBe(
      false,
    );
    expect(ifRangeMatches('not-a-date-or-etag', '"x"', lastModified)).toBe(
      false,
    );
  });
});
