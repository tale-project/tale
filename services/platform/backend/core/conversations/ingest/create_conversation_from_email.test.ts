import { describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../../lib/shared/handlers/function-refs';
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

  it('reports the ingestedTip as the newest email it covered', async () => {
    const { ctx } = createMockCtx();
    const result = await createConversationFromEmail(ctx, {
      organizationId: ORG,
      emails: [
        makeEmail('a@thread.com', '2026-07-01T09:00:00.000Z'),
        makeEmail('b@thread.com', '2026-07-03T09:00:00.000Z'),
        makeEmail('c@thread.com', '2026-07-02T09:00:00.000Z'),
      ],
    });
    // The sync advances the watermark to exactly this, never past it.
    expect(result.ingestedTip).toBe(Date.parse('2026-07-03T09:00:00.000Z'));
  });
});

/**
 * A Gmail message without a Date header arrives with `date` = internalDate (an
 * epoch-ms STRING); a malformed one may carry no readable date at all. The
 * ingest shim validates every stamp as a number, so a NaN stamp rejects the
 * write — and with no per-message isolation one such message wedged the whole
 * mailbox pass forever (the watermark never advanced past it). Every writer
 * (create / thread / update) must ingest such a message with the stamp
 * omitted, and the rest of the batch must land.
 */
describe('createConversationFromEmail — messages without a readable Date', () => {
  const INTERNAL_DATE = String(Date.UTC(2026, 6, 2, 12));

  /** The shim's contract: a stamp is a finite number or absent. */
  function assertShimStamps(args: Record<string, unknown>): void {
    const initial = args.initialMessage;
    const carriers: unknown[] = [args];
    if (typeof initial === 'object' && initial !== null) carriers.push(initial);
    for (const carrier of carriers) {
      for (const key of ['sentAt', 'deliveredAt']) {
        const value = Reflect.get(Object(carrier), key);
        if (value !== undefined && !Number.isFinite(value)) {
          throw new Error(
            `Invalid input: expected number, received ${String(value)} at ${key}`,
          );
        }
      }
    }
  }

  function strictCtx() {
    const mutations: Record<string, unknown>[] = [];
    const ctx = {
      runQuery: vi.fn(async (ref: unknown, args: Record<string, unknown>) => {
        // One conversation already exists from an earlier pass; its root
        // Message-ID is what a later undated reply threads onto.
        if (
          functionRefName(ref) ===
            'conversations/internal_queries:getMessageByExternalId' &&
          args.externalMessageId === 'root@existing'
        ) {
          return {
            _id: 'msg_root',
            conversationId: 'conv_existing',
            deliveryState: 'delivered',
          };
        }
        return null;
      }),
      runMutation: vi.fn(async (_ref, args: Record<string, unknown>) => {
        assertShimStamps(args);
        mutations.push(args);
        if ('source' in args && args.source === 'conversation') {
          return { contactId: 'cont_1', created: true };
        }
        if (isCreateConversationArgs(args)) {
          return {
            conversationId: `conv_${mutations.length}`,
            messageId: `msg_${mutations.length}`,
          };
        }
        return null;
      }),
    } as unknown as ActionCtx;
    return { ctx, mutations };
  }

  it('ingests the whole batch: the readable instants are stamped, the rest carry none', async () => {
    const { ctx, mutations } = strictCtx();
    const result = await createConversationFromEmail(ctx, {
      organizationId: ORG,
      emails: [
        makeEmail('<dated@x>', '2026-07-01T09:00:00.000Z'),
        makeEmail('<internal@x>', INTERNAL_DATE),
        makeEmail('<undated@x>', ''),
        makeEmail('<undated-reply@x>', '', {
          headers: {
            'message-id': '<undated-reply@x>',
            'in-reply-to': '<root@existing>',
            references: '<root@existing>',
          },
        }),
      ],
      connectorName: 'gmail',
    });

    expect(result.processedCount).toBe(4);
    expect(result.skippedCount).toBe(0);
    // Three new conversations + one message threaded onto the existing one.
    const created = mutations.filter(isCreateConversationArgs);
    const threaded = mutations.filter(isAddMessageArgs);
    expect(created).toHaveLength(3);
    expect(threaded).toHaveLength(1);
    expect(threaded[0]?.conversationId).toBe('conv_existing');
    expect(threaded[0]).not.toHaveProperty('sentAt');

    const initialOf = (externalMessageId: string) =>
      created.find((args) => args.externalMessageId === externalMessageId)
        ?.initialMessage as Record<string, unknown> | undefined;
    expect(initialOf('internal@x')).toMatchObject({
      sentAt: Number(INTERNAL_DATE),
      deliveredAt: Number(INTERNAL_DATE),
    });
    expect(initialOf('dated@x')).toMatchObject({
      sentAt: Date.UTC(2026, 6, 1, 9),
    });
    expect(initialOf('undated@x')).not.toHaveProperty('sentAt');
    expect(initialOf('undated@x')).not.toHaveProperty('deliveredAt');
    // The watermark tip is the newest READABLE instant — undated mail never
    // moves it, and never freezes it either.
    expect(result.ingestedTip).toBe(Number(INTERNAL_DATE));
  });

  it('re-syncing an already-ingested undated message updates it without a NaN stamp', async () => {
    const { ctx, mutations } = strictCtx();
    const result = await createConversationFromEmail(ctx, {
      organizationId: ORG,
      emails: [makeEmail('<root@existing>', '')],
    });
    expect(result.processedCount).toBe(1);
    const update = mutations.find(
      (args) => 'messageId' in args && 'deliveryState' in args,
    );
    expect(update).toMatchObject({
      messageId: 'msg_root',
      deliveryState: 'delivered',
    });
    expect(update).not.toHaveProperty('deliveredAt');
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
