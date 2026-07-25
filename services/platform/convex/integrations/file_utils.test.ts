import { describe, expect, it } from 'vitest';

import { deriveNextSlug, validateIntegrationSlug } from './file_utils';

describe('deriveNextSlug', () => {
  it('appends -2 to a base with no numeric suffix', () => {
    expect(deriveNextSlug('imap_smtp', [])).toBe('imap_smtp-2');
  });

  it('skips slugs already taken', () => {
    expect(deriveNextSlug('imap_smtp', ['imap_smtp-2', 'imap_smtp-3'])).toBe(
      'imap_smtp-4',
    );
  });

  it('increments an existing numeric suffix instead of stacking (-2-2)', () => {
    expect(deriveNextSlug('imap_smtp-2', [])).toBe('imap_smtp-3');
    expect(deriveNextSlug('imap_smtp-2', ['imap_smtp-3'])).toBe('imap_smtp-4');
  });

  it('suffixes only the last segment of a kebab automation slug path', () => {
    expect(deriveNextSlug('imap-smtp/sync-emails', [])).toBe(
      'imap-smtp/sync-emails-2',
    );
    expect(deriveNextSlug('imap-smtp/sync-emails-2', [])).toBe(
      'imap-smtp/sync-emails-3',
    );
  });

  it('always returns a slug distinct from the base', () => {
    expect(deriveNextSlug('x-5', ['x-6'])).toBe('x-7');
  });

  it('produces a valid integration slug for the imap case', () => {
    expect(validateIntegrationSlug(deriveNextSlug('imap_smtp', []))).toBe(true);
  });
});
