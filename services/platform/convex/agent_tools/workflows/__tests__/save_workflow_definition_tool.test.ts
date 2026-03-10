import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../_generated/api', () => ({
  internal: {
    agent_tools: {
      workflows: {
        internal_mutations: {
          createWorkflowUpdateApproval: 'mock-createWorkflowUpdateApproval',
        },
      },
    },
    wf_definitions: {
      internal_queries: {
        resolveWorkflow: 'mock-resolveWorkflow',
      },
    },
  },
}));

vi.mock('../../../threads/get_parent_thread_id', () => ({
  getApprovalThreadId: vi.fn().mockResolvedValue('thread-123'),
}));

vi.mock(
  '../../../workflow_engine/helpers/validation/validate_workflow_definition',
  () => ({
    validateWorkflowDefinition: vi
      .fn()
      .mockReturnValue({ valid: true, errors: [], warnings: [] }),
  }),
);

vi.mock('@convex-dev/agent', () => ({
  createTool: vi.fn((def) => ({ _handler: def.handler })),
}));

function createMockCtx(overrides?: Record<string, unknown>) {
  return {
    organizationId: 'org1',
    userId: 'user1',
    threadId: 'thread-current',
    messageId: 'msg-123',
    runQuery: vi.fn().mockResolvedValue({
      name: 'My Workflow',
      versionNumber: 1,
    }),
    runMutation: vi.fn().mockResolvedValue('approval-id-1'),
    ...overrides,
  };
}

function createValidArgs() {
  return {
    workflowConfig: {
      name: 'My Workflow',
      description: 'A test workflow',
    },
    stepsConfig: [
      {
        stepSlug: 'start_step',
        name: 'Start',
        stepType: 'start' as const,
        config: {},
        nextSteps: { default: 'next_step' },
      },
    ],
    workflowId: 'wf-def-1',
    updateSummary: 'Added error handling step',
  };
}

async function getHandler() {
  const { saveWorkflowDefinitionTool } =
    await import('../save_workflow_definition_tool');
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only: accessing mocked createTool internals
  return (saveWorkflowDefinitionTool.tool as unknown as { _handler: Function })
    ._handler;
}

describe('save_workflow_definition tool handler', () => {
  it('creates approval with correct metadata on happy path', async () => {
    const handler = await getHandler();
    const mockRunMutation = vi.fn().mockResolvedValue('approval-id-1');
    const ctx = createMockCtx({ runMutation: mockRunMutation });

    const result = await handler(ctx, createValidArgs());

    expect(result.success).toBe(true);
    expect(result.requiresApproval).toBe(true);
    expect(result.approvalId).toBe('approval-id-1');
    expect(result.approvalCreated).toBe(true);

    expect(mockRunMutation).toHaveBeenCalledWith(
      'mock-createWorkflowUpdateApproval',
      expect.objectContaining({
        organizationId: 'org1',
        workflowName: 'My Workflow',
        workflowVersionNumber: 1,
        updateSummary: 'Added error handling step',
      }),
    );
  });

  it('returns failure when organizationId is missing', async () => {
    const handler = await getHandler();
    const ctx = createMockCtx({ organizationId: undefined });

    const result = await handler(ctx, createValidArgs());

    expect(result.success).toBe(false);
    expect(result.message).toContain('organizationId is required');
  });

  it('returns failure when workflowId is missing', async () => {
    const handler = await getHandler();
    const ctx = createMockCtx({ workflowId: undefined });
    const args = createValidArgs();
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only: simulating missing workflowId
    (args as Record<string, unknown>).workflowId = undefined;

    const result = await handler(ctx, args);

    expect(result.success).toBe(false);
    expect(result.message).toContain('workflowId is required');
  });

  it('returns failure when validation fails', async () => {
    const { validateWorkflowDefinition } =
      await import('../../../workflow_engine/helpers/validation/validate_workflow_definition');
    vi.mocked(validateWorkflowDefinition).mockReturnValueOnce({
      valid: false,
      errors: ['Missing start step'],
      warnings: [],
    });

    const handler = await getHandler();
    const ctx = createMockCtx();

    const result = await handler(ctx, createValidArgs());

    expect(result.success).toBe(false);
    expect(result.message).toContain('validation failed');
    expect(result.validationErrors).toContain('Missing start step');
  });

  it('returns failure when workflow not found', async () => {
    const handler = await getHandler();
    const ctx = createMockCtx({
      runQuery: vi.fn().mockResolvedValue(null),
    });

    const result = await handler(ctx, createValidArgs());

    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });

  it('returns failure when approval creation throws', async () => {
    const handler = await getHandler();
    const ctx = createMockCtx({
      runQuery: vi.fn().mockResolvedValue({
        name: 'My Workflow',
        versionNumber: 1,
      }),
      runMutation: vi.fn().mockRejectedValue(new Error('DB error')),
    });

    const result = await handler(ctx, createValidArgs());

    expect(result.success).toBe(false);
    expect(result.message).toContain('DB error');
  });

  it('forwards threadId and messageId to approval mutation', async () => {
    const handler = await getHandler();
    const mockRunMutation = vi.fn().mockResolvedValue('approval-id-2');
    const ctx = createMockCtx({
      runMutation: mockRunMutation,
      messageId: 'msg-abc',
    });

    await handler(ctx, createValidArgs());

    expect(mockRunMutation).toHaveBeenCalledWith(
      'mock-createWorkflowUpdateApproval',
      expect.objectContaining({
        threadId: 'thread-123',
        messageId: 'msg-abc',
      }),
    );
  });

  it('includes stepsConfig in approval mutation', async () => {
    const handler = await getHandler();
    const mockRunMutation = vi.fn().mockResolvedValue('approval-id-3');
    const ctx = createMockCtx({ runMutation: mockRunMutation });
    const args = createValidArgs();

    await handler(ctx, args);

    expect(mockRunMutation).toHaveBeenCalledWith(
      'mock-createWorkflowUpdateApproval',
      expect.objectContaining({
        stepsConfig: args.stepsConfig,
      }),
    );
  });
});
