import type { ActionCtx } from '../../_generated/server';
import { queryLatestMessageByDeliveryState } from './query_latest_message_by_delivery_state';

/**
 * Sent-folder sync cursor: consider both `delivered` (imported from IMAP)
 * and `sent` (native Tale SMTP sends) outbound rows.
 */
export async function queryLatestOutboundMessageForEmailSync(
  ctx: ActionCtx,
  params: {
    organizationId: string;
    channel: string;
    connectorName?: string;
  },
) {
  const deliveryStates = ['delivered', 'sent'] as const;
  let bestMessage: Awaited<
    ReturnType<typeof queryLatestMessageByDeliveryState>
  >['message'] = null;
  let bestTime = -1;

  for (const deliveryState of deliveryStates) {
    const { message } = await queryLatestMessageByDeliveryState(ctx, {
      organizationId: params.organizationId,
      channel: params.channel,
      direction: 'outbound',
      deliveryState,
      connectorName: params.connectorName,
    });
    if (!message) continue;

    const timestamp =
      message.sentAt ?? message.deliveredAt ?? message._creationTime;
    if (timestamp > bestTime) {
      bestTime = timestamp;
      bestMessage = message;
    }
  }

  return { message: bestMessage };
}
