import { describe, expect, it } from 'vitest';

import {
  formatEntityTag,
  ifMatchHolds,
  ifNoneMatchHolds,
  parseEntityTag,
  parseEntityTagList,
  strongEntityTag,
  strongMatch,
  weakMatch,
} from './entity-tag';

const strong = strongEntityTag('abc');
const weak = { weak: true, opaque: 'abc' };

describe('parseEntityTag', () => {
  it('reads strong and weak tags and keeps the opaque value verbatim', () => {
    expect(parseEntityTag('"abc"')).toEqual({ weak: false, opaque: 'abc' });
    expect(parseEntityTag('W/"abc"')).toEqual({ weak: true, opaque: 'abc' });
    expect(parseEntityTag('  "a,b"  ')).toEqual({ weak: false, opaque: 'a,b' });
    expect(parseEntityTag('""')).toEqual({ weak: false, opaque: '' });
  });

  it('refuses a bare word, an unquoted weak prefix, a lowercase weak prefix and a DQUOTE inside', () => {
    expect(parseEntityTag('abc')).toBeNull();
    expect(parseEntityTag('W/abc')).toBeNull();
    expect(parseEntityTag('w/"abc"')).toBeNull();
    expect(parseEntityTag('"a"b"')).toBeNull();
    expect(parseEntityTag('"')).toBeNull();
    expect(parseEntityTag('"a b"')).toBeNull();
  });

  it('round-trips through formatEntityTag', () => {
    expect(formatEntityTag(strong)).toBe('"abc"');
    expect(formatEntityTag(weak)).toBe('W/"abc"');
    expect(parseEntityTag(formatEntityTag(weak))).toEqual(weak);
  });
});

describe('parseEntityTagList', () => {
  it('reads `*`, one tag, and a list with whitespace and empty elements', () => {
    expect(parseEntityTagList(' * ')).toEqual({ kind: 'any' });
    expect(parseEntityTagList('"a"')).toEqual({
      kind: 'tags',
      tags: [{ weak: false, opaque: 'a' }],
    });
    expect(parseEntityTagList('"a", W/"b" ,,"c"')).toEqual({
      kind: 'tags',
      tags: [
        { weak: false, opaque: 'a' },
        { weak: true, opaque: 'b' },
        { weak: false, opaque: 'c' },
      ],
    });
  });

  it('keeps a comma inside an opaque tag with the tag', () => {
    expect(parseEntityTagList('"a,b", "c"')).toEqual({
      kind: 'tags',
      tags: [
        { weak: false, opaque: 'a,b' },
        { weak: false, opaque: 'c' },
      ],
    });
  });

  it('reads anything else as malformed', () => {
    for (const value of ['', 'abc', '"a" "b"', '"a', '*, "a"', 'W/', '"a"x']) {
      expect(parseEntityTagList(value)).toEqual({ kind: 'malformed' });
    }
  });
});

describe('strongMatch / weakMatch', () => {
  it('compares strongly only between two strong tags', () => {
    expect(strongMatch(strong, strongEntityTag('abc'))).toBe(true);
    expect(strongMatch(strong, weak)).toBe(false);
    expect(strongMatch(weak, weak)).toBe(false);
    expect(strongMatch(strong, strongEntityTag('abd'))).toBe(false);
  });

  it('compares weakly on the opaque value alone', () => {
    expect(weakMatch(strong, weak)).toBe(true);
    expect(weakMatch(weak, weak)).toBe(true);
    expect(weakMatch(strong, strongEntityTag('abd'))).toBe(false);
  });
});

describe('ifMatchHolds', () => {
  it('holds for `*` only when a representation exists', () => {
    expect(ifMatchHolds({ kind: 'any' }, strong)).toBe(true);
    expect(ifMatchHolds({ kind: 'any' }, null)).toBe(false);
  });

  it('holds for a list only on a strong match', () => {
    expect(ifMatchHolds(parseEntityTagList('"x", "abc"'), strong)).toBe(true);
    expect(ifMatchHolds(parseEntityTagList('W/"abc"'), strong)).toBe(false);
    expect(ifMatchHolds(parseEntityTagList('"abd"'), strong)).toBe(false);
    expect(ifMatchHolds(parseEntityTagList('"abc"'), null)).toBe(false);
  });

  it('never holds for a malformed value', () => {
    expect(ifMatchHolds(parseEntityTagList('abc'), strong)).toBe(false);
  });
});

describe('ifNoneMatchHolds', () => {
  it('holds for `*` only when no representation exists', () => {
    expect(ifNoneMatchHolds({ kind: 'any' }, null)).toBe(true);
    expect(ifNoneMatchHolds({ kind: 'any' }, strong)).toBe(false);
  });

  it('fails on a weak match, holds otherwise', () => {
    expect(ifNoneMatchHolds(parseEntityTagList('W/"abc"'), strong)).toBe(false);
    expect(ifNoneMatchHolds(parseEntityTagList('"abc"'), strong)).toBe(false);
    expect(ifNoneMatchHolds(parseEntityTagList('"abd"'), strong)).toBe(true);
    expect(ifNoneMatchHolds(parseEntityTagList('"abc"'), null)).toBe(true);
  });

  it('holds for a malformed value — it matches nothing', () => {
    expect(ifNoneMatchHolds(parseEntityTagList('abc'), strong)).toBe(true);
  });
});
