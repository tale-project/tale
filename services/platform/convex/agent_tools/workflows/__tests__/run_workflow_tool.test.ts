import { describe, expect, it, vi } from 'vitest';

import { runWorkflowArgs } from '../run_workflow_tool';

vi.mock('../../../_generated/api', () => ({
  internal: {
    workflows: {
      file_actions: {
        readWorkflowForExecution: 'mock-readWorkflowForExecution',
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
  createTool: vi.fn((def) => ({ _handler: def.execute })),
}));

function createMockCtx(overrides?: Record<string, unknown>) {
  return {
    organizationId: 'org1',
    userId: 'user1',
    threadId: 'thread-current',
    messageId: 'msg-123',
    runQuery: vi.fn(),
    runAction: vi.fn(),
    runMutation: vi.fn(),
    ...overrides,
  };
}

function createMockWorkflowConfig(overrides?: Record<string, unknown>) {
  return {
    name: 'Test Workflow',
    description: 'A test workflow',
    enabled: true,
    steps: [
      {
        stepSlug: 'start',
        name: 'Start',
        stepType: 'start',
        config: {},
        nextSteps: {},
      },
    ],
    ...overrides,
  };
}

function createMockFileResult(configOverrides?: Record<string, unknown>) {
  return {
    ok: true,
    config: createMockWorkflowConfig(configOverrides),
    hash: 'abc123hash',
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
    const ctx = createMockCtx({
      runAction: vi.fn().mockResolvedValue(createMockFileResult()),
      runMutation: vi.fn().mockResolvedValue('approval-id-1'),
    });

    const result = await handler(ctx, { workflowSlug: 'test-workflow' });

    expect(result.success).toBe(true);
    expect(result.requiresApproval).toBe(true);
    expect(result.approvalId).toBe('approval-id-1');
    expect(result.approvalCreated).toBe(true);
  });

  it('returns failure when organizationId is missing', async () => {
    const handler = await getHandler();
    const ctx = createMockCtx({ organizationId: undefined });

    const result = await handler(ctx, { workflowSlug: 'test-workflow' });

    expect(result.success).toBe(false);
    expect(result.message).toContain('organizationId is required');
  });

  it('returns failure when workflow not found', async () => {
    const handler = await getHandler();
    const ctx = createMockCtx({
      runAction: vi.fn().mockResolvedValue({
        ok: false,
        error: 'not_found',
        message: 'Workflow not found',
      }),
    });

    const result = await handler(ctx, { workflowSlug: 'nonexistent' });

    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });

  it('returns failure when workflow is disabled', async () => {
    const handler = await getHandler();
    const ctx = createMockCtx({
      runAction: vi
        .fn()
        .mockResolvedValue(createMockFileResult({ enabled: false })),
    });

    const result = await handler(ctx, { workflowSlug: 'test-workflow' });

    expect(result.success).toBe(false);
    expect(result.message).toContain('disabled');
  });

  it('forwards parameters to approval mutation', async () => {
    const handler = await getHandler();
    const mockRunMutation = vi.fn().mockResolvedValue('approval-id-3');
    const ctx = createMockCtx({
      runAction: vi.fn().mockResolvedValue(createMockFileResult()),
      runMutation: mockRunMutation,
    });

    const params = { targetFolder: '/invoices', daysBack: 30 };
    await handler(ctx, {
      workflowSlug: 'test-workflow',
      parameters: JSON.stringify(params),
    });

    expect(mockRunMutation).toHaveBeenCalledWith(
      'mock-createWorkflowRunApproval',
      expect.objectContaining({
        parameters: params,
        workflowName: 'Test Workflow',
      }),
    );
  });

  it('returns failure when parameters is invalid JSON', async () => {
    const handler = await getHandler();
    const ctx = createMockCtx({
      runAction: vi.fn().mockResolvedValue(createMockFileResult()),
    });

    const result = await handler(ctx, {
      workflowSlug: 'test-workflow',
      parameters: 'not-valid-json',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid parameters');
  });

  it('returns failure when approval creation throws', async () => {
    const handler = await getHandler();
    const ctx = createMockCtx({
      runAction: vi.fn().mockResolvedValue(createMockFileResult()),
      runMutation: vi.fn().mockRejectedValue(new Error('DB error')),
    });

    const result = await handler(ctx, { workflowSlug: 'test-workflow' });

    expect(result.success).toBe(false);
    expect(result.message).toContain('DB error');
  });

  it('forwards messageId from context to approval mutation', async () => {
    const handler = await getHandler();
    const mockRunMutation = vi.fn().mockResolvedValue('approval-id-4');
    const ctx = createMockCtx({
      runAction: vi.fn().mockResolvedValue(createMockFileResult()),
      runMutation: mockRunMutation,
      messageId: 'msg-abc',
    });

    await handler(ctx, { workflowSlug: 'test-workflow' });

    expect(mockRunMutation).toHaveBeenCalledWith(
      'mock-createWorkflowRunApproval',
      expect.objectContaining({
        messageId: 'msg-abc',
      }),
    );
  });

  it('passes undefined messageId when not present in context', async () => {
    const handler = await getHandler();
    const mockRunMutation = vi.fn().mockResolvedValue('approval-id-5');
    const ctx = createMockCtx({
      runAction: vi.fn().mockResolvedValue(createMockFileResult()),
      runMutation: mockRunMutation,
      messageId: undefined,
    });

    await handler(ctx, { workflowSlug: 'test-workflow' });

    expect(mockRunMutation).toHaveBeenCalledWith(
      'mock-createWorkflowRunApproval',
      expect.objectContaining({
        messageId: undefined,
      }),
    );
  });

  it('forwards resolved threadId to approval mutation', async () => {
    const handler = await getHandler();
    const mockRunMutation = vi.fn().mockResolvedValue('approval-id-6');
    const ctx = createMockCtx({
      runAction: vi.fn().mockResolvedValue(createMockFileResult()),
      runMutation: mockRunMutation,
    });

    await handler(ctx, { workflowSlug: 'test-workflow' });

    expect(mockRunMutation).toHaveBeenCalledWith(
      'mock-createWorkflowRunApproval',
      expect.objectContaining({
        threadId: 'thread-123',
      }),
    );
  });
});

describe('runWorkflowArgs schema validation', () => {
  it('accepts valid workflowSlug only', () => {
    const result = runWorkflowArgs.parse({ workflowSlug: 'conversation-sync' });
    expect(result.workflowSlug).toBe('conversation-sync');
    expect(result.parameters).toBeUndefined();
  });

  it('accepts workflowSlug with parameters as JSON string', () => {
    const result = runWorkflowArgs.parse({
      workflowSlug: 'conversation-sync',
      parameters: '{"key":"value","num":42}',
    });
    expect(result.parameters).toBe('{"key":"value","num":42}');
  });

  it('rejects empty workflowSlug', () => {
    expect(() => runWorkflowArgs.parse({ workflowSlug: '' })).toThrow();
  });

  it('rejects missing workflowSlug', () => {
    expect(() => runWorkflowArgs.parse({})).toThrow();
  });

  it('accepts empty JSON object string as parameters', () => {
    const result = runWorkflowArgs.parse({
      workflowSlug: 'abc',
      parameters: '{}',
    });
    expect(result.parameters).toBe('{}');
  });

  it('accepts nested JSON string parameter values', () => {
    const result = runWorkflowArgs.parse({
      workflowSlug: 'abc',
      parameters: '{"nested":{"deep":true}}',
    });
    expect(result.parameters).toBe('{"nested":{"deep":true}}');
  });
});
