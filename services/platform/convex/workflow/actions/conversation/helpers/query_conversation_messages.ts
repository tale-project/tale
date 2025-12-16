import type { ActionCtx } from '../../../../_generated/server';
import { internal } from '../../../../_generated/api';
import type { Id } from '../../../../_generated/dataModel';
import type { QueryResult } from './types';

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
  const result: QueryResult = await ctx.runQuery(
    internal.conversations.queryConversationMessages,
    {
      organizationId: params.organizationId!,
      conversationId: params.conversationId,
      channel: params.channel,
      direction: params.direction,
      paginationOpts: params.paginationOpts,
    },
  );

  // Note: execute_action_node wraps this in output: { type: 'action', data: result }
  // For pagination queries, we return the full result object (items, isDone, continueCursor)
  return {
    items: result.items,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}

