import type { ActionCtx } from '../../../../_generated/server';
import { internal } from '../../../../_generated/api';
import type { Id } from '../../../../_generated/dataModel';
import type { QueryResult, ConversationStatus } from './types';

export async function queryConversations(
  ctx: ActionCtx,
  params: {
    organizationId: string;
    customerId?: Id<'customers'>;
    status?: ConversationStatus;
    priority?: string;
    channel?: string;
    direction?: 'inbound' | 'outbound';
    paginationOpts: {
      numItems: number;
      cursor: string | null;
    };
  },
) {
  const result: QueryResult = await ctx.runQuery(
    internal.conversations.queryConversations,
    {
      organizationId: params.organizationId!,
      customerId: params.customerId,
      status: params.status,
      priority: params.priority,
      channel: params.channel,
      direction: params.direction,
      paginationOpts: params.paginationOpts,
    },
  );

  return {
    operation: 'query',
    page: result.page,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
    count: result.count,
    timestamp: Date.now(),
  };
}

