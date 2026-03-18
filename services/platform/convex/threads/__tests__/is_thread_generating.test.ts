import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockListMessages = vi.fn();
vi.mock('@convex-dev/agent', () => ({
  listMessages: mockListMessages,
}));

const mockGetStreamStatus = vi.fn();
vi.mock('../../_generated/api', () => ({
  components: {
    agent: {},
    persistentTextStreaming: {
      lib: { getStreamStatus: 'mock-getStreamStatus' },
    },
  },
}));

vi.mock('../../_generated/server', () => ({
  query: ({ handler }: { handler: Function }) => handler,
}));

const mockGetAuthUserIdentity = vi.fn();
vi.mock('../../lib/rls', () => ({
  getAuthUserIdentity: (...args: unknown[]) => mockGetAuthUserIdentity(...args),
}));

const { isThreadGenerating: isThreadGeneratingQuery } =
  await import('../queries');
const isThreadGenerating = isThreadGeneratingQuery as unknown as (
  ctx: unknown,
  args: { threadId: string },
) => Promise<boolean>;

function createMockCtx(threadMeta?: {
  generationStatus?: string;
  streamId?: string;
}) {
  return {
    db: {
      query: () => ({
        withIndex: () => ({
          first: vi.fn().mockResolvedValue(threadMeta ?? null),
        }),
      }),
    },
    runQuery: mockGetStreamStatus,
  };
}

describe('isThreadGenerating — threadMetadata-based detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUserIdentity.mockResolvedValue({ userId: 'user_1' });
    mockListMessages.mockResolvedValue({ page: [] });
    mockGetStreamStatus.mockResolvedValue('streaming');
  });

  it('returns false when user is not authenticated', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(null);
    const result = await isThreadGenerating(
      createMockCtx({ generationStatus: 'generating', streamId: 'stream_1' }),
      { threadId: 'thread_1' },
    );
    expect(result).toBe(false);
  });

  it('returns false when no threadMetadata record exists', async () => {
    const result = await isThreadGenerating(createMockCtx(), {
      threadId: 'thread_1',
    });
    expect(result).toBe(false);
  });

  it('returns false when generationStatus is idle', async () => {
    const result = await isThreadGenerating(
      createMockCtx({ generationStatus: 'idle', streamId: undefined }),
      { threadId: 'thread_1' },
    );
    expect(result).toBe(false);
  });

  it('returns false when generationStatus is undefined', async () => {
    const result = await isThreadGenerating(
      createMockCtx({ generationStatus: undefined, streamId: undefined }),
      { threadId: 'thread_1' },
    );
    expect(result).toBe(false);
  });

  it('returns false when generating but no streamId', async () => {
    const result = await isThreadGenerating(
      createMockCtx({ generationStatus: 'generating', streamId: undefined }),
      { threadId: 'thread_1' },
    );
    expect(result).toBe(false);
  });

  it('returns true when generating with active persistent stream', async () => {
    mockGetStreamStatus.mockResolvedValue('streaming');
    const result = await isThreadGenerating(
      createMockCtx({ generationStatus: 'generating', streamId: 'stream_1' }),
      { threadId: 'thread_1' },
    );
    expect(result).toBe(true);
  });

  it('returns true when generating with pending persistent stream', async () => {
    mockGetStreamStatus.mockResolvedValue('pending');
    const result = await isThreadGenerating(
      createMockCtx({ generationStatus: 'generating', streamId: 'stream_1' }),
      { threadId: 'thread_1' },
    );
    expect(result).toBe(true);
  });

  it('returns false when generating but persistent stream is done (self-healing)', async () => {
    mockGetStreamStatus.mockResolvedValue('done');
    const result = await isThreadGenerating(
      createMockCtx({ generationStatus: 'generating', streamId: 'stream_1' }),
      { threadId: 'thread_1' },
    );
    expect(result).toBe(false);
  });

  it('returns false when generating but persistent stream is error (self-healing)', async () => {
    mockGetStreamStatus.mockResolvedValue('error');
    const result = await isThreadGenerating(
      createMockCtx({ generationStatus: 'generating', streamId: 'stream_1' }),
      { threadId: 'thread_1' },
    );
    expect(result).toBe(false);
  });

  it('returns false when generating but persistent stream timed out (self-healing)', async () => {
    mockGetStreamStatus.mockResolvedValue('timeout');
    const result = await isThreadGenerating(
      createMockCtx({ generationStatus: 'generating', streamId: 'stream_1' }),
      { threadId: 'thread_1' },
    );
    expect(result).toBe(false);
  });

  it('returns false when getStreamStatus throws (component unavailable)', async () => {
    mockGetStreamStatus.mockRejectedValue(new Error('component down'));
    const result = await isThreadGenerating(
      createMockCtx({ generationStatus: 'generating', streamId: 'stream_1' }),
      { threadId: 'thread_1' },
    );
    expect(result).toBe(false);
  });

  describe('zombie detection', () => {
    it('returns false when stream is active but latest assistant is failed', async () => {
      mockGetStreamStatus.mockResolvedValue('streaming');
      mockListMessages.mockResolvedValue({
        page: [
          {
            message: { role: 'assistant', content: 'error' },
            status: 'failed',
          },
        ],
      });
      const result = await isThreadGenerating(
        createMockCtx({
          generationStatus: 'generating',
          streamId: 'stream_1',
        }),
        { threadId: 'thread_1' },
      );
      expect(result).toBe(false);
    });

    it('returns false when stream is active but latest assistant is success', async () => {
      mockGetStreamStatus.mockResolvedValue('streaming');
      mockListMessages.mockResolvedValue({
        page: [
          {
            message: { role: 'assistant', content: 'done' },
            status: 'success',
          },
        ],
      });
      const result = await isThreadGenerating(
        createMockCtx({
          generationStatus: 'generating',
          streamId: 'stream_1',
        }),
        { threadId: 'thread_1' },
      );
      expect(result).toBe(false);
    });

    it('returns true when stream is active and latest assistant is pending', async () => {
      mockGetStreamStatus.mockResolvedValue('streaming');
      mockListMessages.mockResolvedValue({
        page: [
          {
            message: { role: 'assistant', content: 'working...' },
            status: 'pending',
          },
        ],
      });
      const result = await isThreadGenerating(
        createMockCtx({
          generationStatus: 'generating',
          streamId: 'stream_1',
        }),
        { threadId: 'thread_1' },
      );
      expect(result).toBe(true);
    });

    it('returns true when stream is active and no assistant messages', async () => {
      mockGetStreamStatus.mockResolvedValue('streaming');
      mockListMessages.mockResolvedValue({
        page: [{ message: { role: 'user', content: 'hello' } }],
      });
      const result = await isThreadGenerating(
        createMockCtx({
          generationStatus: 'generating',
          streamId: 'stream_1',
        }),
        { threadId: 'thread_1' },
      );
      expect(result).toBe(true);
    });
  });
});
