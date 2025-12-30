/**
 * Get conversations for an organization with filtering and pagination (business logic)
 *
 * Optimized to use async iteration with pre-filtering before expensive transformation.
 * Priority filter is applied on raw data before transformConversation is called.
 */

import type { QueryCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';
import type { ConversationListResponse, ConversationStatus, ConversationPriority } from './types';
import { transformConversation } from './transform_conversation';

export async function getConversations(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    status?: ConversationStatus;
    priority?: ConversationPriority;
    search?: string;
    page?: number;
    limit?: number;
  },
): Promise<ConversationListResponse> {
  const page = args.page || 1;
  const limit = args.limit || 20;
  const offset = (page - 1) * limit;

  // Build query with index - use status index if provided, otherwise use organizationId index
  const query = args.status
    ? ctx.db
        .query('conversations')
        .withIndex('by_organizationId_and_status', (q) =>
          q.eq('organizationId', args.organizationId).eq('status', args.status),
        )
    : ctx.db
        .query('conversations')
        .withIndex('by_organizationId', (q) =>
          q.eq('organizationId', args.organizationId),
        );

  const searchLower = args.search?.toLowerCase();

  // Phase 1: Pre-filter using async iteration (priority and search on raw data)
  // Note: search is applied on raw subject/metadata which doesn't require transformation
  const preFilteredConversations: Array<Doc<'conversations'>> = [];

  for await (const conv of query) {
    // Apply priority filter on raw data
    if (args.priority && conv.priority !== args.priority) {
      continue;
    }

    // Apply search filter on raw data (subject and metadata.description)
    if (searchLower) {
      const subjectMatch = conv.subject?.toLowerCase().includes(searchLower);
      const descriptionMatch = (
        conv.metadata as { description?: string }
      )?.description
        ?.toLowerCase()
        .includes(searchLower);

      if (!subjectMatch && !descriptionMatch) {
        continue;
      }
    }

    preFilteredConversations.push(conv);
  }

  // Calculate pagination on pre-filtered results
  const total = preFilteredConversations.length;
  const totalPages = Math.ceil(total / limit);
  const paginatedConversations = preFilteredConversations.slice(
    offset,
    offset + limit,
  );

  // Phase 2: Transform only paginated conversations (expensive operation)
  const transformedConversations = await Promise.all(
    paginatedConversations.map((conv) => transformConversation(ctx, conv)),
  );

  return {
    conversations: transformedConversations,
    total,
    page,
    limit,
    totalPages,
  };
}
