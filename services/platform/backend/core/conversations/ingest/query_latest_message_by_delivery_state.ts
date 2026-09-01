import type { ActionCtx } from '../../lib/ctx';
import { internal } from '../../lib/handler_names';

export async function queryLatestMessageByDeliveryState(
  ctx: ActionCtx,
  params: {
    organizationId: string;
    channel: string;
    direction: 'inbound' | 'outbound';
    deliveryState: 'queued' | 'sent' | 'delivered' | 'failed';
    connectorName?: string;
  },
) {
  const result = await ctx.runQuery(
    internal.conversations.internal_queries.queryLatestMessageByDeliveryState,
    {
      organizationId: params.organizationId,
      channel: params.channel,
      direction: params.direction,
      deliveryState: params.deliveryState,
      ...(params.connectorName ? { connectorName: params.connectorName } : {}),
    },
  );

  // Note: execute_action_node wraps the return value in: { type: 'action', data: <return value> }
  return result;
}
