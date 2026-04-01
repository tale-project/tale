import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock('../../../_generated/api', () => ({
  internal: {
    agents: {
      internal_queries: {
        getBindingByAgent: 'mock-getBindingByAgent',
      },
    },
    agent_tools: {
      workflows: {
        internal_mutations: {
          triggerWorkflowCompletionResponse:
            'mock-triggerWorkflowCompletionResponse',
        },
      },
    },
  },
}));

vi.mock('../../../_generated/server', () => ({
  internalAction: vi.fn((def) => ({ _handler: def.handler })),
}));

vi.mock('../../../agents/config', () => ({
  toSerializableConfig: vi.fn(
    (slug: string, _config: unknown, _binding: unknown) => ({
      name: slug,
      instructions: 'test',
    }),
  ),
}));

vi.mock('../../../agents/file_utils', () => ({
  MAX_FILE_SIZE_BYTES: 1024 * 1024,
  parseAgentJson: vi.fn(() => ({
    displayName: 'Test Agent',
    systemInstructions: 'test',
    toolNames: [],
  })),
  resolveAgentFilePath: vi.fn(
    (_org: string, slug: string) => `/agents/${slug}.json`,
  ),
}));

const { stat, readFile } = await import('node:fs/promises');
const { triggerCompletionWithAgent } =
  await import('../trigger_completion_action');

const handler = (
  triggerCompletionWithAgent as unknown as {
    _handler: (ctx: never, args: never) => Promise<void>;
  }
)._handler;

function createMockCtx(binding: Record<string, unknown> | null = null) {
  return {
    runQuery: vi.fn().mockResolvedValue(binding),
    runMutation: vi.fn().mockResolvedValue(undefined),
  };
}

describe('triggerCompletionWithAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads agent file, resolves binding, and triggers completion', async () => {
    vi.mocked(stat).mockResolvedValue({ size: 100 } as never);
    vi.mocked(readFile).mockResolvedValue('{}' as never);

    const ctx = createMockCtx({ teamId: 'team-1', knowledgeFiles: [] });

    await handler(
      ctx as never,
      {
        threadId: 'thread-1',
        organizationId: 'org-1',
        agentSlug: 'my-agent',
        messageContent: 'Workflow completed',
      } as never,
    );

    expect(stat).toHaveBeenCalledWith('/agents/my-agent.json');
    expect(readFile).toHaveBeenCalledWith('/agents/my-agent.json', 'utf-8');
    expect(ctx.runQuery).toHaveBeenCalledWith('mock-getBindingByAgent', {
      organizationId: 'org-1',
      agentSlug: 'my-agent',
    });
    expect(ctx.runMutation).toHaveBeenCalledWith(
      'mock-triggerWorkflowCompletionResponse',
      expect.objectContaining({
        threadId: 'thread-1',
        organizationId: 'org-1',
        agentSlug: 'my-agent',
        messageContent: 'Workflow completed',
      }),
    );
  });

  it('works without a binding (no knowledge files)', async () => {
    vi.mocked(stat).mockResolvedValue({ size: 100 } as never);
    vi.mocked(readFile).mockResolvedValue('{}' as never);

    const ctx = createMockCtx(null);

    await handler(
      ctx as never,
      {
        threadId: 'thread-1',
        organizationId: 'org-1',
        agentSlug: 'my-agent',
        messageContent: 'Done',
      } as never,
    );

    expect(ctx.runMutation).toHaveBeenCalledTimes(1);
  });

  it('throws when agent file is not found', async () => {
    vi.mocked(stat).mockRejectedValue(new Error('ENOENT'));

    const ctx = createMockCtx();

    await expect(
      handler(
        ctx as never,
        {
          threadId: 'thread-1',
          organizationId: 'org-1',
          agentSlug: 'missing-agent',
          messageContent: 'Done',
        } as never,
      ),
    ).rejects.toThrow('Agent not found: missing-agent');
  });

  it('throws when agent file is too large', async () => {
    vi.mocked(stat).mockResolvedValue({ size: 10 * 1024 * 1024 } as never);

    const ctx = createMockCtx();

    await expect(
      handler(
        ctx as never,
        {
          threadId: 'thread-1',
          organizationId: 'org-1',
          agentSlug: 'big-agent',
          messageContent: 'Done',
        } as never,
      ),
    ).rejects.toThrow('Agent not found: big-agent');
  });
});
