import { describe, expect, it, vi } from 'vitest';

import type { Id } from '../../_generated/dataModel';
import type { ActionCtx } from '../../_generated/server';
import { createConversationFromEmail } from './create_conversation_from_email';
import type { EmailType } from './types';

const ORG = 'org_1';

function makeEmail(
  messageId: string,
  date: string,
  overrides: Partial<EmailType> = {},
): EmailType {
  return {
    uid: 1,
    messageId,
    from: [{ name: 'Calendly', address: 'notifications@calendly.com' }],
    to: [{ address: 'user@activlabs.com' }],
    subject: 'Join your teammate in Calendly',
    date,
    text: `Body for ${messageId}`,
    flags: [],
    ...overrides,
  };
}

function isCreateConversationArgs(
  args: Record<string, unknown>,
): args is { externalMessageId: string } {
  return 'initialMessage' in args && 'externalMessageId' in args;
}

function isAddMessageArgs(
  args: Record<string, unknown>,
): args is { conversationId: Id<'conversations'> } {
  return 'conversationId' in args && 'sender' in args;
}

function createMockCtx() {
  const createdConversationIds: Id<'conversations'>[] = [];
  const addMessageCalls: Array<{ conversationId: Id<'conversations'> }> = [];
  let conversationCounter = 0;

  const ctx = {
    runQuery: vi.fn(async () => null),
    runMutation: vi.fn(async (_ref, args: Record<string, unknown>) => {
      if ('source' in args && args.source === 'manual_import') {
        return {
          contactId: 'cont_1' as Id<'contacts'>,
          created: true,
        };
      }
      if (isCreateConversationArgs(args)) {
        conversationCounter += 1;
        const conversationId =
          `conv_${conversationCounter}` as Id<'conversations'>;
        createdConversationIds.push(conversationId);
        return { conversationId, messageId: `msg_${conversationCounter}` };
      }
      if (isAddMessageArgs(args)) {
        addMessageCalls.push({ conversationId: args.conversationId });
        return { messageId: `msg_added_${addMessageCalls.length}` };
      }
      return {};
    }),
  } as unknown as ActionCtx;

  return { ctx, createdConversationIds, addMessageCalls };
}

describe('createConversationFromEmail', () => {
  it('does not merge unrelated emails from the same IMAP sync batch', async () => {
    const calendlyInvite = makeEmail(
      'invite@calendly.com',
      '2026-07-01T09:00:00.000Z',
    );
    const paystackNewsletter = makeEmail(
      'news@paystack.com',
      '2026-07-02T14:07:00.000Z',
      {
        from: [{ name: 'Paystack', address: 'hello@m.paystack.com' }],
        subject: 'Paystack quarterly roundup',
        headers: {
          'message-id': '<news@paystack.com>',
          'in-reply-to': '',
          // Some providers set References without In-Reply-To — must not merge.
          references: '<invite@calendly.com>',
        },
      },
    );
    const calendlyReminder = makeEmail(
      'reminder@calendly.com',
      '2026-07-03T10:00:00.000Z',
      {
        headers: {
          'message-id': '<reminder@calendly.com>',
          'in-reply-to': '<invite@calendly.com>',
          references: '<invite@calendly.com>',
        },
      },
    );

    const { ctx, createdConversationIds, addMessageCalls } = createMockCtx();

    const result = await createConversationFromEmail(ctx, {
      organizationId: ORG,
      emails: [calendlyInvite, paystackNewsletter, calendlyReminder],
      connectorName: 'imap-smtp',
    });

    expect(result.conversationIds).toHaveLength(2);
    expect(createdConversationIds).toHaveLength(2);
    expect(addMessageCalls).toHaveLength(1);
    expect(addMessageCalls[0]?.conversationId).toBe(createdConversationIds[0]);
    expect(result.processedCount).toBe(3);
  });

  it('keeps legitimately threaded emails in one conversation', async () => {
    const root = makeEmail('root@thread.com', '2026-07-01T09:00:00.000Z');
    const reply = makeEmail('reply@thread.com', '2026-07-01T10:00:00.000Z', {
      headers: {
        'message-id': '<reply@thread.com>',
        'in-reply-to': '<root@thread.com>',
        references: '<root@thread.com>',
      },
    });

    const { ctx, createdConversationIds, addMessageCalls } = createMockCtx();

    const result = await createConversationFromEmail(ctx, {
      organizationId: ORG,
      emails: [root, reply],
    });

    expect(result.conversationIds).toHaveLength(1);
    expect(createdConversationIds).toHaveLength(1);
    expect(addMessageCalls).toHaveLength(1);
    expect(addMessageCalls[0]?.conversationId).toBe(createdConversationIds[0]);
  });
});
