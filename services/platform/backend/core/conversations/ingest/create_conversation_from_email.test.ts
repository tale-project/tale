import { describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../../lib/ctx';
import type { Id } from '../../lib/rows';
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

function isBindArgs(
  args: Record<string, unknown>,
): args is { storageId: string; conversationId: Id<'conversations'> } {
  return 'storageId' in args && 'conversationId' in args && !('sender' in args);
}

function createMockCtx(opts: { failBind?: boolean } = {}) {
  const createdConversationIds: Id<'conversations'>[] = [];
  const addMessageCalls: Array<{ conversationId: Id<'conversations'> }> = [];
  const bindCalls: Array<{
    storageId: string;
    conversationId: Id<'conversations'>;
  }> = [];
  let conversationCounter = 0;

  const ctx = {
    runQuery: vi.fn(async () => null),
    runMutation: vi.fn(async (_ref, args: Record<string, unknown>) => {
      if ('source' in args && args.source === 'conversation') {
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
      if (isBindArgs(args)) {
        if (opts.failBind) throw new Error('transient');
        bindCalls.push({
          storageId: args.storageId,
          conversationId: args.conversationId,
        });
        return null;
      }
      return {};
    }),
  } as unknown as ActionCtx;

  return { ctx, createdConversationIds, addMessageCalls, bindCalls };
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

// #2985: an inbound attachment's bytes were stored with no record of the mail
// they arrived on, so nothing could get from the file back to its conversation.
// The link is what lets an emailed file be readable by whoever can currently
// read that conversation, instead of carrying a stamped team that goes stale the
// moment somebody reassigns it.
describe('createConversationFromEmail — attachment binding', () => {
  function withAttachment(messageId: string, storageId: string): EmailType {
    return makeEmail(messageId, '2026-08-19T10:00:00.000Z', {
      attachments: [
        {
          id: 'p1',
          filename: 'CV.pdf',
          contentType: 'application/pdf',
          size: 23_359,
          storageId,
        },
      ],
    });
  }

  it('binds a stored attachment to the conversation it landed on', async () => {
    const { ctx, createdConversationIds, bindCalls } = createMockCtx();
    await createConversationFromEmail(ctx, {
      organizationId: ORG,
      emails: [withAttachment('<cv@x>', 'blob_cv')],
    });
    expect(bindCalls).toEqual([
      { storageId: 'blob_cv', conversationId: createdConversationIds[0] },
    ]);
  });

  it('binds every stored attachment on one email', async () => {
    const { ctx, bindCalls } = createMockCtx();
    const email = makeEmail('<two@x>', '2026-08-19T10:00:00.000Z', {
      attachments: [
        {
          id: 'p1',
          filename: 'CV.pdf',
          contentType: 'application/pdf',
          size: 1,
          storageId: 'blob_a',
        },
        {
          id: 'p2',
          filename: 'Cover.pdf',
          contentType: 'application/pdf',
          size: 1,
          storageId: 'blob_b',
        },
      ],
    });
    await createConversationFromEmail(ctx, {
      organizationId: ORG,
      emails: [email],
    });
    expect(bindCalls.map((c) => c.storageId)).toEqual(['blob_a', 'blob_b']);
  });

  // A metadata-only chip was never materialized, so there is no row to bind.
  it('skips a part that was never stored', async () => {
    const { ctx, bindCalls } = createMockCtx();
    const email = makeEmail('<meta@x>', '2026-08-19T10:00:00.000Z', {
      attachments: [
        {
          id: 'p1',
          filename: 'CV.pdf',
          contentType: 'application/pdf',
          size: 1,
        },
      ],
    });
    await createConversationFromEmail(ctx, {
      organizationId: ORG,
      emails: [email],
    });
    expect(bindCalls).toEqual([]);
  });

  it('binds nothing for an email with no attachments', async () => {
    const { ctx, bindCalls } = createMockCtx();
    await createConversationFromEmail(ctx, {
      organizationId: ORG,
      emails: [makeEmail('<plain@x>', '2026-08-19T10:00:00.000Z')],
    });
    expect(bindCalls).toEqual([]);
  });

  // The ingest already landed the mail; a failed link must not undo that. The
  // next poll rebinds.
  it('still reports the ingest when a binding throws', async () => {
    const { ctx } = createMockCtx({ failBind: true });
    const result = await createConversationFromEmail(ctx, {
      organizationId: ORG,
      emails: [withAttachment('<boom@x>', 'blob_boom')],
    });
    expect(result.created).toBe(true);
    expect(result.conversationId).not.toBeNull();
  });
});
