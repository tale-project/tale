import { describe, expect, it } from 'vitest';

import {
  discoverSentMailboxPath,
  type ListableMailbox,
} from './discover_sent_mailbox';

function mailbox(
  path: string,
  options: { specialUse?: string; noselect?: boolean } = {},
): ListableMailbox {
  const flags = new Set<string>();
  if (options.noselect) flags.add('\\Noselect');
  return { path, flags, specialUse: options.specialUse };
}

describe('discoverSentMailboxPath', () => {
  it('prefers SPECIAL-USE \\Sent over configured name', () => {
    expect(
      discoverSentMailboxPath(
        [
          mailbox('Sent', { noselect: true }),
          mailbox('Sent Items', { specialUse: '\\Sent' }),
        ],
        'Sent',
      ),
    ).toBe('Sent Items');
  });

  it('matches configured folder name case-insensitively', () => {
    expect(discoverSentMailboxPath([mailbox('INBOX.Sent')], 'sent')).toBe(
      'INBOX.Sent',
    );
  });

  it('falls back to common Sent folder names', () => {
    expect(discoverSentMailboxPath([mailbox('[Gmail]/Sent Mail')])).toBe(
      '[Gmail]/Sent Mail',
    );
  });

  it('matches leaf segment for nested paths', () => {
    expect(
      discoverSentMailboxPath([mailbox('INBOX/Sent Items')], 'Sent Items'),
    ).toBe('INBOX/Sent Items');
  });

  it('returns null when no sent folder exists', () => {
    expect(discoverSentMailboxPath([mailbox('INBOX')])).toBeNull();
  });
});
