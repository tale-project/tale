import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreateThread = vi.fn();
const mockSaveMessage = vi.fn();
vi.mock('@convex-dev/agent', () => ({
  createThread: (...args: unknown[]) => mockCreateThread(...args),
  saveMessage: (...args: unknown[]) => mockSaveMessage(...args),
}));

vi.mock('../../_generated/api', () => ({
  components: { agent: { threads: { getThread: 'getThread' } } },
}));

vi.mock('../../_generated/server', () => ({
  mutation: ({ handler }: { handler: Function }) => handler,
}));

const mockGetAuthUser = vi.fn();
vi.mock('../../auth', () => ({
  authComponent: {
    getAuthUser: (...args: unknown[]) => mockGetAuthUser(...args),
  },
}));

const mockIsOrgMember = vi.fn();
vi.mock('../../lib/rls/auth/check_org_membership', () => ({
  isOrgMember: (...args: unknown[]) => mockIsOrgMember(...args),
}));

const mockGetThreadMessages = vi.fn();
vi.mock('../get_thread_messages', () => ({
  getThreadMessages: (...args: unknown[]) => mockGetThreadMessages(...args),
}));

const { forkThread: forkThreadMutation } = await import('../fork_thread');
const forkThread = forkThreadMutation as unknown as (
  ctx: unknown,
  args: { shareToken: string },
) => Promise<string>;

const VALID_TOKEN = '550e8400-e29b-41d4-a716-446655440000';

function createMockCtx(metadata?: Record<string, unknown> | null) {
  const insertFn = vi.fn();
  return {
    ctx: {
      db: {
        query: () => ({
          withIndex: () => ({
            first: vi.fn().mockResolvedValue(
              metadata
                ? {
                    _id: 'meta_1',
                    threadId: 'thread_1',
                    userId: 'user_1',
                    ...metadata,
                  }
                : null,
            ),
          }),
        }),
        insert: insertFn,
      },
      runQuery: vi.fn().mockResolvedValue({ _creationTime: 1000 }),
    },
    insertFn,
  };
}

describe('forkThread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUser.mockResolvedValue({ _id: 'user_2' });
    mockIsOrgMember.mockResolvedValue(true);
    mockCreateThread.mockResolvedValue('new_thread_1');
    let orderCounter = 0;
    mockSaveMessage.mockImplementation(() => {
      orderCounter += 1;
      return Promise.resolve({
        messageId: `saved_msg_${orderCounter}`,
        message: { order: orderCounter },
      });
    });
    mockGetThreadMessages.mockResolvedValue({
      messages: [
        { _id: 'msg_1', _creationTime: 1000, role: 'user', content: 'hello' },
        {
          _id: 'msg_2',
          _creationTime: 2000,
          role: 'assistant',
          content: 'hi',
        },
      ],
    });
  });

  it('throws when unauthenticated', async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const { ctx } = createMockCtx();
    await expect(forkThread(ctx, { shareToken: VALID_TOKEN })).rejects.toThrow(
      'Unauthenticated',
    );
  });

  it('throws for invalid token format', async () => {
    const { ctx } = createMockCtx();
    await expect(forkThread(ctx, { shareToken: 'not-a-uuid' })).rejects.toThrow(
      'Invalid share token',
    );
  });

  it('throws when shared thread not found', async () => {
    const { ctx } = createMockCtx(null);
    await expect(forkThread(ctx, { shareToken: VALID_TOKEN })).rejects.toThrow(
      'Shared thread not found',
    );
  });

  it('throws when thread is not shared', async () => {
    const { ctx } = createMockCtx({ isShared: false });
    await expect(forkThread(ctx, { shareToken: VALID_TOKEN })).rejects.toThrow(
      'Shared thread not found',
    );
  });

  it('throws when user is not in the same org', async () => {
    mockIsOrgMember.mockResolvedValue(false);
    const { ctx } = createMockCtx({
      isShared: true,
      organizationId: 'org_1',
    });
    await expect(forkThread(ctx, { shareToken: VALID_TOKEN })).rejects.toThrow(
      'Shared thread not found',
    );
  });

  it('allows fork when thread has no organizationId (legacy)', async () => {
    const { ctx } = createMockCtx({ isShared: true, title: 'Test' });
    const result = await forkThread(ctx, { shareToken: VALID_TOKEN });
    expect(result).toBe('new_thread_1');
    expect(mockIsOrgMember).not.toHaveBeenCalled();
  });

  it('creates forked thread with correct metadata', async () => {
    const { ctx, insertFn } = createMockCtx({
      isShared: true,
      organizationId: 'org_1',
      title: 'Original chat',
      sharedAt: 5000,
    });
    const result = await forkThread(ctx, { shareToken: VALID_TOKEN });

    expect(result).toBe('new_thread_1');
    expect(insertFn).toHaveBeenCalledWith(
      'threadMetadata',
      expect.objectContaining({
        threadId: 'new_thread_1',
        userId: 'user_2',
        title: 'Fork of Original chat',
        forkedFrom: 'thread_1',
        forkedFromShare: true,
        forkedMessageCount: 2,
        organizationId: 'org_1',
      }),
    );
  });

  it('copies messages to the forked thread', async () => {
    const { ctx } = createMockCtx({
      isShared: true,
      organizationId: 'org_1',
    });
    await forkThread(ctx, { shareToken: VALID_TOKEN });

    expect(mockSaveMessage).toHaveBeenCalledTimes(2);
    expect(mockSaveMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        threadId: 'new_thread_1',
        message: { role: 'user', content: 'hello' },
      }),
    );
  });

  it('forces disablePersonalization=true on the forked thread (privacy: forker should not inject personalization into context authored by another user)', async () => {
    const { ctx, insertFn } = createMockCtx({
      isShared: true,
      organizationId: 'org_1',
      title: 'Original chat',
    });
    await forkThread(ctx, { shareToken: VALID_TOKEN });

    expect(insertFn).toHaveBeenCalledWith(
      'threadMetadata',
      expect.objectContaining({
        threadId: 'new_thread_1',
        forkedFromShare: true,
        disablePersonalization: true,
      }),
    );
  });

  it('respects snapshot isolation when forking', async () => {
    mockGetThreadMessages.mockResolvedValue({
      messages: [
        { _id: 'msg_1', _creationTime: 1000, role: 'user', content: 'hello' },
        {
          _id: 'msg_2',
          _creationTime: 2000,
          role: 'assistant',
          content: 'hi',
        },
        {
          _id: 'msg_3',
          _creationTime: 5000,
          role: 'user',
          content: 'after share',
        },
      ],
    });

    const { ctx, insertFn } = createMockCtx({
      isShared: true,
      sharedAt: 3000,
    });
    await forkThread(ctx, { shareToken: VALID_TOKEN });

    // Only 2 messages should be saved (msg_3 is after sharedAt)
    expect(mockSaveMessage).toHaveBeenCalledTimes(2);
    expect(insertFn).toHaveBeenCalledWith(
      'threadMetadata',
      expect.objectContaining({ forkedMessageCount: 2 }),
    );
  });
});
