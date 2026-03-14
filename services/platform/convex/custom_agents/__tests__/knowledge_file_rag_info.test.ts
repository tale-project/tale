import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../_generated/server', () => ({
  internalMutation: vi.fn((config) => config),
}));

vi.mock('../schema', () => ({
  knowledgeFileRagStatusValidator: 'mock-validator',
}));

const { updateKnowledgeFileRagInfo } = await import('../internal_mutations');

// The vi.mock above makes internalMutation a passthrough, so the export is
// the raw { args, handler } config object.  Extract the handler with a cast
// to work around Convex's RegisteredMutation type.
const handler = (
  updateKnowledgeFileRagInfo as unknown as {
    handler: (ctx: never, args: never) => Promise<void>;
  }
).handler;

function createMockCtx(agent: Record<string, unknown> | null) {
  const draftBuilder = {
    withIndex: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
  };

  return {
    ctx: {
      db: {
        query: vi.fn().mockReturnValue(draftBuilder),
        get: vi.fn().mockResolvedValue(agent),
        patch: vi.fn().mockResolvedValue(undefined),
      },
    },
    draftBuilder,
  };
}

describe('updateKnowledgeFileRagInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates ragStatus on matching file in root version', async () => {
    const agent = {
      _id: 'root-1',
      knowledgeFiles: [
        { fileId: 'file-a', fileName: 'a.pdf', ragStatus: 'queued' },
        { fileId: 'file-b', fileName: 'b.pdf', ragStatus: 'queued' },
      ],
    };
    const { ctx } = createMockCtx(agent);

    await handler(
      ctx as never,
      {
        customAgentId: 'root-1',
        fileId: 'file-a',
        ragStatus: 'completed',
        ragIndexedAt: 1234567890,
      } as never,
    );

    expect(ctx.db.patch).toHaveBeenCalledWith('root-1', {
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

  it('prefers draft version over root when draft exists', async () => {
    const draft = {
      _id: 'draft-1',
      knowledgeFiles: [
        { fileId: 'file-a', fileName: 'a.pdf', ragStatus: 'queued' },
      ],
    };
    const { ctx, draftBuilder } = createMockCtx(null);
    draftBuilder.first.mockResolvedValue(draft);

    await handler(
      ctx as never,
      {
        customAgentId: 'root-1',
        fileId: 'file-a',
        ragStatus: 'running',
      } as never,
    );

    expect(ctx.db.patch).toHaveBeenCalledWith('draft-1', {
      knowledgeFiles: [
        {
          fileId: 'file-a',
          fileName: 'a.pdf',
          ragStatus: 'running',
          ragIndexedAt: undefined,
          ragError: undefined,
        },
      ],
    });
    expect(ctx.db.get).not.toHaveBeenCalled();
  });

  it('sets ragError on failure', async () => {
    const agent = {
      _id: 'root-1',
      knowledgeFiles: [
        { fileId: 'file-a', fileName: 'a.pdf', ragStatus: 'running' },
      ],
    };
    const { ctx } = createMockCtx(agent);

    await handler(
      ctx as never,
      {
        customAgentId: 'root-1',
        fileId: 'file-a',
        ragStatus: 'failed',
        ragError: 'Upload timeout',
      } as never,
    );

    expect(ctx.db.patch).toHaveBeenCalledWith('root-1', {
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

  it('no-ops when agent has no knowledgeFiles', async () => {
    const agent = { _id: 'root-1', knowledgeFiles: undefined };
    const { ctx } = createMockCtx(agent);

    await handler(
      ctx as never,
      {
        customAgentId: 'root-1',
        fileId: 'file-a',
        ragStatus: 'completed',
      } as never,
    );

    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it('no-ops when agent is not found', async () => {
    const { ctx } = createMockCtx(null);

    await handler(
      ctx as never,
      {
        customAgentId: 'root-1',
        fileId: 'file-a',
        ragStatus: 'completed',
      } as never,
    );

    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
});
