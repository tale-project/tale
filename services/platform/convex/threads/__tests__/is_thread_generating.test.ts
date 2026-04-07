import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

function createMockCtx(
  threadMeta?: {
    generationStatus?: string;
    generationStartTime?: number;
  } | null,
) {
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
    vi.useFakeTimers();
    mockGetAuthUserIdentity.mockResolvedValue({ userId: 'user_1' });
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('returns true when generationStatus is generating and within time limit', async () => {
    const now = Date.now();
    const result = await isThreadGenerating(
      createMockCtx({
        generationStatus: 'generating',
        generationStartTime: now - 5000,
      }),
      { threadId: 'thread_1' },
    );
    expect(result).toBe(true);
  });

  it('returns true when generationStatus is generating without generationStartTime', async () => {
    const result = await isThreadGenerating(
      createMockCtx({ generationStatus: 'generating' }),
      { threadId: 'thread_1' },
    );
    expect(result).toBe(true);
  });

  it('returns false when generationStatus is generating but stale (>10 minutes)', async () => {
    const now = Date.now();
    const elevenMinutesAgo = now - 11 * 60 * 1000;
    const result = await isThreadGenerating(
      createMockCtx({
        generationStatus: 'generating',
        generationStartTime: elevenMinutesAgo,
      }),
      { threadId: 'thread_1' },
    );
    expect(result).toBe(false);
  });

  it('returns true when generationStatus is generating at exactly 10 minutes', async () => {
    const now = Date.now();
    const tenMinutesAgo = now - 10 * 60 * 1000;
    const result = await isThreadGenerating(
      createMockCtx({
        generationStatus: 'generating',
        generationStartTime: tenMinutesAgo,
      }),
      { threadId: 'thread_1' },
    );
    expect(result).toBe(true);
  });
});
