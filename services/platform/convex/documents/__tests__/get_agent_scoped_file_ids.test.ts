import { describe, it, expect } from 'vitest';

import { getAgentScopedFileIds } from '../get_agent_scoped_file_ids';

function createMockCtx(docs: Array<Record<string, unknown>>) {
  const asyncIterator = {
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next() {
          if (index < docs.length) {
            return { value: docs[index++], done: false };
          }
          return { value: undefined, done: true };
        },
      };
    },
  };

  const query = () => ({
    withIndex: () => asyncIterator,
  });

  return { db: { query } } as unknown as Parameters<
    typeof getAgentScopedFileIds
  >[0];
}

describe('getAgentScopedFileIds', () => {
  it('returns only knowledgeFileIds when no team/org docs needed', async () => {
    const ctx = createMockCtx([]);
    const ids = await getAgentScopedFileIds(ctx, {
      organizationId: 'org1',
      knowledgeFileIds: ['file-a', 'file-b'],
      includeTeamKnowledge: false,
      includeOrgKnowledge: false,
    });

    expect(ids).toEqual(['file-a', 'file-b']);
  });

  it('returns empty when no knowledge sources configured', async () => {
    const ctx = createMockCtx([]);
    const ids = await getAgentScopedFileIds(ctx, {
      organizationId: 'org1',
      includeTeamKnowledge: false,
      includeOrgKnowledge: false,
    });

    expect(ids).toEqual([]);
  });

  it('includes team documents when includeTeamKnowledge is true', async () => {
    const ctx = createMockCtx([
      {
        _id: 'doc1',
        fileId: 'file1',
        ragInfo: { status: 'completed' },
        teamId: 'team-a',
      },
      {
        _id: 'doc2',
        fileId: 'file2',
        ragInfo: { status: 'completed' },
        teamId: 'team-b',
      },
    ]);

    const ids = await getAgentScopedFileIds(ctx, {
      organizationId: 'org1',
      agentTeamId: 'team-a',
      includeTeamKnowledge: true,
      includeOrgKnowledge: false,
    });

    expect(ids).toEqual(['file1']);
  });

  it('defaults includeTeamKnowledge to true (backward compat)', async () => {
    const ctx = createMockCtx([
      {
        _id: 'doc1',
        fileId: 'file1',
        ragInfo: { status: 'completed' },
        teamId: 'team-a',
      },
    ]);

    const ids = await getAgentScopedFileIds(ctx, {
      organizationId: 'org1',
      agentTeamId: 'team-a',
    });

    expect(ids).toEqual(['file1']);
  });

  it('excludes team documents when includeTeamKnowledge is false', async () => {
    const ctx = createMockCtx([
      {
        _id: 'doc1',
        fileId: 'file1',
        ragInfo: { status: 'completed' },
        teamId: 'team-a',
      },
    ]);

    const ids = await getAgentScopedFileIds(ctx, {
      organizationId: 'org1',
      agentTeamId: 'team-a',
      includeTeamKnowledge: false,
      includeOrgKnowledge: false,
    });

    expect(ids).toEqual([]);
  });

  it('includes org-wide documents when includeOrgKnowledge is true', async () => {
    const ctx = createMockCtx([
      { _id: 'doc1', fileId: 'file1', ragInfo: { status: 'completed' } },
      {
        _id: 'doc2',
        fileId: 'file2',
        ragInfo: { status: 'completed' },
        teamId: 'team-a',
      },
    ]);

    const ids = await getAgentScopedFileIds(ctx, {
      organizationId: 'org1',
      includeTeamKnowledge: false,
      includeOrgKnowledge: true,
    });

    expect(ids).toEqual(['file1']);
  });

  it('excludes non-completed documents', async () => {
    const ctx = createMockCtx([
      { _id: 'doc1', fileId: 'file1', ragInfo: { status: 'queued' } },
      { _id: 'doc2', fileId: 'file2', ragInfo: { status: 'running' } },
      { _id: 'doc3', fileId: 'file3', ragInfo: { status: 'failed' } },
      { _id: 'doc4', fileId: 'file4' },
    ]);

    const ids = await getAgentScopedFileIds(ctx, {
      organizationId: 'org1',
      includeOrgKnowledge: true,
    });

    expect(ids).toEqual([]);
  });

  it('skips documents without fileId', async () => {
    const ctx = createMockCtx([
      { _id: 'doc1', ragInfo: { status: 'completed' } },
      { _id: 'doc2', fileId: undefined, ragInfo: { status: 'completed' } },
      { _id: 'doc3', fileId: 'file3', ragInfo: { status: 'completed' } },
    ]);

    const ids = await getAgentScopedFileIds(ctx, {
      organizationId: 'org1',
      includeOrgKnowledge: true,
    });

    expect(ids).toEqual(['file3']);
  });

  it('combines all sources and deduplicates', async () => {
    const ctx = createMockCtx([
      {
        _id: 'doc1',
        fileId: 'file-team',
        ragInfo: { status: 'completed' },
        teamId: 'team-a',
      },
      {
        _id: 'doc2',
        fileId: 'file-org',
        ragInfo: { status: 'completed' },
      },
    ]);

    const ids = await getAgentScopedFileIds(ctx, {
      organizationId: 'org1',
      agentTeamId: 'team-a',
      includeTeamKnowledge: true,
      includeOrgKnowledge: true,
      knowledgeFileIds: ['file-agent', 'file-team'],
    });

    expect(ids).toContain('file-agent');
    expect(ids).toContain('file-team');
    expect(ids).toContain('file-org');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ignores team docs when no agentTeamId', async () => {
    const ctx = createMockCtx([
      {
        _id: 'doc1',
        fileId: 'file1',
        ragInfo: { status: 'completed' },
        teamId: 'team-a',
      },
      {
        _id: 'doc2',
        fileId: 'file2',
        ragInfo: { status: 'completed' },
      },
    ]);

    const ids = await getAgentScopedFileIds(ctx, {
      organizationId: 'org1',
      includeTeamKnowledge: true,
      includeOrgKnowledge: true,
    });

    expect(ids).toEqual(['file2']);
  });
});
