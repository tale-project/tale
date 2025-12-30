/**
 * Get a paged list of conversations for an organization with filtering by
 * status, priority, category, and search (business logic)
 *
 * Optimization notes:
 * - Uses compound index `by_org_status_lastMessageAt` for efficient sorted pagination
 * - Pre-filters on raw data (priority, type, search) BEFORE transformation
 * - Paginates BEFORE calling transformConversation (which is expensive)
 * - Only transforms the paginated subset of conversations
 * - Search filter works on raw data (subject + metadata.description)
 */

import type { QueryCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';
import type { ConversationListResponse, ConversationStatus, ConversationPriority } from './types';
import { transformConversation } from './transform_conversation';

export async function getConversationsPage(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    status?: ConversationStatus;
    priority?: ConversationPriority;
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

  // Use compound index for sorted results (by lastMessageAt descending)
  // This allows efficient pagination without loading all conversations
  const baseQuery = ctx.db
    .query('conversations')
    .withIndex('by_org_status_lastMessageAt', (q) =>
      q
        .eq('organizationId', args.organizationId)
        .eq('status', args.status ?? 'open'),
    )
    .order('desc'); // Sort by lastMessageAt descending (latest first)

  // Phase 1: Pre-filter on raw data and collect for pagination
  // All filters work on raw conversation data, no transformation needed
  const preFilteredConversations: Array<Doc<'conversations'>> = [];

  for await (const row of baseQuery) {
    // Priority filter: apply on raw data
    if (allowedPriorities && allowedPriorities.size > 0) {
      if (!row.priority || !allowedPriorities.has(row.priority)) {
        continue;
      }
    }

    // Category/Type filter: apply on raw data
    if (allowedTypes && allowedTypes.size > 0) {
      if (!row.type || !allowedTypes.has(row.type)) {
        continue;
      }
    }

    // Search filter: apply on raw data (subject + metadata.description)
    // title = conversation.subject || 'Untitled Conversation'
    // description = metadata.description || conversation.subject || 'No description'
    if (searchLower) {
      const subject = row.subject?.toLowerCase() ?? '';
      const metadataDescription = (
        (row.metadata as { description?: string })?.description ?? ''
      ).toLowerCase();

      if (
        !subject.includes(searchLower) &&
        !metadataDescription.includes(searchLower)
      ) {
        continue;
      }
    }

    preFilteredConversations.push(row);
  }

  // Calculate pagination on pre-filtered results
  const total = preFilteredConversations.length;
  const totalPages = Math.ceil(total / limit);

  // Apply pagination BEFORE transformation (key optimization)
  const paginatedConversations = preFilteredConversations.slice(
    offset,
    offset + limit,
  );

  // Phase 2: Transform only the paginated conversations (expensive operation)
  const results = await Promise.all(
    paginatedConversations.map((conv) => transformConversation(ctx, conv)),
  );

  return {
    conversations: results,
    total,
    page,
    limit,
    totalPages,
  };
}
