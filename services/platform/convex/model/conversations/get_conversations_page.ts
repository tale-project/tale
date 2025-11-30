/**
 * Get a paged list of conversations for an organization with filtering by status (business logic)
 */

import type { QueryCtx } from '../../_generated/server';
import type { ConversationListResponse } from './types';
import { transformConversation } from './transform_conversation';

export async function getConversationsPage(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    status?: 'open' | 'closed' | 'spam' | 'archived';
    page?: number;
    limit?: number;
  },
): Promise<ConversationListResponse> {
  const page = args.page || 1;
  const limit = args.limit || 20;
  const offset = (page - 1) * limit;

  // Use index query with organizationId and status (default: 'open').
  // Collect all conversations first to enable proper ordering
  const allConversations: Array<
    Awaited<ReturnType<typeof transformConversation>>
  > = [];

  const baseQuery = ctx.db
    .query('conversations')
    .withIndex('by_organizationId_and_status', (q) =>
      q
        .eq('organizationId', args.organizationId)
        .eq('status', args.status ?? 'open'),
    );

  for await (const row of baseQuery) {
    allConversations.push(await transformConversation(ctx, row));
  }

  // Sort by last_message_at in descending order (latest first)
  allConversations.sort((a, b) => {
    const timeA = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
    const timeB = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
    return timeB - timeA; // descending order
  });

  const total = allConversations.length;
  const totalPages = Math.ceil(total / limit);

  // Apply pagination after sorting
  const results = allConversations.slice(offset, offset + limit);

  return {
    conversations: results,
    total,
    page,
    limit,
    totalPages,
  };
}
