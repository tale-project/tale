import type { ToolCtx } from '@convex-dev/agent';

import type { ConversationReadMessagesResult } from './types';

import { internal } from '../../../_generated/api';
import { toId } from '../../../lib/type_cast_helpers';

export async function readConversationMessages(
  ctx: ToolCtx,
  args: {
    conversationId: string;
    cursor?: string | null;
    numItems?: number;
  },
): Promise<ConversationReadMessagesResult> {
  const { organizationId } = ctx;

  if (!organizationId) {
    throw new Error(
      'organizationId is required in context for reading conversation messages',
    );
  }

  const conversationId = toId<'conversations'>(args.conversationId);
  const numItems = args.numItems ?? 100;
  const cursor = args.cursor ?? null;

  const result = await ctx.runQuery(
    internal.conversations.internal_queries.queryConversationMessages,
    {
      organizationId,
      conversationId,
      paginationOpts: {
        numItems,
        cursor,
      },
    },
  );

  return {
    operation: 'get_messages',
    messages: result.page,
    pagination: {
      hasMore: !result.isDone,
      totalFetched: result.page.length,
      cursor: result.continueCursor || null,
    },
  };
}
