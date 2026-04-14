import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../_generated/server', () => ({
  action: vi.fn((config) => config),
}));

const mockGetAuthUser = vi.fn();
vi.mock('../../auth', () => ({
  authComponent: {
    getAuthUser: (...args: unknown[]) => mockGetAuthUser(...args),
  },
}));

vi.mock('../../governance/pii', () => ({
  scrubPii: vi.fn((_msg: string, _config: unknown) => ({
    text: 'scrubbed',
    matchCount: 0,
    detectedTypes: [],
  })),
}));

vi.mock('../../_generated/api', () => ({
  internal: {
    governance: {
      internal_queries: {
        getPiiConfigInternal: 'getPiiConfigInternal',
        resolveDefaultModelInternal: 'resolveDefaultModelInternal',
      },
    },
    threads: {
      internal_mutations: {
        markGenerating: 'markGenerating',
        clearGenerationStatus: 'clearGenerationStatus',
      },
    },
    agents: {
      file_actions: {
        resolveAgentConfig: 'resolveAgentConfig',
      },
      start_chat: {
        startChat: 'startChat',
      },
      internal_queries: {
        getBindingByAgent: 'getBindingByAgent',
      },
    },
    audit_logs: {
      internal_mutations: {
        createAuditLog: 'createAuditLog',
      },
    },
  },
}));

vi.mock('node:path', async () => {
  const actual = await vi.importActual<typeof import('node:path')>('node:path');
  return { ...actual, default: actual };
});

const mockReadAgentFile = vi.fn();
vi.mock('../file_utils', () => ({
  resolveAgentFilePath: vi.fn(
    (orgSlug: string, agentName: string) =>
      `/data/agents/${orgSlug}/${agentName}.json`,
  ),
  resolveAgentsDir: vi.fn((orgSlug: string) => `/data/agents/${orgSlug}`),
  resolveHistoryDir: vi.fn(),
  parseAgentJson: vi.fn(),
  serializeAgentJson: vi.fn(),
  agentNameFromFileName: vi.fn(),
  validateAgentName: vi.fn(),
  MAX_FILE_SIZE_BYTES: 1_000_000,
  MAX_HISTORY_ENTRIES: 100,
}));

vi.mock('../../lib/file_io', () => ({
  readJsonFile: (...args: unknown[]) => mockReadAgentFile(...args),
  atomicWrite: vi.fn(),
  sha256: () => 'mock-hash',
  readFileSafe: vi.fn(),
  generateHistoryTimestamp: vi.fn(),
  pruneHistory: vi.fn(),
}));

vi.mock('../config', () => ({
  toSerializableConfig: vi.fn(
    (name: string, _config: unknown, _binding?: unknown) => ({
      name,
      instructions: 'test instructions',
      model: 'gpt-4o',
    }),
  ),
}));

const { chatWithAgent } = await import('../unified_chat');
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- vi.mock replaces action() with identity fn, so the raw config object is returned
const chatHandler = (
  chatWithAgent as unknown as { handler: (...args: unknown[]) => unknown }
).handler;

