import { type Infer, v } from 'convex/values';

import { query } from '../_generated/server';
import { messageMetadataValidator } from '../streaming/validators';

export const getMessageMetadata = query({
  args: {
    messageId: v.string(),
    threadId: v.optional(v.string()),
  },
  returns: v.union(messageMetadataValidator, v.null()),
  handler: async (ctx, args) => {
    const direct = await ctx.db
      .query('messageMetadata')
      .withIndex('by_messageId', (q) => q.eq('messageId', args.messageId))
      .first();
    if (direct) return direct;

    // In error scenarios, the metadata is saved with the failed message's
    // ID which differs from the UIMessage id (first message in group).
    // Fall back to the most recent metadata entry for this thread.
    const { threadId } = args;
    if (threadId) {
      return ctx.db
        .query('messageMetadata')
        .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
        .order('desc')
        .first();
    }

    return null;
  },
});

/**
 * Batched companion to {@link getMessageMetadata}: returns EVERY metadata row
 * for a thread in one subscription via the `by_threadId` index. The per-bubble
 * `useMessageMetadata` hook reads from this shared map when a thread-level
 * subscription is mounted, collapsing N per-message subscriptions (one per
 * assistant bubble) into a single thread subscription. Each row is the same
 * shape `getMessageMetadata` returns (the existing `messageMetadataValidator`),
 * so consumers project identically — no output-shape change.
 *
 * Access is unchanged: this reads the same table the per-message query reads.
 * Authorization is enforced upstream by the thread's own read gate (the thread
 * messages query); metadata rows carry no independent ACL beyond `threadId`.
 */
export const getThreadMessageMetadata = query({
  args: {
    threadId: v.string(),
  },
  returns: v.array(messageMetadataValidator),
  handler: async (ctx, args) => {
    const rows: Infer<typeof messageMetadataValidator>[] = [];
    for await (const row of ctx.db
      .query('messageMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))) {
      rows.push(row);
    }
    return rows;
  },
});
