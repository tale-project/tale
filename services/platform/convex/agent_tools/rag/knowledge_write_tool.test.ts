import { describe, expect, it, vi } from 'vitest';

vi.mock('@convex-dev/agent', () => ({
  createTool: vi.fn((def) => ({
    _handler: def.execute,
    _description: def.description,
  })),
}));

vi.mock('../../_generated/api', () => ({
  internal: {
    knowledge_entries: {
      internal_mutations: {
        createKnowledgeWriteApproval: 'mock-create-knowledge-approval',
      },
    },
  },
  components: {},
}));

vi.mock('../../threads/get_parent_thread_id', () => ({
  getApprovalThreadId: vi.fn().mockResolvedValue('thread-123'),
}));

import { knowledgeWriteArgs, knowledgeWriteTool } from './knowledge_write_tool';

function createMockCtx(overrides?: Record<string, unknown>) {
  return {
    organizationId: 'org-1',
    threadId: 'thread-1',
    messageId: 'msg-1',
    runQuery: vi.fn(),
    runMutation: vi.fn(),
    ...overrides,
  };
}

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- accessing internal handler for testing
const handler = (knowledgeWriteTool.tool as unknown as { _handler: Function })
  ._handler as (
  ctx: ReturnType<typeof createMockCtx>,
  args: { topic: string; content: string; incorrectInfo?: string },
) => Promise<{
  success: boolean;
  message: string;
  error?: string;
  approvalId?: string;
  requiresApproval?: boolean;
  approvalCreated?: boolean;
  approvalMessage?: string;
  replacesTopic?: string;
}>;

describe('knowledgeWriteArgs schema validation', () => {
  it('accepts topic and content', () => {
    const result = knowledgeWriteArgs.parse({
      topic: 'Store hours',
      content: 'Open Monday to Friday, 9-5.',
    });
    expect(result.topic).toBe('Store hours');
    expect(result.incorrectInfo).toBeUndefined();
  });

  it('accepts optional incorrectInfo', () => {
    const result = knowledgeWriteArgs.parse({
      topic: 'Return policy',
      content: 'Returns accepted within 3 days.',
      incorrectInfo: 'Returns accepted within 7 days.',
    });
    expect(result.incorrectInfo).toContain('7 days');
  });

  it('rejects missing topic', () => {
    expect(() => knowledgeWriteArgs.parse({ content: 'x' })).toThrow();
  });

  it('rejects empty topic', () => {
    expect(() =>
      knowledgeWriteArgs.parse({ topic: '', content: 'x' }),
    ).toThrow();
  });

  it('rejects topic over 120 characters', () => {
    expect(() =>
      knowledgeWriteArgs.parse({ topic: 'x'.repeat(121), content: 'x' }),
    ).toThrow();
  });

  it('rejects missing content', () => {
    expect(() => knowledgeWriteArgs.parse({ topic: 'Topic' })).toThrow();
  });

  it('rejects content over 8000 characters', () => {
    expect(() =>
      knowledgeWriteArgs.parse({ topic: 'Topic', content: 'x'.repeat(8001) }),
    ).toThrow();
  });
});

describe('knowledge_write tool handler', () => {
  it('returns error when organizationId is missing', async () => {
    const ctx = createMockCtx({ organizationId: undefined });
    const result = await handler(ctx, {
      topic: 'Store hours',
      content: 'Open 9-5',
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain('organizationId');
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it('creates an approval for a new topic', async () => {
    const ctx = createMockCtx({
      runMutation: vi
        .fn()
        .mockResolvedValue({ approvalId: 'approval-1', replacesTopic: null }),
    });
    const result = await handler(ctx, {
      topic: 'Store hours',
      content: 'Open 9-5',
    });
    expect(result.success).toBe(true);
    expect(result.requiresApproval).toBe(true);
    expect(result.approvalId).toBe('approval-1');
    expect(result.replacesTopic).toBeUndefined();
    expect(result.message).toContain('Store hours');
    expect(result.message).not.toContain('REPLACE');
    expect(ctx.runMutation).toHaveBeenCalledWith(
      'mock-create-knowledge-approval',
      expect.objectContaining({
        organizationId: 'org-1',
        topic: 'Store hours',
        content: 'Open 9-5',
        threadId: 'thread-123',
        messageId: 'msg-1',
      }),
    );
  });

  it('flags a replacement when the topic already exists', async () => {
    const ctx = createMockCtx({
      runMutation: vi.fn().mockResolvedValue({
        approvalId: 'approval-2',
        replacesTopic: 'Return policy',
      }),
    });
    const result = await handler(ctx, {
      topic: 'return policy',
      content: 'Returns within 3 days.',
      incorrectInfo: 'Returns within 7 days.',
    });
    expect(result.success).toBe(true);
    expect(result.replacesTopic).toBe('Return policy');
    expect(result.approvalMessage).toContain('REPLACE');
    expect(result.message).toContain('Return policy');
  });

  it('surfaces mutation failures (e.g. rate limit) as a tool error', async () => {
    const ctx = createMockCtx({
      runMutation: vi
        .fn()
        .mockRejectedValue(
          new Error('Rate limit exceeded for knowledge:write'),
        ),
    });
    const result = await handler(ctx, {
      topic: 'Store hours',
      content: 'Open 9-5',
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain('Rate limit exceeded');
  });
});
