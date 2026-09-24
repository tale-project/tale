import { describe, expect, it } from 'vitest';

import {
  channelFilterOf,
  channelOptionsOf,
  channelSourceOf,
  mailboxOptionValue,
  type MailboxEntry,
} from './channel-source';

const GMAIL: MailboxEntry = {
  id: 'cred-gmail',
  connectorSlug: 'gmail',
  name: 'Gmail',
  status: 'active',
};
const GENERAL: MailboxEntry = {
  id: 'cred-general',
  connectorSlug: 'imap-smtp',
  name: 'General Support',
  status: 'active',
  config: { fromAddress: 'hello@support.test' },
};
const RECRUITMENT: MailboxEntry = {
  id: 'cred-recruitment',
  connectorSlug: 'imap-smtp',
  name: 'Recruitment Support',
  status: 'active',
  config: { fromAddress: 'jobs@support.test' },
};
const MAILBOXES = [GMAIL, GENERAL, RECRUITMENT];

describe('channelSourceOf', () => {
  it("names an email thread by its connector's only mailbox", () => {
    expect(
      channelSourceOf({ channel: 'email', connectorName: 'gmail' }, MAILBOXES),
    ).toEqual({
      lane: 'email',
      slug: 'gmail',
      label: 'Gmail',
      mailbox: { id: 'cred-gmail', name: 'Gmail' },
    });
  });

  // One connector, two mailboxes: the connector cannot say which one a thread
  // is on, so a lookup by slug named every thread after the last mailbox
  // listed. The server's `credentialId` is the only answer.
  it('names the mailbox the server placed the thread on', () => {
    for (const [credentialId, name, fromAddress] of [
      ['cred-general', 'General Support', 'hello@support.test'],
      ['cred-recruitment', 'Recruitment Support', 'jobs@support.test'],
    ] as const) {
      expect(
        channelSourceOf(
          { channel: 'email', connectorName: 'imap-smtp', credentialId },
          MAILBOXES,
        ),
      ).toEqual({
        lane: 'email',
        slug: 'imap-smtp',
        label: name,
        mailbox: { id: credentialId, name, fromAddress },
      });
    }
  });

  it('names no mailbox for an unplaced thread when its connector has several', () => {
    expect(
      channelSourceOf(
        { channel: 'email', connectorName: 'imap-smtp' },
        MAILBOXES,
      ),
    ).toEqual({ lane: 'email', slug: 'imap-smtp', label: 'imap-smtp' });
  });

  // A disabled mailbox cannot be what an unplaced thread is on, so the one
  // still active is unambiguous.
  it('names the only ACTIVE mailbox for an unplaced thread', () => {
    expect(
      channelSourceOf({ channel: 'email', connectorName: 'imap-smtp' }, [
        GENERAL,
        { ...RECRUITMENT, status: 'disabled' },
      ]).mailbox,
    ).toEqual({
      id: 'cred-general',
      name: 'General Support',
      fromAddress: 'hello@support.test',
    });
  });

  // It is still where the thread arrived.
  it('names a placed thread even after its mailbox was disabled', () => {
    expect(
      channelSourceOf(
        {
          channel: 'email',
          connectorName: 'imap-smtp',
          credentialId: 'cred-recruitment',
        },
        [GENERAL, { ...RECRUITMENT, status: 'disabled' }],
      ).label,
    ).toBe('Recruitment Support');
  });

  // A credential id is only trusted inside its own connector.
  it('ignores a credential that belongs to another connector', () => {
    expect(
      channelSourceOf(
        {
          channel: 'email',
          connectorName: 'imap-smtp',
          credentialId: 'cred-gmail',
        },
        MAILBOXES,
      ),
    ).toEqual({ lane: 'email', slug: 'imap-smtp', label: 'imap-smtp' });
  });

  // An org can hold threads on a connector it no longer has a mailbox for, or
  // one the directory has not loaded yet. The slug is still true, so it is
  // still shown.
  it('falls back to the slug when the connector has no mailbox', () => {
    expect(
      channelSourceOf({ channel: 'email', connectorName: 'outlook' }, []),
    ).toEqual({ lane: 'email', slug: 'outlook', label: 'outlook' });
  });

  // The two namespaces are disjoint: an API source slug must never be looked
  // up in the connector catalog, or a source named `gmail` would read "Gmail".
  it('names an API thread by its own source, never the catalog', () => {
    expect(
      channelSourceOf({ channel: 'api', connectorName: 'gmail' }, MAILBOXES),
    ).toEqual({ lane: 'api', slug: 'gmail', label: 'gmail' });
  });

  it('reports an API thread with no source as the api lane', () => {
    expect(channelSourceOf({ channel: 'api' }, MAILBOXES)).toEqual({
      lane: 'api',
    });
  });

  // Says nothing rather than something wrong.
  it('resolves an unstamped thread to unknown with no label', () => {
    expect(channelSourceOf({}, MAILBOXES)).toEqual({ lane: 'unknown' });
    expect(channelSourceOf({ connectorName: '' }, MAILBOXES)).toEqual({
      lane: 'unknown',
    });
  });

  // A thread whose channel was never stamped but which names a connector is
  // an email thread: only the API lane is created with an explicit channel.
  it('treats a connector without a channel as email', () => {
    expect(channelSourceOf({ connectorName: 'gmail' }, MAILBOXES)).toEqual({
      lane: 'email',
      slug: 'gmail',
      label: 'Gmail',
      mailbox: { id: 'cred-gmail', name: 'Gmail' },
    });
  });
});

