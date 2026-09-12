// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { conversationReadAdapters } from './conversations';

const ctx = { organizationId: 'org1' };
const NAME = 'conversations/queries:approxCountConversationsByStatus';

/**
 * `/conversations/counts` answers every status in one body, and the Inbox
 * prefetches a badge per status: keyed on the status, one cold load fetched
 * the same body four times. The reads key on the fetch and narrow in
 * `select`, so react-query issues one request and every badge reads it.
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
    expect(read?.select?.({ open: 3, closed: 7 })).toBe(7);
    expect(read?.select?.({ open: 3 })).toBe(0);
  });
});
