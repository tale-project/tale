import { describe, expect, it, vi } from 'vitest';

vi.mock('../../_generated/api', () => ({
  internal: {
    approvals: {
      internal_queries: {
        getApprovalById: 'mock-getApprovalById',
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

// The executor writes automations/<slug>/automation.json then runs the
// standard install pipeline — mock the fs seams so no real files are touched.
// resolveAutomationDir returns a nonexistent path, so the executor's real
// `stat` probe resolves to "no existing automation dir".
vi.mock('../../automations/file_utils', () => ({
  resolveAutomationDir: vi.fn(
    (orgSlug: string, slug: string) =>
      `/nonexistent-test-config/${orgSlug}/automations/${slug}`,
  ),
  resolveAutomationManifestPath: vi.fn(
    (orgSlug: string, slug: string) =>
      `/nonexistent-test-config/${orgSlug}/automations/${slug}/automation.json`,
  ),
}));

vi.mock('../../automations/install_fs', () => ({
  automationExistsInBuiltinCatalog: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../automations/install_actions', () => ({
  prepareInstallAs: vi.fn().mockResolvedValue({
    orgSlug: 'default',
    installedBy: 'user-1',
    manifest: { name: 'Test Workflow', scope: 'org' },
  }),
  ensureOrgResources: vi
    .fn()
    .mockResolvedValue({ workflows: 1, agents: 0, resources: 0 }),
}));

// Partial mock: only the write is stubbed — `sha256`/`serializeJson` stay real
// (the specification fingerprint hashes through them).
vi.mock(import('../../lib/file_io'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    atomicWrite: vi.fn().mockResolvedValue(undefined),
  };
});

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
      workflowSlug: 'test-workflow',
      workflowConfig: {},
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
    runAction: vi.fn(),
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

/** The automation manifest the executor wrote (parsed from atomicWrite). */
async function writtenManifest(): Promise<Record<string, unknown>> {
  const { atomicWrite } = await import('../../lib/file_io');
  const call = vi.mocked(atomicWrite).mock.calls.at(-1);
  expect(call).toBeDefined();
  if (!call) throw new Error('Expected atomicWrite to have been called');
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only parse of the serialized manifest
  return JSON.parse(call[1]) as Record<string, unknown>;
}

describe('executeApprovedWorkflowCreation', () => {
  it('writes an org automation manifest carrying the workflow inline and installs it', async () => {
    const handler = await getHandler();
    const approval = createMockApproval();
    const ctx = createMockCtx(approval);

    const result = await handler(ctx, {
      approvalId: 'approval-1',
      approvedBy: 'user-1',
    });

    expect(result.success).toBe(true);
    expect(result.workflowSlug).toBe('test-workflow');

    const { atomicWrite } = await import('../../lib/file_io');
    expect(vi.mocked(atomicWrite).mock.calls.at(-1)?.[0]).toBe(
      '/nonexistent-test-config/default/automations/test-workflow/automation.json',
    );
    const manifest = await writtenManifest();
    expect(manifest.name).toBe('Test Workflow');
    expect(manifest.scope).toBe('org');
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only manifest shape probe
    const workflow = manifest.workflow as Record<string, unknown>;
    expect(Array.isArray(workflow.steps)).toBe(true);
    expect(workflow.specification).toBeUndefined();
    expect(workflow.specificationMeta).toBeUndefined();

    // Installed through the ONE pipeline every install path shares, as the
    // approving user.
    const { prepareInstallAs, ensureOrgResources } =
      await import('../../automations/install_actions');
    expect(prepareInstallAs).toHaveBeenCalledWith(
      'default',
      'test-workflow',
      'user-1',
    );
    expect(ensureOrgResources).toHaveBeenCalledWith(
      ctx,
      'org-1',
      'test-workflow',
      expect.objectContaining({ orgSlug: 'default' }),
    );
  });

  it('links the automation URL in the system message', async () => {
    const handler = await getHandler();
    const approval = createMockApproval();
    const ctx = createMockCtx(approval);

    await handler(ctx, { approvalId: 'approval-1', approvedBy: 'user-1' });

    const messageCall = ctx.runMutation.mock.calls.find(
      (call) => call[0] === 'mock-saveSystemMessage',
    );
    expect(messageCall).toBeDefined();
    if (!messageCall) throw new Error('Expected saveSystemMessage call');
    expect(messageCall[1].content).toContain('/automations/test-workflow');
    expect(messageCall[1].content).not.toContain('/workflows/test-workflow');
  });

  it('refuses a slug that already exists in the built-in catalog', async () => {
    const { automationExistsInBuiltinCatalog } =
      await import('../../automations/install_fs');
    vi.mocked(automationExistsInBuiltinCatalog).mockResolvedValueOnce(true);

    const handler = await getHandler();
    const approval = createMockApproval();
    const ctx = createMockCtx(approval);

    await expect(
      handler(ctx, { approvalId: 'approval-1', approvedBy: 'user-1' }),
    ).rejects.toThrow(/already exists in the built-in catalog/);

    // The failure is recorded on the approval.
    const resultCall = ctx.runMutation.mock.calls.find(
      (call) => call[0] === 'mock-updateWorkflowApprovalWithResult',
    );
    expect(resultCall?.[1].executionError).toMatch(/already exists/);
  });

  it('refuses an invalid (foldered) workflow slug', async () => {
    const handler = await getHandler();
    const approval = createMockApproval({
      metadata: {
        workflowName: 'Foldered',
        workflowSlug: 'shopify/sync-customers',
        workflowConfig: {},
        stepsConfig: [
          {
            stepSlug: 'start',
            name: 'Start',
            stepType: 'start',
            config: {},
            nextSteps: {},
          },
        ],
      },
    });
    const ctx = createMockCtx(approval);

    await expect(
      handler(ctx, { approvalId: 'approval-1', approvedBy: 'user-1' }),
    ).rejects.toThrow(/Invalid workflow slug/);
  });

  it('Title-Cases the manifest name for legacy approvals whose name is the slug', async () => {
    const handler = await getHandler();
    const approval = createMockApproval({
      metadata: {
        workflowName: 'test-workflow',
        workflowSlug: 'test-workflow',
        workflowConfig: {},
        stepsConfig: [
          {
            stepSlug: 'start',
            name: 'Start',
            stepType: 'start',
            config: {},
            nextSteps: {},
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
    const manifest = await writtenManifest();
    expect(manifest.name).toBe('Test Workflow');
  });

  describe('specification (W5b)', () => {
    it('records specification + specificationMeta synced to the created graph when supplied', async () => {
      const handler = await getHandler();
      const approval = createMockApproval({
        metadata: {
          workflowName: 'Test Workflow',
          workflowSlug: 'test-workflow',
          workflowConfig: {
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
      const manifest = await writtenManifest();
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only manifest shape probe
      const workflow = manifest.workflow as Record<string, unknown>;
      expect(workflow.specification).toBe('Start, then end.');
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only manifest shape probe
      const meta = workflow.specificationMeta as Record<string, unknown>;
      expect(meta.direction).toBe('graph_to_spec');
      expect(meta.sourceHash).toBeTruthy();
    });
  });
});
