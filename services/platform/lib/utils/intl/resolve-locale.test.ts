import { describe, it, expect } from 'vitest';

import { resolveLocale } from './resolve-locale';

describe('resolveLocale', () => {
  it('returns default when candidates are empty', () => {
    expect(resolveLocale([], 'en-US')).toBe('en-US');
  });

  it('returns the first valid locale', () => {
    expect(resolveLocale(['de-DE', 'en-US'], 'en-US')).toBe('de-DE');
  });

  it('picks first valid candidate from a preference list', () => {
    expect(resolveLocale(['fr-FR', 'de-DE'], 'en-US')).toBe('fr-FR');
  });

  it('resolves from a multi-language preference list', () => {
    expect(resolveLocale(['de-DE', 'de', 'en-US', 'en'], 'en-US')).toBe(
      'de-DE',
    );
  });

  it('falls back to en-US for bare "en" via en fallback', () => {
    expect(resolveLocale(['en'], 'de-DE')).toBe('en');
  });

  it('returns default for truly unparseable tags', () => {
    expect(resolveLocale(['!!!', '@@@'], 'en-US')).toBe('en-US');
  });

  it('handles single-candidate list', () => {
    expect(resolveLocale(['ja-JP'], 'en-US')).toBe('ja-JP');
  });
});
