import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../_generated/server', () => ({
  internalMutation: ({ handler }: { handler: Function }) => handler,
  // Adds for the side-imports pulled in transitively by internal_mutations
  // (legal_hold etc.) — none are exercised by the tests in this file.
  mutation: ({ handler }: { handler: Function }) => handler,
  query: ({ handler }: { handler: Function }) => handler,
  internalQuery: ({ handler }: { handler: Function }) => handler,
}));

const mockGetAuthUserIdentity = vi.fn();
vi.mock('../lib/rls', () => ({
  getAuthUserIdentity: (...args: unknown[]) => mockGetAuthUserIdentity(...args),
}));

const mockCreateStream = vi.fn();
vi.mock('../streaming/helpers', () => ({
  persistentStreaming: {
    createStream: (...args: unknown[]) => mockCreateStream(...args),
  },
}));

const { bumpGenerationHeartbeat: bumpMutation } =
  await import('./internal_mutations');

const bumpGenerationHeartbeat = bumpMutation as unknown as (
  ctx: unknown,
  args: { threadId: string; streamId?: string },
) => Promise<null>;

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

describe('bumpGenerationHeartbeat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('patches generationHeartbeatAt for a generating thread', async () => {
    const { ctx, patchFn } = createMockCtx({
      _id: 'meta_1',
      generationStatus: 'generating',
      streamId: 'stream_abc',
    });
    await bumpGenerationHeartbeat(ctx, { threadId: 'thread_1' });
    expect(patchFn).toHaveBeenCalledTimes(1);
    const [id, patch] = patchFn.mock.calls[0] as [
      string,
      { generationHeartbeatAt: number },
    ];
    expect(id).toBe('meta_1');
    expect(typeof patch.generationHeartbeatAt).toBe('number');
  });

  it('bumps when the caller streamId matches the live generation', async () => {
    const { ctx, patchFn } = createMockCtx({
      _id: 'meta_1',
      generationStatus: 'generating',
      streamId: 'stream_abc',
    });
    await bumpGenerationHeartbeat(ctx, {
      threadId: 'thread_1',
      streamId: 'stream_abc',
    });
    expect(patchFn).toHaveBeenCalledTimes(1);
  });

  it('no-ops when the thread is idle', async () => {
    const { ctx, patchFn } = createMockCtx({
      _id: 'meta_1',
      generationStatus: 'idle',
    });
    await bumpGenerationHeartbeat(ctx, { threadId: 'thread_1' });
    expect(patchFn).not.toHaveBeenCalled();
  });

  it('no-ops when the thread metadata row is missing', async () => {
    const { ctx, patchFn } = createMockCtx(null);
    await bumpGenerationHeartbeat(ctx, { threadId: 'thread_1' });
    expect(patchFn).not.toHaveBeenCalled();
  });

  it("no-ops on streamId mismatch (a stale action's heartbeat must not keep a newer turn alive)", async () => {
    const { ctx, patchFn } = createMockCtx({
      _id: 'meta_1',
      generationStatus: 'generating',
      streamId: 'stream_NEW',
    });
    await bumpGenerationHeartbeat(ctx, {
      threadId: 'thread_1',
      streamId: 'stream_OLD',
    });
    expect(patchFn).not.toHaveBeenCalled();
  });
});
