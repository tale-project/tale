import { describe, it, expect } from 'vitest';

import {
  emailDomain,
  inboundRecipientAddress,
  isPublicEmailDomain,
  mailboxSideAddress,
  resolveReplyFrom,
  sameMailboxAliasDomain,
} from './reply-from';

describe('emailDomain', () => {
  it('returns the lowercased domain part', () => {
    expect(emailDomain('billing@support.example.com')).toBe(
      'support.example.com',
    );
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
        to: [{ address: 'billing@support.example.com' }],
      }),
    ).toBe('billing@support.example.com');
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

describe('mailboxSideAddress', () => {
  it('reads the recipient on inbound mail', () => {
    expect(
      mailboxSideAddress(
        {
          from: [{ address: 'jordan@customer.test' }],
          to: [{ address: 'support@acme.test' }],
        },
        'inbound',
      ),
    ).toBe('support@acme.test');
  });

  it('reads the sender on sent-folder mail, where To is the contact', () => {
    expect(
      mailboxSideAddress(
        {
          from: [{ address: 'support@acme.test' }],
          to: [{ address: 'jordan@customer.test' }],
        },
        'outbound',
      ),
    ).toBe('support@acme.test');
  });

  it('falls back to To for a compose thread, which stamps only the sender there', () => {
    expect(
      mailboxSideAddress(
        { to: [{ address: 'billing@acme.test' }] },
        'outbound',
      ),
    ).toBe('billing@acme.test');
  });

  it('treats an unknown direction as inbound and tolerates junk metadata', () => {
    expect(
      mailboxSideAddress({ to: [{ address: 'support@acme.test' }] }, undefined),
    ).toBe('support@acme.test');
    expect(mailboxSideAddress(undefined, 'outbound')).toBeUndefined();
    expect(mailboxSideAddress({ from: 'nope' }, 'outbound')).toBeUndefined();
    expect(
      mailboxSideAddress({ from: [{ name: 'no address' }] }, 'outbound'),
    ).toBeUndefined();
  });
});

describe('isPublicEmailDomain / sameMailboxAliasDomain', () => {
  it('flags consumer hosts and allows org domains', () => {
    expect(isPublicEmailDomain('gmail.com')).toBe(true);
    expect(isPublicEmailDomain('Gmail.COM')).toBe(true);
    expect(isPublicEmailDomain('support.example.com')).toBe(false);
  });

  it('allows aliasing only on non-public matching domains', () => {
    expect(
      sameMailboxAliasDomain(
        'billing@support.example.com',
        'hello@support.example.com',
      ),
    ).toBe(true);
    expect(sameMailboxAliasDomain('stranger@gmail.com', 'desk@gmail.com')).toBe(
      false,
    );
    expect(sameMailboxAliasDomain('a@example.com', 'b@other.com')).toBe(false);
  });
});

describe('resolveReplyFrom', () => {
  it('uses the inbound address when it shares the sender domain', () => {
    expect(
      resolveReplyFrom(
        'billing@support.example.com',
        'hello@support.example.com',
      ),
    ).toBe('billing@support.example.com');
  });

  it('matches the domain case-insensitively', () => {
    expect(
      resolveReplyFrom(
        'billing@SUPPORT.example.com',
        'hello@support.example.com',
      ),
    ).toBe('billing@SUPPORT.example.com');
  });

  it('falls back when the inbound address is on a different domain', () => {
    expect(
      resolveReplyFrom('billing@other.com', 'hello@support.example.com'),
    ).toBe('hello@support.example.com');
  });

  it('falls back when there is no inbound address', () => {
    expect(resolveReplyFrom(undefined, 'hello@support.example.com')).toBe(
      'hello@support.example.com',
    );
  });

  it('falls back when the sender From has no domain (misconfigured)', () => {
    // e.g. Resend split creds with no From Address set → smtp.user = "resend"
    expect(resolveReplyFrom('billing@support.example.com', 'resend')).toBe(
      'resend',
    );
  });

  it('keeps the connected Gmail address when To is a different @gmail.com', () => {
    // Regression: domain equality alone treated every Gmail To as a From alias,
    // so the Inbox Mail icon showed unconnected personal addresses.
    expect(resolveReplyFrom('stranger@gmail.com', 'desk@gmail.com')).toBe(
      'desk@gmail.com',
    );
  });

  it('still uses the inbound address when it equals the connected mailbox', () => {
    expect(resolveReplyFrom('Desk@Gmail.com', 'desk@gmail.com')).toBe(
      'Desk@Gmail.com',
    );
  });
});
