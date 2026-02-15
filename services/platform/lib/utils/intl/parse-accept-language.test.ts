import { describe, it, expect } from 'vitest';

import { parseAcceptLanguage } from './parse-accept-language';

describe('parseAcceptLanguage', () => {
  it('returns empty array for empty string', () => {
    expect(parseAcceptLanguage('')).toEqual([]);
  });

  it('parses a single locale without quality', () => {
    expect(parseAcceptLanguage('en-US')).toEqual(['en-US']);
  });

  it('preserves order when all qualities are implicit (1.0)', () => {
    expect(parseAcceptLanguage('en-US, de-DE')).toEqual(['en-US', 'de-DE']);
  });

  it('sorts by quality weight descending', () => {
    expect(parseAcceptLanguage('en;q=0.7, de;q=0.9, fr;q=0.8')).toEqual([
      'de',
      'fr',
      'en',
    ]);
  });

  it('parses a realistic Accept-Language header', () => {
    expect(parseAcceptLanguage('de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7')).toEqual([
      'de-DE',
      'de',
      'en-US',
      'en',
    ]);
  });

  it('handles mixed implicit and explicit qualities', () => {
    expect(parseAcceptLanguage('en-US,en;q=0.9,de;q=0.8')).toEqual([
      'en-US',
      'en',
      'de',
    ]);
  });

  it('ignores wildcard (*)', () => {
    expect(parseAcceptLanguage('en-US, *;q=0.5')).toEqual(['en-US']);
  });

  it('handles whitespace variations', () => {
    expect(parseAcceptLanguage('  en-US , de-DE ; q=0.8 ')).toEqual([
      'en-US',
      'de-DE',
    ]);
  });

  it('clamps quality to 0–1 range', () => {
    const result = parseAcceptLanguage('en;q=1.5, de;q=-0.1');
    expect(result).toEqual(['en', 'de']);
  });

  it('handles quality of 0', () => {
    expect(parseAcceptLanguage('en;q=0, de')).toEqual(['de', 'en']);
  });

  it('skips empty segments', () => {
    expect(parseAcceptLanguage('en-US,,de-DE')).toEqual(['en-US', 'de-DE']);
  });
});
