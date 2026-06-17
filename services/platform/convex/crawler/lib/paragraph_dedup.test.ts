import { describe, expect, it } from 'vitest';

import {
  BOILERPLATE_PAGE_THRESHOLD,
  extractParagraphHashes,
  filterBoilerplateParagraphs,
  MIN_LINE_LENGTH,
  paragraphHash,
} from './paragraph_dedup';

describe('paragraphHash', () => {
  it('is a 32-char hex MD5 digest', () => {
    const h = paragraphHash('Some meaningful paragraph text.');
    expect(h).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is stable for the same content', () => {
    expect(paragraphHash('hello world')).toBe(paragraphHash('hello world'));
  });

  it('ignores surrounding whitespace (strip parity)', () => {
    expect(paragraphHash('  hello world  ')).toBe(paragraphHash('hello world'));
  });

  it('NFC-normalizes equivalent unicode forms to the same hash', () => {
    // U+00E9 (é) vs. e + U+0301 (combining acute) — NFC collapses them.
    const composed = 'café';
    const decomposed = 'café';
    expect(paragraphHash(composed)).toBe(paragraphHash(decomposed));
  });

  it('differs for different content', () => {
    expect(paragraphHash('one')).not.toBe(paragraphHash('two'));
  });
});

describe('extractParagraphHashes', () => {
  it('hashes each long-enough line', () => {
    const content = 'This is a long enough line.\nAnother long enough line.';
    expect(extractParagraphHashes(content)).toHaveLength(2);
  });

  it('skips lines shorter than the minimum length', () => {
    const content = `short\n${'x'.repeat(MIN_LINE_LENGTH + 1)}`;
    expect(extractParagraphHashes(content)).toHaveLength(1);
  });

  it('deduplicates repeated lines within a page', () => {
    const line = 'A repeated boilerplate line here.';
    const content = `${line}\n${line}\n${line}`;
    expect(extractParagraphHashes(content)).toHaveLength(1);
  });

  it('returns empty for blank content', () => {
    expect(extractParagraphHashes('')).toEqual([]);
    expect(extractParagraphHashes('   \n\n  ')).toEqual([]);
  });
});

describe('filterBoilerplateParagraphs', () => {
  const boilerplate = 'Accept all cookies on this website.';
  const body = 'Unique article body content for this page.';

  it('returns content unchanged when pageCounts is empty', () => {
    const content = `${boilerplate}\n${body}`;
    expect(filterBoilerplateParagraphs(content, {})).toBe(content);
  });

  it('removes lines appearing on more than the threshold pages', () => {
    const content = `${boilerplate}\n${body}`;
    const pageCounts = {
      [paragraphHash(boilerplate)]: BOILERPLATE_PAGE_THRESHOLD + 1,
    };
    const result = filterBoilerplateParagraphs(content, pageCounts);
    expect(result).not.toContain(boilerplate);
    expect(result).toContain(body);
  });

  it('keeps lines at exactly the threshold', () => {
    const content = `${boilerplate}\n${body}`;
    const pageCounts = {
      [paragraphHash(boilerplate)]: BOILERPLATE_PAGE_THRESHOLD,
    };
    expect(filterBoilerplateParagraphs(content, pageCounts)).toContain(
      boilerplate,
    );
  });

  it('always keeps short, unhashable lines', () => {
    const shortLine = 'short';
    const content = `${shortLine}\n${body}`;
    const pageCounts = { [paragraphHash(shortLine)]: 999 };
    expect(filterBoilerplateParagraphs(content, pageCounts)).toContain(
      shortLine,
    );
  });

  it('respects a custom threshold', () => {
    const content = `${boilerplate}\n${body}`;
    const pageCounts = { [paragraphHash(boilerplate)]: 3 };
    expect(filterBoilerplateParagraphs(content, pageCounts, 2)).not.toContain(
      boilerplate,
    );
  });
});
