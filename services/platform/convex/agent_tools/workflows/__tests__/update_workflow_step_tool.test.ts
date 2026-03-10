import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../_generated/api', () => ({
  internal: {
    agent_tools: {
      workflows: {
        internal_mutations: {
          createWorkflowStepUpdateApproval:
            'mock-createWorkflowStepUpdateApproval',
        },
      },
    },
    wf_step_defs: {
      internal_queries: {
        getStepWithWorkflowInfo: 'mock-getStepWithWorkflowInfo',
      },
    },
  },
}));

vi.mock('../../../threads/get_parent_thread_id', () => ({
  getApprovalThreadId: vi.fn().mockResolvedValue('thread-123'),
}));

vi.mock(
  '../../../workflow_engine/helpers/validation/validate_step_config',
  () => ({
    validateStepConfig: vi
      .fn()
      .mockReturnValue({ valid: true, errors: [], warnings: [] }),
    isValidStepType: vi.fn().mockReturnValue(false),
  }),
);

vi.mock('@convex-dev/agent', () => ({
  createTool: vi.fn((def) => ({ _handler: def.handler })),
}));

function createMockStepInfo() {
  return {
    step: { name: 'Send Email', stepType: 'action' },
    workflowId: 'wf-def-1',
    workflowName: 'My Workflow',
    workflowVersionNumber: 2,
  };
}

function createMockCtx(overrides?: Record<string, unknown>) {
  return {
    organizationId: 'org1',
    userId: 'user1',
    threadId: 'thread-current',
    messageId: 'msg-123',
    runQuery: vi.fn().mockResolvedValue(createMockStepInfo()),
    runMutation: vi.fn().mockResolvedValue('approval-id-1'),
    ...overrides,
  };
}

function createValidArgs() {
  return {
    stepRecordId: 'step-record-1',
    updates: {
      config: { type: 'send_email', to: '{{email}}' },
      stepType: 'action' as const,
    },
    updateSummary: 'Updated email template',
  };
}

async function getHandler() {
  const { updateWorkflowStepTool } =
    await import('../update_workflow_step_tool');
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only: accessing mocked createTool internals
  return (updateWorkflowStepTool.tool as unknown as { _handler: Function })
    ._handler;
}

describe('update_workflow_step tool handler', () => {
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
      'mock-createWorkflowStepUpdateApproval',
      expect.objectContaining({
        organizationId: 'org1',
        workflowName: 'My Workflow',
        workflowVersionNumber: 2,
        updateSummary: 'Updated email template',
        stepName: 'Send Email',
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

  it('returns failure when step not found', async () => {
    const handler = await getHandler();
    const ctx = createMockCtx({
      runQuery: vi.fn().mockResolvedValue(null),
    });

    const result = await handler(ctx, createValidArgs());

    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });

  it('returns failure when step validation fails', async () => {
    const { validateStepConfig } =
      await import('../../../workflow_engine/helpers/validation/validate_step_config');
    vi.mocked(validateStepConfig).mockReturnValueOnce({
      valid: false,
      errors: ['Missing required field: type'],
      warnings: [],
    });

    const handler = await getHandler();
    const ctx = createMockCtx();

    const result = await handler(ctx, createValidArgs());

    expect(result.success).toBe(false);
    expect(result.message).toContain('validation failed');
    expect(result.validationErrors).toContain('Missing required field: type');
  });

  it('returns failure when approval creation throws', async () => {
    const handler = await getHandler();
    const ctx = createMockCtx({
      runQuery: vi.fn().mockResolvedValue(createMockStepInfo()),
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
      messageId: 'msg-xyz',
    });

    await handler(ctx, createValidArgs());

    expect(mockRunMutation).toHaveBeenCalledWith(
      'mock-createWorkflowStepUpdateApproval',
      expect.objectContaining({
        threadId: 'thread-123',
        messageId: 'msg-xyz',
      }),
    );
  });

  it('rejects updates with control characters in unrecoverable field names', async () => {
    const handler = await getHandler();
    const ctx = createMockCtx();

    const args = {
      stepRecordId: 'step-record-1',
      updates: {
        config: { 'bad\nfield': 'value' },
      },
      updateSummary: 'test',
    };

    const result = await handler(ctx, args);

    expect(result.success).toBe(false);
    expect(result.message).toContain('control characters');
  });
});
