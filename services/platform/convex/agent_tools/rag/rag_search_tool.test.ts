import { describe, expect, it, vi } from 'vitest';

vi.mock('../../_generated/api', () => ({
  internal: {
    documents: {
      internal_queries: {
        getAgentScopedFileIds: 'mock-getAgentScopedFileIds',
      },
    },
  },
}));

vi.mock('../../lib/debug_log', () => ({
  createDebugLog: () => () => {},
}));

import { resolveFileIds } from './rag_search_tool';

function createMockCtx(overrides?: Record<string, unknown>) {
  return {
    organizationId: 'org1',
    runQuery: vi.fn().mockResolvedValue(['file-1', 'file-2']),
    ...overrides,
  };
}

describe('resolveFileIds', () => {
  it('uses explicit fileIds when provided', async () => {
    const ctx = createMockCtx();

    const result = await resolveFileIds(ctx as never, [
      'explicit-1',
      'explicit-2',
    ]);

    expect(result).toEqual(['explicit-1', 'explicit-2']);
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });

  it('resolves via agent-scoped query when no explicit fileIds', async () => {
    const ctx = createMockCtx();

    const result = await resolveFileIds(ctx as never);

    expect(result).toEqual(['file-1', 'file-2']);
    expect(ctx.runQuery).toHaveBeenCalledWith('mock-getAgentScopedFileIds', {
      organizationId: 'org1',
      agentTeamId: undefined,
      includeTeamKnowledge: undefined,
      includeOrgKnowledge: undefined,
      knowledgeFileIds: undefined,
    });
  });

  it('resolves via agent-scoped query when fileIds is empty array', async () => {
    const ctx = createMockCtx();

    const result = await resolveFileIds(ctx as never, []);

    expect(result).toEqual(['file-1', 'file-2']);
    expect(ctx.runQuery).toHaveBeenCalled();
  });

  it('works with explicit fileIds even without organizationId', async () => {
    const ctx = createMockCtx({ organizationId: undefined });

    const result = await resolveFileIds(ctx as never, ['file-1']);

    expect(result).toEqual(['file-1']);
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });

  it('throws when no fileIds and no organizationId', async () => {
    const ctx = createMockCtx({ organizationId: undefined });

    await expect(resolveFileIds(ctx as never)).rejects.toThrow(
      'rag_search requires organizationId',
    );
  });
});
