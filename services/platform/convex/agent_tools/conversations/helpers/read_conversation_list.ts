import type { ToolCtx } from '@convex-dev/agent';

import type { ConversationReadListResult } from './types';

import { internal } from '../../../_generated/api';

export async function readConversationList(
  ctx: ToolCtx,
  args: {
    cursor?: string | null;
    numItems?: number;
    status?: 'open' | 'closed' | 'spam' | 'archived';
    customerId?: string;
  },
): Promise<ConversationReadListResult> {
  const { organizationId } = ctx;

  if (!organizationId) {
    throw new Error(
      'organizationId is required in context for listing conversations',
    );
  }

  const numItems = args.numItems ?? 50;
  const cursor = args.cursor ?? null;

  const result = await ctx.runQuery(
    internal.conversations.internal_queries.queryConversations,
    {
      organizationId,
      status: args.status,
      customerId: args.customerId
        ? // @ts-expect-error -- Convex Id<"customers"> branded type from plain string
          args.customerId
        : undefined,
      paginationOpts: {
        numItems,
        cursor,
      },
    },
  );

  return {
    operation: 'list',
    conversations: result.page,
    pagination: {
      hasMore: !result.isDone,
      totalFetched: result.page.length,
      cursor: result.continueCursor || null,
    },
  };
}
