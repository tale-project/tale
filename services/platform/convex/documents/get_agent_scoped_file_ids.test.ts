import { describe, it, expect } from 'vitest';

import { getAgentScopedFileIds } from './get_agent_scoped_file_ids';

function createMockCtx(docs: Array<Record<string, unknown>>) {
  const makeAsyncIterator = (filtered: Array<Record<string, unknown>>) => ({
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next() {
          if (index < filtered.length) {
            return { value: filtered[index++], done: false };
          }
          return { value: undefined, done: true };
        },
      };
    },
  });

  // RAG completion is canonical on fileMetadata.ragStatus now. Derive the
  // completed fileMetadata rows from the doc fixtures (a doc is RAG-complete
  // when its ragInfo.status === 'completed'), and resolve documents by _id via
  // ctx.db.get — mirroring getAgentScopedFileIds' new query path.
  const completedFms = docs
    .filter(
      (d) =>
        (d.ragInfo as { status?: string } | undefined)?.status === 'completed',
    )
    .map((d) => ({
      storageId: d.fileId,
      documentId: d._id,
      ragStatus: 'completed',
      organizationId: 'org1',
    }));

  const docsById = new Map(docs.map((d) => [d._id, d]));

  const query = (table: string) => ({
    withIndex: (indexName: string) => {
      if (
        table === 'fileMetadata' &&
        indexName === 'by_organizationId_and_ragStatus_and_documentId'
      ) {
        return makeAsyncIterator(completedFms);
      }
      return makeAsyncIterator([]);
    },
  });

  const get = async (id: unknown) => docsById.get(id) ?? null;

  return { db: { query, get } } as unknown as Parameters<
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
        indexed: true,
        teamId: 'team-a',
      },
      {
        _id: 'doc2',
        fileId: 'file2',
        ragInfo: { status: 'completed' },
        indexed: true,
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
        indexed: true,
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
        indexed: true,
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
      {
        _id: 'doc1',
        fileId: 'file1',
        ragInfo: { status: 'completed' },
        indexed: true,
      },
      {
        _id: 'doc2',
        fileId: 'file2',
        ragInfo: { status: 'completed' },
        indexed: true,
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
      { _id: 'doc1', ragInfo: { status: 'completed' }, indexed: true },
      {
        _id: 'doc2',
        fileId: undefined,
        ragInfo: { status: 'completed' },
        indexed: true,
      },
      {
        _id: 'doc3',
        fileId: 'file3',
        ragInfo: { status: 'completed' },
        indexed: true,
      },
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
        indexed: true,
        teamId: 'team-a',
      },
      {
        _id: 'doc2',
        fileId: 'file-org',
        ragInfo: { status: 'completed' },
        indexed: true,
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

  it('includes project documents when agentProjectIds matches', async () => {
    const ctx = createMockCtx([
      {
        _id: 'doc1',
        fileId: 'file-proj',
        ragInfo: { status: 'completed' },
        indexed: true,
        projectId: 'proj-1',
      },
      {
        _id: 'doc2',
        fileId: 'file-other-proj',
        ragInfo: { status: 'completed' },
        indexed: true,
        projectId: 'proj-2',
      },
    ]);

    const ids = await getAgentScopedFileIds(ctx, {
      organizationId: 'org1',
      includeTeamKnowledge: false,
      includeOrgKnowledge: false,
      agentProjectIds: ['proj-1'],
    });

    expect(ids).toEqual(['file-proj']);
  });

  it('does not include project docs as org-wide docs (mutual exclusivity)', async () => {
    const ctx = createMockCtx([
      {
        _id: 'doc1',
        fileId: 'file-proj',
        ragInfo: { status: 'completed' },
        indexed: true,
        projectId: 'proj-1',
      },
      {
        _id: 'doc2',
        fileId: 'file-lib',
        ragInfo: { status: 'completed' },
        indexed: true,
      },
    ]);

    // includeOrgKnowledge with NO project scope: project doc must NOT leak.
    const ids = await getAgentScopedFileIds(ctx, {
      organizationId: 'org1',
      includeOrgKnowledge: true,
    });
    expect(ids).toEqual(['file-lib']);
  });

  it('unions team + project file IDs cleanly', async () => {
    const ctx = createMockCtx([
      {
        _id: 'doc1',
        fileId: 'file-team',
        ragInfo: { status: 'completed' },
        indexed: true,
        teamId: 'team-a',
      },
      {
        _id: 'doc2',
        fileId: 'file-proj',
        ragInfo: { status: 'completed' },
        indexed: true,
        projectId: 'proj-1',
      },
    ]);

    const ids = await getAgentScopedFileIds(ctx, {
      organizationId: 'org1',
      agentTeamId: 'team-a',
      includeTeamKnowledge: true,
      includeOrgKnowledge: false,
      agentProjectIds: ['proj-1'],
    });

    expect(ids.sort()).toEqual(['file-proj', 'file-team']);
  });

  it('ignores team docs when no agentTeamId', async () => {
    const ctx = createMockCtx([
      {
        _id: 'doc1',
        fileId: 'file1',
        ragInfo: { status: 'completed' },
        indexed: true,
        teamId: 'team-a',
      },
      {
        _id: 'doc2',
        fileId: 'file2',
        ragInfo: { status: 'completed' },
        indexed: true,
      },
    ]);

    const ids = await getAgentScopedFileIds(ctx, {
      organizationId: 'org1',
      includeTeamKnowledge: true,
      includeOrgKnowledge: true,
    });

    expect(ids).toEqual(['file2']);
  });

  // SSOT skip branches: with the canonical fileMetadata-keyed query, three
  // classes of completed rows must be dropped from agent scope. The index range
  // already excludes documentId-absent rows, but the in-loop guards backstop
  // each case — exercise them with explicit fileMetadata rows + a docs map.
  describe('SSOT skip branches', () => {
    function createScopedCtx(
      fms: Array<Record<string, unknown>>,
      docsById: Record<string, Record<string, unknown>>,
    ) {
      const makeAsyncIterator = (rows: Array<Record<string, unknown>>) => ({
        [Symbol.asyncIterator]() {
          let i = 0;
          return {
            async next() {
              return i < rows.length
                ? { value: rows[i++], done: false }
                : { value: undefined, done: true };
            },
          };
        },
      });
      const query = (table: string) => ({
        withIndex: (indexName: string) =>
          table === 'fileMetadata' &&
          indexName === 'by_organizationId_and_ragStatus_and_documentId'
            ? makeAsyncIterator(fms)
            : makeAsyncIterator([]),
      });
      const get = async (id: unknown) => docsById[id as string] ?? null;
      return { db: { query, get } } as unknown as Parameters<
        typeof getAgentScopedFileIds
      >[0];
    }

    const orgArgs = {
      organizationId: 'org1',
      includeTeamKnowledge: false,
      includeOrgKnowledge: true,
    };

    it('skips a completed row whose documentId is unset (defensive guard)', async () => {
      const ctx = createScopedCtx(
        [
          { storageId: 'blob-x', ragStatus: 'completed' }, // no documentId
          { storageId: 'blob-y', documentId: 'docY', ragStatus: 'completed' },
        ],
        { docY: { _id: 'docY', fileId: 'blob-y' } },
      );
      const ids = await getAgentScopedFileIds(ctx, orgArgs);
      expect(ids).toEqual(['blob-y']);
    });

    it('skips a stale completed row on a doc whose current blob differs', async () => {
      const ctx = createScopedCtx(
        [{ storageId: 'old-blob', documentId: 'docZ', ragStatus: 'completed' }],
        { docZ: { _id: 'docZ', fileId: 'new-blob' } }, // re-indexed: current blob moved
      );
      const ids = await getAgentScopedFileIds(ctx, orgArgs);
      expect(ids).toEqual([]);
    });

    it('skips trashed / soft-deleted documents', async () => {
      const ctx = createScopedCtx(
        [{ storageId: 'blob-t', documentId: 'docT', ragStatus: 'completed' }],
        { docT: { _id: 'docT', fileId: 'blob-t', lifecycleStatus: 'trashed' } },
      );
      const ids = await getAgentScopedFileIds(ctx, orgArgs);
      expect(ids).toEqual([]);
    });
  });
});
