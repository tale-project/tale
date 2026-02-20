import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  components: { agent: 'mock-agent-component' },
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

vi.mock('../../rag_prefetch', () => ({
  startRagPrefetch: vi.fn(),
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
    runQuery: vi.fn(),
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
    userTeamIds: undefined,
    deadlineMs: undefined,
    ...overrides,
  };
}

describe('generateAgentResponse error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saves a failed assistant message when an error occurs', async () => {
    const ctx = createMockCtx();
    const testError = new Error('Model API unavailable');

    mockBuildStructuredContext.mockRejectedValueOnce(testError);

    await expect(
      generateAgentResponse(createMockConfig(), createMockArgs(ctx)),
    ).rejects.toThrow('Model API unavailable');

    expect(mockSaveMessage).toHaveBeenCalledOnce();
    expect(mockSaveMessage).toHaveBeenCalledWith(ctx, 'mock-agent-component', {
      threadId: 'thread_123',
      message: {
        role: 'assistant',
        content: 'I was unable to complete your request. Please try again.',
      },
      metadata: {
        status: 'failed',
        error: 'Model API unavailable',
      },
    });
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
      'mock-agent-component',
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
      'mock-agent-component',
      expect.objectContaining({
        metadata: expect.objectContaining({
          status: 'failed',
          error: 'string error',
        }),
      }),
    );
  });
});
