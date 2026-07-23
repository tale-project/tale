import { describe, expect, it } from 'vitest';

import {
  findRevealSegmentEnd,
  isInsideCodeFence,
  MAX_SEGMENT_CHARS,
} from './reveal-segment';

describe('findRevealSegmentEnd', () => {
  describe('prose clauses', () => {
    it('ends a segment at a comma followed by a space, consuming the space', () => {
      const text = 'Hello there, how are you';
      expect(findRevealSegmentEnd(text, 0, true)).toBe('Hello there, '.length);
    });

    it('ends a segment at sentence punctuation', () => {
      const text = 'Done. Next part';
      expect(findRevealSegmentEnd(text, 0, true)).toBe('Done. '.length);
    });

    it('does not split numbers at decimal points or thousand separators', () => {
      const text = 'Pi is 3.14159 and big is 1,000,000 ok';
      // First boundary should be well past "3." — the next separator
      // followed by whitespace.
      const end = findRevealSegmentEnd(text, 0, true);
      expect(text.slice(0, end)).not.toBe('Pi is 3.');
      expect(text.slice(0, end)).not.toBe('Pi is 3.14159 and big is 1,');
    });

    it('ends a segment at a newline (inclusive)', () => {
      const text = 'line one\nline two';
      expect(findRevealSegmentEnd(text, 0, true)).toBe('line one\n'.length);
    });

    it('holds an incomplete clause while streaming', () => {
      const text = 'still typing with no separator yet';
      expect(findRevealSegmentEnd(text, 0, true)).toBe(0);
    });

    it('reveals the remaining tail once the stream has ended', () => {
      const text = 'final words without punctuation';
      expect(findRevealSegmentEnd(text, 0, false)).toBe(text.length);
    });

    it('caps unpunctuated runs at a word boundary', () => {
      const word = 'abcdefgh';
      const text = Array.from({ length: 20 }, () => word).join(' ');
      const end = findRevealSegmentEnd(text, 0, true);
      expect(end).toBeGreaterThan(0);
      expect(end).toBeLessThanOrEqual(MAX_SEGMENT_CHARS + 1);
      // Breaks AFTER a space, never mid-word.
      expect(text[end - 1]).toBe(' ');
    });

    it('advances from a mid-text position', () => {
      const text = 'First part, second part, third';
      const first = findRevealSegmentEnd(text, 0, true);
      const second = findRevealSegmentEnd(text, first, true);
      expect(text.slice(first, second)).toBe('second part, ');
    });
  });

  describe('code fences', () => {
    const code = '```ts\nconst a = 1;\nconst b = 2;\n```\ndone';

    it('detects positions inside a fence', () => {
      expect(isInsideCodeFence(code, code.indexOf('const a'))).toBe(true);
      expect(isInsideCodeFence(code, code.indexOf('done'))).toBe(false);
    });

    it('reveals code line by line', () => {
      const from = code.indexOf('const a');
      expect(findRevealSegmentEnd(code, from, true)).toBe(
        code.indexOf('const b'),
      );
    });

    it('holds an incomplete code line while streaming', () => {
      const partial = '```ts\nconst a = 1;\nconst b = ';
      const from = partial.indexOf('const b');
      expect(findRevealSegmentEnd(partial, from, true)).toBe(from);
    });

    it('reveals the incomplete code line in drain', () => {
      const partial = '```ts\nconst a = 1;\nconst b = ';
      const from = partial.indexOf('const b');
      expect(findRevealSegmentEnd(partial, from, false)).toBe(partial.length);
    });
  });

  describe('tables', () => {
    const table = '| a | b |\n| --- | --- |\n| 1 | 2 |\n';

    it('reveals table rows whole (row by row)', () => {
      expect(findRevealSegmentEnd(table, 0, true)).toBe('| a | b |\n'.length);
      const secondRowStart = '| a | b |\n'.length;
      expect(findRevealSegmentEnd(table, secondRowStart, true)).toBe(
        secondRowStart + '| --- | --- |\n'.length,
      );
    });

    it('holds an incomplete row while streaming', () => {
      const partial = '| a | b |\n| 1 | ';
      const from = '| a | b |\n'.length;
      expect(findRevealSegmentEnd(partial, from, true)).toBe(from);
    });
  });

  it('returns from when already at the end', () => {
    expect(findRevealSegmentEnd('abc', 3, true)).toBe(3);
    expect(findRevealSegmentEnd('abc', 3, false)).toBe(3);
  });
});
