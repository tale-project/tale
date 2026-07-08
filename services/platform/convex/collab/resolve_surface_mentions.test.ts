// Regression: an `@file.pdf` knowledge pin also matches the actor-mention
// scanner's regex; before the exclusion every successful file mention
// toasted "did not match anyone in your organization — no notification was
// sent". The exclusion must drop exactly the tokens the scanner derived from
// pinned reference names — and nothing else.

import { describe, expect, it } from 'vitest';

import { excludeKbReferenceTokens } from './resolve_surface_mentions';

describe('excludeKbReferenceTokens', () => {
  it('drops a token that names a pinned file', () => {
    expect(excludeKbReferenceTokens(['test.txt'], ['test.txt'])).toEqual([]);
  });

  it('matches what MENTION_RE captured, not the full reference name', () => {
    // "@Q3 Report.pdf" scans as the token "q3" (space ends the token);
    // the exclusion must reduce the reference name the same way.
    expect(excludeKbReferenceTokens(['q3'], ['Q3 Report.pdf'])).toEqual([]);
  });

  it('keeps genuinely unresolved actor tokens', () => {
    expect(
      excludeKbReferenceTokens(['nosuchuser', 'test.txt'], ['test.txt']),
    ).toEqual(['nosuchuser']);
  });

  it('covers folder pin names too', () => {
    expect(excludeKbReferenceTokens(['contracts'], ['Contracts'])).toEqual([]);
  });

  it('is a pass-through without pins or without unresolved tokens', () => {
    expect(excludeKbReferenceTokens(['x'], [])).toEqual(['x']);
    expect(excludeKbReferenceTokens([], ['a.pdf'])).toEqual([]);
  });

  it('ignores reference names the scanner could never tokenize', () => {
    // A name starting with a non-token character yields no exclusion.
    expect(excludeKbReferenceTokens(['报告'], ['报告.pdf'])).toEqual(['报告']);
  });
});
