import { describe, expect, it, vi } from 'vitest';

import { runWorkflowArgs } from '../run_workflow_tool';

vi.mock('../../../_generated/api', () => ({
  internal: {
    wf_definitions: {
      internal_queries: {
        resolveWorkflow: 'mock-resolveWorkflow',
      },
    },
    agent_tools: {
      workflows: {
        internal_mutations: {
          createWorkflowRunApproval: 'mock-createWorkflowRunApproval',
        },
      },
    },
  },
}));

vi.mock('../../../threads/get_parent_thread_id', () => ({
  getApprovalThreadId: vi.fn().mockResolvedValue('thread-123'),
}));

// Mock createTool to expose the raw handler for testing
vi.mock('@convex-dev/agent', () => ({
  createTool: vi.fn((def) => ({ _handler: def.handler })),
}));

function createMockCtx(overrides?: Record<string, unknown>) {
  return {
    organizationId: 'org1',
    userId: 'user1',
    threadId: 'thread-current',
    runQuery: vi.fn(),
    runMutation: vi.fn(),
    ...overrides,
  };
}

function createMockWorkflow(overrides?: Record<string, unknown>) {
  return {
    _id: 'wf-def-123',
    organizationId: 'org1',
    name: 'Test Workflow',
    description: 'A test workflow',
    status: 'active',
    ...overrides,
  };
}

// Access the raw handler exposed by our createTool mock
async function getHandler() {
  const { runWorkflowTool } = await import('../run_workflow_tool');
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only: accessing mocked createTool internals
  return (runWorkflowTool.tool as unknown as { _handler: Function })._handler;
}

describe('run_workflow tool handler', () => {
  it('creates approval on happy path', async () => {
    const handler = await getHandler();
    const workflow = createMockWorkflow();
    const ctx = createMockCtx({
      runQuery: vi.fn().mockResolvedValue(workflow),
      runMutation: vi.fn().mockResolvedValue('approval-id-1'),
    });

    const result = await handler(ctx, { workflowId: 'wf-def-123' });

    expect(result.success).toBe(true);
    expect(result.requiresApproval).toBe(true);
    expect(result.approvalId).toBe('approval-id-1');
    expect(result.approvalCreated).toBe(true);
  });

  it('returns failure when organizationId is missing', async () => {
    const handler = await getHandler();
    const ctx = createMockCtx({ organizationId: undefined });

    const result = await handler(ctx, { workflowId: 'wf-def-123' });

    expect(result.success).toBe(false);
    expect(result.message).toContain('organizationId is required');
  });

  it('returns failure when workflow not found', async () => {
    const handler = await getHandler();
    const ctx = createMockCtx({
      runQuery: vi.fn().mockResolvedValue(null),
    });

    const result = await handler(ctx, { workflowId: 'nonexistent' });

    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });

  it('returns failure when workflow belongs to different org', async () => {
    const handler = await getHandler();
    const workflow = createMockWorkflow({ organizationId: 'other-org' });
    const ctx = createMockCtx({
      runQuery: vi.fn().mockResolvedValue(workflow),
    });

    const result = await handler(ctx, { workflowId: 'wf-def-123' });

    expect(result.success).toBe(false);
    expect(result.message).toContain('does not belong');
  });

  it('returns failure when workflow is archived', async () => {
    const handler = await getHandler();
    const workflow = createMockWorkflow({ status: 'archived' });
    const ctx = createMockCtx({
      runQuery: vi.fn().mockResolvedValue(workflow),
    });

    const result = await handler(ctx, { workflowId: 'wf-def-123' });

    expect(result.success).toBe(false);
    expect(result.message).toContain('archived');
  });

  it('allows draft workflows', async () => {
    const handler = await getHandler();
    const workflow = createMockWorkflow({ status: 'draft' });
    const ctx = createMockCtx({
      runQuery: vi.fn().mockResolvedValue(workflow),
      runMutation: vi.fn().mockResolvedValue('approval-id-2'),
    });

    const result = await handler(ctx, { workflowId: 'wf-def-123' });

    expect(result.success).toBe(true);
  });

  it('forwards parameters to approval mutation', async () => {
    const handler = await getHandler();
    const workflow = createMockWorkflow();
    const mockRunMutation = vi.fn().mockResolvedValue('approval-id-3');
    const ctx = createMockCtx({
      runQuery: vi.fn().mockResolvedValue(workflow),
      runMutation: mockRunMutation,
    });

    const params = { targetFolder: '/invoices', daysBack: 30 };
    await handler(ctx, {
      workflowId: 'wf-def-123',
      parameters: params,
    });

    expect(mockRunMutation).toHaveBeenCalledWith(
      'mock-createWorkflowRunApproval',
      expect.objectContaining({
        parameters: params,
        workflowName: 'Test Workflow',
      }),
    );
  });

  it('returns failure when approval creation throws', async () => {
    const handler = await getHandler();
    const workflow = createMockWorkflow();
    const ctx = createMockCtx({
      runQuery: vi.fn().mockResolvedValue(workflow),
      runMutation: vi.fn().mockRejectedValue(new Error('DB error')),
    });

    const result = await handler(ctx, { workflowId: 'wf-def-123' });

    expect(result.success).toBe(false);
    expect(result.message).toContain('DB error');
  });
});

describe('runWorkflowArgs schema validation', () => {
  it('accepts valid workflowId only', () => {
    const result = runWorkflowArgs.parse({ workflowId: 'abc123' });
    expect(result.workflowId).toBe('abc123');
    expect(result.parameters).toBeUndefined();
  });

  it('accepts workflowId with parameters', () => {
    const result = runWorkflowArgs.parse({
      workflowId: 'abc123',
      parameters: { key: 'value', num: 42 },
    });
    expect(result.parameters).toEqual({ key: 'value', num: 42 });
  });

  it('rejects empty workflowId', () => {
    expect(() => runWorkflowArgs.parse({ workflowId: '' })).toThrow();
  });

  it('rejects missing workflowId', () => {
    expect(() => runWorkflowArgs.parse({})).toThrow();
  });

  it('accepts empty parameters object', () => {
    const result = runWorkflowArgs.parse({
      workflowId: 'abc',
      parameters: {},
    });
    expect(result.parameters).toEqual({});
  });

  it('accepts nested parameter values', () => {
    const result = runWorkflowArgs.parse({
      workflowId: 'abc',
      parameters: { nested: { deep: true } },
    });
    expect(result.parameters).toEqual({ nested: { deep: true } });
  });
});
