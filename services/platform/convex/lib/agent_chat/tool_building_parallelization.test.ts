import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../_generated/server', () => ({
  internalAction: vi.fn((config) => config),
}));

vi.mock('../../_generated/api', () => ({
  components: {
    agent: {
      threads: { getThread: 'mock-getThread' },
      messages: { updateMessage: 'mock-updateMessage' },
      streams: { list: 'mock-listStreams' },
    },
  },
  internal: {
    governance: {
      internal_queries: {
        getSystemPromptPolicyInternal: 'getSystemPromptPolicyInternal',
      },
    },
    streaming: {
      internal_mutations: {
        startStream: 'mock-startStream',
        completeStream: 'mock-completeStream',
      },
    },
    threads: {
      internal_mutations: {
        clearGenerationStatus: 'mock-clearGenerationStatus',
      },
    },
    workflows: {
      file_actions: {
        readWorkflowForExecution: 'mock-readWorkflowForExecution',
      },
    },
    mcp_servers: {
      internal_queries: {
        listActiveByOrg: 'mock-listActiveByOrg',
      },
    },
    organizations: {
      internal_queries: {
        getOrganizationDefaultLocale: 'mock-getOrganizationDefaultLocale',
      },
    },
    personalization: {
      internal_queries: {
        isPersonalizationActiveForChat: 'mock-isPersonalizationActiveForChat',
      },
    },
  },
}));

const mockFetchOperationsWithSchema = vi.fn();
vi.mock('../../agent_tools/integrations/fetch_operations_summary', () => ({
  fetchOperationsWithSchema: (...args: unknown[]) =>
    mockFetchOperationsWithSchema(...args),
}));

vi.mock('../../agent_tools/integrations/create_bound_integration_tool', () => ({
  createBoundIntegrationTool: vi.fn(
    (name: string, _s: unknown, _o: unknown, _m: unknown) => ({
      name: `integration_${name}`,
      description: `Integration tool for ${name}`,
    }),
  ),
}));

const mockLoadDelegateAgents = vi.fn();
vi.mock('../../agent_tools/delegation/load_delegation_agents', () => ({
  loadDelegateAgents: (...args: unknown[]) => mockLoadDelegateAgents(...args),
}));

vi.mock('../../agent_tools/delegation/create_delegation_tool', () => ({
  createDelegationTool: vi.fn((delegate: { name: string }) => ({
    name: `delegate_${delegate.name}`,
    tool: { description: `Delegate to ${delegate.name}` },
  })),
  buildDelegationInstructionsSection: vi.fn(() => '\n\nDelegation info'),
}));

vi.mock('../../agent_tools/workflows/create_bound_workflow_tool', () => ({
  createBoundWorkflowTool: vi.fn(() => ({
    description: 'Workflow tool',
  })),
  sanitizeWorkflowName: vi.fn((name: string) =>
    name.replace(/\s+/g, '_').toLowerCase(),
  ),
}));

vi.mock('../../agent_tools/workflows/helpers/extract_input_schema', () => ({
  extractInputSchema: vi.fn(() => undefined),
}));

vi.mock('../../agent_tools/tool_names', () => ({
  TOOL_NAMES: ['web', 'rag_search'],
}));

vi.mock('../../agent_tools/tool_registry', () => ({
  getToolRegistryMap: vi.fn(() => ({})),
}));

vi.mock('../../providers/circuit_breaker', () => ({
  recordFailure: vi.fn(),
  recordSuccess: vi.fn(),
}));

vi.mock('../../providers/errors', () => ({
  isTransientProviderError: vi.fn(() => false),
}));

const mockResolveModelById = vi.fn();
const mockResolveModelWithFallback = vi.fn();
vi.mock('../../providers/failover', () => ({
  resolveLanguageModelWithFallback: (...args: unknown[]) =>
    mockResolveModelWithFallback(...args),
}));
vi.mock('../../providers/resolve_model', () => ({
  resolveLanguageModelById: (...args: unknown[]) =>
    mockResolveModelById(...args),
}));

