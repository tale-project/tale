import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockListMessages = vi.fn();
const mockSaveMessage = vi.fn();
vi.mock('@convex-dev/agent', () => ({
  listMessages: (...args: unknown[]) => mockListMessages(...args),
  saveMessage: (...args: unknown[]) => mockSaveMessage(...args),
}));

vi.mock('../../_generated/api', () => ({
  components: {
    agent: { threads: { getThread: 'mock-getThread' } },
    persistentTextStreaming: {
      lib: { getStreamStatus: 'mock-getStreamStatus' },
    },
    betterAuth: {
      adapter: { findMany: 'mock-betterAuth-findMany' },
    },
  },
  internal: {
    lib: {
      agent_chat: {
        internal_actions: { runAgentGeneration: 'mock-runAgentGeneration' },
      },
    },
    threads: {
      generate_thread_title: {
        generateThreadTitle: 'mock-generateThreadTitle',
      },
    },
  },
}));

vi.mock('../../streaming/helpers', () => ({
  persistentStreaming: {
    createStream: vi.fn().mockResolvedValue('new-stream-id'),
  },
}));

vi.mock('../context_management/constants', () => ({
  AGENT_CONTEXT_CONFIGS: {},
}));

vi.mock('../debug_log', () => ({
  createDebugLog: () => () => {},
}));

vi.mock('../../governance/budget_enforcement', () => ({
  checkBudget: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock('../../governance/feature_enforcement', () => ({
  resolveFeatureFlags: vi.fn().mockResolvedValue({
    webSearch: true,
    codeExecution: true,
    fileUpload: true,
  }),
}));

vi.mock('../get_user_teams', () => ({
  getUserTeamIds: vi.fn().mockResolvedValue([]),
}));

vi.mock('../message_deduplication', () => ({
  computeDeduplicationState: () => ({
    lastUserMessage: null,
    messageAlreadyExists: false,
    trimmedMessage: 'hello',
  }),
}));

const { resolveFeatureFlags } =
  await import('../../governance/feature_enforcement');
const mockedResolveFeatureFlags = vi.mocked(resolveFeatureFlags);

const { startAgentChat } = await import('./start_agent_chat');

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
    runQuery: vi.fn().mockImplementation((queryRef: string) => {
      // betterAuth adapter queries (getUserTeamIds + resolveBudgetContext)
      if (queryRef === 'mock-betterAuth-findMany') {
        return Promise.resolve({ page: [], isDone: true });
      }
      // getThread query returns thread data with userId
      return Promise.resolve({ userId: 'user_1' });
    }),
    scheduler: {
      runAfter: vi.fn(),
    },
    storage: {
      getUrl: vi.fn(),
    },
    auth: {
      getUserIdentity: vi.fn().mockResolvedValue(null),
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
      updatedAt: expect.any(Number),
      generationStatus: 'generating',
      streamId: 'new-stream-id',
    });
  });
});

describe('startAgentChat — feature flag enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListMessages.mockResolvedValue({ page: [] });
    mockSaveMessage.mockResolvedValue({ messageId: 'msg_1' });
  });

  it('forwards maxContextTokens to scheduled generation when set', async () => {
    mockedResolveFeatureFlags.mockResolvedValueOnce({
      webSearch: true,
      codeExecution: true,
      fileUpload: true,
      maxContextTokens: 4096,
    });

    const ctx = createMockCtx({
      _id: 'meta_1',
      generationStatus: 'idle',
    });

    await startAgentChat(createDefaultArgs(ctx));

    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      expect.any(Number),
      'mock-runAgentGeneration',
      expect.objectContaining({ maxContextTokens: 4096 }),
    );
  });

  it('removes web tool and sets webSearchMode off when webSearch is disabled', async () => {
    mockedResolveFeatureFlags.mockResolvedValueOnce({
      webSearch: false,
      codeExecution: true,
      fileUpload: true,
    });

    const ctx = createMockCtx({
      _id: 'meta_1',
      generationStatus: 'idle',
    });

    const args = {
      ...createDefaultArgs(ctx),
      agentConfig: {
        name: 'test-agent',
        instructions: 'test',
        maxSteps: 5,
        webSearchMode: 'tool' as const,
        convexToolNames: ['web', 'rag_search'] as never[],
      },
    };

    await startAgentChat(args);

    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      expect.any(Number),
      'mock-runAgentGeneration',
      expect.objectContaining({
        agentConfig: expect.objectContaining({
          webSearchMode: 'off',
          convexToolNames: ['rag_search'],
        }),
      }),
    );
  });

  it('blocks file upload with assistant message when fileUpload is disabled', async () => {
    mockedResolveFeatureFlags.mockResolvedValueOnce({
      webSearch: true,
      codeExecution: true,
      fileUpload: false,
    });

    const ctx = createMockCtx({
      _id: 'meta_1',
      generationStatus: 'idle',
    });

    const args = {
      ...createDefaultArgs(ctx),
      attachments: [
        {
          fileId: 'file_1' as never,
          fileName: 'test.pdf',
          fileType: 'application/pdf',
          fileSize: 1024,
        },
      ],
    };

    const result = await startAgentChat(args);

    expect(result.streamId).toBe('new-stream-id');
    expect(mockSaveMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        message: expect.objectContaining({
          role: 'assistant',
          content: expect.stringContaining('File uploads are disabled'),
        }),
      }),
    );
    expect(ctx.db.patch).toHaveBeenCalledWith(
      'meta_1',
      expect.objectContaining({
        generationStatus: 'idle',
      }),
    );
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it('allows request without attachments when fileUpload is disabled', async () => {
    mockedResolveFeatureFlags.mockResolvedValueOnce({
      webSearch: true,
      codeExecution: true,
      fileUpload: false,
    });

    const ctx = createMockCtx({
      _id: 'meta_1',
      generationStatus: 'idle',
    });

    await startAgentChat(createDefaultArgs(ctx));

    expect(ctx.scheduler.runAfter).toHaveBeenCalled();
  });
});
