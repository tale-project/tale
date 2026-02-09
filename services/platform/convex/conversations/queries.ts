/**
 * Conversations Queries
 *
 * All query operations for conversations.
 * Business logic is in ./helpers.ts
 */

import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { hasRecordsInOrg } from '../lib/helpers/has_records_in_org';
import { cursorPaginationOptsValidator } from '../lib/pagination';
import { queryWithRLS } from '../lib/rls';
import * as ConversationsHelpers from './helpers';
import {
  conversationWithMessagesValidator,
  conversationStatusValidator,
  conversationItemValidator,
} from './validators';

const internalConversationRecordValidator = v.object({
  _id: v.id('conversations'),
  _creationTime: v.number(),
  organizationId: v.string(),
  customerId: v.optional(v.id('customers')),
  externalMessageId: v.optional(v.string()),
  subject: v.optional(v.string()),
  status: v.optional(conversationStatusValidator),
  priority: v.optional(v.string()),
  type: v.optional(v.string()),
  channel: v.optional(v.string()),
  direction: v.optional(v.union(v.literal('inbound'), v.literal('outbound'))),
  providerId: v.optional(v.id('emailProviders')),
  lastMessageAt: v.optional(v.number()),
  metadata: v.optional(jsonRecordValidator),
});

export const hasConversations = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    return await hasRecordsInOrg(ctx.db, 'conversations', args.organizationId);
  },
});

export const getConversation = queryWithRLS({
  args: {
    conversationId: v.id('conversations'),
  },
  returns: v.union(internalConversationRecordValidator, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.conversationId);
  },
});

export const getConversationWithMessages = queryWithRLS({
  args: {
    conversationId: v.id('conversations'),
  },
  returns: v.union(conversationWithMessagesValidator, v.null()),
  handler: async (ctx, args) => {
    return await ConversationsHelpers.getConversationWithMessages(
      ctx,
      args.conversationId,
    );
  },
});

/**
 * List conversations with cursor pagination.
 * Returns fully transformed conversations with customer info and messages.
 */
export const listConversations = queryWithRLS({
  args: {
    organizationId: v.string(),
    status: v.optional(conversationStatusValidator),
    paginationOpts: cursorPaginationOptsValidator,
  },
  returns: v.object({
    page: v.array(conversationItemValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const query = args.status
      ? ctx.db
          .query('conversations')
          .withIndex('by_org_status_lastMessageAt', (q) =>
            q
              .eq('organizationId', args.organizationId)
              .eq('status', args.status),
          )
      : ctx.db
          .query('conversations')
          .withIndex('by_organizationId', (q) =>
            q.eq('organizationId', args.organizationId),
          );

    const result = await query.order('desc').paginate(args.paginationOpts);

    const transformedPage = await Promise.all(
      result.page.map((conversation) =>
        ConversationsHelpers.transformConversation(ctx, conversation, {
          includeAllMessages: false,
        }),
      ),
    );

    return {
      page: transformedPage,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
