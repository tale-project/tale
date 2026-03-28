import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../_generated/server', () => ({
  internalMutation: vi.fn((config) => config),
}));

vi.mock('../schema', () => ({
  knowledgeFileRagStatusValidator: 'mock-validator',
}));

const { updateKnowledgeFileRagInfo } = await import('../internal_mutations');

const handler = (
  updateKnowledgeFileRagInfo as unknown as {
    handler: (ctx: never, args: never) => Promise<void>;
  }
).handler;

function createMockCtx(binding: Record<string, unknown> | null) {
  const queryBuilder = {
    withIndex: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(binding),
  };

  return {
    ctx: {
      db: {
        query: vi.fn().mockReturnValue(queryBuilder),
        patch: vi.fn().mockResolvedValue(undefined),
      },
      storage: {
        delete: vi.fn().mockResolvedValue(undefined),
      },
    },
    queryBuilder,
  };
}

describe('updateKnowledgeFileRagInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates ragStatus on matching file in binding', async () => {
    const binding = {
      _id: 'binding-1',
      knowledgeFiles: [
        { fileId: 'file-a', fileName: 'a.pdf', ragStatus: 'queued' },
        { fileId: 'file-b', fileName: 'b.pdf', ragStatus: 'queued' },
      ],
    };
    const { ctx } = createMockCtx(binding);

    await handler(
      ctx as never,
      {
        organizationId: 'org-1',
        agentFileName: 'my-agent',
        fileId: 'file-a',
        ragStatus: 'completed',
        ragIndexedAt: 1234567890,
      } as never,
    );

    expect(ctx.db.patch).toHaveBeenCalledWith('binding-1', {
      knowledgeFiles: [
        {
          fileId: 'file-a',
          fileName: 'a.pdf',
          ragStatus: 'completed',
          ragIndexedAt: 1234567890,
          ragError: undefined,
        },
        { fileId: 'file-b', fileName: 'b.pdf', ragStatus: 'queued' },
      ],
    });
  });

  it('sets ragError on failure', async () => {
    const binding = {
      _id: 'binding-1',
      knowledgeFiles: [
        { fileId: 'file-a', fileName: 'a.pdf', ragStatus: 'running' },
      ],
    };
    const { ctx } = createMockCtx(binding);

    await handler(
      ctx as never,
      {
        organizationId: 'org-1',
        agentFileName: 'my-agent',
        fileId: 'file-a',
        ragStatus: 'failed',
        ragError: 'Upload timeout',
      } as never,
    );

    expect(ctx.db.patch).toHaveBeenCalledWith('binding-1', {
      knowledgeFiles: [
        {
          fileId: 'file-a',
          fileName: 'a.pdf',
          ragStatus: 'failed',
          ragIndexedAt: undefined,
          ragError: 'Upload timeout',
        },
      ],
    });
  });

  it('no-ops when binding has no knowledgeFiles', async () => {
    const binding = { _id: 'binding-1', knowledgeFiles: undefined };
    const { ctx } = createMockCtx(binding);

    await handler(
      ctx as never,
      {
        organizationId: 'org-1',
        agentFileName: 'my-agent',
        fileId: 'file-a',
        ragStatus: 'completed',
      } as never,
    );

    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it('no-ops when binding is not found', async () => {
    const { ctx } = createMockCtx(null);

    await handler(
      ctx as never,
      {
        organizationId: 'org-1',
        agentFileName: 'my-agent',
        fileId: 'file-a',
        ragStatus: 'completed',
      } as never,
    );

    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
});
