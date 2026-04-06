import { describe, expect, it, vi } from 'vitest';

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

vi.mock('@convex-dev/agent', () => ({
  createTool: vi.fn((def) => ({
    _handler: def.execute,
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
    runAction: vi.fn(),
    runMutation: vi.fn(),
    ...overrides,
  };
}

function createMockFileConfig(overrides?: Record<string, unknown>) {
  return {
    ok: true,
    config: {
      name: 'Test Workflow',
      description: 'A test workflow',
      enabled: true,
      steps: [{ stepType: 'start', config: {} }],
      ...overrides,
    },
  };
}

describe('createBoundWorkflowTool', () => {
  it('creates a tool with workflow name in description', () => {
    const tool = createBoundWorkflowTool(
      {
        workflowSlug: 'test-workflow',
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
      { workflowSlug: 'test-workflow', name: 'My Workflow' },
      {
        properties: {
          targetFolder: {
            type: 'string',
            description: 'The folder to process',
          },
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
    expect(description).toContain('The folder to process');
    expect(description).toContain('daysBack');
  });

  it('includes raw JSON schema in description', () => {
    const tool = createBoundWorkflowTool(
      { workflowSlug: 'test-workflow', name: 'My Workflow' },
      {
        properties: {
          count: { type: 'number' },
        },
      },
    );

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only
    const description = (tool as unknown as { _description: string })
      ._description;
    expect(description).toContain('Input schema:');
    expect(description).toContain('"count"');
    expect(description).toContain('"type": "number"');
  });

  it('creates approval on happy path', async () => {
    const tool = createBoundWorkflowTool(
      { workflowSlug: 'test-workflow', name: 'Test Workflow' },
      undefined,
    );

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only
    const handler = (tool as unknown as { _handler: Function })._handler;

    const fileConfig = createMockFileConfig();
    const ctx = createMockCtx({
      runAction: vi.fn().mockResolvedValue(fileConfig),
      runMutation: vi.fn().mockResolvedValue('approval-id-1'),
    });

    const result = await handler(ctx, {});

    expect(result.success).toBe(true);
    expect(result.requiresApproval).toBe(true);
    expect(result.approvalId).toBe('approval-id-1');
  });

  it('returns failure when organizationId is missing', async () => {
    const tool = createBoundWorkflowTool(
      { workflowSlug: 'test-workflow', name: 'Test Workflow' },
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
      { workflowSlug: 'test-workflow', name: 'Test Workflow' },
      undefined,
    );

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only
    const handler = (tool as unknown as { _handler: Function })._handler;
    const ctx = createMockCtx({
      runAction: vi.fn().mockResolvedValue({ ok: false, message: 'Not found' }),
    });

    const result = await handler(ctx, {});

    expect(result.success).toBe(false);
    expect(result.message).toContain('Not found');
  });

  it('returns failure when workflow is disabled', async () => {
    const tool = createBoundWorkflowTool(
      { workflowSlug: 'test-workflow', name: 'Test Workflow' },
      undefined,
    );

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only
    const handler = (tool as unknown as { _handler: Function })._handler;
    const fileConfig = createMockFileConfig({ enabled: false });
    const ctx = createMockCtx({
      runAction: vi.fn().mockResolvedValue(fileConfig),
    });

    const result = await handler(ctx, {});

    expect(result.success).toBe(false);
    expect(result.message).toContain('disabled');
  });

  it('forwards parameters to approval mutation', async () => {
    const tool = createBoundWorkflowTool(
      { workflowSlug: 'test-workflow', name: 'Test Workflow' },
      undefined,
    );

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only
    const handler = (tool as unknown as { _handler: Function })._handler;
    const fileConfig = createMockFileConfig();
    const mockRunMutation = vi.fn().mockResolvedValue('approval-id-3');
    const ctx = createMockCtx({
      runAction: vi.fn().mockResolvedValue(fileConfig),
      runMutation: mockRunMutation,
    });

    const params = { targetFolder: '/invoices', daysBack: 30 };
    await handler(ctx, params);

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
      { workflowSlug: 'test-workflow', name: 'Test Workflow' },
      undefined,
    );

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only
    const handler = (tool as unknown as { _handler: Function })._handler;
    const fileConfig = createMockFileConfig();
    const ctx = createMockCtx({
      runAction: vi.fn().mockResolvedValue(fileConfig),
      runMutation: vi.fn().mockRejectedValue(new Error('DB error')),
    });

    const result = await handler(ctx, {});

    expect(result.success).toBe(false);
    expect(result.message).toContain('DB error');
  });

  it('includes raw JSON schema with nested object properties in description', () => {
    const tool = createBoundWorkflowTool(
      { workflowSlug: 'test-workflow', name: 'My Workflow' },
      {
        properties: {
          baseFile: {
            type: 'object',
            description: 'The base file',
            properties: {
              fileId: { type: 'string', description: 'Storage ID' },
              fileName: { type: 'string', description: 'File name' },
            },
            required: ['fileId', 'fileName'],
          },
        },
        required: ['baseFile'],
      },
    );

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only
    const description = (tool as unknown as { _description: string })
      ._description;
    expect(description).toContain('Input schema:');
    expect(description).toContain('"baseFile"');
    expect(description).toContain('"fileId"');
    expect(description).toContain('"Storage ID"');
  });

  it('normalizes stringified object args before validation', async () => {
    const inputSchema = {
      properties: {
        baseFile: {
          type: 'object' as const,
          properties: {
            fileId: { type: 'string' as const },
            fileName: { type: 'string' as const },
          },
          required: ['fileId', 'fileName'],
        },
        requirements: { type: 'string' as const },
      },
      required: ['baseFile', 'requirements'],
    };

    const tool = createBoundWorkflowTool(
      { workflowSlug: 'test-workflow', name: 'Contract Workflow' },
      inputSchema,
    );

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only
    const handler = (tool as unknown as { _handler: Function })._handler;
    const fileConfig = createMockFileConfig({
      name: 'Contract Workflow',
      steps: [{ stepType: 'start', config: { inputSchema } }],
    });
    const mockRunMutation = vi.fn().mockResolvedValue('approval-id-5');

    const ctx = createMockCtx({
      runAction: vi.fn().mockResolvedValue(fileConfig),
      runMutation: mockRunMutation,
    });

    const result = await handler(ctx, {
      baseFile: '{"fileId":"abc123","fileName":"contract.docx"}',
      requirements: 'Make it simpler',
    });

    expect(result.success).toBe(true);
    expect(mockRunMutation).toHaveBeenCalledWith(
      'mock-createWorkflowRunApproval',
      expect.objectContaining({
        parameters: {
          baseFile: { fileId: 'abc123', fileName: 'contract.docx' },
          requirements: 'Make it simpler',
        },
      }),
    );
  });

  it('normalizes stringified array items before validation', async () => {
    const inputSchema = {
      properties: {
        knowledgeFiles: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              fileId: { type: 'string' as const },
              fileName: { type: 'string' as const },
            },
            required: ['fileId', 'fileName'],
          },
        },
      },
      required: ['knowledgeFiles'],
    };

    const tool = createBoundWorkflowTool(
      { workflowSlug: 'test-workflow', name: 'Test Workflow' },
      inputSchema,
    );

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only
    const handler = (tool as unknown as { _handler: Function })._handler;
    const fileConfig = createMockFileConfig({
      steps: [{ stepType: 'start', config: { inputSchema } }],
    });
    const mockRunMutation = vi.fn().mockResolvedValue('approval-id-6');

    const ctx = createMockCtx({
      runAction: vi.fn().mockResolvedValue(fileConfig),
      runMutation: mockRunMutation,
    });

    const result = await handler(ctx, {
      knowledgeFiles: [
        '{"fileId":"id1","fileName":"a.docx"}',
        '{"fileId":"id2","fileName":"b.docx"}',
      ],
    });

    expect(result.success).toBe(true);
    expect(mockRunMutation).toHaveBeenCalledWith(
      'mock-createWorkflowRunApproval',
      expect.objectContaining({
        parameters: {
          knowledgeFiles: [
            { fileId: 'id1', fileName: 'a.docx' },
            { fileId: 'id2', fileName: 'b.docx' },
          ],
        },
      }),
    );
  });

  it('passes native object args without modification', async () => {
    const inputSchema = {
      properties: {
        baseFile: {
          type: 'object' as const,
          properties: {
            fileId: { type: 'string' as const },
            fileName: { type: 'string' as const },
          },
          required: ['fileId', 'fileName'],
        },
      },
      required: ['baseFile'],
    };

    const tool = createBoundWorkflowTool(
      { workflowSlug: 'test-workflow', name: 'Test Workflow' },
      inputSchema,
    );

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only
    const handler = (tool as unknown as { _handler: Function })._handler;
    const fileConfig = createMockFileConfig({
      steps: [{ stepType: 'start', config: { inputSchema } }],
    });
    const mockRunMutation = vi.fn().mockResolvedValue('approval-id-7');

    const ctx = createMockCtx({
      runAction: vi.fn().mockResolvedValue(fileConfig),
      runMutation: mockRunMutation,
    });

    const nativeObj = { fileId: 'abc123', fileName: 'contract.docx' };
    const result = await handler(ctx, { baseFile: nativeObj });

    expect(result.success).toBe(true);
    expect(mockRunMutation).toHaveBeenCalledWith(
      'mock-createWorkflowRunApproval',
      expect.objectContaining({
        parameters: { baseFile: nativeObj },
      }),
    );
  });

  it('does not parse string fields that are legitimately strings', async () => {
    const inputSchema = {
      properties: {
        requirements: { type: 'string' as const },
      },
      required: ['requirements'],
    };

    const tool = createBoundWorkflowTool(
      { workflowSlug: 'test-workflow', name: 'Test Workflow' },
      inputSchema,
    );

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test-only
    const handler = (tool as unknown as { _handler: Function })._handler;
    const fileConfig = createMockFileConfig({
      steps: [{ stepType: 'start', config: { inputSchema } }],
    });
    const mockRunMutation = vi.fn().mockResolvedValue('approval-id-8');

    const ctx = createMockCtx({
      runAction: vi.fn().mockResolvedValue(fileConfig),
      runMutation: mockRunMutation,
    });

    const jsonLikeString = '{"key": "value"}';
    const result = await handler(ctx, { requirements: jsonLikeString });

    expect(result.success).toBe(true);
    expect(mockRunMutation).toHaveBeenCalledWith(
      'mock-createWorkflowRunApproval',
      expect.objectContaining({
        parameters: { requirements: jsonLikeString },
      }),
    );
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
