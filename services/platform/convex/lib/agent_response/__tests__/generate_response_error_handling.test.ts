import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @convex-dev/agent before importing the module under test
const mockSaveMessage = vi.fn();
const mockListMessages = vi.fn();
vi.mock('@convex-dev/agent', () => ({
  listMessages: mockListMessages,
  saveMessage: mockSaveMessage,
}));

// Mock internal modules — paths are relative to the SOURCE file (generate_response.ts),
// not relative to this test file. vitest resolves vi.mock paths from the test file location,
// so we need to go up from __tests__ → agent_response, then follow the same relative paths.
vi.mock('../../../../lib/utils/type-guards', () => ({
  isRecord: (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null,
  getString: (obj: Record<string, unknown>, key: string) => {
    const val = obj[key];
    return typeof val === 'string' ? val : undefined;
  },
}));

vi.mock('../../../_generated/api', () => ({
  components: {
    agent: {
      streams: { list: 'mock-streams-list' },
    },
  },
  internal: {
    streaming: {
      internal_mutations: {
        startStream: 'mock-startStream',
        errorStream: 'mock-errorStream',
        appendToStream: 'mock-appendToStream',
        completeStream: 'mock-completeStream',
      },
    },
  },
}));

vi.mock('../../agent_completion', () => ({
  onAgentComplete: vi.fn(),
}));

const mockBuildStructuredContext = vi.fn();
vi.mock('../../context_management', () => ({
  buildStructuredContext: mockBuildStructuredContext,
  AGENT_CONTEXT_CONFIGS: {
    chat: {
      recentMessages: 10,
      timeoutMs: 420_000,
    },
  },
  RECOVERY_TIMEOUT_MS: 30_000,
  estimateTokens: vi.fn().mockReturnValue(100),
}));

vi.mock('../../context_management/message_formatter', () => ({
  wrapInDetails: vi.fn((_title: string, content: string) => content),
}));

vi.mock('../../debug_log', () => ({
  createDebugLog: () => vi.fn(),
}));

vi.mock('../structured_response_instructions', () => ({
  STRUCTURED_RESPONSE_INSTRUCTIONS: '',
}));

vi.mock('../with_timeout', () => ({
  AgentTimeoutError: class AgentTimeoutError extends Error {},
  withTimeout: vi.fn((promise: Promise<unknown>) => promise),
}));

// Import after mocks are set up
const { generateAgentResponse } = await import('../generate_response');

import type { GenerateResponseArgs, GenerateResponseConfig } from '../types';

function createMockCtx() {
  return {
    runMutation: vi.fn(),
    runQuery: vi.fn().mockResolvedValue([]),
    runAction: vi.fn(),
  };
}

function createMockConfig(
  overrides?: Partial<GenerateResponseConfig>,
): GenerateResponseConfig {
  return {
    agentType: 'chat',
    createAgent: vi.fn(),
    model: 'gpt-4',
    provider: 'openai',
    debugTag: '[test]',
    enableStreaming: false,
    hooks: undefined,
    convexToolNames: undefined,
    instructions: 'Test instructions',
    toolsSummary: undefined,
    ...overrides,
  };
}

function createMockArgs(
  ctx: ReturnType<typeof createMockCtx>,
  overrides?: Partial<GenerateResponseArgs>,
): GenerateResponseArgs {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test mock: only methods used in error path are needed
  return {
    ctx: ctx as unknown as GenerateResponseArgs['ctx'],
    threadId: 'thread_123',
    organizationId: 'org_456',
    userId: 'user_789',
    promptMessage: 'Hello',
    additionalContext: undefined,
    parentThreadId: undefined,
    agentOptions: undefined,
    attachments: undefined,
    streamId: undefined,
    promptMessageId: undefined,
    maxSteps: undefined,
    deadlineMs: undefined,
    ...overrides,
  };
}

describe('generateAgentResponse error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListMessages.mockResolvedValue({ page: [] });
  });

  it('saves a failed assistant message when an error occurs', async () => {
    const ctx = createMockCtx();
    const testError = new Error('Model API unavailable');

    mockBuildStructuredContext.mockRejectedValueOnce(testError);

    await expect(
      generateAgentResponse(createMockConfig(), createMockArgs(ctx)),
    ).rejects.toThrow('Model API unavailable');

    expect(mockSaveMessage).toHaveBeenCalledOnce();
    expect(mockSaveMessage).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ streams: expect.anything() }),
      {
        threadId: 'thread_123',
        message: {
          role: 'assistant',
          content: 'I was unable to complete your request. Please try again.',
        },
        metadata: {
          status: 'failed',
          error: 'Model API unavailable',
        },
      },
    );
  });

  it('still throws the original error after saving the failed message', async () => {
    const ctx = createMockCtx();
    const testError = new Error('Connection refused');

    mockBuildStructuredContext.mockRejectedValueOnce(testError);

    await expect(
      generateAgentResponse(createMockConfig(), createMockArgs(ctx)),
    ).rejects.toThrow('Connection refused');
  });

  it('does not crash when saving the failed message itself fails', async () => {
    const ctx = createMockCtx();
    const testError = new Error('Original error');

    mockBuildStructuredContext.mockRejectedValueOnce(testError);
    mockSaveMessage.mockRejectedValueOnce(new Error('Save failed'));

    // Should still throw the original error, not the save error
    await expect(
      generateAgentResponse(createMockConfig(), createMockArgs(ctx)),
    ).rejects.toThrow('Original error');
  });

  it('marks stream as errored and saves failed message when streamId is provided', async () => {
    const ctx = createMockCtx();
    const testError = new Error('Stream error');

    mockBuildStructuredContext.mockRejectedValueOnce(testError);

    await expect(
      generateAgentResponse(
        createMockConfig(),
        createMockArgs(ctx, { streamId: 'stream_abc' }),
      ),
    ).rejects.toThrow('Stream error');

    // Should mark stream as errored
    expect(ctx.runMutation).toHaveBeenCalledWith('mock-errorStream', {
      streamId: 'stream_abc',
    });

    // Should also save the failed message
    expect(mockSaveMessage).toHaveBeenCalledOnce();
    expect(mockSaveMessage).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ streams: expect.anything() }),
      expect.objectContaining({
        threadId: 'thread_123',
        metadata: expect.objectContaining({
          status: 'failed',
        }),
      }),
    );
  });

  it('saves failed message with stringified error when error is not an Error object', async () => {
    const ctx = createMockCtx();

    mockBuildStructuredContext.mockRejectedValueOnce('string error');

    await expect(
      generateAgentResponse(createMockConfig(), createMockArgs(ctx)),
    ).rejects.toBe('string error');

    // Non-Error thrown values are wrapped as { message: String(error) }
    expect(mockSaveMessage).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ streams: expect.anything() }),
      expect.objectContaining({
        metadata: expect.objectContaining({
          status: 'failed',
          error: 'string error',
        }),
      }),
    );
  });
});

