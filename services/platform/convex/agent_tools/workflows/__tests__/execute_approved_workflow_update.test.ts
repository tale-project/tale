import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../_generated/api', () => ({
  internal: {
    approvals: {
      internal_queries: {
        getApprovalById: 'mock-getApprovalById',
      },
    },
    wf_definitions: {
      internal_queries: {
        resolveWorkflow: 'mock-resolveWorkflow',
      },
      internal_mutations: {
        saveWorkflowWithSteps: 'mock-saveWorkflowWithSteps',
      },
    },
    wf_step_defs: {
      internal_mutations: {
        patchStep: 'mock-patchStep',
      },
    },
    agent_tools: {
      workflows: {
        internal_mutations: {
          updateWorkflowUpdateApprovalWithResult:
            'mock-updateWorkflowUpdateApprovalWithResult',
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
    resourceType: 'workflow_update',
    organizationId: 'org-1',
    threadId: 'thread-1',
    executedAt: undefined,
    metadata: {
      updateType: 'full_save',
      updateSummary: 'Added error handling',
      workflowId: 'wf-def-1',
      workflowName: 'Test Workflow',
      workflowVersionNumber: 3,
      workflowConfig: { name: 'Test Workflow', description: 'test' },
      stepsConfig: [
        {
          stepSlug: 'start',
          name: 'Start',
          stepType: 'start',
          config: {},
          nextSteps: { default: 'end' },
        },
      ],
    },
    ...overrides,
  };
}

function createStepPatchApproval(overrides?: Record<string, unknown>) {
  return createMockApproval({
    metadata: {
      updateType: 'step_patch',
      updateSummary: 'Updated email template',
      workflowId: 'wf-def-1',
      workflowName: 'Test Workflow',
      workflowVersionNumber: 3,
      stepRecordId: 'step-1',
      stepName: 'Send Email',
      stepUpdates: { config: { type: 'send_email' } },
    },
    ...overrides,
  });
}

function createMockCtx(approval: ReturnType<typeof createMockApproval> | null) {
  const workflow = approval
    ? {
        _id: 'wf-def-1',
        versionNumber:
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only: accessing mock metadata
          (approval.metadata as Record<string, unknown>).workflowVersionNumber,
        name: 'Test Workflow',
      }
    : null;

  return {
    runQuery: vi.fn().mockImplementation((ref: string) => {
      if (ref === 'mock-getApprovalById') return approval;
      if (ref === 'mock-resolveWorkflow') return workflow;
      return null;
    }),
    runMutation: vi.fn().mockResolvedValue('result-1'),
  };
}

async function getHandler() {
  const mod = await import('../internal_actions');
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only: accessing mocked internalAction internals
  return (
    mod.executeApprovedWorkflowUpdate as unknown as {
      _handler: (
        ctx: ReturnType<typeof createMockCtx>,
        args: { approvalId: string; approvedBy: string },
      ) => Promise<Record<string, unknown>>;
    }
  )._handler;
}

describe('executeApprovedWorkflowUpdate', () => {
  it('calls saveWorkflowWithSteps on full_save happy path', async () => {
    const handler = await getHandler();
    const approval = createMockApproval();
    const ctx = createMockCtx(approval);

    const result = await handler(ctx, {
      approvalId: 'approval-1',
      approvedBy: 'user-1',
    });

    expect(result.success).toBe(true);
    expect(ctx.runMutation).toHaveBeenCalledWith(
      'mock-saveWorkflowWithSteps',
      expect.objectContaining({
        organizationId: 'org-1',
      }),
    );
    expect(ctx.runMutation).toHaveBeenCalledWith(
      'mock-updateWorkflowUpdateApprovalWithResult',
      expect.objectContaining({
        approvalId: 'approval-1',
        executionError: null,
      }),
    );
  });

  it('calls patchStep on step_patch happy path', async () => {
    const handler = await getHandler();
    const approval = createStepPatchApproval();
    const ctx = createMockCtx(approval);

    const result = await handler(ctx, {
      approvalId: 'approval-1',
      approvedBy: 'user-1',
    });

    expect(result.success).toBe(true);
    expect(ctx.runMutation).toHaveBeenCalledWith(
      'mock-patchStep',
      expect.objectContaining({
        updates: { config: { type: 'send_email' } },
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
      resourceType: 'workflow_creation',
    });
    const ctx = createMockCtx(approval);

    await expect(
      handler(ctx, { approvalId: 'approval-1', approvedBy: 'user-1' }),
    ).rejects.toThrow('expected "workflow_update"');
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
      metadata: { updateType: 'full_save', updateSummary: 'test' },
    });
    const ctx = createMockCtx(approval);

    await expect(
      handler(ctx, { approvalId: 'approval-1', approvedBy: 'user-1' }),
    ).rejects.toThrow('missing workflow ID');
  });

  it('throws on stale data (version mismatch)', async () => {
    const handler = await getHandler();
    const approval = createMockApproval();
    const ctx = createMockCtx(approval);
    // Override resolveWorkflow to return a different version
    ctx.runQuery = vi.fn().mockImplementation((ref: string) => {
      if (ref === 'mock-getApprovalById') return approval;
      if (ref === 'mock-resolveWorkflow')
        return { _id: 'wf-def-1', versionNumber: 999, name: 'Test' };
      return null;
    });

    await expect(
      handler(ctx, { approvalId: 'approval-1', approvedBy: 'user-1' }),
    ).rejects.toThrow('modified after this update was proposed');

    expect(ctx.runMutation).toHaveBeenCalledWith(
      'mock-updateWorkflowUpdateApprovalWithResult',
      expect.objectContaining({
        executionError: expect.stringContaining('modified after'),
      }),
    );
  });

  it('throws when workflow is deleted', async () => {
    const handler = await getHandler();
    const approval = createMockApproval();
    const ctx = createMockCtx(approval);
    ctx.runQuery = vi.fn().mockImplementation((ref: string) => {
      if (ref === 'mock-getApprovalById') return approval;
      if (ref === 'mock-resolveWorkflow') return null;
      return null;
    });

    await expect(
      handler(ctx, { approvalId: 'approval-1', approvedBy: 'user-1' }),
    ).rejects.toThrow('not found');
  });

  it('throws when step_patch step not found (patchStep returns null)', async () => {
    const handler = await getHandler();
    const approval = createStepPatchApproval();
    const ctx = createMockCtx(approval);
    ctx.runMutation = vi.fn().mockImplementation((ref: string) => {
      if (ref === 'mock-patchStep') return null;
      return undefined;
    });

    await expect(
      handler(ctx, { approvalId: 'approval-1', approvedBy: 'user-1' }),
    ).rejects.toThrow('not found');
  });

  it('records error in approval when execution fails', async () => {
    const handler = await getHandler();
    const approval = createMockApproval();
    const ctx = createMockCtx(approval);
    ctx.runMutation = vi.fn().mockImplementation((ref: string) => {
      if (ref === 'mock-saveWorkflowWithSteps') throw new Error('Save failed');
      return undefined;
    });

    await expect(
      handler(ctx, { approvalId: 'approval-1', approvedBy: 'user-1' }),
    ).rejects.toThrow('Save failed');

    expect(ctx.runMutation).toHaveBeenCalledWith(
      'mock-updateWorkflowUpdateApprovalWithResult',
      expect.objectContaining({
        approvalId: 'approval-1',
        executionError: 'Save failed',
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

    ctx.runMutation = vi.fn().mockImplementation((ref: string) => {
      if (ref === 'mock-saveSystemMessage') {
        throw new Error('Message save failed');
      }
      return undefined;
    });

    const result = await handler(ctx, {
      approvalId: 'approval-1',
      approvedBy: 'user-1',
    });

    expect(result.success).toBe(true);
  });
});
