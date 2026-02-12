/**
 * Query the latest message with specific channel, direction, and delivery state.
 * Uses the 5-field index for efficient querying ordered by deliveredAt.
 */

import type { ConvexJsonRecord } from '../../lib/shared/schemas/utils/json-value';
import type { Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export interface QueryLatestMessageByDeliveryStateArgs {
  organizationId: string;
  channel: string;
  direction: 'inbound' | 'outbound';
  deliveryState: 'queued' | 'sent' | 'delivered' | 'failed';
}

export interface QueryLatestMessageByDeliveryStateResult {
  message: {
    _id: Id<'conversationMessages'>;
    _creationTime: number;
    organizationId: string;
    conversationId: Id<'conversations'>;
    channel: string;
    direction: 'inbound' | 'outbound';
    externalMessageId?: string;
    deliveryState: 'queued' | 'sent' | 'delivered' | 'failed';
    content: string;
    sentAt?: number;
    deliveredAt?: number;
    metadata?: ConvexJsonRecord;
  } | null;
}

export async function queryLatestMessageByDeliveryState(
  ctx: QueryCtx,
  args: QueryLatestMessageByDeliveryStateArgs,
): Promise<QueryLatestMessageByDeliveryStateResult> {
  const message = await ctx.db
    .query('conversationMessages')
    .withIndex('by_org_channel_direction_deliveryState_deliveredAt', (q) =>
      q
        .eq('organizationId', args.organizationId)
        .eq('channel', args.channel)
        .eq('direction', args.direction)
        .eq('deliveryState', args.deliveryState),
    )
    .order('desc')
    .first();

  return {
    message: message
      ? {
          _id: message._id,
          _creationTime: message._creationTime,
          organizationId: message.organizationId,
          conversationId: message.conversationId,
          channel: message.channel,
          direction: message.direction,
          externalMessageId: message.externalMessageId,
          deliveryState: message.deliveryState,
          content: message.content,
          sentAt: message.sentAt,
          deliveredAt: message.deliveredAt,
          metadata: message.metadata,
        }
      : null,
  };
}
