import { describe, expect, it } from 'vitest';

import { groupMessagesByDate } from '../../utils/conversation/date-utils';
import { projectConversationItem } from './conversation-item';

describe('API contact presentation', () => {
  it('preserves a real app contact without inventing an email address', () => {
    const result = projectConversationItem({
      conversation: {
        id: 'thread',
        organizationId: 'org',
        channel: 'api',
        contactId: 'client',
        createdAt: 0,
      },
      contact: { id: 'client', name: 'Alpine AG', email: '', createdAt: 0 },
      messages: [],
    });
    expect(result.contact).toMatchObject({ name: 'Alpine AG', email: '' });
    expect(result.channel).toBe('api');
    const missing = projectConversationItem({
      conversation: {
        id: 'thread',
        organizationId: 'org',
        channel: 'api',
        createdAt: 0,
      },
      contact: null,
      messages: [],
    });
    expect(missing.contact).toMatchObject({ email: '' });
  });
});

/**
 * A reply queued for an API app has no send time until the app acknowledges
 * delivery, and the thread drops any message without a timestamp. An empty
 * timestamp therefore hid the reply, its undo countdown and, after a terminal
 * failure, its Retry/Discard, until the acknowledgement arrived.
 */
describe('message timestamps', () => {
  const QUEUED_AT = Date.UTC(2026, 8, 24, 9, 30);

  function project(message: Record<string, unknown>) {
    const item = projectConversationItem({
      conversation: {
        id: 'thread',
        organizationId: 'org',
        channel: 'api',
        createdAt: 0,
      },
      contact: null,
      messages: [
        {
          id: 'reply',
          direction: 'outbound',
          content: 'On its way.',
          createdAt: QUEUED_AT,
          ...message,
        },
      ],
    });
    const messages = item.messages as { timestamp: string; status: string }[];
    return { item, message: messages[0] };
  }

  it('dates a queued reply with no send time by when it was written', () => {
    const { item, message } = project({
      deliveryState: 'queued',
      sentAt: null,
      metadata: { scheduledSendAt: QUEUED_AT + 10_000 },
    });
    expect(message).toMatchObject({
      status: 'queued',
      timestamp: new Date(QUEUED_AT).toISOString(),
    });
    expect(item.messages).toMatchObject([
      { scheduledSendAt: QUEUED_AT + 10_000 },
    ]);
    // The thread renders only what it can group by date.
    const groups = groupMessagesByDate(
      item.messages as { id: string; timestamp: string }[],
    );
    expect(groups.flatMap((group) => group.messages)).toHaveLength(1);
  });

  it('keeps a failed reply dated, so its retry can be reached', () => {
    const { item, message } = project({
      deliveryState: 'failed',
      sentAt: null,
      metadata: { error: 'App refused the reply' },
    });
    expect(message?.timestamp).toBe(new Date(QUEUED_AT).toISOString());
    expect(item.messages).toMatchObject([
      { status: 'failed', errorMessage: 'App refused the reply' },
    ]);
  });

  it('prefers the send time, then the delivery time, over the write time', () => {
    const sent = QUEUED_AT + 60_000;
    const delivered = QUEUED_AT + 30_000;
    expect(
      project({ sentAt: sent, deliveredAt: delivered }).message?.timestamp,
    ).toBe(new Date(sent).toISOString());
    expect(
      project({ sentAt: null, deliveredAt: delivered }).message?.timestamp,
    ).toBe(new Date(delivered).toISOString());
  });
});
