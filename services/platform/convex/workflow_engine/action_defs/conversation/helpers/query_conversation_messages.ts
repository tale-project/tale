import type { Id } from '../../../../_generated/dataModel';
import type { ActionCtx } from '../../../../_generated/server';

import { internal } from '../../../../_generated/api';

export async function queryConversationMessages(
  ctx: ActionCtx,
  params: {
    organizationId: string;
    conversationId?: Id<'conversations'>;
    channel?: string;
    direction?: 'inbound' | 'outbound';
    paginationOpts: {
      numItems: number;
      cursor: string | null;
    };
  },
) {
  const result = await ctx.runQuery(
    internal.conversations.internal_queries.queryConversationMessages,
    {
      organizationId: params.organizationId,
      conversationId: params.conversationId,
      channel: params.channel,
      direction: params.direction,
      paginationOpts: params.paginationOpts,
    },
  );

  return {
    page: result.page,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}