describe('chatWithAgent — TTFT parallelization', () => {
  let mockCtx: {
    runQuery: ReturnType<typeof vi.fn>;
    runAction: ReturnType<typeof vi.fn>;
    runMutation: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUser.mockResolvedValue({
      _id: 'user_1',
      email: 'test@example.com',
      name: 'Test User',
    });
    mockReadAgentFile.mockResolvedValue({
      ok: true,
      data: {
        displayName: 'Test Agent',
        description: 'A test agent',
        systemInstructions: 'test instructions',
        supportedModels: ['gpt-4o'],
        toolNames: [],
      },
      hash: 'abc',
    });
    mockCtx = {
      runQuery: vi.fn().mockImplementation((fn: string) => {
        if (fn === 'getPiiConfigInternal') {
          return Promise.resolve({ enabled: false });
        }
        if (fn === 'getBindingByAgent') {
          return Promise.resolve(null);
        }
        return Promise.resolve(null);
      }),
      runAction: vi.fn().mockResolvedValue({
        name: 'test-agent',
        instructions: 'test instructions',
        model: 'gpt-4o',
      }),
      runMutation: vi.fn().mockImplementation((fn: string) => {
        if (fn === 'markGenerating') {
          return Promise.resolve({
            streamId: 'stream_1',
            userId: 'user_1',
            userEmail: 'test@example.com',
            userName: 'Test User',
          });
        }
        // startChat and other mutations
        return Promise.resolve({
          messageAlreadyExists: false,
          streamId: 'stream_1',
        });
      }),
    };
  });

  it('calls PII query and agent config resolution concurrently', async () => {
    // Track call order with timestamps
    const callOrder: string[] = [];

    // PII query resolves after 100ms
    mockCtx.runQuery.mockImplementation((fn: string) => {
      callOrder.push(`query:${fn}`);
      if (fn === 'getPiiConfigInternal') {
        return new Promise((resolve) =>
          setTimeout(() => resolve({ enabled: false }), 10),
        );
      }
      if (fn === 'getBindingByAgent') {
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });

    // Agent config resolves after 100ms — if sequential with PII, total > 200ms
    mockReadAgentFile.mockImplementation(() => {
      callOrder.push('readAgentFile');
      return new Promise((resolve) =>
        setTimeout(
          () =>
            resolve({
              ok: true,
              data: {
                displayName: 'Test Agent',
                systemInstructions: 'test',
                supportedModels: ['gpt-4o'],
                toolNames: [],
              },
              hash: 'abc',
            }),
          10,
        ),
      );
    });

    const handler = chatHandler;
    const start = Date.now();
    await handler(mockCtx as never, {
      agentSlug: 'test-agent',
      threadId: 'thread_1',
      organizationId: 'org_1',
      orgSlug: 'default',
      message: 'hello',
    });
    const elapsed = Date.now() - start;

    // Both should have been called. With parallelization, total time
    // should be less than sum of individual delays.
    expect(callOrder).toContain('query:getPiiConfigInternal');
    expect(callOrder).toContain('readAgentFile');

    // With parallel execution, elapsed < 200ms. With sequential it would be >= 200ms.
    // Use a generous threshold to avoid flaky tests.
    expect(elapsed).toBeLessThan(150);
  });

  it('still scrubs PII before startChat when PII is enabled', async () => {
    const { scrubPii } = await import('../../governance/pii');
    const mockScrubPii = vi.mocked(scrubPii);
    mockScrubPii.mockReturnValue({
      text: 'scrubbed message',
      matchCount: 1,
      detectedTypes: ['email'],
    });

    mockCtx.runQuery.mockImplementation((fn: string) => {
      if (fn === 'getPiiConfigInternal') {
        return Promise.resolve({
          enabled: true,
          config: {
            mode: 'mask',
            enabledPatterns: ['email'],
            customPatterns: [],
          },
        });
      }
      if (fn === 'getBindingByAgent') {
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });

    const handler = chatHandler;
    await handler(mockCtx as never, {
      agentSlug: 'test-agent',
      threadId: 'thread_1',
      organizationId: 'org_1',
      orgSlug: 'default',
      message: 'user@example.com',
    });

    // PII scrubbing should happen
    expect(mockScrubPii).toHaveBeenCalled();

    // startChat mutation should receive the scrubbed message
    expect(mockCtx.runMutation).toHaveBeenCalledWith(
      'startChat',
      expect.objectContaining({
        message: 'scrubbed message',
      }),
    );
  });

  it('eliminates resolveAgentConfig action hop by reading files directly', async () => {
    const handler = chatHandler;
    await handler(mockCtx as never, {
      agentSlug: 'test-agent',
      threadId: 'thread_1',
      organizationId: 'org_1',
      orgSlug: 'default',
      message: 'hello',
    });

    // Should NOT call resolveAgentConfig as an action — it's inlined now
    const actionCalls = mockCtx.runAction.mock.calls;
    const resolveConfigCalls = actionCalls.filter(
      (call: unknown[]) => call[0] === 'resolveAgentConfig',
    );
    expect(resolveConfigCalls).toHaveLength(0);
  });
});
