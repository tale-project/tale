import { describe, expect, it } from 'vitest';

import { channelOptionsOf, channelSourceOf } from './channel-source';

const TITLES: Record<string, string> = { gmail: 'Gmail' };
const titleOf = (slug: string): string | undefined => TITLES[slug];

describe('channelSourceOf', () => {
  it('names an email thread by its connector title', () => {
    expect(
      channelSourceOf({ channel: 'email', connectorName: 'gmail' }, titleOf),
    ).toEqual({ lane: 'email', slug: 'gmail', label: 'Gmail' });
  });

  // An org can install a connector the catalog lookup has not loaded yet, or
  // one it no longer offers. The slug is still true, so it is still shown.
  it('falls back to the slug when the connector has no title', () => {
    expect(
      channelSourceOf(
        { channel: 'email', connectorName: 'imap-smtp' },
        titleOf,
      ),
    ).toEqual({ lane: 'email', slug: 'imap-smtp', label: 'imap-smtp' });
  });

  // The two namespaces are disjoint: an API source slug must never be looked
  // up in the connector catalog, or a source named `gmail` would read "Gmail".
  it('names an API thread by its own source, never the catalog', () => {
    expect(
      channelSourceOf({ channel: 'api', connectorName: 'gmail' }, titleOf),
    ).toEqual({ lane: 'api', slug: 'gmail', label: 'gmail' });
  });

  it('reports an API thread with no source as the api lane', () => {
    expect(channelSourceOf({ channel: 'api' }, titleOf)).toEqual({
      lane: 'api',
    });
  });

  // Says nothing rather than something wrong.
  it('resolves an unstamped thread to unknown with no label', () => {
    expect(channelSourceOf({}, titleOf)).toEqual({ lane: 'unknown' });
    expect(channelSourceOf({ connectorName: '' }, titleOf)).toEqual({
      lane: 'unknown',
    });
  });

  // A thread whose channel was never stamped but which names a connector is
  // an email thread: only the API lane is created with an explicit channel.
  it('treats a connector without a channel as email', () => {
    expect(channelSourceOf({ connectorName: 'gmail' }, titleOf)).toEqual({
      lane: 'email',
      slug: 'gmail',
      label: 'Gmail',
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
