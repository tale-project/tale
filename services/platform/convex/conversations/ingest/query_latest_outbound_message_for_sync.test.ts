import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../../_generated/server';

const { queryLatestMessageByDeliveryState } = vi.hoisted(() => ({
  queryLatestMessageByDeliveryState: vi.fn(),
}));

vi.mock('./query_latest_message_by_delivery_state', () => ({
  queryLatestMessageByDeliveryState,
}));

import { queryLatestOutboundMessageForEmailSync } from './query_latest_outbound_message_for_sync';

describe('queryLatestOutboundMessageForEmailSync', () => {
  beforeEach(() => {
    queryLatestMessageByDeliveryState.mockReset();
  });

  it('returns the newest outbound row across delivered and sent states', async () => {
    queryLatestMessageByDeliveryState.mockImplementation(
      async (_ctx, params) => {
        if (params.deliveryState === 'delivered') {
          return {
            message: {
              _id: 'msg_delivered',
              _creationTime: 1,
              organizationId: 'org',
              conversationId: 'conv',
              channel: 'email',
              direction: 'outbound',
              deliveryState: 'delivered',
              content: 'old import',
              deliveredAt: 1000,
            },
          };
        }
        return {
          message: {
            _id: 'msg_sent',
            _creationTime: 2,
            organizationId: 'org',
            conversationId: 'conv',
            channel: 'email',
            direction: 'outbound',
            deliveryState: 'sent',
            content: 'native send',
            sentAt: 2000,
          },
        };
      },
    );

    const ctx = {} as ActionCtx;
    const result = await queryLatestOutboundMessageForEmailSync(ctx, {
      organizationId: 'org',
      channel: 'email',
      connectorName: 'imap-smtp',
    });

    expect(result.message?._id).toBe('msg_sent');
  });
});
