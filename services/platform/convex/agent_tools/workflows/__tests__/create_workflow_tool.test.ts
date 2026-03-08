import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../_generated/api', () => ({
  internal: {
    agent_tools: {
      workflows: {
        internal_mutations: {
          createWorkflowCreationApproval: 'mock-createWorkflowCreationApproval',
        },
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

// Mock createTool to expose the raw handler for testing
vi.mock('@convex-dev/agent', () => ({
  createTool: vi.fn((def) => ({ _handler: def.handler })),
}));

function createMockCtx(overrides?: Record<string, unknown>) {
  return {
    organizationId: 'org1',
    userId: 'user1',
    threadId: 'thread-current',
    messageId: 'msg-123',
    runQuery: vi.fn(),
    runMutation: vi.fn(),
    ...overrides,
  };
}

function createValidArgs() {
  return {
    workflowConfig: {
      name: 'Test Workflow',
      description: 'A test workflow',
    },
    stepsConfig: [
      {
        stepSlug: 'start_step',
        name: 'Start',
        stepType: 'start' as const,
        order: 0,
        config: {},
        nextSteps: { default: 'next_step' },
      },
    ],
  };
}

// Access the raw handler exposed by our createTool mock
async function getHandler() {
  const { createWorkflowTool } = await import('../create_workflow_tool');
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only: accessing mocked createTool internals
  return (createWorkflowTool.tool as unknown as { _handler: Function })
    ._handler;
}

describe('create_workflow tool handler', () => {
  it('creates approval on happy path', async () => {
    const handler = await getHandler();
    const ctx = createMockCtx({
      runMutation: vi.fn().mockResolvedValue('approval-id-1'),
    });

    const result = await handler(ctx, createValidArgs());

    expect(result.success).toBe(true);
    expect(result.requiresApproval).toBe(true);
    expect(result.approvalId).toBe('approval-id-1');
    expect(result.approvalCreated).toBe(true);
  });

  it('returns failure when organizationId is missing', async () => {
    const handler = await getHandler();
    const ctx = createMockCtx({ organizationId: undefined });

    const result = await handler(ctx, createValidArgs());

    expect(result.success).toBe(false);
    expect(result.message).toContain('organizationId is required');
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

  it('returns failure when approval creation throws', async () => {
    const handler = await getHandler();
    const ctx = createMockCtx({
      runMutation: vi.fn().mockRejectedValue(new Error('DB error')),
    });

    const result = await handler(ctx, createValidArgs());

    expect(result.success).toBe(false);
    expect(result.message).toContain('DB error');
  });

  it('forwards messageId from context to approval mutation', async () => {
    const handler = await getHandler();
    const mockRunMutation = vi.fn().mockResolvedValue('approval-id-2');
    const ctx = createMockCtx({
      runMutation: mockRunMutation,
      messageId: 'msg-abc',
    });

    await handler(ctx, createValidArgs());

    expect(mockRunMutation).toHaveBeenCalledWith(
      'mock-createWorkflowCreationApproval',
      expect.objectContaining({
        messageId: 'msg-abc',
      }),
    );
  });

  it('forwards resolved threadId to approval mutation', async () => {
    const handler = await getHandler();
    const mockRunMutation = vi.fn().mockResolvedValue('approval-id-3');
    const ctx = createMockCtx({
      runMutation: mockRunMutation,
    });

    await handler(ctx, createValidArgs());

    expect(mockRunMutation).toHaveBeenCalledWith(
      'mock-createWorkflowCreationApproval',
      expect.objectContaining({
        threadId: 'thread-123',
      }),
    );
  });
});