describe('channelOptionsOf', () => {
  const connectors = [
    { slug: 'gmail', title: 'Gmail' },
    { slug: 'imap-smtp', title: 'IMAP / SMTP Mailbox' },
  ];

  it('lists email connectors by title and API sources by slug', () => {
    expect(channelOptionsOf(connectors, ['helpdesk'])).toEqual([
      { value: 'gmail', label: 'Gmail' },
      { value: 'imap-smtp', label: 'IMAP / SMTP Mailbox' },
      { value: 'helpdesk', label: 'helpdesk' },
    ]);
  });

  // One slug is one lane on the server's `connectorName` filter, so a source
  // that shadows a connector must not produce two rows that filter alike.
  it('drops an API source that collides with a connector slug', () => {
    expect(channelOptionsOf(connectors, ['gmail', 'helpdesk'])).toEqual([
      { value: 'gmail', label: 'Gmail' },
      { value: 'imap-smtp', label: 'IMAP / SMTP Mailbox' },
      { value: 'helpdesk', label: 'helpdesk' },
    ]);
  });

  it('dedupes repeated API sources', () => {
    expect(channelOptionsOf([], ['helpdesk', 'helpdesk'])).toEqual([
      { value: 'helpdesk', label: 'helpdesk' },
    ]);
  });

  // The facet is guarded on a non-empty list, so an org with neither keeps
  // the control hidden rather than offering an empty menu.
  it('returns nothing when the org has no channel at all', () => {
    expect(channelOptionsOf([], [])).toEqual([]);
  });
});

/**
 * One connector, two mailboxes: the filter lists each, so General Support's
 * threads can be seen without Recruitment Support's. A connector with one
 * mailbox stays one entry — its mailbox and its connector are the same lane.
 */
describe('channelOptionsOf with several mailboxes on one connector', () => {
  const connectors = [
    { slug: 'imap-smtp', title: 'General Support' },
    { slug: 'imap-smtp', title: 'Recruitment Support' },
    { slug: 'gmail', title: 'Gmail' },
  ];
  const inactive = (name: string) => `${name} (inactive)`;

  it('lists each mailbox of a connector that holds several, by name', () => {
    expect(
      channelOptionsOf(
        connectors,
        ['helpdesk'],
        [GENERAL, { ...RECRUITMENT, status: 'disabled' }, GMAIL],
        inactive,
      ),
    ).toEqual([
      { value: 'mailbox:cred-general', label: 'General Support' },
      {
        value: 'mailbox:cred-recruitment',
        label: 'Recruitment Support (inactive)',
      },
      { value: 'gmail', label: 'Gmail' },
      { value: 'helpdesk', label: 'helpdesk' },
    ]);
  });

  it('keeps a connector with one mailbox as one connector entry', () => {
    expect(
      channelOptionsOf(
        [{ slug: 'imap-smtp', title: 'General Support' }],
        [],
        [GENERAL],
        inactive,
      ),
    ).toEqual([{ value: 'imap-smtp', label: 'General Support' }]);
  });
});

describe('channelFilterOf', () => {
  it('reads a mailbox entry as one mailbox, anything else as a connector', () => {
    expect(channelFilterOf(mailboxOptionValue('cred-general'))).toEqual({
      mailbox: 'cred-general',
    });
    expect(channelFilterOf('gmail')).toEqual({ channel: 'gmail' });
    expect(channelFilterOf(undefined)).toEqual({});
    expect(channelFilterOf('')).toEqual({});
  });
});
