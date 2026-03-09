import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../_generated/api', () => ({
  internal: {
    wf_definitions: {
      internal_queries: {
        resolveWorkflow: 'mock-resolveWorkflow',
        getStartStepConfig: 'mock-getStartStepConfig',
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

vi.mock('@convex-dev/agent', () => ({
  createTool: vi.fn((def) => ({
    _handler: def.handler,
    _description: def.description,
  })),
}));

import {
  createBoundWorkflowTool,
  sanitizeWorkflowName,
} from '../create_bound_workflow_tool';

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

describe('createBoundWorkflowTool', () => {
  it('creates a tool with workflow name in description', () => {
    const tool = createBoundWorkflowTool(
      {
        _id: 'wf-123' as never,
        name: 'My Workflow',
        description: 'Does things',
      },
      undefined,
    );

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only: accessing mocked createTool internals
    const description = (tool as unknown as { _description: string })
      ._description;
    expect(description).toContain('My Workflow');
    expect(description).toContain('Does things');
    expect(description).toContain('approval');
  });

  it('includes input schema in description', () => {
    const tool = createBoundWorkflowTool(
      { _id: 'wf-123' as never, name: 'My Workflow' },
      {
        properties: {
          targetFolder: { type: 'string' },
          daysBack: { type: 'number' },
        },
        required: ['targetFolder'],
      },
    );

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only
    const description = (tool as unknown as { _description: string })
      ._description;
    expect(description).toContain('targetFolder');
    expect(description).toContain('string');
    expect(description).toContain('required');
    expect(description).toContain('daysBack');
  });

  it('creates approval on happy path', async () => {
    const tool = createBoundWorkflowTool(
      { _id: 'wf-def-123' as never, name: 'Test Workflow' },
      undefined,
    );

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only
    const handler = (tool as unknown as { _handler: Function })._handler;

    const workflow = createMockWorkflow();
    const ctx = createMockCtx({
      runQuery: vi.fn().mockResolvedValue(workflow),
      runMutation: vi.fn().mockResolvedValue('approval-id-1'),
    });

    const result = await handler(ctx, {});

    expect(result.success).toBe(true);
    expect(result.requiresApproval).toBe(true);
    expect(result.approvalId).toBe('approval-id-1');
  });

  it('returns failure when organizationId is missing', async () => {
    const tool = createBoundWorkflowTool(
      { _id: 'wf-def-123' as never, name: 'Test Workflow' },
      undefined,
    );

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only
    const handler = (tool as unknown as { _handler: Function })._handler;
    const ctx = createMockCtx({ organizationId: undefined });

    const result = await handler(ctx, {});

    expect(result.success).toBe(false);
    expect(result.message).toContain('organizationId is required');
  });

  it('returns failure when workflow is no longer available', async () => {
    const tool = createBoundWorkflowTool(
      { _id: 'wf-def-123' as never, name: 'Test Workflow' },
      undefined,
    );

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only
    const handler = (tool as unknown as { _handler: Function })._handler;
    const ctx = createMockCtx({
      runQuery: vi.fn().mockResolvedValue(null),
    });

    const result = await handler(ctx, {});

    expect(result.success).toBe(false);
    expect(result.message).toContain('no longer available');
  });

  it('returns failure when workflow belongs to different org', async () => {
    const tool = createBoundWorkflowTool(
      { _id: 'wf-def-123' as never, name: 'Test Workflow' },
      undefined,
    );

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only
    const handler = (tool as unknown as { _handler: Function })._handler;
    const workflow = createMockWorkflow({ organizationId: 'other-org' });
    const ctx = createMockCtx({
      runQuery: vi.fn().mockResolvedValue(workflow),
    });

    const result = await handler(ctx, {});

    expect(result.success).toBe(false);
    expect(result.message).toContain('does not belong');
  });

  it('returns failure when workflow is archived', async () => {
    const tool = createBoundWorkflowTool(
      { _id: 'wf-def-123' as never, name: 'Test Workflow' },
      undefined,
    );

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only
    const handler = (tool as unknown as { _handler: Function })._handler;
    const workflow = createMockWorkflow({ status: 'archived' });
    const ctx = createMockCtx({
      runQuery: vi.fn().mockResolvedValue(workflow),
    });

    const result = await handler(ctx, {});

    expect(result.success).toBe(false);
    expect(result.message).toContain('archived');
  });

  it('forwards parameters to approval mutation', async () => {
    const tool = createBoundWorkflowTool(
      { _id: 'wf-def-123' as never, name: 'Test Workflow' },
      undefined,
    );

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only
    const handler = (tool as unknown as { _handler: Function })._handler;
    const workflow = createMockWorkflow();
    const mockRunMutation = vi.fn().mockResolvedValue('approval-id-3');
    const ctx = createMockCtx({
      runQuery: vi.fn().mockResolvedValue(workflow),
      runMutation: mockRunMutation,
    });

    const params = { targetFolder: '/invoices', daysBack: 30 };
    await handler(ctx, { parameters: params });

    expect(mockRunMutation).toHaveBeenCalledWith(
      'mock-createWorkflowRunApproval',
      expect.objectContaining({
        parameters: params,
        workflowName: 'Test Workflow',
      }),
    );
  });

  it('returns failure when approval creation throws', async () => {
    const tool = createBoundWorkflowTool(
      { _id: 'wf-def-123' as never, name: 'Test Workflow' },
      undefined,
    );

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only
    const handler = (tool as unknown as { _handler: Function })._handler;
    const workflow = createMockWorkflow();
    const ctx = createMockCtx({
      runQuery: vi.fn().mockResolvedValue(workflow),
      runMutation: vi.fn().mockRejectedValue(new Error('DB error')),
    });

    const result = await handler(ctx, {});

    expect(result.success).toBe(false);
    expect(result.message).toContain('DB error');
  });
});

describe('sanitizeWorkflowName', () => {
  it('lowercases and replaces non-alphanumeric chars', () => {
    expect(sanitizeWorkflowName('Invoice Processing')).toBe(
      'invoice_processing',
    );
  });

  it('collapses consecutive underscores', () => {
    expect(sanitizeWorkflowName('my--workflow__test')).toBe('my_workflow_test');
  });

  it('trims leading/trailing underscores', () => {
    expect(sanitizeWorkflowName('__test__')).toBe('test');
  });

  it('handles special characters', () => {
    expect(sanitizeWorkflowName('CRM-Sync (v2)')).toBe('crm_sync_v2');
  });

  it('handles empty string', () => {
    expect(sanitizeWorkflowName('')).toBe('');
  });
});
