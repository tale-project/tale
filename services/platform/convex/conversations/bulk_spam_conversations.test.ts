import { describe, expect, it, vi } from 'vitest';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

import { bulkSpamConversations } from './bulk_spam_conversations';

vi.mock('../audit_logs/helpers', () => ({
  logSuccess: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/helpers/build_audit_context', () => ({
  buildAuditContext: vi.fn().mockResolvedValue({ organizationId: 'org_1' }),
}));

function createMockCtx(conversations: Array<Record<string, unknown> | null>) {
  const patchFn = vi.fn().mockResolvedValue(undefined);
  const ctx = {
    db: {
      get: vi.fn((id: string) => {
        const index = conversations.findIndex((c) => c?._id === id);
        return Promise.resolve(index >= 0 ? conversations[index] : null);
      }),
      patch: patchFn,
    },
  } as unknown as MutationCtx;
  return { ctx, patchFn };
}

const ORG_ID = 'org_1';

function makeConversation(id: string, status = 'open') {
  return {
    _id: id,
    organizationId: ORG_ID,
    status,
    metadata: {},
  };
}

describe('bulkSpamConversations', () => {
  it('marks all conversations as spam', async () => {
    const c1 = makeConversation('c_1');
    const c2 = makeConversation('c_2');
    const { ctx, patchFn } = createMockCtx([c1, c2]);

    const result = await bulkSpamConversations(ctx, {
      conversationIds: ['c_1', 'c_2'] as Array<Id<'conversations'>>,
    });

    expect(result.successCount).toBe(2);
    expect(result.failedCount).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(patchFn).toHaveBeenCalledTimes(2);
    expect(patchFn).toHaveBeenCalledWith('c_1', { status: 'spam' });
    expect(patchFn).toHaveBeenCalledWith('c_2', { status: 'spam' });
  });

  it('records errors for missing conversations', async () => {
    const c1 = makeConversation('c_1');
    const { ctx } = createMockCtx([c1]);

    const result = await bulkSpamConversations(ctx, {
      conversationIds: ['c_1', 'c_missing'] as Array<Id<'conversations'>>,
    });

    expect(result.successCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.errors).toContain('Conversation c_missing not found');
  });

  it('handles empty input', async () => {
    const { ctx } = createMockCtx([]);

    const result = await bulkSpamConversations(ctx, {
      conversationIds: [],
    });

    expect(result.successCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('handles patch failures gracefully', async () => {
    const c1 = makeConversation('c_1');
    const { ctx, patchFn } = createMockCtx([c1]);
    patchFn.mockRejectedValueOnce(new Error('DB write error'));

    const result = await bulkSpamConversations(ctx, {
      conversationIds: ['c_1'] as Array<Id<'conversations'>>,
    });

    expect(result.successCount).toBe(0);
    expect(result.failedCount).toBe(1);
    expect(result.errors[0]).toContain('DB write error');
  });
});
