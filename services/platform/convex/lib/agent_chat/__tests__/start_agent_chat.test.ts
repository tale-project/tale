import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockListMessages = vi.fn();
const mockSaveMessage = vi.fn();
vi.mock('@convex-dev/agent', () => ({
  listMessages: (...args: unknown[]) => mockListMessages(...args),
  saveMessage: (...args: unknown[]) => mockSaveMessage(...args),
}));

vi.mock('../../../_generated/api', () => ({
  components: {
    agent: { threads: { getThread: 'mock-getThread' } },
    persistentTextStreaming: {
      lib: { getStreamStatus: 'mock-getStreamStatus' },
    },
  },
  internal: {
    lib: {
      agent_chat: {
        internal_actions: { runAgentGeneration: 'mock-runAgentGeneration' },
      },
    },
  },
}));

vi.mock('../../../streaming/helpers', () => ({
  persistentStreaming: {
    createStream: vi.fn().mockResolvedValue('new-stream-id'),
  },
}));

vi.mock('../../context_management/constants', () => ({
  AGENT_CONTEXT_CONFIGS: {},
}));

vi.mock('../../debug_log', () => ({
  createDebugLog: () => () => {},
}));

vi.mock('../../message_deduplication', () => ({
  computeDeduplicationState: () => ({
    lastUserMessage: null,
    messageAlreadyExists: false,
    trimmedMessage: 'hello',
  }),
}));

const { startAgentChat } = await import('../start_agent_chat');

function createMockCtx(
  threadMeta: {
    _id: string;
    generationStatus?: string;
    streamId?: string;
  } | null = null,
) {
  return {
    db: {
      query: () => ({
        withIndex: () => ({
          first: vi.fn().mockResolvedValue(threadMeta),
        }),
      }),
      patch: vi.fn(),
    },
    runQuery: vi.fn().mockResolvedValue({ userId: 'user_1' }),
    scheduler: {
      runAfter: vi.fn(),
    },
    storage: {
      getUrl: vi.fn(),
    },
  };
}

function createDefaultArgs(ctx: ReturnType<typeof createMockCtx>) {
  return {
    ctx: ctx as never,
    agentType: 'writer' as never,
    threadId: 'thread_1',
    organizationId: 'org_1',
    message: 'hello',
    agentConfig: { name: 'test-agent', instructions: 'test', maxSteps: 5 },
    model: 'gpt-4',
    provider: 'openai',
    debugTag: 'test',
    enableStreaming: true,
  };
}

describe('startAgentChat — concurrent generation guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListMessages.mockResolvedValue({
      page: [],
    });
    mockSaveMessage.mockResolvedValue({ messageId: 'msg_1' });
  });

  it('does not throw when generationStatus is idle', async () => {
    const ctx = createMockCtx({
      _id: 'meta_1',
      generationStatus: 'idle',
      streamId: undefined,
    });

    const result = await startAgentChat(createDefaultArgs(ctx));
    expect(result.streamId).toBe('new-stream-id');
  });

  it('does not throw when generationStatus is undefined', async () => {
    const ctx = createMockCtx({
      _id: 'meta_1',
      generationStatus: undefined,
      streamId: undefined,
    });

    const result = await startAgentChat(createDefaultArgs(ctx));
    expect(result.streamId).toBe('new-stream-id');
  });

  it('does not throw when no threadMetadata exists', async () => {
    const ctx = createMockCtx(null);

    const result = await startAgentChat(createDefaultArgs(ctx));
    expect(result.streamId).toBe('new-stream-id');
  });

  it('patches generationStatus and streamId when thread is idle', async () => {
    const ctx = createMockCtx({
      _id: 'meta_1',
      generationStatus: 'idle',
      streamId: undefined,
    });

    await startAgentChat(createDefaultArgs(ctx));

    expect(ctx.db.patch).toHaveBeenCalledWith('meta_1', {
      cancelledAt: undefined,
      cancelledMessageId: undefined,
      generationStartTime: expect.any(Number),
      generationStatus: 'generating',
      streamId: 'new-stream-id',
    });
  });
});
