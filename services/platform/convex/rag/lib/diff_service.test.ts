import { describe, expect, it } from 'vitest';

import {
  computeDiff,
  computeInlineDiff,
  extractClauseRef,
  INLINE_DIFF_MAX_CHARS,
  normalizeText,
  sequenceMatcherOpcodes,
  splitParagraphs,
} from './diff_service';

describe('sequenceMatcherOpcodes', () => {
  it('reports a single equal block for identical sequences', () => {
    const ops = sequenceMatcherOpcodes(['a', 'b', 'c'], ['a', 'b', 'c']);
    expect(ops).toEqual([['equal', 0, 3, 0, 3]]);
  });

  it('reports a replace for a fully different middle', () => {
    const ops = sequenceMatcherOpcodes(['a', 'x', 'c'], ['a', 'y', 'c']);
    expect(ops).toContainEqual(['replace', 1, 2, 1, 2]);
    expect(ops[0]).toEqual(['equal', 0, 1, 0, 1]);
    expect(ops[ops.length - 1]).toEqual(['equal', 2, 3, 2, 3]);
  });

  it('reports an insert', () => {
    const ops = sequenceMatcherOpcodes(['a', 'c'], ['a', 'b', 'c']);
    expect(ops).toContainEqual(['insert', 1, 1, 1, 2]);
  });

  it('reports a delete', () => {
    const ops = sequenceMatcherOpcodes(['a', 'b', 'c'], ['a', 'c']);
    expect(ops).toContainEqual(['delete', 1, 2, 1, 1]);
  });

  it('handles two empty sequences', () => {
    expect(sequenceMatcherOpcodes([], [])).toEqual([]);
  });

  it('reports a pure insert from empty', () => {
    expect(sequenceMatcherOpcodes([], ['a', 'b'])).toEqual([
      ['insert', 0, 0, 0, 2],
    ]);
  });
});

describe('computeInlineDiff', () => {
  it('marks deletions and additions', () => {
    const out = computeInlineDiff('the quick brown fox', 'the slow brown fox');
    expect(out).toContain('[-quick-]');
    expect(out).toContain('{+slow+}');
    expect(out).toContain('the');
    expect(out).toContain('fox');
  });

  it('returns null when both sides are empty', () => {
    expect(computeInlineDiff('', '')).toBeNull();
    expect(computeInlineDiff('   ', '   ')).toBeNull();
  });

  it('returns null when either side exceeds the char cap', () => {
    const big = 'x '.repeat(INLINE_DIFF_MAX_CHARS);
    expect(computeInlineDiff(big, 'small')).toBeNull();
    expect(computeInlineDiff('small', big)).toBeNull();
  });

  it('emits a delete-only marker', () => {
    const out = computeInlineDiff('alpha beta gamma', 'alpha gamma');
    expect(out).toContain('[-beta-]');
  });

  it('emits an add-only marker', () => {
    const out = computeInlineDiff('alpha gamma', 'alpha beta gamma');
    expect(out).toContain('{+beta+}');
  });
});

describe('extractClauseRef', () => {
  it('extracts an English Section reference', () => {
    expect(extractClauseRef('See Section 4.2 for details')).toBe('Section 4.2');
  });

  it('extracts a German Artikel reference', () => {
    expect(extractClauseRef('Gemäß Artikel 5 gilt')).toBe('Artikel 5');
  });

  it('extracts a paragraph-sign reference', () => {
    expect(extractClauseRef('§ 12 Datenschutz')).toBe('§ 12');
  });

  it('returns null when no clause reference is present', () => {
    expect(extractClauseRef('Just some ordinary prose.')).toBeNull();
  });
});

describe('normalizeText', () => {
  it('normalizes curly quotes to straight quotes', () => {
    expect(normalizeText('“hello” and ‘world’')).toBe('"hello" and \'world\'');
  });

  it('normalizes em/en dashes', () => {
    expect(normalizeText('a—b')).toBe('a--b');
  });

  it('strips image and table markers', () => {
    // The image marker is removed, then the resulting double space collapses
    // to one via the multi-space rule.
    expect(normalizeText('before [Image: logo.png] after')).toBe(
      'before after',
    );
    expect(normalizeText('[Table] data')).toBe('data');
  });

  it('collapses runs of spaces', () => {
    expect(normalizeText('a     b')).toBe('a b');
  });

  it('strips trailing whitespace per line', () => {
    expect(normalizeText('line one   \nline two\t')).toBe('line one\nline two');
  });
});

describe('splitParagraphs', () => {
  it('splits on blank lines and trims', () => {
    expect(splitParagraphs('  one  \n\n  two  ')).toEqual(['one', 'two']);
  });

  it('drops empty paragraphs', () => {
    expect(splitParagraphs('one\n\n\n\ntwo')).toEqual(['one', 'two']);
  });

  it('returns empty for blank input', () => {
    expect(splitParagraphs('')).toEqual([]);
    expect(splitParagraphs('\n\n  \n\n')).toEqual([]);
  });
});

describe('computeDiff', () => {
  it('reports all-unchanged for identical documents', () => {
    const text = 'Para one.\n\nPara two.';
    const result = computeDiff(text, text);
    expect(result.stats.unchanged).toBe(2);
    expect(result.stats.added).toBe(0);
    expect(result.stats.deleted).toBe(0);
    expect(result.stats.modified).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('counts an added paragraph', () => {
    const base = 'Para one.';
    const comparison = 'Para one.\n\nPara two added.';
    const result = computeDiff(base, comparison);
    expect(result.stats.added).toBe(1);
    expect(result.stats.total_paragraphs_base).toBe(1);
    expect(result.stats.total_paragraphs_comparison).toBe(2);
  });

  it('counts a deleted paragraph', () => {
    const base = 'Para one.\n\nPara two.';
    const comparison = 'Para one.';
    const result = computeDiff(base, comparison);
    expect(result.stats.deleted).toBe(1);
  });

  it('produces change blocks for a modified document', () => {
    const result = computeDiff(
      'The contract starts in January.',
      'The contract starts in February.',
    );
    expect(result.change_blocks.length).toBeGreaterThan(0);
    expect(
      result.stats.modified + result.stats.added + result.stats.deleted,
    ).toBeGreaterThan(0);
  });
});
