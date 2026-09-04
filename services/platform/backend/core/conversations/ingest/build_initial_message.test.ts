/**
 * The three message writers stamp instants from ONE reading of the email's
 * date. A Gmail message without a Date header carries `internalDate` (an
 * epoch-ms string); a malformed one carries nothing readable. The shim behind
 * `ctx.runMutation` validates every stamp as a number, so a NaN stamp rejects
 * the write — and one rejected message wedged the whole mailbox pass.
 */

import { describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../../lib/ctx';
import type { Id } from '../../lib/rows';
import { addMessageToConversation } from './add_message_to_conversation';
import { buildInitialMessage } from './build_initial_message';
import type { EmailType } from './types';
import { updateMessage } from './update_message';

const INTERNAL_DATE = String(Date.UTC(2026, 6, 2, 12));

function email(date: string): EmailType {
  return {
    uid: 7,
    messageId: '<no-date@mail.gmail.com>',
    from: [{ address: 'customer@ext.test' }],
    to: [{ address: 'inbox@door.test' }],
    subject: 'No Date header',
    date,
    text: 'hello',
    flags: [],
  };
}

function recordingCtx() {
  const calls: Record<string, unknown>[] = [];
  const ctx = {
    runQuery: vi.fn(async () => null),
    runMutation: vi.fn(async (_ref, args: Record<string, unknown>) => {
      calls.push(args);
      return null;
    }),
  } as unknown as ActionCtx;
  return { ctx, calls };
}

describe('buildInitialMessage', () => {
  it("stamps Gmail's internalDate string as a numeric instant", () => {
    const message = buildInitialMessage(
      email(INTERNAL_DATE),
      true,
      'delivered',
    );
    expect(message.sentAt).toBe(Number(INTERNAL_DATE));
    expect(message.deliveredAt).toBe(Number(INTERNAL_DATE));
  });

  it('carries no stamp at all — never NaN — for an unreadable date', () => {
    const message = buildInitialMessage(email(''), true, 'delivered');
    expect('sentAt' in message).toBe(false);
    expect('deliveredAt' in message).toBe(false);
  });

  it('stamps only sentAt for a sent (not delivered) message', () => {
    const message = buildInitialMessage(
      email('2026-07-01T09:00:00.000Z'),
      false,
      'sent',
    );
    expect(message.sentAt).toBe(Date.UTC(2026, 6, 1, 9));
    expect('deliveredAt' in message).toBe(false);
  });
});

describe('addMessageToConversation (ingest writer)', () => {
  it('stamps the internalDate instant and omits stamps for an unreadable date', async () => {
    const { ctx, calls } = recordingCtx();
    const conversationId = 'conv_1' as Id<'conversations'>;
    await addMessageToConversation(
      ctx,
      conversationId,
      'org_1',
      email(INTERNAL_DATE),
      true,
      'delivered',
    );
    await addMessageToConversation(
      ctx,
      conversationId,
      'org_1',
      email(''),
      true,
      'delivered',
    );
    expect(calls[0]).toMatchObject({
      sentAt: Number(INTERNAL_DATE),
      deliveredAt: Number(INTERNAL_DATE),
    });
    expect(calls[1]).not.toHaveProperty('sentAt');
    expect(calls[1]).not.toHaveProperty('deliveredAt');
  });
});

describe('updateMessage (ingest writer)', () => {
  it('flips to delivered with a numeric deliveredAt, or without one when the date is unreadable', async () => {
    const { ctx, calls } = recordingCtx();
    const messageId = 'msg_1' as Id<'conversationMessages'>;
    await updateMessage(ctx, messageId, email(INTERNAL_DATE));
    await updateMessage(ctx, messageId, email(''));
    expect(calls[0]).toMatchObject({
      deliveryState: 'delivered',
      deliveredAt: Number(INTERNAL_DATE),
    });
    expect(calls[1]).toMatchObject({ deliveryState: 'delivered' });
    expect(calls[1]).not.toHaveProperty('deliveredAt');
  });
});
