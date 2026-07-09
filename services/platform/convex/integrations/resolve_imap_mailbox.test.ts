import { describe, expect, it } from 'vitest';

import { resolveImapMailbox } from './resolve_imap_mailbox';

describe('resolveImapMailbox', () => {
  it('maps sent sentinel to configured sentMailbox', () => {
    expect(resolveImapMailbox({ sentMailbox: 'Sent Items' }, 'SENT')).toEqual({
      mailbox: 'Sent Items',
      isSentFolder: true,
    });
  });

  it('defaults sent sentinel to Sent when unset', () => {
    expect(resolveImapMailbox({}, 'sent')).toEqual({
      mailbox: 'Sent',
      isSentFolder: true,
    });
  });

  it('passes explicit mailbox names through', () => {
    expect(resolveImapMailbox({}, 'INBOX')).toEqual({
      mailbox: 'INBOX',
      isSentFolder: false,
    });
  });

  it('returns undefined mailbox for INBOX default', () => {
    expect(resolveImapMailbox({}, undefined)).toEqual({
      mailbox: undefined,
      isSentFolder: false,
    });
  });
});