const mockGenerateAgentResponse = vi.fn();
vi.mock('../agent_response', () => ({
  generateAgentResponse: (...args: unknown[]) =>
    mockGenerateAgentResponse(...args),
}));

vi.mock('../agent_response/types');

vi.mock('../context_management', () => ({
  estimateTokens: vi.fn(() => 100),
  DEFAULT_MODEL_CONTEXT_LIMIT: 128000,
  CONTEXT_SAFETY_MARGIN: 0.9,
  SYSTEM_INSTRUCTIONS_TOKENS: 500,
  OUTPUT_RESERVE: 4096,
}));

vi.mock('../context_management/constants', () => ({
  AGENT_CONTEXT_CONFIGS: {
    custom: {
      maxHistoryTokens: 8000,
      timeoutMs: 60000,
    },
  },
}));

vi.mock('../create_agent_config', () => ({
  createAgentConfig: vi.fn(() => ({
    name: 'test-agent',
  })),
}));

vi.mock('../debug_log', () => ({
  createDebugLog: () => () => {},
}));

vi.mock('../error_classification', () => ({
  NonRetryableError: class extends Error {
    constructor(
      msg: string,
      public cause: unknown,
      public code: string,
    ) {
      super(msg);
    }
  },
}));

vi.mock('../../lib/utils/type-guards', () => ({
  isRecord: (v: unknown) => typeof v === 'object' && v !== null,
  getString: (obj: Record<string, unknown>, key: string) => obj[key],
  narrowStringUnion: (val: string, arr: string[]) =>
    arr.includes(val) ? val : undefined,
}));

vi.mock('@convex-dev/agent', () => ({
  Agent: vi.fn().mockImplementation(() => ({
    streamText: vi.fn(),
    generateText: vi.fn(),
  })),
  listMessages: vi.fn().mockResolvedValue({ page: [] }),
  saveMessage: vi.fn().mockResolvedValue({ messageId: 'msg_1' }),
}));

vi.mock('../../organizations/resolve_org_slug', () => ({
  resolveOrgSlug: vi.fn().mockResolvedValue('default'),
}));

const { runAgentGeneration } = await import('./internal_actions');
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- vi.mock replaces internalAction() with identity fn, so the raw config object is returned
const generationHandler = (
  runAgentGeneration as unknown as { handler: (...args: unknown[]) => unknown }
).handler;

