import { describe, it, expect } from 'vitest';

import { normalizeForCache } from '../normalize';

describe('normalizeForCache', () => {
  it('trims leading and trailing whitespace', () => {
    expect(normalizeForCache('  hello  ')).toBe('hello');
  });

  it('collapses internal whitespace runs', () => {
    expect(normalizeForCache('a   b\t\tc')).toBe('a b c');
  });

  it('collapses newlines into single space', () => {
    expect(normalizeForCache('line1\nline2\n\nline3')).toBe(
      'line1 line2 line3',
    );
  });

  it('preserves punctuation', () => {
    expect(normalizeForCache('C++')).toBe('C++');
    expect(normalizeForCache('file.txt')).toBe('file.txt');
    expect(normalizeForCache("What's up?")).toBe("What's up?");
  });

  it('preserves casing', () => {
    expect(normalizeForCache('Hello World')).toBe('Hello World');
  });

  it('preserves JSON structure', () => {
    expect(normalizeForCache('{"status": "ok"}')).toBe('{"status": "ok"}');
  });

  it('preserves URLs', () => {
    expect(normalizeForCache('https://example.com/path?q=1')).toBe(
      'https://example.com/path?q=1',
    );
  });

  it('returns empty string for empty input', () => {
    expect(normalizeForCache('')).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeForCache('   \t\n  ')).toBe('');
  });

  it('distinguishes C++ from C', () => {
    expect(normalizeForCache('C++')).not.toBe(normalizeForCache('C'));
  });
});
