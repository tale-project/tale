import { describe, it, expect } from 'vitest';

import {
  emailDomain,
  inboundRecipientAddress,
  notificationFromAddress,
  resolveReplyFrom,
} from './reply_from';

describe('emailDomain', () => {
  it('returns the lowercased domain part', () => {
    expect(emailDomain('billing@support.activ.ng')).toBe('support.activ.ng');
    expect(emailDomain('Support@Example.COM')).toBe('example.com');
  });

  it('returns empty string when there is no @', () => {
    expect(emailDomain('resend')).toBe('');
  });

  it('uses the LAST @ so display-name garbage does not fool it', () => {
    expect(emailDomain('a@b@c.com')).toBe('c.com');
  });
});

describe('inboundRecipientAddress', () => {
  it('extracts the first recipient address from metadata.to', () => {
    expect(
      inboundRecipientAddress({
        to: [{ address: 'billing@support.activ.ng' }],
      }),
    ).toBe('billing@support.activ.ng');
  });

  it('returns undefined for missing / empty / non-array to', () => {
    expect(inboundRecipientAddress(undefined)).toBeUndefined();
    expect(inboundRecipientAddress({})).toBeUndefined();
    expect(inboundRecipientAddress({ to: [] })).toBeUndefined();
    expect(inboundRecipientAddress({ to: 'nope' })).toBeUndefined();
  });

  it('returns undefined when the first entry has no string address', () => {
    expect(inboundRecipientAddress({ to: [{ name: 'x' }] })).toBeUndefined();
    expect(inboundRecipientAddress({ to: [{ address: 123 }] })).toBeUndefined();
  });
});

describe('resolveReplyFrom', () => {
  it('uses the inbound address when it shares the sender domain', () => {
    expect(
      resolveReplyFrom('billing@support.activ.ng', 'hello@support.activ.ng'),
    ).toBe('billing@support.activ.ng');
  });

  it('matches the domain case-insensitively', () => {
    expect(
      resolveReplyFrom('billing@SUPPORT.activ.ng', 'hello@support.activ.ng'),
    ).toBe('billing@SUPPORT.activ.ng');
  });

  it('falls back when the inbound address is on a different domain', () => {
    expect(
      resolveReplyFrom('billing@other.com', 'hello@support.activ.ng'),
    ).toBe('hello@support.activ.ng');
  });

  it('falls back when there is no inbound address', () => {
    expect(resolveReplyFrom(undefined, 'hello@support.activ.ng')).toBe(
      'hello@support.activ.ng',
    );
  });

  it('falls back when the sender From has no domain (misconfigured)', () => {
    // e.g. Resend split creds with no From Address set → smtp.user = "resend"
    expect(resolveReplyFrom('billing@support.activ.ng', 'resend')).toBe(
      'resend',
    );
  });
});

describe('notificationFromAddress', () => {
  it('uses notification@ on the base send domain', () => {
    expect(notificationFromAddress('hello@support.activ.ng')).toBe(
      'notification@support.activ.ng',
    );
    expect(notificationFromAddress('Support@Example.COM')).toBe(
      'notification@example.com',
    );
  });

  it('falls back when the base address has no domain', () => {
    expect(notificationFromAddress('resend')).toBe('resend');
  });
});
