/**
 * Query the latest message with specific channel, direction, delivery state, and optionally providerId
 * Uses optimized indexes for efficient querying ordered by deliveredAt:
 * - 6-field index when providerId is provided
 * - 5-field index when providerId is not provided
 */

import type { QueryCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';

export interface QueryLatestMessageByDeliveryStateArgs {
  organizationId: string;
  channel: string;
  direction: 'inbound' | 'outbound';
  deliveryState: 'queued' | 'sent' | 'delivered' | 'failed';
  providerId?: Id<'emailProviders'>;
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
    metadata?: unknown;
  } | null;
}

export async function queryLatestMessageByDeliveryState(
  ctx: QueryCtx,
  args: QueryLatestMessageByDeliveryStateArgs,
): Promise<QueryLatestMessageByDeliveryStateResult> {
  // Use the appropriate index based on whether providerId is provided
  const message = args.providerId
    ? await ctx.db
        .query('conversationMessages')
        .withIndex(
          'by_org_channel_direction_deliveryState_providerId_deliveredAt',
          (q) =>
            q
              .eq('organizationId', args.organizationId)
              .eq('channel', args.channel)
              .eq('direction', args.direction)
              .eq('deliveryState', args.deliveryState)
              .eq('providerId', args.providerId),
        )
        .order('desc')
        .first()
    : await ctx.db
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
