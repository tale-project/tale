import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../_generated/server', () => ({
  internalMutation: ({ handler }: { handler: Function }) => handler,
  // Adds for the side-imports pulled in via legal_hold (placeLegalHold etc.)
  // when the helper transitively loads now that delete_chat_thread imports
  // loadActiveHolds. The mocked passthrough is fine because none of these
  // are exercised by the tests in this file.
  mutation: ({ handler }: { handler: Function }) => handler,
  query: ({ handler }: { handler: Function }) => handler,
  internalQuery: ({ handler }: { handler: Function }) => handler,
}));

const mockGetAuthUserIdentity = vi.fn();
vi.mock('../../lib/rls', () => ({
  getAuthUserIdentity: (...args: unknown[]) => mockGetAuthUserIdentity(...args),
}));

const mockCreateStream = vi.fn();
vi.mock('../../streaming/helpers', () => ({
  persistentStreaming: {
    createStream: (...args: unknown[]) => mockCreateStream(...args),
  },
}));

const { markGenerating: markGeneratingMutation } =
  await import('../internal_mutations');

type MarkGeneratingArgs = {
  threadId: string;
  organizationId: string;
  agentSlug?: string;
};
const markGenerating = markGeneratingMutation as unknown as (
  ctx: unknown,
  args: MarkGeneratingArgs,
) => Promise<{
  streamId: string;
  userId: string;
  userEmail: string;
  userName: string;
}>;

function createMockCtx(metadata: Record<string, unknown> | null) {
  const patchFn = vi.fn().mockResolvedValue(undefined);
  return {
    ctx: {
      db: {
        query: () => ({
          withIndex: () => ({
            first: vi.fn().mockResolvedValue(metadata),
          }),
        }),
        patch: patchFn,
      },
    },
    patchFn,
  };
}

describe('markGenerating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUserIdentity.mockResolvedValue({
      userId: 'user_1',
      email: 'u@example.com',
      name: 'User One',
    });
    mockCreateStream.mockResolvedValue('stream_abc');
  });

  it('throws when unauthenticated', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(null);
    const { ctx } = createMockCtx({
      _id: 'meta_1',
      userId: 'user_1',
      organizationId: 'org_a',
    });
    await expect(
      markGenerating(ctx, { threadId: 'thread_1', organizationId: 'org_a' }),
    ).rejects.toThrow('Unauthenticated');
  });

  it('throws when thread not found', async () => {
    const { ctx } = createMockCtx(null);
    await expect(
      markGenerating(ctx, { threadId: 'thread_1', organizationId: 'org_a' }),
    ).rejects.toThrow('Thread not found');
  });

  it('throws when user does not own the thread', async () => {
    const { ctx } = createMockCtx({
      _id: 'meta_1',
      userId: 'other_user',
      organizationId: 'org_a',
    });
    await expect(
      markGenerating(ctx, { threadId: 'thread_1', organizationId: 'org_a' }),
    ).rejects.toThrow('Thread not found');
  });

  it('passes when org matches', async () => {
    const { ctx, patchFn } = createMockCtx({
      _id: 'meta_1',
      userId: 'user_1',
      organizationId: 'org_a',
    });
    const result = await markGenerating(ctx, {
      threadId: 'thread_1',
      organizationId: 'org_a',
    });
    expect(result).toEqual({
      streamId: 'stream_abc',
      userId: 'user_1',
      userEmail: 'u@example.com',
      userName: 'User One',
    });
    expect(patchFn).toHaveBeenCalledTimes(1);
  });

  // C1: cross-org guard
  it('throws when meta.organizationId differs from args.organizationId', async () => {
    const { ctx, patchFn } = createMockCtx({
      _id: 'meta_1',
      userId: 'user_1',
      organizationId: 'org_a',
    });
    await expect(
      markGenerating(ctx, { threadId: 'thread_1', organizationId: 'org_b' }),
    ).rejects.toThrow('Thread does not belong to the requested organization');
    expect(patchFn).not.toHaveBeenCalled();
  });

  // Backwards compat: legacy threads without organizationId stamp
  it('passes when meta has no organizationId (legacy thread)', async () => {
    const { ctx, patchFn } = createMockCtx({
      _id: 'meta_1',
      userId: 'user_1',
      // no organizationId
    });
    const result = await markGenerating(ctx, {
      threadId: 'thread_1',
      organizationId: 'org_a',
    });
    expect(result.streamId).toBe('stream_abc');
    expect(patchFn).toHaveBeenCalledTimes(1);
  });
});
