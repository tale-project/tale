/**
 * Approximate unread count over OPEN conversations (badges / StatGrid tiles).
 *
 * The unread marker lives at `metadata.unread_count` — written by ingest and
 * cleared by `mark_conversation_as_read`. Walks open conversations via
 * `by_org_connector_status_lastMessageAt` when filtering by connector,
 * otherwise `by_org_status_lastMessageAt`, and counts rows with a positive
 * marker. Both the result and the scan are cap-bounded so a large org can
 * never degrade this into a full-index walk.
 */

import type { QueryCtx } from '../_generated/server';
import { DEFAULT_COUNT_CAP } from '../lib/helpers/count_items_in_org';

// Unread rows can be sparse among open ones, so bounding the counted rows
// alone would not bound the work — the scan itself is capped too.
const UNREAD_SCAN_CAP = 200;

/** Whether a conversation's metadata carries a positive unread marker. */
export function isUnreadConversation(
  metadata: Record<string, unknown> | undefined,
): boolean {
  const unread = metadata?.unread_count;
  return typeof unread === 'number' && unread > 0;
}

export async function approxCountUnreadConversations(
  ctx: QueryCtx,
  args: { organizationId: string; connectorName?: string },
): Promise<number> {
  const { organizationId, connectorName } = args;

  const query =
    connectorName !== undefined
      ? ctx.db
          .query('conversations')
          .withIndex('by_org_connector_status_lastMessageAt', (q) =>
            q
              .eq('organizationId', organizationId)
              .eq('connectorName', connectorName)
              .eq('status', 'open'),
          )
      : ctx.db
          .query('conversations')
          .withIndex('by_org_status_lastMessageAt', (q) =>
            q.eq('organizationId', organizationId).eq('status', 'open'),
          );

  let scanned = 0;
  let count = 0;
  for await (const conversation of query) {
    scanned++;
    if (isUnreadConversation(conversation.metadata)) {
      count++;
    }
    if (count >= DEFAULT_COUNT_CAP || scanned >= UNREAD_SCAN_CAP) break;
  }
  return count;
}
