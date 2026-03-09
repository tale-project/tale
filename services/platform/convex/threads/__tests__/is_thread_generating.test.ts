import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockListMessages = vi.fn();
const mockListStreams = vi.fn();
vi.mock('@convex-dev/agent', () => ({
  listMessages: mockListMessages,
  listStreams: mockListStreams,
}));

vi.mock('../../_generated/api', () => ({
  components: { agent: {} },
}));

vi.mock('../../_generated/server', () => ({
  query: ({ handler }: { handler: Function }) => handler,
}));

const mockGetAuthUserIdentity = vi.fn();
vi.mock('../../lib/rls', () => ({
  getAuthUserIdentity: (...args: unknown[]) => mockGetAuthUserIdentity(...args),
}));

// The query() mock strips the wrapper and returns the raw handler function
const { isThreadGenerating: isThreadGeneratingQuery } =
  await import('../queries');
const isThreadGenerating = isThreadGeneratingQuery as unknown as (
  ctx: unknown,
  args: { threadId: string },
) => Promise<boolean>;

function createMockCtx() {
  return {};
}

describe('isThreadGenerating — zombie stream detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUserIdentity.mockResolvedValue({ userId: 'user_1' });
    mockListStreams.mockResolvedValue([]);
    mockListMessages.mockResolvedValue({ page: [] });
  });

  it('returns false when no active streams exist', async () => {
    mockListStreams.mockResolvedValue([]);

    const result = await isThreadGenerating(createMockCtx(), {
      threadId: 'thread_1',
    });

    expect(result).toBe(false);
    expect(mockListStreams).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { threadId: 'thread_1', includeStatuses: ['streaming'] },
    );
    expect(mockListMessages).not.toHaveBeenCalled();
  });

  it('returns true when active streams exist and latest assistant has no terminal status', async () => {
    mockListStreams.mockResolvedValue([
      { streamId: 'stream_1', status: 'streaming' },
    ]);
    mockListMessages.mockResolvedValue({
      page: [
        {
          message: { role: 'assistant', content: 'thinking...' },
          status: 'pending',
        },
      ],
    });

    const result = await isThreadGenerating(createMockCtx(), {
      threadId: 'thread_1',
    });

    expect(result).toBe(true);
  });

  it('returns false when active streams exist but latest assistant is failed (zombie)', async () => {
    mockListStreams.mockResolvedValue([
      { streamId: 'stream_zombie', status: 'streaming' },
    ]);
    mockListMessages.mockResolvedValue({
      page: [
        {
          message: { role: 'assistant', content: 'error' },
          status: 'failed',
        },
      ],
    });

    const result = await isThreadGenerating(createMockCtx(), {
      threadId: 'thread_1',
    });

    expect(result).toBe(false);
  });

  it('returns false when active streams exist but latest assistant is success (zombie)', async () => {
    mockListStreams.mockResolvedValue([
      { streamId: 'stream_zombie', status: 'streaming' },
    ]);
    mockListMessages.mockResolvedValue({
      page: [
        {
          message: { role: 'assistant', content: 'done' },
          status: 'success',
        },
      ],
    });

    const result = await isThreadGenerating(createMockCtx(), {
      threadId: 'thread_1',
    });

    expect(result).toBe(false);
  });

  it('returns true when active streams exist and no assistant messages found', async () => {
    mockListStreams.mockResolvedValue([
      { streamId: 'stream_1', status: 'streaming' },
    ]);
    mockListMessages.mockResolvedValue({
      page: [{ message: { role: 'user', content: 'hello' } }],
    });

    const result = await isThreadGenerating(createMockCtx(), {
      threadId: 'thread_1',
    });

    expect(result).toBe(true);
  });

  it('uses find (newest first) not findLast — older failed + newer pending returns true', async () => {
    mockListStreams.mockResolvedValue([
      { streamId: 'stream_1', status: 'streaming' },
    ]);
    // desc order: newest first → pending assistant is page[0], older failed is page[1]
    mockListMessages.mockResolvedValue({
      page: [
        {
          message: { role: 'assistant', content: 'working...' },
          status: 'pending',
        },
        {
          message: { role: 'assistant', content: 'old error' },
          status: 'failed',
        },
      ],
    });

    const result = await isThreadGenerating(createMockCtx(), {
      threadId: 'thread_1',
    });

    expect(result).toBe(true);
  });

  it('returns false when user is not authenticated', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(null);
    mockListStreams.mockResolvedValue([
      { streamId: 'stream_1', status: 'streaming' },
    ]);

    const result = await isThreadGenerating(createMockCtx(), {
      threadId: 'thread_1',
    });

    expect(result).toBe(false);
    expect(mockListStreams).not.toHaveBeenCalled();
  });
});
