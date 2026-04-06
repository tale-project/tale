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
    workflows: {
      file_actions: {
        readWorkflowForExecution: 'mock-readWorkflowForExecution',
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
  createTool: vi.fn((def) => ({ _handler: def.execute })),
}));

const MOCK_WORKFLOW_CONFIG = {
  name: 'My Workflow',
  description: 'A test workflow',
  version: '2.0.0',
  enabled: true,
  steps: [
    {
      stepSlug: 'start',
      name: 'Start',
      stepType: 'start',
      config: {},
      nextSteps: { success: 'send_email' },
    },
    {
      stepSlug: 'send_email',
      name: 'Send Email',
      stepType: 'action',
      config: { type: 'send_email', to: 'old@example.com' },
      nextSteps: { success: 'noop' },
    },
  ],
};

function createMockCtx(overrides?: Record<string, unknown>) {
  return {
    organizationId: 'org1',
    userId: 'user1',
    threadId: 'thread-current',
    messageId: 'msg-123',
    runAction: vi.fn().mockImplementation((ref: string) => {
      if (ref === 'mock-readWorkflowForExecution') {
        return { ok: true, config: structuredClone(MOCK_WORKFLOW_CONFIG) };
      }
      return null;
    }),
    runMutation: vi.fn().mockResolvedValue('approval-id-1'),
    ...overrides,
  };
}

function createValidArgs() {
  return {
    workflowSlug: 'my-workflow',
    stepSlug: 'send_email',
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
        workflowSlug: 'my-workflow',
        workflowName: 'My Workflow',
        workflowVersion: '2.0.0',
        updateSummary: 'Updated email template',
        stepSlug: 'send_email',
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

  it('returns failure when step not found in workflow file', async () => {
    const handler = await getHandler();
    const ctx = createMockCtx();

    const args = {
      ...createValidArgs(),
      stepSlug: 'nonexistent_step',
    };

    const result = await handler(ctx, args);

    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
    expect(result.message).toContain('nonexistent_step');
  });

  it('returns failure when workflow file not found', async () => {
    const handler = await getHandler();
    const ctx = createMockCtx({
      runAction: vi.fn().mockImplementation((ref: string) => {
        if (ref === 'mock-readWorkflowForExecution') {
          return { ok: false, error: 'not_found', message: 'File not found' };
        }
        return null;
      }),
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
      workflowSlug: 'my-workflow',
      stepSlug: 'send_email',
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
