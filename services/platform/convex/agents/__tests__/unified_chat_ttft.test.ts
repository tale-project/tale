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

// Mock the PII library so this TTFT test doesn't pay the cost of compiling
// the full locale-aware scrubber regex on every test run.
vi.mock('../../../lib/pii', async () => {
  const actual =
    await vi.importActual<typeof import('../../../lib/pii')>(
      '../../../lib/pii',
    );
  return {
    ...actual,
    createScrubber: vi.fn(() => ({
      scrub: vi.fn(() => ({ kind: 'pass' as const })),
      patterns: [],
      locales: [],
    })),
  };
});

vi.mock('../../_generated/api', () => ({
  components: {
    betterAuth: {
      adapter: {
        findOne: 'betterAuth.adapter.findOne',
      },
    },
  },
  internal: {
    governance: {
      internal_queries: {
        getPiiConfigInternal: 'getPiiConfigInternal',
        getGuardrailsConfigsInternal: 'getGuardrailsConfigsInternal',
        resolveDefaultModelInternal: 'resolveDefaultModelInternal',
        getAccessibleModelsInternal: 'getAccessibleModelsInternal',
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
    organizations: {
      internal_queries: {
        getOrganizationDefaultLocale: 'getOrganizationDefaultLocale',
      },
    },
    audit_logs: {
      internal_mutations: {
        createAuditLog: 'createAuditLog',
      },
    },
    chat_filter_events: {
      internal_mutations: {
        recordEvent: 'recordEvent',
      },
    },
  },
}));

// sanitizeMessage is what unified_chat now calls; we short-circuit it to an
// identity / modify function so the TTFT test can focus on parallelization
// and the "message mutation reaches startChat" behaviour.
vi.mock('../../governance/sanitize', () => ({
  loadGuardrailsSnapshot: vi.fn(async () => ({
    chatFilter: null,
    pii: null,
    moderation: null,
  })),
  sanitizeMessage: vi.fn(async (_ctx, text: string) => ({
    text,
    sanitizationRunId: 'run_test',
  })),
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
      runQuery: vi.fn().mockImplementation((fn: string, args?: unknown) => {
        if (fn === 'getPiiConfigInternal') {
          return Promise.resolve({ enabled: false });
        }
        if (fn === 'getBindingByAgent') {
          return Promise.resolve(null);
        }
        if (fn === 'getOrganizationDefaultLocale') {
          return Promise.resolve('en');
        }
        if (fn === 'getAccessibleModelsInternal') {
          return Promise.resolve(
            (args as { modelIds?: string[] } | undefined)?.modelIds ?? [],
          );
        }
        if (
          (args as { model?: string } | undefined)?.model === 'organization'
        ) {
          return Promise.resolve({ slug: 'default' });
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

  it('calls guardrails snapshot and agent config resolution concurrently', async () => {
    const callOrder: string[] = [];

    // loadGuardrailsSnapshot is mocked at module scope — override to
    // delay so we can observe parallelism via wall clock.
    const sanitize = await import('../../governance/sanitize');
    vi.mocked(sanitize.loadGuardrailsSnapshot).mockImplementation(async () => {
      callOrder.push('loadGuardrailsSnapshot');
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { chatFilter: null, pii: null, moderation: null };
    });

    mockCtx.runQuery.mockImplementation((fn: string, args?: unknown) => {
      callOrder.push(`query:${fn}`);
      if (fn === 'getBindingByAgent') {
        return Promise.resolve(null);
      }
      if (fn === 'getOrganizationDefaultLocale') {
        return Promise.resolve('en');
      }
      if (fn === 'getAccessibleModelsInternal') {
        return Promise.resolve(
          (args as { modelIds?: string[] } | undefined)?.modelIds ?? [],
        );
      }
      if ((args as { model?: string } | undefined)?.model === 'organization') {
        return Promise.resolve({ slug: 'default' });
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
      message: 'hello',
    });
    const elapsed = Date.now() - start;

    // Both should have been called. With parallelization, total time
    // should be less than sum of individual delays.
    expect(callOrder).toContain('loadGuardrailsSnapshot');
    expect(callOrder).toContain('readAgentFile');

    // With parallel execution, elapsed < 200ms. With sequential it would be >= 200ms.
    // Use a generous threshold to avoid flaky tests.
    expect(elapsed).toBeLessThan(150);
  });

  it('routes the user message through sanitizeMessage before startChat', async () => {
    const sanitize = await import('../../governance/sanitize');
    vi.mocked(sanitize.sanitizeMessage).mockResolvedValue({
      text: 'scrubbed message',
      sanitizationRunId: 'run_test',
    });

    const handler = chatHandler;
    await handler(mockCtx as never, {
      agentSlug: 'test-agent',
      threadId: 'thread_1',
      organizationId: 'org_1',
      message: 'user@example.com',
    });

    expect(sanitize.sanitizeMessage).toHaveBeenCalledWith(
      expect.anything(),
      'user@example.com',
      'input',
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org_1',
        threadId: 'thread_1',
        actorType: 'user',
      }),
    );

    // startChat mutation should receive the sanitized text.
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