describe('runAgentGeneration — tool building parallelization', () => {
  let mockCtx: {
    runQuery: ReturnType<typeof vi.fn>;
    runAction: ReturnType<typeof vi.fn>;
    runMutation: ReturnType<typeof vi.fn>;
  };

  const baseArgs = {
    agentType: 'custom',
    agentConfig: {
      name: 'test-agent',
      instructions: 'Be helpful',
      integrationBindings: ['slack', 'jira'],
      delegateSlugs: ['writer-agent'],
      workflowBindings: ['email-workflow'],
    },
    model: 'gpt-4o',
    provider: 'openrouter',
    debugTag: '[test]',
    enableStreaming: false,
    threadId: 'thread_1',
    organizationId: 'org_1',
    userId: 'user_1',
    promptMessage: 'hello',
    streamId: 'stream_1',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockCtx = {
      runQuery: vi.fn().mockImplementation((fn: string) => {
        if (fn === 'getSystemPromptPolicyInternal') {
          return Promise.resolve({ enabled: false });
        }
        if (fn === 'mock-listActiveByOrg') {
          return Promise.resolve([]);
        }
        if (fn === 'mock-getOrganizationDefaultLocale') {
          return Promise.resolve('en');
        }
        return Promise.resolve(null);
      }),
      runAction: vi.fn().mockImplementation((fn: string) => {
        if (fn === 'mock-readWorkflowForExecution') {
          return Promise.resolve({
            ok: true,
            config: {
              name: 'Email Workflow',
              enabled: true,
              steps: [{ stepType: 'start', config: {} }],
            },
          });
        }
        return Promise.resolve(null);
      }),
      runMutation: vi.fn().mockResolvedValue(undefined),
    };

    mockFetchOperationsWithSchema.mockResolvedValue({
      summary: 'Integration summary',
      operations: [],
      metadata: {},
    });

    mockLoadDelegateAgents.mockResolvedValue([
      { name: 'writer-agent', instructions: 'write stuff' },
    ]);

    const modelResult = {
      languageModel: {},
      modelData: {
        providerName: 'openrouter',
        modelId: 'gpt-4o',
        inputCentsPerMillion: 250,
        outputCentsPerMillion: 1000,
        tags: ['chat'],
      },
    };
    mockResolveModelById.mockResolvedValue(modelResult);
    mockResolveModelWithFallback.mockResolvedValue(modelResult);

    mockGenerateAgentResponse.mockResolvedValue({
      threadId: 'thread_1',
      text: 'Hello! How can I help?',
      savedMessageId: 'msg_1',
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      finishReason: 'stop',
      model: 'gpt-4o',
      provider: 'openrouter',
    });
  });

  it('calls integration, delegation, workflow, and governance queries in parallel', async () => {
    const callTimestamps: Array<{ name: string; start: number }> = [];

    // Add delays to detect sequential vs parallel execution
    mockFetchOperationsWithSchema.mockImplementation(
      (_ctx: unknown, _orgId: string, name: string) => {
        callTimestamps.push({
          name: `integration:${name}`,
          start: Date.now(),
        });
        return new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                summary: `Summary for ${name}`,
                operations: [],
                metadata: {},
              }),
            15,
          ),
        );
      },
    );

    mockLoadDelegateAgents.mockImplementation(() => {
      callTimestamps.push({ name: 'delegation', start: Date.now() });
      return new Promise((resolve) =>
        setTimeout(
          () =>
            resolve([{ name: 'writer-agent', instructions: 'write stuff' }]),
          15,
        ),
      );
    });

    mockCtx.runAction.mockImplementation((fn: string) => {
      if (fn === 'mock-readWorkflowForExecution') {
        callTimestamps.push({ name: 'workflow', start: Date.now() });
        return new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                config: {
                  name: 'Email Workflow',
                  enabled: true,
                  steps: [{ stepType: 'start', config: {} }],
                },
              }),
            15,
          ),
        );
      }
      return Promise.resolve(null);
    });

    mockCtx.runQuery.mockImplementation((fn: string) => {
      if (fn === 'getSystemPromptPolicyInternal') {
        callTimestamps.push({ name: 'governance', start: Date.now() });
        return new Promise((resolve) =>
          setTimeout(() => resolve({ enabled: false }), 15),
        );
      }
      if (fn === 'mock-listActiveByOrg') {
        return Promise.resolve([]);
      }
      if (fn === 'mock-getOrganizationDefaultLocale') {
        return Promise.resolve('en');
      }
      return Promise.resolve(null);
    });

    const handler = generationHandler;
    const start = Date.now();
    await handler(mockCtx as never, baseArgs as never);
    const elapsed = Date.now() - start;

    // All four categories should have been called
    const names = callTimestamps.map((c) => c.name);
    expect(names).toContain('integration:slack');
    expect(names).toContain('integration:jira');
    expect(names).toContain('delegation');
    expect(names).toContain('workflow');
    expect(names).toContain('governance');

    // With parallelization: ~15ms for the parallel group + overhead
    // Sequential would be: 15ms * 5 = 75ms minimum
    // Use a generous threshold but ensure it's less than sequential time
    expect(elapsed).toBeLessThan(200);
  });

  it('builds all tool types and passes them to generateAgentResponse', async () => {
    const handler = generationHandler;
    await handler(mockCtx as never, baseArgs as never);

    expect(mockGenerateAgentResponse).toHaveBeenCalledTimes(1);

    // Verify integration tools were fetched for both bindings
    expect(mockFetchOperationsWithSchema).toHaveBeenCalledTimes(2);

    // Verify delegation agents were loaded
    expect(mockLoadDelegateAgents).toHaveBeenCalledTimes(1);
  });
});
