import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockListMessages = vi.fn();
vi.mock('@convex-dev/agent', () => ({
  listMessages: mockListMessages,
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

const { getMessageError: getMessageErrorQuery } =
  await import('../get_message_error');
const getMessageError = getMessageErrorQuery as unknown as (
  ctx: unknown,
  args: { threadId: string },
) => Promise<string | null>;

function createMockCtx() {
  return {};
}

describe('getMessageError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUserIdentity.mockResolvedValue({ userId: 'user_1' });
    mockListMessages.mockResolvedValue({ page: [] });
  });

  it('returns null when user is not authenticated', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(null);

    const result = await getMessageError(createMockCtx(), {
      threadId: 'thread_1',
    });

    expect(result).toBeNull();
    expect(mockListMessages).not.toHaveBeenCalled();
  });

  it('returns null when no failed messages exist', async () => {
    mockListMessages.mockResolvedValue({ page: [] });

    const result = await getMessageError(createMockCtx(), {
      threadId: 'thread_1',
    });

    expect(result).toBeNull();
  });

  it('returns error from the first failed assistant message', async () => {
    mockListMessages.mockResolvedValue({
      page: [
        {
          message: { role: 'assistant', content: 'partial response' },
          error: 'Rate limit exceeded',
        },
      ],
    });

    const result = await getMessageError(createMockCtx(), {
      threadId: 'thread_1',
    });

    expect(result).toBe('Rate limit exceeded');
  });

  it('skips failed messages without error field', async () => {
    mockListMessages.mockResolvedValue({
      page: [
        {
          message: { role: 'assistant', content: 'partial' },
          error: undefined,
        },
        {
          message: { role: 'assistant', content: 'other partial' },
          error: 'Connection timeout',
        },
      ],
    });

    const result = await getMessageError(createMockCtx(), {
      threadId: 'thread_1',
    });

    expect(result).toBe('Connection timeout');
  });

  it('skips non-assistant failed messages', async () => {
    mockListMessages.mockResolvedValue({
      page: [
        {
          message: { role: 'user', content: 'hello' },
          error: 'Some user error',
        },
        {
          message: { role: 'assistant', content: 'response' },
          error: 'Assistant error',
        },
      ],
    });

    const result = await getMessageError(createMockCtx(), {
      threadId: 'thread_1',
    });

    expect(result).toBe('Assistant error');
  });

  it('queries with correct parameters', async () => {
    await getMessageError(createMockCtx(), { threadId: 'thread_42' });

    expect(mockListMessages).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        threadId: 'thread_42',
        paginationOpts: { cursor: null, numItems: 5 },
        statuses: ['failed'],
      },
    );
  });
});
