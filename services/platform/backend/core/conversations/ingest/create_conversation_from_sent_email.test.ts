import { describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../../lib/ctx';
import type { Id } from '../../lib/rows';
import { createConversationFromSentEmail } from './create_conversation_from_sent_email';
import type { EmailType } from './types';

const ORG = 'org_activ';

function makeSentEmail(overrides: Partial<EmailType> = {}): EmailType {
  return {
    uid: 1,
    messageId: '<4abab424-9cfd-f43a-64c4-c5fd36788a4f@support.example.com>',
    from: [{ address: 'billing@support.example.com' }],
    to: [{ address: 'johndoe@example.com' }],
    subject: 'Re: Test',
    date: '2026-07-07T18:11:00.000Z',
    text: 'Hello Israel',
    flags: [],
    ...overrides,
  };
}

function createMockCtx() {
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
      if ('initialMessage' in args) {
        conversationCounter += 1;
        return {
          conversationId: `conv_${conversationCounter}` as Id<'conversations'>,
          messageId: `msg_${conversationCounter}` as Id<'conversationMessages'>,
        };
      }
      return {};
    }),
  } as unknown as ActionCtx;

  return { ctx };
}

describe('createConversationFromSentEmail', () => {
  it('imports sent mail when From is a reply-as alias (billing@) not the account email (hello@)', async () => {
    const { ctx } = createMockCtx();

    const result = await createConversationFromSentEmail(ctx, {
      organizationId: ORG,
      emails: [makeSentEmail()],
      accountEmail: 'hello@support.example.com',
      connectorName: 'imap-smtp',
    });

    expect(result.created).toBe(true);
    expect(result.skippedCount).toBe(0);
    expect(result.processedCount).toBe(1);
    // oxlint-disable-next-line typescript/unbound-method -- asserting on a mock fn reference
    expect(ctx.runMutation).toHaveBeenCalled();
  });

  it('does not treat a different @gmail.com From as a reply-as alias of the account', async () => {
    const { ctx } = createMockCtx();

    // From is another person's Gmail; account is desk@. Without a public-domain
    // guard this would have been accepted as a same-domain alias and the
    // customer would be taken from To — inventing a conversation for mail that
    // is not from this mailbox.
    const result = await createConversationFromSentEmail(ctx, {
      organizationId: ORG,
      emails: [
        makeSentEmail({
          from: [{ address: 'stranger@gmail.com' }],
          to: [{ address: 'someone@example.com' }],
          messageId: '<not-ours@mail.gmail.com>',
        }),
      ],
      accountEmail: 'desk@gmail.com',
      connectorName: 'gmail',
    });

    expect(result.created).toBe(false);
    expect(result.skippedCount).toBe(1);
  });

  it('skips when customer cannot be determined', async () => {
    const { ctx } = createMockCtx();

    const result = await createConversationFromSentEmail(ctx, {
      organizationId: ORG,
      emails: [
        makeSentEmail({
          to: [],
        }),
      ],
      accountEmail: 'hello@support.example.com',
    });

    expect(result.created).toBe(false);
    expect(result.skippedCount).toBe(1);
  });
});
