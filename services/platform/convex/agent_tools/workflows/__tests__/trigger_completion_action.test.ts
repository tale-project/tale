import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../../_generated/api', () => ({
  internal: {
    agents: {
      file_actions: {
        resolveAgentConfig: 'mock-resolveAgentConfig',
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

const { triggerCompletionWithAgent } =
  await import('../trigger_completion_action');

const handler = (
  triggerCompletionWithAgent as unknown as {
    _handler: (ctx: never, args: never) => Promise<void>;
  }
)._handler;

function createMockCtx(agentConfig: Record<string, unknown> | null = null) {
  return {
    runAction: vi.fn().mockResolvedValue(agentConfig),
    runMutation: vi.fn().mockResolvedValue(undefined),
  };
}

describe('triggerCompletionWithAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves agent config and triggers completion', async () => {
    const mockConfig = { name: 'my-agent', instructions: 'test' };
    const ctx = createMockCtx(mockConfig);

    await handler(
      ctx as never,
      {
        threadId: 'thread-1',
        organizationId: 'org-1',
        agentSlug: 'my-agent',
        messageContent: 'Workflow completed',
      } as never,
    );

    expect(ctx.runAction).toHaveBeenCalledWith('mock-resolveAgentConfig', {
      orgSlug: 'default',
      agentSlug: 'my-agent',
      organizationId: 'org-1',
    });
    expect(ctx.runMutation).toHaveBeenCalledWith(
      'mock-triggerWorkflowCompletionResponse',
      expect.objectContaining({
        threadId: 'thread-1',
        organizationId: 'org-1',
        agentSlug: 'my-agent',
        messageContent: 'Workflow completed',
        agentConfig: mockConfig,
      }),
    );
  });

  it('propagates errors from resolveAgentConfig', async () => {
    const ctx = createMockCtx();
    ctx.runAction.mockRejectedValue(
      new Error('Agent not found: missing-agent'),
    );

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
});
