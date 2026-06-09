import { describe, expect, it } from 'vitest';

import {
  buildAlternation,
  buildAnywhereMatcher,
  buildWholeMessageMatcher,
  countMatches,
  escapeRegExp,
} from './index';

describe('escapeRegExp', () => {
  it('escapes metacharacters', () => {
    expect(escapeRegExp('a.b*c')).toBe('a\\.b\\*c');
  });
});

describe('buildAlternation', () => {
  it('trims, dedupes, and orders longest-first', () => {
    expect(buildAlternation([' a ', 'abc', 'a', 'ab'])).toBe('abc|ab|a');
  });
  it('returns empty string for an empty set', () => {
    expect(buildAlternation([])).toBe('');
    expect(buildAlternation(['', '   '])).toBe('');
  });
});

describe('buildAnywhereMatcher (word boundaries)', () => {
  const re = buildAnywhereMatcher({
    wordTerms: ['optimize', 'roi'],
    substringTerms: [],
  });
  it('matches a standalone word', () => {
    expect(re.test('please optimize this')).toBe(true);
  });
  it('does not match inside a larger word', () => {
    expect(re.test('the optimizer ran')).toBe(false);
  });
  it('treats digits as word chars (roi vs roi5)', () => {
    expect(
      buildAnywhereMatcher({ wordTerms: ['roi'], substringTerms: [] }).test(
        'roi5',
      ),
    ).toBe(false);
  });
  it('empty spec never matches', () => {
    expect(
      buildAnywhereMatcher({ wordTerms: [], substringTerms: [] }).test(
        'anything',
      ),
    ).toBe(false);
  });
});

describe('buildAnywhereMatcher (substring)', () => {
  it('matches CJK terms raw, no boundary', () => {
    const re = buildAnywhereMatcher({
      wordTerms: [],
      substringTerms: ['优化'],
    });
    expect(re.test('请优化这段代码')).toBe(true);
  });
});

describe('buildWholeMessageMatcher', () => {
  const re = buildWholeMessageMatcher({
    wordTerms: ['hi', 'thanks'],
    substringTerms: [],
  });
  it('matches a whole-message ack ignoring punctuation', () => {
    expect(re.test('  hi!! ')).toBe(true);
  });
  it('does not match when ack is embedded in a longer message', () => {
    expect(re.test('hi can you help me build a parser')).toBe(false);
  });
});

describe('countMatches', () => {
  it('counts non-overlapping matches', () => {
    const re = buildAnywhereMatcher({
      wordTerms: ['debug'],
      substringTerms: [],
      flags: 'giu',
    });
    expect(countMatches(re, 'debug this then debug that')).toBe(2);
  });
  it('throws without the g flag', () => {
    const re = buildAnywhereMatcher({ wordTerms: ['x'], substringTerms: [] });
    expect(() => countMatches(re, 'x')).toThrow(
      /requires a regex with the g flag/,
    );
  });
});
