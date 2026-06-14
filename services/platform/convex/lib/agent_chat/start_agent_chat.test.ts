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
    documents: {
      internal_queries: {
        verifyStorageIdsBelongToOrg: 'mock-verifyStorageIds',
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

const { startAgentChat, buildTitleSource, computeDeadlineMs } =
  await import('./start_agent_chat');

function createMockCtx(
  threadMeta: {
    _id: string;
    generationStatus?: string;
    streamId?: string;
    userId?: string;
  } | null = null,
) {
  return {
    db: {
      query: () => ({
        withIndex: () => ({
          // The real threadMetadata row always carries userId; startAgentChat
          // now reads it from here (not the agent-component getThread), so
          // inject a default so budget/feature-flag enforcement runs.
          first: vi
            .fn()
            .mockResolvedValue(
              threadMeta ? { userId: 'user_1', ...threadMeta } : null,
            ),
          // settleQueueOnTurnEnd sweeps the chat message queue by status via
          // `.withIndex(...).collect()`; no rows queued in these tests.
          collect: vi.fn().mockResolvedValue([]),
        }),
      }),
      patch: vi.fn(),
      delete: vi.fn(),
    },
    runQuery: vi.fn().mockImplementation((queryRef: string) => {
      // betterAuth adapter queries (getUserTeamIds + resolveBudgetContext)
      if (queryRef === 'mock-betterAuth-findMany') {
        return Promise.resolve({ page: [], isDone: true });
      }
      // Attachment org-ownership gate (verifyStorageIdsBelongToOrg) → owned.
      if (queryRef === 'mock-verifyStorageIds') {
        return Promise.resolve(true);
      }
      return Promise.resolve({ userId: 'user_1' });
    }),
    scheduler: {
      // Real Convex `scheduler.runAfter` returns a Promise<Id>; mirror that so
      // fire-and-forget callers (e.g. the thread-title schedule) can chain
      // `.catch(...)` without tripping on an undefined return.
      runAfter: vi.fn().mockResolvedValue('scheduled-fn-id'),
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

describe('startAgentChat — deferGeneration (Track B return path)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListMessages.mockResolvedValue({ page: [] });
    mockSaveMessage.mockResolvedValue({ messageId: 'msg_1' });
  });

  it('returns fully-populated generationArgs and does NOT schedule when deferGeneration is true', async () => {
    const ctx = createMockCtx({ _id: 'meta_1', generationStatus: 'idle' });

    const result = await startAgentChat({
      ...createDefaultArgs(ctx),
      deferGeneration: true,
    } as never);

    // The node-action caller runs generation itself via runAction; startChat
    // must NOT also schedule runAgentGeneration (that would double-generate).
    // (Thread-title generation is still scheduled — assert specifically that
    // the generation action is not.)
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalledWith(
      expect.anything(),
      'mock-runAgentGeneration',
      expect.anything(),
    );
    expect(result.generationArgs).toBeDefined();
    expect(result.generationArgs).toMatchObject({
      agentType: 'writer',
      model: 'gpt-4',
      provider: 'openai',
      threadId: 'thread_1',
      organizationId: 'org_1',
      promptMessage: 'hello',
      promptMessageId: 'msg_1',
      streamId: 'new-stream-id',
      deadlineMs: expect.any(Number),
      scheduledAtMs: expect.any(Number),
    });
    expect(result.streamId).toBe('new-stream-id');
    expect(result.messageAlreadyExists).toBe(false);
  });

  it('schedules generation and omits generationArgs when deferGeneration is false', async () => {
    const ctx = createMockCtx({ _id: 'meta_1', generationStatus: 'idle' });

    const result = await startAgentChat({
      ...createDefaultArgs(ctx),
      deferGeneration: false,
    } as never);

    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      0,
      'mock-runAgentGeneration',
      expect.objectContaining({ threadId: 'thread_1', model: 'gpt-4' }),
    );
    expect(result.generationArgs).toBeUndefined();
    expect(result.streamId).toBe('new-stream-id');
  });
});

describe('startAgentChat — `@`-mention KB references', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListMessages.mockResolvedValue({ page: [] });
    mockSaveMessage.mockResolvedValue({ messageId: 'msg_1' });
  });

  const referencedFiles = [
    {
      documentId: 'doc_1',
      fileId: 'file_kb_1',
      fileName: 'Q3 Report.pdf',
      fileType: 'application/pdf',
      fileSize: 2048,
    },
  ];

  it('appends the enriched KB reference block to the saved message and pins the fileIds', async () => {
    const ctx = createMockCtx({ _id: 'meta_1', generationStatus: 'idle' });

    const result = await startAgentChat({
      ...createDefaultArgs(ctx),
      deferGeneration: true,
      referencedFiles,
    } as never);

    expect(mockSaveMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        message: expect.objectContaining({
          role: 'user',
          content:
            'hello\n\n📚 Referenced from the knowledge base: Q3 Report.pdf\n*(fileId: file_kb_1 | fileName: Q3 Report.pdf | fileType: application/pdf | fileSize: 2048)*',
        }),
      }),
    );
    expect(result.generationArgs).toMatchObject({
      promptMessage: expect.stringContaining('fileId: file_kb_1'),
      // The un-augmented text used for multimodal prompts stays clean.
      originalUserText: 'hello',
      pinnedFileIds: ['file_kb_1'],
    });
    // KB refs are NOT attachments — no blob re-registration.
    expect(result.generationArgs).toMatchObject({ attachments: undefined });
  });

  it('omits pinnedFileIds and the block when no references are passed', async () => {
    const ctx = createMockCtx({ _id: 'meta_1', generationStatus: 'idle' });

    const result = await startAgentChat({
      ...createDefaultArgs(ctx),
      deferGeneration: true,
    } as never);

    expect(result.generationArgs).toMatchObject({
      promptMessage: 'hello',
      pinnedFileIds: undefined,
    });
  });

  it('drops KB references entirely on a prewarm turn', async () => {
    const ctx = createMockCtx({ _id: 'meta_1', generationStatus: 'idle' });

    const result = await startAgentChat({
      ...createDefaultArgs(ctx),
      deferGeneration: true,
      prewarm: true,
      referencedFiles,
    } as never);

    expect(mockSaveMessage).not.toHaveBeenCalled();
    expect(result.generationArgs).toMatchObject({
      promptMessage: '.',
      pinnedFileIds: undefined,
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

// Regression test for #1468: an attachment-only message used to generate the
// thread title from the raw attachment markdown/fileId metadata block. The
// title source must be the user's words, or the file names when there is no
// text — never the metadata block.
describe('buildTitleSource (#1468)', () => {
  it('uses the user message when present', () => {
    expect(buildTitleSource('How do I reset my budget?', undefined)).toBe(
      'How do I reset my budget?',
    );
  });

  it('prefers the user message over attachment names', () => {
    expect(
      buildTitleSource('Summarize this', [{ fileName: 'report.md' }]),
    ).toBe('Summarize this');
  });

  it('falls back to attachment file names for an attachment-only message', () => {
    expect(buildTitleSource('', [{ fileName: 'report.md' }])).toBe('report.md');
    expect(
      buildTitleSource('   ', [
        { fileName: 'q3.xlsx' },
        { fileName: 'notes.md' },
      ]),
    ).toBe('q3.xlsx, notes.md');
  });

  it('returns an empty string when there is neither text nor attachments', () => {
    expect(buildTitleSource('', undefined)).toBe('');
    expect(buildTitleSource('', [])).toBe('');
  });
});

describe('computeDeadlineMs', () => {
  const NOW = 1_000_000;

  it('uses the per-agent timeoutMs over the AgentType default', () => {
    expect(
      computeDeadlineMs({ timeoutMs: 900_000 }, 'integration', undefined, NOW),
    ).toBe(NOW + 900_000);
  });

  it('falls back to the 420s default when neither per-agent nor AgentType timeoutMs is set', () => {
    // AGENT_CONTEXT_CONFIGS is mocked to {} in this suite, so the lookup is
    // undefined and the final 420_000 fallback applies.
    expect(computeDeadlineMs({}, 'integration', undefined, NOW)).toBe(
      NOW + 420_000,
    );
  });

  it('caps the deadline at maxDeadlineMs when the agent would run longer', () => {
    // 15-min agent, but the caller (e.g. Slack poll) only waits 9 min.
    const cap = NOW + 540_000;
    expect(
      computeDeadlineMs({ timeoutMs: 900_000 }, 'integration', cap, NOW),
    ).toBe(cap);
  });

  it('leaves the deadline untouched when it is within maxDeadlineMs', () => {
    const cap = NOW + 540_000;
    expect(
      computeDeadlineMs({ timeoutMs: 120_000 }, 'integration', cap, NOW),
    ).toBe(NOW + 120_000);
  });
});
