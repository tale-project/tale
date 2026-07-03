import { describe, expect, it } from 'vitest';

import { deriveNameFromEmail } from './derive-name-from-email';

describe('deriveNameFromEmail', () => {
  it('Title-Cases all multi-token handles', () => {
    expect(deriveNameFromEmail('john.doe@example.com')).toBe('John Doe');
  });

  it('drops trailing digits and keeps every long token', () => {
    expect(deriveNameFromEmail('marcel.jan.kurbeck98@example.com')).toBe(
      'Marcel Jan Kurbeck',
    );
  });

  it('drops a trailing single-character initial', () => {
    expect(deriveNameFromEmail('marcel.k@example.com')).toBe('Marcel');
  });

  it('drops a leading single-character initial', () => {
    expect(deriveNameFromEmail('j.smith@example.com')).toBe('Smith');
  });

  it('splits common separators (underscore, hyphen)', () => {
    expect(deriveNameFromEmail('john_doe@example.com')).toBe('John Doe');
    expect(deriveNameFromEmail('john-doe@example.com')).toBe('John Doe');
  });

  it('splits camelCase handles without an explicit separator', () => {
    expect(deriveNameFromEmail('johnDoe@example.com')).toBe('John Doe');
  });

  it('strips a +tag alias before deriving', () => {
    expect(deriveNameFromEmail('john.doe+newsletter@example.com')).toBe(
      'John Doe',
    );
  });

  it('keeps a short separator-less handle verbatim (unchanged case)', () => {
    expect(deriveNameFromEmail('mk@example.com')).toBe('mk');
  });

  it('keeps a separator-less word verbatim rather than guessing', () => {
    expect(deriveNameFromEmail('marcel@example.com')).toBe('marcel');
  });

  it('keeps the raw handle when every token is a single character', () => {
    expect(deriveNameFromEmail('j.k@example.com')).toBe('j.k');
  });

  it('collapses repeated and trailing separators', () => {
    expect(deriveNameFromEmail('john..doe.@example.com')).toBe('John Doe');
  });

  it('keeps a numeric-only handle verbatim', () => {
    expect(deriveNameFromEmail('12345@example.com')).toBe('12345');
  });

  it('preserves unicode/accented names', () => {
    expect(deriveNameFromEmail('andré.müller@example.com')).toBe(
      'André Müller',
    );
  });

  it('handles a bare handle with no @', () => {
    expect(deriveNameFromEmail('john.doe')).toBe('John Doe');
  });

  it('returns an empty string for empty or whitespace input', () => {
    expect(deriveNameFromEmail('')).toBe('');
    expect(deriveNameFromEmail('   ')).toBe('');
    expect(deriveNameFromEmail('@example.com')).toBe('');
  });

  it('returns an empty string for non-string input', () => {
    // @ts-expect-error — guarding the runtime contract against bad callers.
    expect(deriveNameFromEmail(undefined)).toBe('');
    // @ts-expect-error — guarding the runtime contract against bad callers.
    expect(deriveNameFromEmail(null)).toBe('');
  });

  it('handles a very long handle without throwing', () => {
    const long = `${'a'.repeat(200)}.${'b'.repeat(200)}`;
    const result = deriveNameFromEmail(`${long}@example.com`);
    expect(result.startsWith('A')).toBe(true);
    expect(result).toContain(' B');
  });
});
