import { describe, expect, it, vi } from 'vitest';

vi.mock('../../_generated/api', () => ({
  internal: {
    approvals: {
      internal_queries: {
        getApprovalById: 'mock-getApprovalById',
      },
    },
    workflows: {
      file_actions: {
        saveWorkflowForExecution: 'mock-saveWorkflowForExecution',
      },
      installations: {
        upsertInstallation: 'mock-upsertInstallation',
      },
    },
    agent_tools: {
      workflows: {
        internal_mutations: {
          claimWorkflowApprovalForExecution:
            'mock-claimWorkflowApprovalForExecution',
          updateWorkflowApprovalWithResult:
            'mock-updateWorkflowApprovalWithResult',
          saveSystemMessage: 'mock-saveSystemMessage',
        },
      },
    },
  },
}));

vi.mock('../../_generated/server', () => ({
  internalAction: vi.fn((def) => ({ _handler: def.handler })),
}));

vi.mock('../../organizations/resolve_org_slug', () => ({
  resolveOrgSlug: vi.fn().mockResolvedValue('default'),
}));

function createMockApproval(overrides?: Record<string, unknown>) {
  return {
    _id: 'approval-1',
    status: 'executing',
    resourceType: 'workflow_creation',
    organizationId: 'org-1',
    threadId: 'thread-1',
    executedAt: undefined,
    metadata: {
      workflowName: 'Test Workflow',
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

function createMockCtx(approval: ReturnType<typeof createMockApproval> | null) {
  return {
    runQuery: vi.fn().mockImplementation((ref: string) => {
      if (ref === 'mock-getApprovalById') return approval;
      return null;
    }),
    runMutation: vi.fn().mockResolvedValue('result-1'),
    runAction: vi.fn().mockImplementation((ref: string) => {
      if (ref === 'mock-saveWorkflowForExecution') {
        return { hash: 'new-hash' };
      }
      return null;
    }),
  };
}

async function getHandler() {
  const mod = await import('./internal_actions');
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only: accessing mocked internalAction internals
  return (
    mod.executeApprovedWorkflowCreation as unknown as {
      _handler: (
        ctx: ReturnType<typeof createMockCtx>,
        args: { approvalId: string; approvedBy: string },
      ) => Promise<Record<string, unknown>>;
    }
  )._handler;
}

describe('executeApprovedWorkflowCreation', () => {
  it('creates the workflow file without a specification', async () => {
    const handler = await getHandler();
    const approval = createMockApproval();
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
    expect(savedConfig.specification).toBeUndefined();
    expect(savedConfig.specificationMeta).toBeUndefined();
  });

  describe('specification (W5b)', () => {
    it('records specification + specificationMeta synced to the created graph when supplied', async () => {
      const handler = await getHandler();
      const approval = createMockApproval({
        metadata: {
          workflowName: 'Test Workflow',
          workflowConfig: {
            name: 'Test Workflow',
            description: 'test',
            specification: 'Start, then end.',
          },
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
      });
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
      expect(savedConfig.specification).toBe('Start, then end.');
      expect(savedConfig.specificationMeta.direction).toBe('graph_to_spec');
      expect(savedConfig.specificationMeta.sourceHash).toBeTruthy();
    });
  });
});
