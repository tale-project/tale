/**
 * Get conversations for an organization with filtering and pagination (business logic)
 */

import type { QueryCtx } from '../../_generated/server';
import type { ConversationListResponse } from './types';
import { transformConversation } from './transform_conversation';

export async function getConversations(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    status?: 'open' | 'closed' | 'spam' | 'archived';
    priority?: string;
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

  // Get all conversations from the index
  const allConversations = await query.collect();

  // Apply filters
  let filteredConversations = allConversations;

  // Apply priority filter if provided
  if (args.priority) {
    filteredConversations = filteredConversations.filter(
      (conv) => conv.priority === args.priority,
    );
  }

  // Apply search filter if provided
  if (args.search) {
    const searchLower = args.search.toLowerCase();
    filteredConversations = filteredConversations.filter(
      (conv) =>
        conv.subject?.toLowerCase().includes(searchLower) ||
        (conv.metadata as { description?: string })?.description
          ?.toLowerCase()
          .includes(searchLower),
    );
  }

  // Calculate pagination
  const total = filteredConversations.length;
  const totalPages = Math.ceil(total / limit);
  const paginatedConversations = filteredConversations.slice(
    offset,
    offset + limit,
  );

  // Transform conversations to match expected frontend format
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
