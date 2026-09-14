/**
 * Telling a product its conversation closed.
 *
 * `conversation.closed` fans out to automation triggers, which is not the same
 * as telling the product that owns the customer's view — so a customer's copy
 * said "we're on it" long after the case was finished. The rule this lane
 * encodes: a channel conversation notifies its product, a mail one notifies
 * nobody, because an email thread's customer copy is their own mailbox.
 */

import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { addJobInTx, enqueued } = vi.hoisted(() => {
  const sent: { queue: string; payload: Record<string, unknown> }[] = [];
  return {
    enqueued: sent,
    addJobInTx: vi.fn(
      async (_tx: unknown, queue: string, payload: Record<string, unknown>) => {
        sent.push({ queue, payload });
        return 'job-1';
      },
    ),
  };
});
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx }));
vi.mock('../connectors/service.ts', () => ({ runConnectorAction: vi.fn() }));

import { notifyChannelStatusInTx } from './notify-status.ts';

const TX = {} as TransactionSql;

const channelConversation = {
  id: 'conv_1',
  organizationId: 'org_1',
  channel: 'support-widget',
  connectorName: 'webhook-channel',
  credentialId: 'cred_a',
  contactExternalId: 'user_42',
};

beforeEach(() => {
  enqueued.length = 0;
  addJobInTx.mockClear();
});

describe('notifyChannelStatusInTx', () => {
  it('queues a notice for a channel conversation', async () => {
    await notifyChannelStatusInTx(TX, channelConversation, 'closed');
    expect(addJobInTx).toHaveBeenCalledTimes(1);
    expect(enqueued[0]?.queue).toBe('conversation.notify_status');
    expect(enqueued[0]?.payload).toMatchObject({
      conversationId: 'conv_1',
      connectorName: 'webhook-channel',
      credentialRef: 'cred_a',
      status: 'closed',
      to: ['user_42'],
    });
  });

  it('queues nothing for a mail conversation', async () => {
    await notifyChannelStatusInTx(
      TX,
      { ...channelConversation, channel: 'email', connectorName: 'imap-smtp' },
      'closed',
    );
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('treats a conversation with no channel as mail, the way every old row reads', async () => {
    await notifyChannelStatusInTx(
      TX,
      { ...channelConversation, channel: null },
      'closed',
    );
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('queues nothing when no connector can carry it', async () => {
    await notifyChannelStatusInTx(
      TX,
      { ...channelConversation, connectorName: null },
      'closed',
    );
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('names the conversation credential so the notice follows the thread', async () => {
    // Same reason a reply does: on an org running two products, the default
    // credential is the other product's endpoint.
    await notifyChannelStatusInTx(
      TX,
      { ...channelConversation, credentialId: 'cred_b' },
      'open',
    );
    expect(enqueued[0]?.payload).toMatchObject({
      credentialRef: 'cred_b',
      status: 'open',
    });
  });

  it('omits the credential when the conversation carries none', async () => {
    await notifyChannelStatusInTx(
      TX,
      { ...channelConversation, credentialId: null },
      'closed',
    );
    expect(enqueued[0]?.payload).not.toHaveProperty('credentialRef');
  });
});
