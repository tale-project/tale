import type { ToolCtx } from '@convex-dev/agent';

import { describe, it, expect, vi } from 'vitest';

import { resolveFileIds } from '../rag_search_tool';

function createMockCtx(
  overrides: Record<string, unknown> = {},
): ToolCtx & Record<string, unknown> {
  return {
    runQuery: vi.fn(),
    userId: 'user1',
    organizationId: 'org1',
    ...overrides,
  } as unknown as ToolCtx & Record<string, unknown>;
}

describe('resolveFileIds', () => {
  it('returns explicit fileIds when provided', async () => {
    const ctx = createMockCtx();
    const result = await resolveFileIds(ctx, ['file-a', 'file-b']);
    expect(result).toEqual(['file-a', 'file-b']);
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });

  it('uses agent-scoped query when agent scope fields present', async () => {
    const ctx = createMockCtx({
      agentTeamId: 'team-1',
      includeTeamKnowledge: true,
      includeOrgKnowledge: false,
      knowledgeFileIds: ['file-agent'],
    });
    const mockRunQuery = vi.mocked(ctx.runQuery);
    mockRunQuery.mockResolvedValue(['file-agent', 'file-team']);

    const result = await resolveFileIds(ctx);
    expect(result).toEqual(['file-agent', 'file-team']);
    expect(mockRunQuery).toHaveBeenCalledTimes(1);

    const [, queryArgs] = mockRunQuery.mock.calls[0];
    expect(queryArgs).toEqual({
      organizationId: 'org1',
      agentTeamId: 'team-1',
      includeTeamKnowledge: true,
      includeOrgKnowledge: false,
      knowledgeFileIds: ['file-agent'],
    });
  });

  it('uses agent-scoped query when knowledgeFileIds present', async () => {
    const ctx = createMockCtx({
      knowledgeFileIds: ['file-x'],
    });
    const mockRunQuery = vi.mocked(ctx.runQuery);
    mockRunQuery.mockResolvedValue(['file-x']);

    const result = await resolveFileIds(ctx);
    expect(result).toEqual(['file-x']);
    expect(mockRunQuery).toHaveBeenCalledTimes(1);

    const [, queryArgs] = mockRunQuery.mock.calls[0];
    expect(queryArgs).toHaveProperty('knowledgeFileIds', ['file-x']);
  });

  it('uses agent-scoped query when includeOrgKnowledge present', async () => {
    const ctx = createMockCtx({
      includeOrgKnowledge: true,
    });
    const mockRunQuery = vi.mocked(ctx.runQuery);
    mockRunQuery.mockResolvedValue(['file-org']);

    const result = await resolveFileIds(ctx);
    expect(result).toEqual(['file-org']);
    expect(mockRunQuery).toHaveBeenCalledTimes(1);

    const [, queryArgs] = mockRunQuery.mock.calls[0];
    expect(queryArgs).toHaveProperty('includeOrgKnowledge', true);
  });

  it('falls back to user-scoped query without agent scope', async () => {
    const ctx = createMockCtx();
    const mockRunQuery = vi.mocked(ctx.runQuery);
    mockRunQuery.mockResolvedValue(['file-1', 'file-2']);

    const result = await resolveFileIds(ctx);
    expect(result).toEqual(['file-1', 'file-2']);
    expect(mockRunQuery).toHaveBeenCalledTimes(1);

    const [, queryArgs] = mockRunQuery.mock.calls[0];
    expect(queryArgs).toEqual({
      organizationId: 'org1',
      userId: 'user1',
    });
  });

  it('throws when no organizationId', async () => {
    const ctx = createMockCtx({ organizationId: undefined });
    await expect(resolveFileIds(ctx)).rejects.toThrow(
      'rag_search requires organizationId',
    );
  });

  it('throws when no userId and no agent scope', async () => {
    const ctx = createMockCtx({ userId: undefined });
    await expect(resolveFileIds(ctx)).rejects.toThrow(
      'rag_search requires either agent scope fields or userId',
    );
  });
});
