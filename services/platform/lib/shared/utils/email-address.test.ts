import { describe, expect, it } from 'vitest';

import { looksLikeEmailAddress } from './email-address';

describe('looksLikeEmailAddress', () => {
  it('accepts a simple local@domain', () => {
    expect(looksLikeEmailAddress('hello@acme.test')).toBe(true);
    expect(looksLikeEmailAddress('  Hello@Acme.TEST  ')).toBe(true);
  });

  it('rejects non-emails', () => {
    expect(looksLikeEmailAddress('')).toBe(false);
    expect(looksLikeEmailAddress('resend')).toBe(false);
    expect(looksLikeEmailAddress('@acme.test')).toBe(false);
    expect(looksLikeEmailAddress('hello@')).toBe(false);
    expect(looksLikeEmailAddress('hello @acme.test')).toBe(false);
    // A directory object ID names a mailbox to Graph, but is no address.
    expect(looksLikeEmailAddress('9f1c2b7e-4d3a-4c8e-9b1f-2a6d5e8c7b40')).toBe(
      false,
    );
  });
});
