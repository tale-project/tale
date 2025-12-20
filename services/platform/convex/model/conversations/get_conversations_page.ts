/**
 * Get a paged list of conversations for an organization with filtering by
 * status, priority, category, and search (business logic)
 *
 * Optimization notes:
 * - Pre-filters conversations BEFORE calling transformConversation (which is expensive)
 * - Priority and type filters are applied on raw conversation data
 * - Search filter requires transformed data (title/description are computed)
 * - Sorting by last_message_at requires all matching conversations to be transformed
 *   (this is a limitation since last_message_at is computed from messages)
 */

import type { QueryCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';
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

  // Precompute filter helpers for O(1) lookups
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

  // Use index query with organizationId and status (default: 'open')
  const baseQuery = ctx.db
    .query('conversations')
    .withIndex('by_organizationId_and_status', (q) =>
      q
        .eq('organizationId', args.organizationId)
        .eq('status', args.status ?? 'open'),
    );

  // Phase 1: Pre-filter conversations BEFORE expensive transformation
  // Priority and type are stored on the conversation, so we can filter early
  const preFilteredConversations: Array<Doc<'conversations'>> = [];

  for await (const row of baseQuery) {
    // Priority filter: apply on raw data (priority is stored on conversation)
    if (allowedPriorities && allowedPriorities.size > 0) {
      if (!row.priority || !allowedPriorities.has(row.priority)) {
        continue;
      }
    }

    // Category/Type filter: apply on raw data (type is stored on conversation)
    if (allowedTypes && allowedTypes.size > 0) {
      if (!row.type || !allowedTypes.has(row.type)) {
        continue;
      }
    }

    preFilteredConversations.push(row);
  }

  // Phase 2: Transform conversations (expensive - fetches messages, customer, etc.)
  // Only transform conversations that passed the pre-filter
  const allConversations: Array<
    Awaited<ReturnType<typeof transformConversation>>
  > = [];

  for (const row of preFilteredConversations) {
    const conversation = await transformConversation(ctx, row);

    // Search filter: requires transformed data (title/description are computed)
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
