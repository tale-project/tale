import { describe, expect, it } from 'vitest';

import {
  emailDomain,
  isSenderAddressValid,
  resolvedEmailOption,
  supportsDynamicSender,
} from './email-connectors';

describe('resolvedEmailOption', () => {
  it('reads slug, title, type and fromAddress from a resolved connector', () => {
    expect(
      resolvedEmailOption('imap_smtp', {
        title: 'Company Mailbox',
        type: 'imap_smtp',
        connectionConfig: { fromAddress: 'support@acme.test' },
      }),
    ).toEqual({
      slug: 'imap_smtp',
      title: 'Company Mailbox',
      type: 'imap_smtp',
      fromAddress: 'support@acme.test',
    });
  });

  it('falls back to the slug / empty type when fields are missing', () => {
    expect(resolvedEmailOption('outlook', {})).toEqual({
      slug: 'outlook',
      title: 'outlook',
      type: '',
      fromAddress: undefined,
    });
    expect(resolvedEmailOption('gmail', null)).toEqual({
      slug: 'gmail',
      title: 'gmail',
      type: '',
      fromAddress: undefined,
    });
  });

  it('ignores a blank configured fromAddress', () => {
    expect(
      resolvedEmailOption('imap_smtp', {
        type: 'imap_smtp',
        connectionConfig: { fromAddress: '   ' },
      }).fromAddress,
    ).toBeUndefined();
  });
});

describe('emailDomain', () => {
  it('returns the lowercased domain', () => {
    expect(emailDomain('Jane@Acme.TEST')).toBe('acme.test');
  });
  it('returns empty for an address without a domain', () => {
    expect(emailDomain('nope')).toBe('');
  });
});

describe('supportsDynamicSender', () => {
  it('is true for imap_smtp with a known verified domain', () => {
    expect(
      supportsDynamicSender({
        slug: 'imap_smtp',
        title: 'Mailbox',
        type: 'imap_smtp',
        fromAddress: 'support@acme.test',
      }),
    ).toBe(true);
  });
  it('is false for a fixed-sender provider (outlook)', () => {
    expect(
      supportsDynamicSender({
        slug: 'outlook',
        title: 'Outlook',
        type: 'rest_api',
        fromAddress: 'ops@acme.test',
      }),
    ).toBe(false);
  });
  it('is false for imap_smtp without a known domain', () => {
    expect(
      supportsDynamicSender({
        slug: 'imap_smtp',
        title: 'Mailbox',
        type: 'imap_smtp',
      }),
    ).toBe(false);
    expect(supportsDynamicSender(null)).toBe(false);
  });
});

describe('isSenderAddressValid', () => {
  it('accepts any local part on the verified domain (case-insensitive)', () => {
    expect(isSenderAddressValid('sales@acme.test', 'acme.test')).toBe(true);
    expect(isSenderAddressValid('Sales@ACME.test', 'acme.test')).toBe(true);
  });
  it('rejects a different domain, empty local part, or whitespace', () => {
    expect(isSenderAddressValid('sales@evil.test', 'acme.test')).toBe(false);
    expect(isSenderAddressValid('@acme.test', 'acme.test')).toBe(false);
    expect(isSenderAddressValid('sales @acme.test', 'acme.test')).toBe(false);
    expect(isSenderAddressValid('', 'acme.test')).toBe(false);
    expect(isSenderAddressValid('sales', 'acme.test')).toBe(false);
  });
});
