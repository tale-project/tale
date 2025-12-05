/**
 * Get a paged list of conversations for an organization with filtering by
 * status, priority, category, and search (business logic)
 */

import type { QueryCtx } from '../../_generated/server';
import type { ConversationListResponse } from './types';
import { transformConversation } from './transform_conversation';

export async function getConversationsPage(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    status?: 'open' | 'closed' | 'spam' | 'archived';
    priority?: string;
    category?: string;
    search?: string;
    page?: number;
    limit?: number;
  },
): Promise<ConversationListResponse> {
  const page = args.page || 1;
  const limit = args.limit || 20;
  const offset = (page - 1) * limit;

  // Use index query with organizationId and status (default: 'open').
  // Collect (and filter) conversations first to enable proper ordering
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

  // Precompute filter helpers so they can be applied inside the async iterator
  const allowedPriorities = args.priority
    ? new Set(
        args.priority
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      )
    : null;

  const allowedTypes = args.category
    ? new Set(
        args.category
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      )
    : null;

  const searchLower = args.search?.toLowerCase();

  for await (const row of baseQuery) {
    const conversation = await transformConversation(ctx, row);

    // Priority filter: support comma-separated priorities (e.g. "low,medium")
    if (allowedPriorities && allowedPriorities.size > 0) {
      const priority = conversation.priority as string | undefined;
      if (!priority || !allowedPriorities.has(priority)) {
        continue;
      }
    }

    // Category filter: maps to the conversation "type" field
    if (allowedTypes && allowedTypes.size > 0) {
      const type = conversation.type as string | undefined;
      if (!type || !allowedTypes.has(type)) {
        continue;
      }
    }

    // Search filter: match against title and description
    if (searchLower) {
      const title =
        (conversation.title as string | undefined)?.toLowerCase() ?? '';
      const description =
        (conversation.description as string | undefined)?.toLowerCase() ?? '';

      if (!title.includes(searchLower) && !description.includes(searchLower)) {
        continue;
      }
    }

    allConversations.push(conversation);
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
