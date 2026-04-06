import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../_generated/api', () => ({
  internal: {
    approvals: {
      internal_queries: {
        getApprovalById: 'mock-getApprovalById',
      },
    },
    workflows: {
      file_actions: {
        readWorkflowForExecution: 'mock-readWorkflowForExecution',
        saveWorkflowForExecution: 'mock-saveWorkflowForExecution',
      },
    },
    agent_tools: {
      workflows: {
        internal_mutations: {
          claimWorkflowApprovalForExecution:
            'mock-claimWorkflowApprovalForExecution',
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

const MOCK_WORKFLOW_CONFIG = {
  name: 'Test Workflow',
  description: 'test',
  version: '1.0.0',
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
      config: { type: 'send_email' },
      nextSteps: { success: 'noop' },
    },
  ],
};

function createMockApproval(overrides?: Record<string, unknown>) {
  return {
    _id: 'approval-1',
    status: 'executing',
    resourceType: 'workflow_update',
    organizationId: 'org-1',
    threadId: 'thread-1',
    executedAt: undefined,
    metadata: {
      updateType: 'full_save',
      updateSummary: 'Added error handling',
      workflowSlug: 'test-workflow',
      workflowName: 'Test Workflow',
      workflowVersion: '1.0.0',
      workflowConfig: { name: 'Test Workflow', description: 'test' },
      stepsConfig: [
        {
          stepSlug: 'start',
          name: 'Start',
          stepType: 'start',
          config: {},
          nextSteps: { success: 'end' },
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
      workflowSlug: 'test-workflow',
      workflowName: 'Test Workflow',
      workflowVersion: '1.0.0',
      stepSlug: 'send_email',
      stepName: 'Send Email',
      stepUpdates: { config: { type: 'send_email', template: 'new' } },
    },
    ...overrides,
  });
}

function createMultiStepPatchApproval() {
  return createMockApproval({
    metadata: {
      updateType: 'multi_step_patch',
      updateSummary: 'Updated multiple steps',
      workflowSlug: 'test-workflow',
      workflowName: 'Test Workflow',
      workflowVersion: '1.0.0',
      steps: [
        {
          stepSlug: 'start',
          stepName: 'Start',
          stepUpdates: { name: 'Begin' },
        },
        {
          stepSlug: 'send_email',
          stepName: 'Send Email',
          stepUpdates: { config: { type: 'send_email', template: 'v2' } },
        },
      ],
    },
  });
}

function createMockCtx(approval: ReturnType<typeof createMockApproval> | null) {
  return {
    runQuery: vi.fn().mockImplementation((ref: string) => {
      if (ref === 'mock-getApprovalById') return approval;
      return null;
    }),
    runMutation: vi.fn().mockResolvedValue('result-1'),
    runAction: vi.fn().mockImplementation((ref: string) => {
      if (ref === 'mock-readWorkflowForExecution') {
        return { ok: true, config: structuredClone(MOCK_WORKFLOW_CONFIG) };
      }
      if (ref === 'mock-saveWorkflowForExecution') {
        return { hash: 'new-hash' };
      }
      return null;
    }),
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
  it('saves workflow file on full_save happy path', async () => {
    const handler = await getHandler();
    const approval = createMockApproval();
    const ctx = createMockCtx(approval);

    const result = await handler(ctx, {
      approvalId: 'approval-1',
      approvedBy: 'user-1',
    });

    expect(result.success).toBe(true);
    expect(ctx.runAction).toHaveBeenCalledWith(
      'mock-saveWorkflowForExecution',
      expect.objectContaining({
        workflowSlug: 'test-workflow',
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

  it('applies step_patch to correct step in file', async () => {
    const handler = await getHandler();
    const approval = createStepPatchApproval();
    const ctx = createMockCtx(approval);

    const result = await handler(ctx, {
      approvalId: 'approval-1',
      approvedBy: 'user-1',
    });

    expect(result.success).toBe(true);

    // Verify the saved config has the patched step
    const saveCall = ctx.runAction.mock.calls.find(
      (call) => call[0] === 'mock-saveWorkflowForExecution',
    );
    expect(saveCall).toBeDefined();
    if (!saveCall) throw new Error('Expected saveCall to be defined');
    const savedConfig = saveCall[1].config;
    const patchedStep = savedConfig.steps.find(
      (s: { stepSlug: string }) => s.stepSlug === 'send_email',
    );
    expect(patchedStep.config).toEqual({
      type: 'send_email',
      template: 'new',
    });
  });

  it('applies multi_step_patch to all steps in file', async () => {
    const handler = await getHandler();
    const approval = createMultiStepPatchApproval();
    const ctx = createMockCtx(approval);

    const result = await handler(ctx, {
      approvalId: 'approval-1',
      approvedBy: 'user-1',
    });

    expect(result.success).toBe(true);

    const saveCall = ctx.runAction.mock.calls.find(
      (call) => call[0] === 'mock-saveWorkflowForExecution',
    );
    expect(saveCall).toBeDefined();
    if (!saveCall) throw new Error('Expected saveCall to be defined');
    const savedConfig = saveCall[1].config;

    const startStep = savedConfig.steps.find(
      (s: { stepSlug: string }) => s.stepSlug === 'start',
    );
    expect(startStep.name).toBe('Begin');

    const emailStep = savedConfig.steps.find(
      (s: { stepSlug: string }) => s.stepSlug === 'send_email',
    );
    expect(emailStep.config).toEqual({
      type: 'send_email',
      template: 'v2',
    });
  });

  it('throws when approval not found', async () => {
    const handler = await getHandler();
    const ctx = createMockCtx(null);

    await expect(
      handler(ctx, { approvalId: 'nonexistent', approvedBy: 'user-1' }),
    ).rejects.toThrow('Approval not found');
  });

  it('throws when approval status is not executing', async () => {
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
    const approval = createMockApproval();
    const ctx = createMockCtx(approval);
    ctx.runMutation = vi.fn().mockImplementation((ref: string) => {
      if (ref === 'mock-claimWorkflowApprovalForExecution') return false;
      return 'result-1';
    });

    await expect(
      handler(ctx, { approvalId: 'approval-1', approvedBy: 'user-1' }),
    ).rejects.toThrow('already been executed');
  });

  it('throws when metadata is missing workflowSlug', async () => {
    const handler = await getHandler();
    const approval = createMockApproval({
      metadata: { updateType: 'full_save', updateSummary: 'test' },
    });
    const ctx = createMockCtx(approval);

    await expect(
      handler(ctx, { approvalId: 'approval-1', approvedBy: 'user-1' }),
    ).rejects.toThrow('missing workflow slug');
  });

  it('throws when workflow file is not found', async () => {
    const handler = await getHandler();
    const approval = createMockApproval();
    const ctx = createMockCtx(approval);
    ctx.runAction = vi.fn().mockImplementation((ref: string) => {
      if (ref === 'mock-readWorkflowForExecution') {
        return { ok: false, error: 'not_found', message: 'File not found' };
      }
      return null;
    });

    await expect(
      handler(ctx, { approvalId: 'approval-1', approvedBy: 'user-1' }),
    ).rejects.toThrow('file may have been deleted');
  });

  it('throws when step_patch step not found in file', async () => {
    const handler = await getHandler();
    const approval = createStepPatchApproval({
      metadata: {
        updateType: 'step_patch',
        updateSummary: 'test',
        workflowSlug: 'test-workflow',
        workflowName: 'Test Workflow',
        workflowVersion: '1.0.0',
        stepSlug: 'nonexistent_step',
        stepName: 'Missing Step',
        stepUpdates: { name: 'Updated' },
      },
    });
    const ctx = createMockCtx(approval);

    await expect(
      handler(ctx, { approvalId: 'approval-1', approvedBy: 'user-1' }),
    ).rejects.toThrow('not found');
  });

  it('records error in approval when execution fails', async () => {
    const handler = await getHandler();
    const approval = createMockApproval();
    const ctx = createMockCtx(approval);
    ctx.runAction = vi.fn().mockImplementation((ref: string) => {
      if (ref === 'mock-readWorkflowForExecution') {
        return { ok: true, config: structuredClone(MOCK_WORKFLOW_CONFIG) };
      }
      if (ref === 'mock-saveWorkflowForExecution')
        throw new Error('Save failed');
      return null;
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

    const originalRunMutation = ctx.runMutation;
    ctx.runMutation = vi.fn().mockImplementation((ref: string, ...rest) => {
      if (ref === 'mock-saveSystemMessage') {
        throw new Error('Message save failed');
      }
      return originalRunMutation(ref, ...rest);
    });

    const result = await handler(ctx, {
      approvalId: 'approval-1',
      approvedBy: 'user-1',
    });

    expect(result.success).toBe(true);
  });
});
