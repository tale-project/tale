import { describe, expect, it } from 'vitest';

import {
  looksLikeEmailAddress,
  storedImapFromAddress,
  withImapFromAddress,
} from './imap_from_address';

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
  });
});

describe('storedImapFromAddress', () => {
  it('carries an existing mirror so a config replace cannot drop it', () => {
    // The field is server-owned and hidden from the form, so an update that
    // replaces config without a username has no way to resupply it.
    expect(storedImapFromAddress({ config: { fromAddress: 'a@b.test' } })).toBe(
      'a@b.test',
    );
  });

  it('ignores an absent or unusable stored value', () => {
    expect(storedImapFromAddress({})).toBeUndefined();
    expect(storedImapFromAddress({ config: {} })).toBeUndefined();
    expect(
      storedImapFromAddress({ config: { fromAddress: 'resend' } }),
    ).toBeUndefined();
    expect(storedImapFromAddress({ config: { fromAddress: 25 } })).toBe(
      undefined,
    );
  });
});

describe('withImapFromAddress', () => {
  it('mirrors username into fromAddress for imap-smtp', () => {
    expect(
      withImapFromAddress(
        'imap-smtp',
        { imapHost: 'imap.example.com' },
        'hello@acme.test',
      ),
    ).toEqual({
      imapHost: 'imap.example.com',
      fromAddress: 'hello@acme.test',
    });
  });

  it('overwrites a drifted fromAddress so it stays equal to username', () => {
    expect(
      withImapFromAddress(
        'imap-smtp',
        { fromAddress: 'old@acme.test' },
        'new@acme.test',
      ),
    ).toEqual({ fromAddress: 'new@acme.test' });
  });

  it('leaves other connectors and non-email usernames alone', () => {
    expect(
      withImapFromAddress('gmail', { fromAddress: 'x' }, 'a@b.com'),
    ).toEqual({ fromAddress: 'x' });
    expect(
      withImapFromAddress('imap-smtp', { imapHost: 'imap.example.com' }, 'ops'),
    ).toEqual({ imapHost: 'imap.example.com' });
    expect(withImapFromAddress('imap-smtp', undefined, undefined)).toBe(
      undefined,
    );
    expect(
      withImapFromAddress('imap-smtp', undefined, 'hello@acme.test'),
    ).toEqual({
      fromAddress: 'hello@acme.test',
    });
  });
});
