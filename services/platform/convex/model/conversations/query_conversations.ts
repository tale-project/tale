/**
 * Query conversations with flexible filtering and pagination support (business logic)
 */

import type { QueryCtx } from '../../_generated/server';
import type { QueryConversationsArgs, QueryConversationsResult } from './types';

export async function queryConversations(
  ctx: QueryCtx,
  args: QueryConversationsArgs,
): Promise<QueryConversationsResult> {
  const numItems = args.paginationOpts.numItems;

  // Choose the best index based on provided filters
  // Priority: direction > channel > status > priority > customerId > organizationId
  let query;

  if (args.direction !== undefined) {
    // Use direction index for best performance when filtering by direction
    query = ctx.db
      .query('conversations')
      .withIndex('by_organizationId_and_direction', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('direction', args.direction!),
      );
  } else if (args.channel !== undefined) {
    // Use channel index
    query = ctx.db
      .query('conversations')
      .withIndex('by_organizationId_and_channel', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('channel', args.channel!),
      );
  } else if (args.status !== undefined) {
    // Use status index
    query = ctx.db
      .query('conversations')
      .withIndex('by_organizationId_and_status', (q) =>
        q.eq('organizationId', args.organizationId).eq('status', args.status!),
      );
  } else if (args.priority !== undefined) {
    // Use priority index
    query = ctx.db
      .query('conversations')
      .withIndex('by_organizationId_and_priority', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('priority', args.priority!),
      );
  } else if (args.customerId !== undefined) {
    // Use customerId index
    query = ctx.db
      .query('conversations')
      .withIndex('by_organizationId_and_customerId', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('customerId', args.customerId!),
      );
  } else {
    // Default to organizationId index
    query = ctx.db
      .query('conversations')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      );
  }

  // Collect results
  let conversations = await query.collect();

  // Apply remaining filters that weren't covered by the index
  // Only filter if the field was provided AND wasn't used in the index
  if (args.channel !== undefined && args.direction !== undefined) {
    // We used direction index, so filter by channel
    conversations = conversations.filter((c) => c.channel === args.channel);
  }

  if (args.status !== undefined && args.direction !== undefined) {
    // We used direction index, so filter by status
    conversations = conversations.filter((c) => c.status === args.status);
  }

  if (args.priority !== undefined && args.direction !== undefined) {
    // We used direction index, so filter by priority
    conversations = conversations.filter((c) => c.priority === args.priority);
  }

  if (args.customerId !== undefined && args.direction !== undefined) {
    // We used direction index, so filter by customerId
    conversations = conversations.filter(
      (c) => c.customerId === args.customerId,
    );
  }

  if (
    args.priority !== undefined &&
    args.status !== undefined &&
    args.direction === undefined
  ) {
    // We used status index, so filter by priority
    conversations = conversations.filter((c) => c.priority === args.priority);
  }

  if (
    args.customerId !== undefined &&
    args.status !== undefined &&
    args.direction === undefined
  ) {
    // We used status index, so filter by customerId
    conversations = conversations.filter(
      (c) => c.customerId === args.customerId,
    );
  }

  if (
    args.customerId !== undefined &&
    args.priority !== undefined &&
    args.status === undefined &&
    args.direction === undefined
  ) {
    // We used priority index, so filter by customerId
    conversations = conversations.filter(
      (c) => c.customerId === args.customerId,
    );
  }

  // Sort by creation time (newest first) for consistent pagination
  conversations.sort((a, b) => b._creationTime - a._creationTime);

  // Apply cursor-based pagination
  const paginationOpts = args.paginationOpts;
  const startIndex = paginationOpts.cursor
    ? conversations.findIndex((c) => c._id === paginationOpts.cursor) + 1
    : 0;
  const endIndex = startIndex + numItems;
  const paginatedConversations = conversations.slice(startIndex, endIndex);

  return {
    items: paginatedConversations,
    isDone: endIndex >= conversations.length,
    continueCursor:
      paginatedConversations.length > 0
        ? paginatedConversations[paginatedConversations.length - 1]._id
        : null,
    count: paginatedConversations.length,
  };
}