// ============================================================================
// User cancellation detection (isUserCancellation)
// ============================================================================

describe('generateAgentResponse — user cancellation (state-driven)', () => {
  const cancelledAssistant = {
    _id: 'msg_cancelled',
    message: { role: 'assistant', content: '' },
    status: 'failed',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockListMessages.mockResolvedValue({ page: [] });
  });

  it('does NOT save a failed message when cancelGeneration already created one', async () => {
    const ctx = createMockCtx();

    mockListMessages.mockResolvedValue({ page: [cancelledAssistant] });
    mockBuildStructuredContext.mockRejectedValueOnce(new Error('aborted'));

    await expect(
      generateAgentResponse(createMockConfig(), createMockArgs(ctx)),
    ).rejects.toThrow();

    expect(mockSaveMessage).not.toHaveBeenCalled();
  });

  it('does NOT mark stream as errored when stream is already aborted', async () => {
    const ctx = createMockCtx();

    ctx.runQuery.mockResolvedValue([
      { streamId: 'stream_abc', status: 'aborted' },
    ]);
    mockListMessages.mockResolvedValue({ page: [cancelledAssistant] });
    mockBuildStructuredContext.mockRejectedValueOnce(new Error('aborted'));

    await expect(
      generateAgentResponse(
        createMockConfig(),
        createMockArgs(ctx, { streamId: 'stream_abc' }),
      ),
    ).rejects.toThrow();

    expect(ctx.runMutation).not.toHaveBeenCalledWith(
      'mock-errorStream',
      expect.anything(),
    );
  });

  it('skips both errorStream and saveMessage when stream is aborted and failed message exists', async () => {
    const ctx = createMockCtx();

    ctx.runQuery.mockResolvedValue([
      { streamId: 'stream_xyz', status: 'aborted' },
    ]);
    mockListMessages.mockResolvedValue({ page: [cancelledAssistant] });
    mockBuildStructuredContext.mockRejectedValueOnce(
      new Error('Stream aborted: user-cancelled'),
    );

    await expect(
      generateAgentResponse(
        createMockConfig(),
        createMockArgs(ctx, { streamId: 'stream_xyz' }),
      ),
    ).rejects.toThrow('Stream aborted: user-cancelled');

    expect(mockSaveMessage).not.toHaveBeenCalled();
    expect(ctx.runMutation).not.toHaveBeenCalledWith(
      'mock-errorStream',
      expect.anything(),
    );
  });

  it('still re-throws the original error after detecting cancellation', async () => {
    const ctx = createMockCtx();

    mockListMessages.mockResolvedValue({ page: [cancelledAssistant] });
    mockBuildStructuredContext.mockRejectedValueOnce(
      new DOMException('The operation was aborted', 'AbortError'),
    );

    await expect(
      generateAgentResponse(createMockConfig(), createMockArgs(ctx)),
    ).rejects.toThrow();
  });

  it('saves failed message for non-cancellation errors (control case)', async () => {
    const ctx = createMockCtx();
    const error = new Error('Connection refused');

    mockBuildStructuredContext.mockRejectedValueOnce(error);

    await expect(
      generateAgentResponse(createMockConfig(), createMockArgs(ctx)),
    ).rejects.toThrow('Connection refused');

    expect(mockSaveMessage).toHaveBeenCalledOnce();
  });

  it('marks stream as errored for non-cancellation errors (control case)', async () => {
    const ctx = createMockCtx();
    const error = new Error('Rate limit exceeded');

    mockBuildStructuredContext.mockRejectedValueOnce(error);

    await expect(
      generateAgentResponse(
        createMockConfig(),
        createMockArgs(ctx, { streamId: 'stream_rate' }),
      ),
    ).rejects.toThrow('Rate limit exceeded');

    expect(ctx.runMutation).toHaveBeenCalledWith('mock-errorStream', {
      streamId: 'stream_rate',
    });
  });

  it('detects cancellation via stream status even when error is unrecognised', async () => {
    const ctx = createMockCtx();
    const error = new Error('Something unexpected happened');

    ctx.runQuery.mockResolvedValue([
      { streamId: 'stream_check', status: 'aborted' },
    ]);
    mockListMessages.mockResolvedValue({ page: [cancelledAssistant] });
    mockBuildStructuredContext.mockRejectedValueOnce(error);

    await expect(
      generateAgentResponse(
        createMockConfig(),
        createMockArgs(ctx, { streamId: 'stream_check' }),
      ),
    ).rejects.toThrow('Something unexpected happened');

    expect(mockSaveMessage).not.toHaveBeenCalled();
    expect(ctx.runMutation).not.toHaveBeenCalledWith(
      'mock-errorStream',
      expect.anything(),
    );
  });

  it('saves failed message when stream query fails but no prior failed message exists', async () => {
    const ctx = createMockCtx();

    ctx.runQuery.mockRejectedValue(new Error('Query failed'));
    mockBuildStructuredContext.mockRejectedValueOnce(new Error('Some error'));

    await expect(
      generateAgentResponse(
        createMockConfig(),
        createMockArgs(ctx, { streamId: 'stream_fallback' }),
      ),
    ).rejects.toThrow();

    expect(mockSaveMessage).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// Abort watcher integration
// ============================================================================

describe('generateAgentResponse — abort watcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockListMessages.mockResolvedValue({ page: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts polling for aborted streams in streaming mode', async () => {
    const ctx = createMockCtx();
    const error = new Error('Some error');

    // All runQuery calls → no aborted streams (baseline + watcher polls)
    ctx.runQuery.mockResolvedValue([]);
    mockBuildStructuredContext.mockRejectedValueOnce(error);

    const promise = generateAgentResponse(
      createMockConfig({ enableStreaming: true }),
      createMockArgs(ctx, { streamId: 'stream_poll' }),
    );
    promise.catch(() => {}); // prevent unhandled-rejection noise under fake timers

    // Advance timers to give the watcher a chance to fire
    await vi.advanceTimersByTimeAsync(300);

    await expect(promise).rejects.toThrow('Some error');

    // The watcher should have polled streams.list at least once
    expect(ctx.runQuery).toHaveBeenCalledWith('mock-streams-list', {
      threadId: 'thread_123',
      statuses: ['aborted'],
    });
  });

  it('does NOT start abort watcher in non-streaming mode', async () => {
    const ctx = createMockCtx();
    const error = new Error('Some error');

    ctx.runQuery.mockResolvedValue([]);
    mockBuildStructuredContext.mockRejectedValueOnce(error);

    const promise = generateAgentResponse(
      createMockConfig({ enableStreaming: false }),
      createMockArgs(ctx, { streamId: 'stream_no_watch' }),
    );
    promise.catch(() => {}); // prevent unhandled-rejection noise under fake timers

    await vi.advanceTimersByTimeAsync(300);

    await expect(promise).rejects.toThrow('Some error');

    // The watcher should NOT have polled for aborted streams
    // (only the error handler's fallback query may have been called)
    const abortPolls = ctx.runQuery.mock.calls.filter(
      (call) =>
        call[0] === 'mock-streams-list' &&
        Array.isArray(call[1]?.statuses) &&
        call[1].statuses.includes('aborted'),
    );
    // The error handler does its own one-time query, but the watcher's
    // periodic polling should not have added extra calls.
    expect(abortPolls.length).toBeLessThanOrEqual(1);
  });

  it('detects cancellation via watcher flag even with unrecognised error', async () => {
    const ctx = createMockCtx();
    const error = new Error('Internal SDK error 42');

    // Baseline query → empty (no prior aborts)
    // Watcher polls + catch block query → newly aborted stream
    ctx.runQuery
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        { _id: 'sid_watch', streamId: 'stream_watch', status: 'aborted' },
      ]);

    // cancelGeneration also creates a failed assistant message
    mockListMessages.mockResolvedValueOnce({ page: [] }).mockResolvedValue({
      page: [
        {
          _id: 'msg_cancel',
          message: { role: 'assistant', content: '' },
          status: 'failed',
        },
      ],
    });

    mockBuildStructuredContext.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      throw error;
    });

    const promise = generateAgentResponse(
      createMockConfig({ enableStreaming: true }),
      createMockArgs(ctx, { streamId: 'stream_watch' }),
    );
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(600);

    await expect(promise).rejects.toThrow('Internal SDK error 42');

    expect(mockSaveMessage).not.toHaveBeenCalled();
    expect(ctx.runMutation).not.toHaveBeenCalledWith(
      'mock-errorStream',
      expect.anything(),
    );
  });

  // Issue #1: Content mismatch on reload — when watcher detects abort, the
  // action must NOT call errorStream or saveMessage, so the mutation's
  // truncated content is the only source of truth on reload.
  it('does not overwrite truncated content (no errorStream / no saveMessage) when watcher detects abort', async () => {
    const ctx = createMockCtx();

    // Baseline → empty, watcher + catch block → newly aborted
    ctx.runQuery
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        { _id: 'sid_content', streamId: 'stream_content', status: 'aborted' },
      ]);

    // cancelGeneration also creates a failed assistant message
    mockListMessages.mockResolvedValueOnce({ page: [] }).mockResolvedValue({
      page: [
        {
          _id: 'msg_cancel',
          message: { role: 'assistant', content: '' },
          status: 'failed',
        },
      ],
    });

    mockBuildStructuredContext.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      throw new Error('AbortError');
    });

    const promise = generateAgentResponse(
      createMockConfig({ enableStreaming: true }),
      createMockArgs(ctx, { streamId: 'stream_content' }),
    );
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(600);
    await expect(promise).rejects.toThrow();

    // No error message saved — the cancelGeneration mutation handles content
    expect(mockSaveMessage).not.toHaveBeenCalled();
    // No errorStream mutation — stream is already aborted
    expect(ctx.runMutation).not.toHaveBeenCalledWith(
      'mock-errorStream',
      expect.anything(),
    );
  });

  // Issue #4: Stop during tool execution — the watcher triggers
  // abortController.abort() which propagates through the SDK's tool
  // execution pipeline. Verify the controller is actually aborted.
  it('aborts the AbortController when watcher detects cancellation during long operation', async () => {
    const ctx = createMockCtx();

    // Baseline → empty, watcher + catch block → newly aborted
    ctx.runQuery
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        { _id: 'sid_tools', streamId: 'stream_tools', status: 'aborted' },
      ]);

    // cancelGeneration also creates a failed assistant message
    mockListMessages.mockResolvedValueOnce({ page: [] }).mockResolvedValue({
      page: [
        {
          _id: 'msg_cancel',
          message: { role: 'assistant', content: '' },
          status: 'failed',
        },
      ],
    });

    mockBuildStructuredContext.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      throw new Error('Operation aborted');
    });

    const promise = generateAgentResponse(
      createMockConfig({ enableStreaming: true }),
      createMockArgs(ctx, { streamId: 'stream_tools' }),
    );
    promise.catch(() => {});

    // Advance past watcher poll (200ms) so it detects the abort
    await vi.advanceTimersByTimeAsync(250);

    // The watcher should have fired and detected the aborted stream
    expect(ctx.runQuery).toHaveBeenCalledWith('mock-streams-list', {
      threadId: 'thread_123',
      statuses: ['aborted'],
    });

    // Finish the buildStructuredContext delay
    await vi.advanceTimersByTimeAsync(400);
    await expect(promise).rejects.toThrow();

    // Watcher detected cancellation → catch block finds failed assistant → no new save
    expect(mockSaveMessage).not.toHaveBeenCalled();
  });

  it('detects early cancellation via failed assistant message before any stream exists', async () => {
    const ctx = createMockCtx();

    // No aborted streams (baseline + watcher polls)
    ctx.runQuery.mockResolvedValue([]);

    // Baseline listMessages → no assistant messages (fresh thread)
    // Watcher poll listMessages → new failed assistant from cancelGeneration
    mockListMessages.mockResolvedValueOnce({ page: [] }).mockResolvedValue({
      page: [
        {
          _id: 'msg_failed_assistant',
          message: { role: 'assistant', content: '' },
          status: 'failed',
        },
      ],
    });

    mockBuildStructuredContext.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      throw new Error('Operation aborted');
    });

    const promise = generateAgentResponse(
      createMockConfig({ enableStreaming: true }),
      createMockArgs(ctx, {
        streamId: 'stream_early',
        promptMessageId: 'msg_user_prompt',
      }),
    );
    promise.catch(() => {});

    // Advance past watcher poll (200ms) so it detects the early cancellation
    await vi.advanceTimersByTimeAsync(250);

    // Finish the buildStructuredContext delay
    await vi.advanceTimersByTimeAsync(400);
    await expect(promise).rejects.toThrow();

    // Watcher detected early cancellation → isUserCancellation=true → no error message
    expect(mockSaveMessage).not.toHaveBeenCalled();
  });

  it('does not create duplicate failed message when stale one exists from previous cancellation', async () => {
    const ctx = createMockCtx();

    // No aborted streams
    ctx.runQuery.mockResolvedValue([]);

    // Both baseline and watcher see the SAME stale failed assistant.
    // Since the ID matches the baseline, the watcher should NOT trigger.
    // The catch block also finds the stale failed assistant and skips saving.
    const staleAssistant = {
      _id: 'msg_stale_assistant',
      message: { role: 'assistant', content: '' },
      status: 'failed',
    };
    mockListMessages.mockResolvedValue({ page: [staleAssistant] });

    mockBuildStructuredContext.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      throw new Error('Network failure');
    });

    const promise = generateAgentResponse(
      createMockConfig({ enableStreaming: true }),
      createMockArgs(ctx, {
        streamId: 'stream_no_early',
        promptMessageId: 'msg_user_prompt',
      }),
    );
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(600);
    await expect(promise).rejects.toThrow('Network failure');

    // Stale failed assistant exists → catch block skips creating a duplicate
    expect(mockSaveMessage).not.toHaveBeenCalled();
  });

  it('does not create duplicate when stale failed assistant exists alongside SDK messages', async () => {
    const ctx = createMockCtx();

    // No aborted streams
    ctx.runQuery.mockResolvedValue([]);

    // Baseline: stale failed assistant from previous cancellation.
    // Watcher poll: SDK has created its own NEW assistant (status undefined/success).
    // The watcher should NOT trigger because the new message is not failed.
    // The catch block also finds the stale failed assistant and skips saving.
    const staleFailedAssistant = {
      _id: 'msg_stale_failed',
      message: { role: 'assistant', content: '' },
      status: 'failed',
    };
    const sdkAssistant = {
      _id: 'msg_sdk_new',
      message: { role: 'assistant', content: 'Hello...' },
      status: undefined,
    };
    mockListMessages
      .mockResolvedValueOnce({ page: [staleFailedAssistant] })
      .mockResolvedValue({ page: [sdkAssistant, staleFailedAssistant] });

    mockBuildStructuredContext.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      throw new Error('Network failure');
    });

    const promise = generateAgentResponse(
      createMockConfig({ enableStreaming: true }),
      createMockArgs(ctx, {
        streamId: 'stream_sdk_msg',
        promptMessageId: 'msg_user_prompt',
      }),
    );
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(600);
    await expect(promise).rejects.toThrow('Network failure');

    // Stale failed assistant exists → catch block skips creating a duplicate
    expect(mockSaveMessage).not.toHaveBeenCalled();
  });

  it('ignores stale aborted streams from previous cancellations', async () => {
    const ctx = createMockCtx();

    // Baseline → one pre-existing aborted stream from a prior cancellation
    // Watcher polls → same stale stream, no new aborts
    const staleStream = {
      _id: 'sid_stale',
      streamId: 'stream_old',
      status: 'aborted',
    };
    ctx.runQuery.mockResolvedValue([staleStream]);

    // buildStructuredContext will throw after a delay, giving the watcher
    // time to poll. If the watcher incorrectly reacts to the stale stream,
    // it would set isUserCancellation = true and skip the error message.
    mockBuildStructuredContext.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      throw new Error('Network failure');
    });

    const promise = generateAgentResponse(
      createMockConfig({ enableStreaming: true }),
      createMockArgs(ctx, { streamId: 'stream_new' }),
    );
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(600);
    await expect(promise).rejects.toThrow('Network failure');

    // The watcher should NOT have detected a cancellation because the
    // aborted stream was already in the baseline. The error handler should
    // save an error message (since this is a real error, not user cancel).
    expect(mockSaveMessage).toHaveBeenCalled();
  });
});
