import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../_generated/api', () => ({
  internal: {
    approvals: {
      internal_queries: {
        getApprovalById: 'mock-getApprovalById',
      },
    },
    workflow_engine: {
      internal_mutations: {
        startWorkflow: 'mock-startWorkflow',
      },
    },
    agent_tools: {
      workflows: {
        internal_mutations: {
          updateWorkflowRunApprovalWithResult:
            'mock-updateWorkflowRunApprovalWithResult',
          saveSystemMessage: 'mock-saveSystemMessage',
        },
      },
    },
  },
}));

vi.mock('../../../_generated/server', () => ({
  internalAction: vi.fn((def) => ({ _handler: def.handler })),
}));

function createMockApproval(overrides?: Record<string, unknown>) {
  return {
    _id: 'approval-1',
    status: 'approved',
    resourceType: 'workflow_run',
    organizationId: 'org-1',
    threadId: 'thread-1',
    executedAt: undefined,
    metadata: {
      workflowId: 'wf-def-1',
      workflowName: 'Test Workflow',
      parameters: { key: 'value' },
    },
    ...overrides,
  };
}

function createMockCtx(approval: ReturnType<typeof createMockApproval> | null) {
  return {
    runQuery: vi.fn().mockResolvedValue(approval),
    runMutation: vi.fn().mockResolvedValue('exec-1'),
  };
}

async function getHandler() {
  const mod = await import('../internal_actions');
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only: accessing mocked internalAction internals
  return (
    mod.executeApprovedWorkflowRun as unknown as {
      _handler: (
        ctx: ReturnType<typeof createMockCtx>,
        args: { approvalId: string; approvedBy: string },
      ) => Promise<Record<string, unknown>>;
    }
  )._handler;
}

