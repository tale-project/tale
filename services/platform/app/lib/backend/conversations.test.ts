// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { conversationReadAdapters } from './conversations';

const ctx = { organizationId: 'org1' };
const NAME = 'conversations/queries:approxCountConversationsByStatus';
const UNREAD = 'conversations/queries:countUnreadConversations';
const BODY = { byStatus: { open: 3, closed: 7 }, unread: 5 };

/**
 * `/conversations/counts` answers every status AND the unread total in one
 * body, and the Inbox prefetches a badge per status while the rail reads the
 * unread chip: keyed on the narrowing, one cold load fetched the same body
 * five times. Every read keys on the fetch and narrows in `select`, so
 * react-query issues one request and all five read it.
 */
describe('the conversation count badges', () => {
  it('share one cache entry per connector, whatever status they read', () => {
    const keys = ['open', 'closed', 'spam', 'archived'].map(
      (status) => conversationReadAdapters[NAME]?.({ status }, ctx)?.queryKey,
    );
    expect(new Set(keys.map((key) => JSON.stringify(key))).size).toBe(1);
    const filtered = conversationReadAdapters[NAME]?.(
      { status: 'open', connectorName: 'gmail' },
      ctx,
    )?.queryKey;
    expect(JSON.stringify(filtered)).not.toBe(JSON.stringify(keys[0]));
  });

  it('narrow the shared body to their own status', () => {
    const read = conversationReadAdapters[NAME]?.({ status: 'closed' }, ctx);
    expect(read?.select?.(BODY)).toBe(7);
    expect(read?.select?.({ byStatus: { open: 3 }, unread: 0 })).toBe(0);
  });

  it('share that entry with the rail’s unread chip', () => {
    const status = conversationReadAdapters[NAME]?.({ status: 'open' }, ctx);
    const unread = conversationReadAdapters[UNREAD]?.({}, ctx);
    expect(JSON.stringify(unread?.queryKey)).toBe(
      JSON.stringify(status?.queryKey),
    );
  });

  it('narrow the shared body to the unread total', () => {
    const read = conversationReadAdapters[UNREAD]?.({}, ctx);
    expect(read?.select?.(BODY)).toBe(5);
    // Not the open-status count, which is the neighbouring number in the
    // same body and the one a wrong key would silently return.
    expect(read?.select?.(BODY)).not.toBe(BODY.byStatus.open);
  });

  it('keys the unread chip per connector, like the status badges', () => {
    const all = conversationReadAdapters[UNREAD]?.({}, ctx)?.queryKey;
    const gmail = conversationReadAdapters[UNREAD]?.(
      { connectorName: 'gmail' },
      ctx,
    )?.queryKey;
    expect(JSON.stringify(gmail)).not.toBe(JSON.stringify(all));
  });
});
