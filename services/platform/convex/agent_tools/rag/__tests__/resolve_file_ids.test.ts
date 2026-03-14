import type { ToolCtx } from '@convex-dev/agent';

import { describe, it, expect, vi } from 'vitest';

import { resolveFileIds } from '../rag_search_tool';

function createMockCtx(overrides: Record<string, unknown> = {}) {
  const runQuery = vi.fn();
  const ctx = {
    runQuery,
    organizationId: 'org1',
    ...overrides,
  } as unknown as ToolCtx & Record<string, unknown>;

  return { ctx, runQuery };
}

describe('resolveFileIds', () => {
  it('returns explicit fileIds when provided', async () => {
    const { ctx, runQuery } = createMockCtx();
    const result = await resolveFileIds(ctx, ['file-a', 'file-b']);
    expect(result).toEqual(['file-a', 'file-b']);
    expect(runQuery).not.toHaveBeenCalled();
  });

  it('calls getAgentScopedFileIds with all scope fields', async () => {
    const { ctx, runQuery } = createMockCtx({
      agentTeamId: 'team-1',
      includeTeamKnowledge: true,
      includeOrgKnowledge: false,
      knowledgeFileIds: ['file-agent'],
    });
    runQuery.mockResolvedValue(['file-agent', 'file-team']);

    const result = await resolveFileIds(ctx);
    expect(result).toEqual(['file-agent', 'file-team']);
    expect(runQuery).toHaveBeenCalledTimes(1);

    const [, queryArgs] = runQuery.mock.calls[0];
    expect(queryArgs).toEqual({
      organizationId: 'org1',
      agentTeamId: 'team-1',
      includeTeamKnowledge: true,
      includeOrgKnowledge: false,
      knowledgeFileIds: ['file-agent'],
    });
  });

  it('passes knowledgeFileIds when only that field is set', async () => {
    const { ctx, runQuery } = createMockCtx({
      knowledgeFileIds: ['file-x'],
    });
    runQuery.mockResolvedValue(['file-x']);

    const result = await resolveFileIds(ctx);
    expect(result).toEqual(['file-x']);
    expect(runQuery).toHaveBeenCalledTimes(1);

    const [, queryArgs] = runQuery.mock.calls[0];
    expect(queryArgs).toHaveProperty('knowledgeFileIds', ['file-x']);
  });

  it('passes includeOrgKnowledge when only that field is set', async () => {
    const { ctx, runQuery } = createMockCtx({ includeOrgKnowledge: true });
    runQuery.mockResolvedValue(['file-org']);

    const result = await resolveFileIds(ctx);
    expect(result).toEqual(['file-org']);
    expect(runQuery).toHaveBeenCalledTimes(1);

    const [, queryArgs] = runQuery.mock.calls[0];
    expect(queryArgs).toHaveProperty('includeOrgKnowledge', true);
  });

  it('returns empty array when agent has no knowledge config', async () => {
    const { ctx, runQuery } = createMockCtx();
    runQuery.mockResolvedValue([]);

    const result = await resolveFileIds(ctx);
    expect(result).toEqual([]);
    expect(runQuery).toHaveBeenCalledTimes(1);

    const [, queryArgs] = runQuery.mock.calls[0];
    expect(queryArgs).toEqual({
      organizationId: 'org1',
      agentTeamId: undefined,
      includeTeamKnowledge: undefined,
      includeOrgKnowledge: undefined,
      knowledgeFileIds: undefined,
    });
  });

  it('works without userId on context', async () => {
    const { ctx, runQuery } = createMockCtx();
    runQuery.mockResolvedValue(['file-1']);

    const result = await resolveFileIds(ctx);
    expect(result).toEqual(['file-1']);
    expect(runQuery).toHaveBeenCalledTimes(1);
  });

  it('throws when no organizationId', async () => {
    const { ctx } = createMockCtx({ organizationId: undefined });
    await expect(resolveFileIds(ctx)).rejects.toThrow(
      'rag_search requires organizationId',
    );
  });
});
