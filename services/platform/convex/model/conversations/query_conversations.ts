/**
 * Query conversations with flexible filtering and pagination support (business logic)
 *
 * Optimized to use async iteration with early termination instead of .collect()
 * for better memory efficiency and performance with large datasets.
 */

import type { QueryCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';
import type { QueryConversationsArgs, QueryConversationsResult } from './types';

/**
 * Helper to check if a conversation matches the additional filters
 * that weren't covered by the index
 */
function matchesFilters(
  conversation: Doc<'conversations'>,
  args: QueryConversationsArgs,
  indexUsed:
    | 'direction'
    | 'channel'
    | 'status'
    | 'priority'
    | 'customerId'
    | 'organizationId',
): boolean {
  // Apply remaining filters that weren't covered by the index
  if (indexUsed === 'direction') {
    if (args.channel !== undefined && conversation.channel !== args.channel) {
      return false;
    }
    if (args.status !== undefined && conversation.status !== args.status) {
      return false;
    }
    if (
      args.priority !== undefined &&
      conversation.priority !== args.priority
    ) {
      return false;
    }
    if (
      args.customerId !== undefined &&
      conversation.customerId !== args.customerId
    ) {
      return false;
    }
  } else if (indexUsed === 'channel') {
    if (args.status !== undefined && conversation.status !== args.status) {
      return false;
    }
    if (
      args.priority !== undefined &&
      conversation.priority !== args.priority
    ) {
      return false;
    }
    if (
      args.customerId !== undefined &&
      conversation.customerId !== args.customerId
    ) {
      return false;
    }
  } else if (indexUsed === 'status') {
    if (
      args.priority !== undefined &&
      conversation.priority !== args.priority
    ) {
      return false;
    }
    if (
      args.customerId !== undefined &&
      conversation.customerId !== args.customerId
    ) {
      return false;
    }
  } else if (indexUsed === 'priority') {
    if (
      args.customerId !== undefined &&
      conversation.customerId !== args.customerId
    ) {
      return false;
    }
  }
  // 'customerId' and 'organizationId' indexes don't need additional filtering

  return true;
}

export async function queryConversations(
  ctx: QueryCtx,
  args: QueryConversationsArgs,
): Promise<QueryConversationsResult> {
  const numItems = args.paginationOpts.numItems;
  const cursor = args.paginationOpts.cursor;

  // Choose the best index based on provided filters
  // Priority: direction > channel > status > priority > customerId > organizationId
  let query;
  let indexUsed:
    | 'direction'
    | 'channel'
    | 'status'
    | 'priority'
    | 'customerId'
    | 'organizationId';

  if (args.direction !== undefined) {
    query = ctx.db
      .query('conversations')
      .withIndex('by_organizationId_and_direction', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('direction', args.direction!),
      );
    indexUsed = 'direction';
  } else if (args.channel !== undefined) {
    query = ctx.db
      .query('conversations')
      .withIndex('by_organizationId_and_channel', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('channel', args.channel!),
      );
    indexUsed = 'channel';
  } else if (args.status !== undefined) {
    query = ctx.db
      .query('conversations')
      .withIndex('by_organizationId_and_status', (q) =>
        q.eq('organizationId', args.organizationId).eq('status', args.status!),
      );
    indexUsed = 'status';
  } else if (args.priority !== undefined) {
    query = ctx.db
      .query('conversations')
      .withIndex('by_organizationId_and_priority', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('priority', args.priority!),
      );
    indexUsed = 'priority';
  } else if (args.customerId !== undefined) {
    query = ctx.db
      .query('conversations')
      .withIndex('by_organizationId_and_customerId', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('customerId', args.customerId!),
      );
    indexUsed = 'customerId';
  } else {
    query = ctx.db
      .query('conversations')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      );
    indexUsed = 'organizationId';
  }

  // Use async iteration with early termination and descending order
  const orderedQuery = query.order('desc');

  const conversations: Array<Doc<'conversations'>> = [];
  let foundCursor = cursor === null;
  let hasMore = false;

  for await (const conversation of orderedQuery) {
    // Skip until we find the cursor
    if (!foundCursor) {
      if (conversation._id === cursor) {
        foundCursor = true;
      }
      continue;
    }

    // Apply additional filters not covered by the index
    if (!matchesFilters(conversation, args, indexUsed)) {
      continue;
    }

    conversations.push(conversation);

    // Check if we have enough items
    if (conversations.length >= numItems) {
      hasMore = true;
      break;
    }
  }

  return {
    items: conversations,
    isDone: !hasMore,
    continueCursor:
      conversations.length > 0
        ? conversations[conversations.length - 1]._id
        : null,
    count: conversations.length,
  };
}
