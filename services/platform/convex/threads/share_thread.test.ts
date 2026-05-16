import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../_generated/server', () => ({
  mutation: ({ handler }: { handler: Function }) => handler,
}));

const mockGetAuthUser = vi.fn();
vi.mock('../auth', () => ({
  authComponent: {
    getAuthUser: (...args: unknown[]) => mockGetAuthUser(...args),
  },
}));

const {
  shareThread: shareThreadMutation,
  unshareThread: unshareThreadMutation,
} = await import('./share_thread');

const shareThread = shareThreadMutation as unknown as (
  ctx: unknown,
  args: { threadId: string; organizationId?: string },
) => Promise<string>;

const unshareThread = unshareThreadMutation as unknown as (
  ctx: unknown,
  args: { threadId: string },
) => Promise<null>;

function createMockCtx(metadata?: Record<string, unknown> | null) {
  const patchFn = vi.fn();
  return {
    ctx: {
      db: {
        query: () => ({
          withIndex: () => ({
            first: vi
              .fn()
              .mockResolvedValue(
                metadata
                  ? { _id: 'meta_1', userId: 'user_1', ...metadata }
                  : null,
              ),
          }),
        }),
        patch: patchFn,
      },
    },
    patchFn,
  };
}

describe('shareThread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUser.mockResolvedValue({ _id: 'user_1' });
  });

  it('throws when unauthenticated', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const { ctx } = createMockCtx();
    await expect(shareThread(ctx, { threadId: 'thread_1' })).rejects.toThrow(
      'Unauthenticated',
    );
  });

  it('throws when thread not found', async () => {
    const { ctx } = createMockCtx(null);
    await expect(shareThread(ctx, { threadId: 'thread_1' })).rejects.toThrow(
      'Thread not found',
    );
  });

  it('throws when user is not the owner', async () => {
    mockGetAuthUser.mockResolvedValue({ _id: 'user_2' });
    const { ctx } = createMockCtx({ status: 'active' });
    await expect(shareThread(ctx, { threadId: 'thread_1' })).rejects.toThrow(
      'Not authorized to share this thread',
    );
  });

  it('throws when thread is archived', async () => {
    const { ctx } = createMockCtx({ status: 'archived' });
    await expect(shareThread(ctx, { threadId: 'thread_1' })).rejects.toThrow(
      'Cannot share an archived thread',
    );
  });

  it('throws when thread is an arena thread', async () => {
    const { ctx } = createMockCtx({
      status: 'active',
      arenaGroupId: 'arena_1',
    });
    await expect(shareThread(ctx, { threadId: 'thread_1' })).rejects.toThrow(
      'Cannot share arena mode threads',
    );
  });

  it('throws when thread is a branch thread', async () => {
    const { ctx } = createMockCtx({ status: 'active', isBranch: true });
    await expect(shareThread(ctx, { threadId: 'thread_1' })).rejects.toThrow(
      'Cannot share branch threads',
    );
  });

  it('returns existing token when already shared (idempotent)', async () => {
    const { ctx } = createMockCtx({
      status: 'active',
      isShared: true,
      shareToken: 'existing-token',
    });
    const token = await shareThread(ctx, { threadId: 'thread_1' });
    expect(token).toBe('existing-token');
  });

  it('generates a new token and patches metadata', async () => {
    const { ctx, patchFn } = createMockCtx({ status: 'active' });
    const token = await shareThread(ctx, { threadId: 'thread_1' });

    expect(token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(patchFn).toHaveBeenCalledWith(
      'meta_1',
      expect.objectContaining({
        shareToken: token,
        isShared: true,
        sharedBy: 'user_1',
      }),
    );
  });

  it('stores organizationId when provided and not already set', async () => {
    const { ctx, patchFn } = createMockCtx({ status: 'active' });
    await shareThread(ctx, { threadId: 'thread_1', organizationId: 'org_1' });

    expect(patchFn).toHaveBeenCalledWith(
      'meta_1',
      expect.objectContaining({
        organizationId: 'org_1',
      }),
    );
  });

  it('does not overwrite existing organizationId', async () => {
    const { ctx, patchFn } = createMockCtx({
      status: 'active',
      organizationId: 'org_existing',
    });
    await shareThread(ctx, { threadId: 'thread_1', organizationId: 'org_new' });

    const patchArg = patchFn.mock.calls[0][1];
    expect(patchArg.organizationId).toBeUndefined();
  });
});

describe('unshareThread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUser.mockResolvedValue({ _id: 'user_1' });
  });

  it('throws when unauthenticated', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const { ctx } = createMockCtx();
    await expect(unshareThread(ctx, { threadId: 'thread_1' })).rejects.toThrow(
      'Unauthenticated',
    );
  });

  it('throws when thread not found', async () => {
    const { ctx } = createMockCtx(null);
    await expect(unshareThread(ctx, { threadId: 'thread_1' })).rejects.toThrow(
      'Thread not found',
    );
  });

  it('throws when user is not the owner', async () => {
    mockGetAuthUser.mockResolvedValue({ _id: 'user_2' });
    const { ctx } = createMockCtx({ status: 'active', isShared: true });
    await expect(unshareThread(ctx, { threadId: 'thread_1' })).rejects.toThrow(
      'Not authorized to unshare this thread',
    );
  });

  it('throws when thread is archived', async () => {
    const { ctx } = createMockCtx({ status: 'archived', isShared: true });
    await expect(unshareThread(ctx, { threadId: 'thread_1' })).rejects.toThrow(
      'Cannot unshare an archived thread',
    );
  });

  it('clears share fields', async () => {
    const { ctx, patchFn } = createMockCtx({
      status: 'active',
      isShared: true,
      shareToken: 'token-1',
    });
    const result = await unshareThread(ctx, { threadId: 'thread_1' });

    expect(result).toBeNull();
    expect(patchFn).toHaveBeenCalledWith('meta_1', {
      shareToken: undefined,
      isShared: false,
      sharedAt: undefined,
      sharedBy: undefined,
    });
  });
});
