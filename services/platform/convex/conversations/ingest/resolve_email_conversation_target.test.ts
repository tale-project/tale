import { describe, expect, it, vi } from 'vitest';

import type { Id } from '../../_generated/dataModel';
import type { ActionCtx } from '../../_generated/server';
import { resolveEmailConversationTarget } from './resolve_email_conversation_target';
import type { EmailType } from './types';

const ORG = 'org_1';
const CONV_ID = 'conv_parent' as Id<'conversations'>;

function email(overrides: Partial<EmailType> = {}): EmailType {
  return {
    uid: 1,
    messageId: 'child@example.com',
    from: [{ address: 'sender@example.com' }],
    to: [{ address: 'recipient@example.com' }],
    subject: 'Subject',
    date: '2026-07-01T10:00:00.000Z',
    flags: [],
    ...overrides,
  };
}

function mockCtx({
  messageConversationId,
  rootConversationId,
}: {
  messageConversationId?: Id<'conversations'>;
  rootConversationId?: Id<'conversations'>;
}) {
  return {
    runQuery: vi.fn(async (_ref, args: { externalMessageId?: string }) => {
      if (
        args.externalMessageId === 'parent@example.com' &&
        messageConversationId
      ) {
        return {
          _id: 'msg_1',
          conversationId: messageConversationId,
        };
      }
      if (args.externalMessageId === 'root@example.com' && rootConversationId) {
        return { _id: CONV_ID, metadata: {} };
      }
      return null;
    }),
    runMutation: vi.fn(),
  };
}

describe('resolveEmailConversationTarget', () => {
  it('resolves via in-reply-to against stored messages', async () => {
    const ctx = mockCtx({ messageConversationId: CONV_ID });
    const target = await resolveEmailConversationTarget(
      ctx as unknown as ActionCtx,
      ORG,
      email({
        headers: {
          'message-id': '<child@example.com>',
          'in-reply-to': '<parent@example.com>',
          references: '',
        },
      }),
    );

    expect(target).toBe(CONV_ID);
  });

  it('returns null for references-only email (no in-reply-to)', async () => {
    const ctx = mockCtx({ rootConversationId: CONV_ID });
    const target = await resolveEmailConversationTarget(
      ctx as unknown as ActionCtx,
      ORG,
      email({
        headers: {
          'message-id': '<child@example.com>',
          'in-reply-to': '',
          references: '<root@example.com>',
        },
      }),
    );

    expect(target).toBeNull();
  });

  it('resolves via in-batch map before hitting the database', async () => {
    const ctx = mockCtx({});
    const inBatchMap = new Map<string, Id<'conversations'>>([
      ['invite@calendly.com', CONV_ID],
    ]);

    const target = await resolveEmailConversationTarget(
      ctx as unknown as ActionCtx,
      ORG,
      email({
        headers: {
          'message-id': '<reminder@calendly.com>',
          'in-reply-to': '<invite@calendly.com>',
          references: '<invite@calendly.com>',
        },
      }),
      inBatchMap,
    );

    expect(target).toBe(CONV_ID);
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });

  it('returns null for unrelated email', async () => {
    const ctx = mockCtx({});
    const target = await resolveEmailConversationTarget(
      ctx as unknown as ActionCtx,
      ORG,
      email({ headers: { 'message-id': '<news@paystack.com>' } }),
    );

    expect(target).toBeNull();
  });
});
