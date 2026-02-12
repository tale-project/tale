import type { ActionCtx } from '../../../../_generated/server';

import { internal } from '../../../../_generated/api';

export async function queryLatestMessageByDeliveryState(
  ctx: ActionCtx,
  params: {
    organizationId: string;
    channel: string;
    direction: 'inbound' | 'outbound';
    deliveryState: 'queued' | 'sent' | 'delivered' | 'failed';
  },
) {
  const result = await ctx.runQuery(
    internal.conversations.internal_queries.queryLatestMessageByDeliveryState,
    {
      organizationId: params.organizationId,
      channel: params.channel,
      direction: params.direction,
      deliveryState: params.deliveryState,
    },
  );

  // Note: execute_action_node wraps the return value in: { type: 'action', data: <return value> }
  return result.message;
}