describe('executeApprovedWorkflowRun', () => {
  it('starts workflow and updates approval on happy path', async () => {
    const handler = await getHandler();
    const approval = createMockApproval();
    const ctx = createMockCtx(approval);

    const result = await handler(ctx, {
      approvalId: 'approval-1',
      approvedBy: 'user-1',
    });

    expect(result.success).toBe(true);
    expect(result.executionId).toBe('exec-1');
    expect(ctx.runMutation).toHaveBeenCalledWith(
      'mock-startWorkflow',
      expect.objectContaining({
        organizationId: 'org-1',
        input: { key: 'value' },
        triggeredBy: 'agent_tool:run_workflow',
      }),
    );
    expect(ctx.runMutation).toHaveBeenCalledWith(
      'mock-updateWorkflowRunApprovalWithResult',
      expect.objectContaining({
        approvalId: 'approval-1',
        executionId: 'exec-1',
        executionError: null,
      }),
    );
  });

  it('throws when approval not found', async () => {
    const handler = await getHandler();
    const ctx = createMockCtx(null);

    await expect(
      handler(ctx, { approvalId: 'nonexistent', approvedBy: 'user-1' }),
    ).rejects.toThrow('Approval not found');
  });

  it('throws when approval status is not approved', async () => {
    const handler = await getHandler();
    const approval = createMockApproval({ status: 'pending' });
    const ctx = createMockCtx(approval);

    await expect(
      handler(ctx, { approvalId: 'approval-1', approvedBy: 'user-1' }),
    ).rejects.toThrow('approval status is "pending"');
  });

  it('throws when approval resourceType is wrong', async () => {
    const handler = await getHandler();
    const approval = createMockApproval({
      resourceType: 'integration_operation',
    });
    const ctx = createMockCtx(approval);

    await expect(
      handler(ctx, { approvalId: 'approval-1', approvedBy: 'user-1' }),
    ).rejects.toThrow('expected "workflow_run"');
  });

  it('throws on double execution (idempotency guard)', async () => {
    const handler = await getHandler();
    const approval = createMockApproval({ executedAt: Date.now() });
    const ctx = createMockCtx(approval);

    await expect(
      handler(ctx, { approvalId: 'approval-1', approvedBy: 'user-1' }),
    ).rejects.toThrow('already been executed');
  });

  it('throws when metadata is missing workflowId', async () => {
    const handler = await getHandler();
    const approval = createMockApproval({
      metadata: { workflowName: 'Test' },
    });
    const ctx = createMockCtx(approval);

    await expect(
      handler(ctx, { approvalId: 'approval-1', approvedBy: 'user-1' }),
    ).rejects.toThrow('missing workflow ID');
  });

  it('updates approval with error when workflow start fails', async () => {
    const handler = await getHandler();
    const approval = createMockApproval();
    const ctx = createMockCtx(approval);
    ctx.runMutation
      .mockResolvedValueOnce(undefined) // startWorkflow throws
      .mockRejectedValueOnce(new Error('Start failed'));

    // Re-mock to make startWorkflow fail
    ctx.runMutation = vi
      .fn()
      .mockRejectedValueOnce(new Error('Start failed'))
      .mockResolvedValueOnce(undefined);

    await expect(
      handler(ctx, { approvalId: 'approval-1', approvedBy: 'user-1' }),
    ).rejects.toThrow('Start failed');

    expect(ctx.runMutation).toHaveBeenCalledWith(
      'mock-updateWorkflowRunApprovalWithResult',
      expect.objectContaining({
        approvalId: 'approval-1',
        executionId: null,
        executionError: 'Start failed',
      }),
    );
  });

  it('posts system message when threadId exists', async () => {
    const handler = await getHandler();
    const approval = createMockApproval({ threadId: 'thread-abc' });
    const ctx = createMockCtx(approval);

    await handler(ctx, { approvalId: 'approval-1', approvedBy: 'user-1' });

    expect(ctx.runMutation).toHaveBeenCalledWith(
      'mock-saveSystemMessage',
      expect.objectContaining({
        threadId: 'thread-abc',
      }),
    );
  });

  it('does not post system message when threadId is absent', async () => {
    const handler = await getHandler();
    const approval = createMockApproval({ threadId: undefined });
    const ctx = createMockCtx(approval);

    await handler(ctx, { approvalId: 'approval-1', approvedBy: 'user-1' });

    expect(ctx.runMutation).not.toHaveBeenCalledWith(
      'mock-saveSystemMessage',
      expect.anything(),
    );
  });

  it('succeeds even when system message posting fails', async () => {
    const handler = await getHandler();
    const approval = createMockApproval();
    const ctx = createMockCtx(approval);

    let callCount = 0;
    ctx.runMutation = vi.fn().mockImplementation((ref) => {
      if (ref === 'mock-saveSystemMessage') {
        throw new Error('Message save failed');
      }
      callCount++;
      if (callCount === 1) return 'exec-1'; // startWorkflow
      return undefined; // updateWorkflowRunApprovalWithResult
    });

    const result = await handler(ctx, {
      approvalId: 'approval-1',
      approvedBy: 'user-1',
    });

    expect(result.success).toBe(true);
    expect(result.executionId).toBe('exec-1');
  });

  it('uses fallback when workflowName is missing', async () => {
    const handler = await getHandler();
    const approval = createMockApproval({
      metadata: { workflowId: 'wf-def-1', parameters: {} },
    });
    const ctx = createMockCtx(approval);

    const result = await handler(ctx, {
      approvalId: 'approval-1',
      approvedBy: 'user-1',
    });

    expect(result.message).toContain('Unknown Workflow');
  });

  it('uses empty object when parameters are missing', async () => {
    const handler = await getHandler();
    const approval = createMockApproval({
      metadata: { workflowId: 'wf-def-1', workflowName: 'Test' },
    });
    const ctx = createMockCtx(approval);

    await handler(ctx, { approvalId: 'approval-1', approvedBy: 'user-1' });

    expect(ctx.runMutation).toHaveBeenCalledWith(
      'mock-startWorkflow',
      expect.objectContaining({
        input: {},
      }),
    );
  });
});
