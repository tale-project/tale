import { describe, it, expect, vi } from 'vitest';

const mockEstimateContextSize = vi.fn();
vi.mock('./estimate_context_size', () => ({
  estimateContextSize: (...args: unknown[]) => mockEstimateContextSize(...args),
}));

vi.mock('../debug_log', () => ({
  createDebugLog: () => () => {},
}));

const { checkAndSummarizeIfNeeded } = await import('./check_and_summarize');

const mockCtx = {} as never;

describe('checkAndSummarizeIfNeeded — maxContextTokens', () => {
  it('uses default model context limit when maxContextTokens is not set', async () => {
    mockEstimateContextSize.mockResolvedValue({
      totalTokens: 50000,
      usagePercent: 39.1,
    });

    const result = await checkAndSummarizeIfNeeded(mockCtx, {
      threadId: 'thread_1',
      contextMessagesTokens: 5000,
      currentPromptTokens: 100,
      existingSummary: undefined,
    });

    expect(mockEstimateContextSize).toHaveBeenCalledWith(
      mockCtx,
      expect.objectContaining({
        modelContextLimit: 128000,
      }),
    );
    expect(result.estimate.needsSummarization).toBe(false);
  });

  it('uses governance limit when lower than model limit', async () => {
    mockEstimateContextSize.mockResolvedValue({
      totalTokens: 6000,
      usagePercent: 75.0,
    });

    await checkAndSummarizeIfNeeded(mockCtx, {
      threadId: 'thread_1',
      contextMessagesTokens: 5000,
      currentPromptTokens: 100,
      existingSummary: undefined,
      modelContextLimit: 128000,
      maxContextTokens: 8192,
    });

    expect(mockEstimateContextSize).toHaveBeenCalledWith(
      mockCtx,
      expect.objectContaining({
        modelContextLimit: 8192,
      }),
    );
  });

  it('uses model limit when governance limit is higher', async () => {
    mockEstimateContextSize.mockResolvedValue({
      totalTokens: 50000,
      usagePercent: 39.1,
    });

    await checkAndSummarizeIfNeeded(mockCtx, {
      threadId: 'thread_1',
      contextMessagesTokens: 5000,
      currentPromptTokens: 100,
      existingSummary: undefined,
      modelContextLimit: 32000,
      maxContextTokens: 128000,
    });

    expect(mockEstimateContextSize).toHaveBeenCalledWith(
      mockCtx,
      expect.objectContaining({
        modelContextLimit: 32000,
      }),
    );
  });

  it('triggers summarization earlier with low governance limit', async () => {
    mockEstimateContextSize.mockResolvedValue({
      totalTokens: 6000,
      usagePercent: 73.2,
    });

    const result = await checkAndSummarizeIfNeeded(mockCtx, {
      threadId: 'thread_1',
      contextMessagesTokens: 5000,
      currentPromptTokens: 100,
      existingSummary: undefined,
      modelContextLimit: 128000,
      maxContextTokens: 8192,
    });

    // 6000 / 8192 = 0.732 which exceeds SUMMARIZATION_THRESHOLD (0.65)
    expect(result.estimate.needsSummarization).toBe(true);
  });
});
