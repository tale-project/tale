import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../../lib/shared/errors/app-error';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { UpdateConversationsArgs } from './types';
import { updateConversations } from './update_conversations';

vi.mock('../audit_logs/helpers', () => ({
  logSuccess: vi.fn().mockResolvedValue(undefined),
}));

const ORG_ID = 'org_1';

function makeConversation(id: string, organizationId = ORG_ID) {
  return {
    _id: id,
    organizationId,
    status: 'open',
    priority: 'normal',
    metadata: {},
  };
}

function createMockCtx(conversations: Array<Record<string, unknown>>) {
  const ctx = {
    db: {
      get: vi.fn((id: string) =>
        Promise.resolve(conversations.find((c) => c._id === id) ?? null),
      ),
      patch: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as MutationCtx;
  return ctx;
}

describe('updateConversations — client-facing failures use AppError (#2049)', () => {
  it('throws a coded AppError when neither id nor org is provided', async () => {
    const ctx = createMockCtx([]);
    const args = { updates: {} } as UpdateConversationsArgs;

    await expect(updateConversations(ctx, args)).rejects.toBeInstanceOf(
      AppError,
    );
    await expect(updateConversations(ctx, args)).rejects.toMatchObject({
      data: { code: 'conversation_target_required' },
    });
  });

  it('throws a coded AppError when the conversation does not exist', async () => {
    const ctx = createMockCtx([]);
    const args = {
      conversationId: 'missing' as Id<'conversations'>,
      updates: {},
    } as UpdateConversationsArgs;

    await expect(updateConversations(ctx, args)).rejects.toBeInstanceOf(
      AppError,
    );
    await expect(updateConversations(ctx, args)).rejects.toMatchObject({
      data: { code: 'conversation_not_found' },
    });
  });

  it('hides cross-tenant targets behind a not-found AppError', async () => {
    const ctx = createMockCtx([makeConversation('c_1', 'org_other')]);
    const args = {
      conversationId: 'c_1' as Id<'conversations'>,
      organizationId: ORG_ID,
      updates: {},
    } as UpdateConversationsArgs;

    await expect(updateConversations(ctx, args)).rejects.toBeInstanceOf(
      AppError,
    );
    await expect(updateConversations(ctx, args)).rejects.toMatchObject({
      data: { code: 'conversation_not_found' },
    });
  });
});
