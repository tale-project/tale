import { describe, expect, it } from 'vitest';

import {
  findClauseEnd,
  MAX_SEGMENT_CHARS,
  splitClauseChunks,
} from './clause-boundaries';

describe('findClauseEnd', () => {
  it('ends at a separator followed by whitespace, consuming the run', () => {
    expect(findClauseEnd('Hello there, how are you', 0)).toBe(
      'Hello there, '.length,
    );
  });

  it('ends at a newline (inclusive)', () => {
    expect(findClauseEnd('line one\nline two', 0)).toBe('line one\n'.length);
  });

  it('returns -1 when no boundary exists before the end', () => {
    expect(findClauseEnd('no boundary here', 0)).toBe(-1);
  });

  it('cuts at a word boundary once the cap is exceeded', () => {
    const text = Array.from({ length: 20 }, () => 'abcdefgh').join(' ');
    const end = findClauseEnd(text, 0);
    expect(end).toBeGreaterThan(0);
    expect(end).toBeLessThanOrEqual(MAX_SEGMENT_CHARS + 1);
    expect(text[end - 1]).toBe(' ');
  });
});

describe('splitClauseChunks', () => {
  it('splits at separators followed by whitespace, keeping them attached', () => {
    expect(splitClauseChunks('Hello there, how are you? Fine.')).toEqual([
      'Hello there, ',
      'how are you? ',
      'Fine.',
    ]);
  });

  it('does not split numbers', () => {
    expect(splitClauseChunks('Pi is 3.14 and 1,000 things')).toEqual([
      'Pi is 3.14 and 1,000 things',
    ]);
  });

  it('splits at fullwidth CJK punctuation without requiring whitespace', () => {
    expect(splitClauseChunks('你好，世界。完')).toEqual([
      '你好，',
      '世界。',
      '完',
    ]);
  });

  it('sub-splits long unpunctuated runs at the same cap cuts the reveal uses', () => {
    const text = Array.from({ length: 20 }, () => 'abcdefgh').join(' ');
    const chunks = splitClauseChunks(text);
    expect(chunks.length).toBeGreaterThan(1);
    // The chunk boundaries must be exactly the findClauseEnd recurrence —
    // this is what guarantees every reveal step lands on a span boundary.
    let from = 0;
    for (const chunk of chunks) {
      const end = findClauseEnd(text, from);
      if (end === -1) {
        expect(chunk).toBe(text.slice(from));
      } else {
        expect(chunk).toBe(text.slice(from, end));
      }
      from += chunk.length;
    }
  });

  it('round-trips: chunks concatenate to the input', () => {
    const inputs = [
      'One, two. Three! Four? Five: six; seven',
      'Hey! 👋\n\nEs sieht so aus, als hätte deine Nachricht abgebrochen.',
      Array.from({ length: 30 }, () => 'wordhere').join(' '),
    ];
    for (const input of inputs) {
      expect(splitClauseChunks(input).join('')).toBe(input);
    }
  });
});
