import { describe, it, expect, vi, beforeEach } from 'vitest';

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

function createMockCtx(threadMeta?: { generationStatus?: string }) {
  return {
    db: {
      query: () => ({
        withIndex: () => ({
          first: vi.fn().mockResolvedValue(threadMeta ?? null),
        }),
      }),
    },
  };
}

describe('isThreadGenerating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUserIdentity.mockResolvedValue({ userId: 'user_1' });
  });

  it('returns false when user is not authenticated', async () => {
    mockGetAuthUserIdentity.mockResolvedValue(null);
    const result = await isThreadGenerating(
      createMockCtx({ generationStatus: 'generating' }),
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
      createMockCtx({ generationStatus: 'idle' }),
      { threadId: 'thread_1' },
    );
    expect(result).toBe(false);
  });

  it('returns false when generationStatus is undefined', async () => {
    const result = await isThreadGenerating(
      createMockCtx({ generationStatus: undefined }),
      { threadId: 'thread_1' },
    );
    expect(result).toBe(false);
  });

  it('returns true when generationStatus is generating', async () => {
    const result = await isThreadGenerating(
      createMockCtx({ generationStatus: 'generating' }),
      { threadId: 'thread_1' },
    );
    expect(result).toBe(true);
  });
});
