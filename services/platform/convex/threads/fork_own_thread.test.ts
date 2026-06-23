import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateThread = vi.fn();
const mockSaveMessage = vi.fn();
vi.mock('@convex-dev/agent', () => ({
  createThread: (...args: unknown[]) => mockCreateThread(...args),
  saveMessage: (...args: unknown[]) => mockSaveMessage(...args),
}));

vi.mock('../_generated/api', () => ({
  components: { agent: { threads: { getThread: 'getThread' } } },
  internal: {
    threads: {
      snapshot_thread_files: { snapshotThreadFiles: 'snapshotThreadFiles' },
    },
  },
}));

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return { ...mod, mutation: ({ handler }: { handler: Function }) => handler };
});

const mockGetAuthUserIdentity = vi.fn();
vi.mock('../lib/rls/auth/get_auth_user_identity', () => ({
  getAuthUserIdentity: (...args: unknown[]) => mockGetAuthUserIdentity(...args),
}));

const mockGetThreadMessages = vi.fn();
vi.mock('./get_thread_messages', () => ({
  getThreadMessages: (...args: unknown[]) => mockGetThreadMessages(...args),
}));

const mockCopyThreadTodos = vi.fn();
vi.mock('./snapshot_thread_todos', () => ({
  copyThreadTodos: (...args: unknown[]) => mockCopyThreadTodos(...args),
}));

const { forkOwnThread: forkOwnThreadMutation } =
  await import('./fork_own_thread');
const forkOwnThread = forkOwnThreadMutation as unknown as (
  ctx: unknown,
  args: { threadId: string; upToMessageOrder?: number },
) => Promise<string>;

function createMockCtx(metadata?: Record<string, unknown> | null) {
  const insertFn = vi.fn();
  const runAfterFn = vi.fn().mockResolvedValue(undefined);
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
      scheduler: { runAfter: runAfterFn },
      runQuery: vi.fn().mockResolvedValue({ _creationTime: 1000 }),
    },
    insertFn,
    runAfterFn,
  };
}

describe('forkOwnThread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUserIdentity.mockResolvedValue({ userId: 'user_1' });
    mockCreateThread.mockResolvedValue('new_thread_1');
    let orderCounter = 0;
    mockSaveMessage.mockImplementation(() => {
      orderCounter += 1;
      return Promise.resolve({ message: { order: orderCounter } });
    });
    mockGetThreadMessages.mockResolvedValue({
      messages: [
        {
          _id: 'm1',
          order: 0,
          role: 'user',
          content: 'hi',
          _creationTime: 100,
        },
        {
          _id: 'm2',
          order: 1,
          role: 'assistant',
          content: 'yo',
          _creationTime: 200,
        },
      ],
    });
  });

  it('throws when unauthenticated', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(null);
    const { ctx } = createMockCtx();
    await expect(forkOwnThread(ctx, { threadId: 'thread_1' })).rejects.toThrow(
      'Unauthenticated',
    );
  });

  it('throws when forking a thread the user does not own', async () => {
    const { ctx } = createMockCtx({ userId: 'someone_else' });
    await expect(forkOwnThread(ctx, { threadId: 'thread_1' })).rejects.toThrow(
      'Not authorized',
    );
  });

  it('snapshots files + todos using the source organizationId', async () => {
    const { ctx, insertFn, runAfterFn } = createMockCtx({
      userId: 'user_1',
      organizationId: 'org_1',
      title: 'My chat',
    });
    const result = await forkOwnThread(ctx, { threadId: 'thread_1' });

    expect(result).toBe('new_thread_1');
    // Fork is org-bound.
    expect(insertFn).toHaveBeenCalledWith(
      'threadMetadata',
      expect.objectContaining({
        organizationId: 'org_1',
        forkedFrom: 'thread_1',
      }),
    );
    expect(runAfterFn).toHaveBeenCalledWith(0, 'snapshotThreadFiles', {
      sourceThreadId: 'thread_1',
      newThreadId: 'new_thread_1',
      organizationId: 'org_1',
      userId: 'user_1',
    });
    expect(mockCopyThreadTodos).toHaveBeenCalledWith(ctx, {
      sourceThreadId: 'thread_1',
      newThreadId: 'new_thread_1',
      organizationId: 'org_1',
    });
  });

  it('skips the snapshot for a legacy org-less thread', async () => {
    const { ctx, runAfterFn } = createMockCtx({ userId: 'user_1', title: 'T' });
    await forkOwnThread(ctx, { threadId: 'thread_1' });

    expect(runAfterFn).not.toHaveBeenCalled();
    expect(mockCopyThreadTodos).not.toHaveBeenCalled();
  });

  it('forks only up to upToMessageOrder when given', async () => {
    const { ctx } = createMockCtx({
      userId: 'user_1',
      organizationId: 'org_1',
    });
    await forkOwnThread(ctx, { threadId: 'thread_1', upToMessageOrder: 0 });
    // Only the order-0 message is copied.
    expect(mockSaveMessage).toHaveBeenCalledTimes(1);
  });

  it('partial fork passes the cutoff message _creationTime as the file snapshot cut', async () => {
    const { ctx, runAfterFn } = createMockCtx({
      userId: 'user_1',
      organizationId: 'org_1',
    });
    // Cut at order 0 → only message m1 (_creationTime 100) is carried over, so
    // the file snapshot must drop anything written after t=100.
    await forkOwnThread(ctx, { threadId: 'thread_1', upToMessageOrder: 0 });
    expect(runAfterFn).toHaveBeenCalledWith(0, 'snapshotThreadFiles', {
      sourceThreadId: 'thread_1',
      newThreadId: 'new_thread_1',
      organizationId: 'org_1',
      userId: 'user_1',
      createdAtCutoff: 100,
    });
  });

  it('partial fork does NOT copy the plan (cannot reconstruct it as-of-cutoff)', async () => {
    const { ctx } = createMockCtx({
      userId: 'user_1',
      organizationId: 'org_1',
    });
    await forkOwnThread(ctx, { threadId: 'thread_1', upToMessageOrder: 0 });
    expect(mockCopyThreadTodos).not.toHaveBeenCalled();
  });

  it('partial fork with an empty carried window cuts the file snapshot to nothing (cutoff 0, not undefined)', async () => {
    const { ctx, runAfterFn } = createMockCtx({
      userId: 'user_1',
      organizationId: 'org_1',
    });
    // upToMessageOrder: -1 carries no messages, so the cutoff must be 0 (copy
    // nothing) — NOT undefined, which would widen this into a full snapshot.
    await forkOwnThread(ctx, { threadId: 'thread_1', upToMessageOrder: -1 });
    expect(mockSaveMessage).not.toHaveBeenCalled();
    expect(runAfterFn).toHaveBeenCalledWith(0, 'snapshotThreadFiles', {
      sourceThreadId: 'thread_1',
      newThreadId: 'new_thread_1',
      organizationId: 'org_1',
      userId: 'user_1',
      createdAtCutoff: 0,
    });
  });
});
