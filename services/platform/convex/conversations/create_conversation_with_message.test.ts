import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../../lib/shared/errors/app-error';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { emitEvent } from '../events/emit';
import { createConversationWithMessage } from './create_conversation_with_message';
import type { CreateConversationWithMessageArgs } from './create_conversation_with_message';

vi.mock('../audit_logs/helpers', () => ({
  logSuccess: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./create_conversation', () => ({
  createConversation: vi.fn().mockResolvedValue({
    success: true,
    conversationId: 'created_conversation' as Id<'conversations'>,
  }),
}));

vi.mock('../events/emit', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

const ORG_ID = 'org_1';

function makeArgs(): CreateConversationWithMessageArgs {
  return {
    organizationId: ORG_ID,
    initialMessage: {
      sender: 'sender@example.com',
      content: 'hello',
      isCustomer: true,
    },
  };
}

describe('createConversationWithMessage — client-facing failures use AppError (#2049)', () => {
  it('throws a coded AppError when the created conversation cannot be retrieved', async () => {
    // The conversation is created but the immediate read-back returns null,
    // exercising the post-create retrieval invariant.
    const ctx = {
      db: {
        get: vi.fn().mockResolvedValue(null),
        insert: vi.fn().mockResolvedValue('message_id'),
        patch: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as MutationCtx;

    await expect(
      createConversationWithMessage(ctx, makeArgs()),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      createConversationWithMessage(ctx, makeArgs()),
    ).rejects.toMatchObject({
      data: { code: 'conversation_not_found' },
    });
  });

  it('emits conversation.message_received after the initial message is stored', async () => {
    const conversation = {
      _id: 'created_conversation' as Id<'conversations'>,
      organizationId: ORG_ID,
      status: 'open',
    };
    const message = {
      _id: 'message_id' as Id<'conversationMessages'>,
      direction: 'inbound',
    };
    const get = vi
      .fn()
      .mockResolvedValueOnce(conversation)
      .mockResolvedValueOnce(message)
      .mockResolvedValueOnce(conversation);
    const ctx = {
      db: {
        get,
        insert: vi.fn().mockResolvedValue('message_id'),
        patch: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as MutationCtx;

    await createConversationWithMessage(ctx, makeArgs());

    expect(emitEvent).toHaveBeenCalledWith(ctx, {
      organizationId: ORG_ID,
      eventType: 'conversation.message_received',
      eventData: { conversation, message },
    });
  });
});
