import { describe, it, expect } from 'vitest';

import { listIndexedDocumentsForAgent } from '../list_indexed_documents_for_agent';

interface MockDoc {
  _id: string;
  fileId?: string;
  title?: string;
  teamId?: string;
  sourceModifiedAt?: number;
  indexed?: boolean;
}

function createMockCtx(docs: MockDoc[]) {
  const queryFn = () => ({
    withIndex: () => ({
      order: () => ({
        paginate: async (opts: { cursor: string | null; numItems: number }) => {
          // Simulate Convex .paginate() behavior
          const startIndex = opts.cursor ? Number(opts.cursor) : 0;
          const page = docs.slice(startIndex, startIndex + opts.numItems);
          const endIndex = startIndex + page.length;
          const isDone = endIndex >= docs.length;
          return {
            page,
            isDone,
            continueCursor: String(endIndex),
          };
        },
      }),
    }),
  });

  return { db: { query: queryFn } } as unknown as Parameters<
    typeof listIndexedDocumentsForAgent
  >[0];
}

describe('listIndexedDocumentsForAgent', () => {
  it('returns empty result when no indexed documents exist', async () => {
    const ctx = createMockCtx([]);
    const result = await listIndexedDocumentsForAgent(ctx, {
      organizationId: 'org1',
      includeOrgKnowledge: true,
    });

    expect(result.documents).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(result.cursor).toBeNull();
  });

  it('returns org-wide indexed documents', async () => {
    const ctx = createMockCtx([
      {
        _id: 'doc1',
        fileId: 'file1',
        title: 'Report.pdf',
        sourceModifiedAt: 1700000000000,
      },
      {
        _id: 'doc2',
        fileId: 'file2',
        title: 'Guide.docx',
        sourceModifiedAt: 1700100000000,
      },
    ]);

    const result = await listIndexedDocumentsForAgent(ctx, {
      organizationId: 'org1',
      includeOrgKnowledge: true,
    });

    expect(result.documents).toHaveLength(2);
    expect(result.documents[0]).toEqual({
      fileId: 'file1',
      name: 'Report.pdf',
      sourceModifiedAt: 1700000000000,
    });
    expect(result.documents[1]).toEqual({
      fileId: 'file2',
      name: 'Guide.docx',
      sourceModifiedAt: 1700100000000,
    });
  });

  it('filters by team scoping', async () => {
    const ctx = createMockCtx([
      {
        _id: 'doc1',
        fileId: 'file1',
        title: 'Team A Doc',
        teamId: 'team-a',
      },
      {
        _id: 'doc2',
        fileId: 'file2',
        title: 'Team B Doc',
        teamId: 'team-b',
      },
    ]);

    const result = await listIndexedDocumentsForAgent(ctx, {
      organizationId: 'org1',
      agentTeamId: 'team-a',
      includeTeamKnowledge: true,
      includeOrgKnowledge: false,
    });

    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].name).toBe('Team A Doc');
  });

  it('includes knowledgeFileIds regardless of team', async () => {
    const ctx = createMockCtx([
      {
        _id: 'doc1',
        fileId: 'file1',
        title: 'Explicit Doc',
        teamId: 'team-b',
      },
    ]);

    const result = await listIndexedDocumentsForAgent(ctx, {
      organizationId: 'org1',
      knowledgeFileIds: ['file1'],
      includeTeamKnowledge: false,
      includeOrgKnowledge: false,
    });

    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].fileId).toBe('file1');
  });

  it('skips documents without fileId', async () => {
    const ctx = createMockCtx([
      { _id: 'doc1', title: 'No FileId' },
      { _id: 'doc2', fileId: 'file2', title: 'Has FileId' },
    ]);

    const result = await listIndexedDocumentsForAgent(ctx, {
      organizationId: 'org1',
      includeOrgKnowledge: true,
    });

    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].name).toBe('Has FileId');
  });

  it('uses "Untitled" for documents without title', async () => {
    const ctx = createMockCtx([{ _id: 'doc1', fileId: 'file1' }]);

    const result = await listIndexedDocumentsForAgent(ctx, {
      organizationId: 'org1',
      includeOrgKnowledge: true,
    });

    expect(result.documents[0].name).toBe('Untitled');
  });

  it('returns null for missing sourceModifiedAt', async () => {
    const ctx = createMockCtx([
      { _id: 'doc1', fileId: 'file1', title: 'Test' },
    ]);

    const result = await listIndexedDocumentsForAgent(ctx, {
      organizationId: 'org1',
      includeOrgKnowledge: true,
    });

    expect(result.documents[0].sourceModifiedAt).toBeNull();
  });

  it('respects limit parameter', async () => {
    const docs = Array.from({ length: 5 }, (_, i) => ({
      _id: `doc${i}`,
      fileId: `file${i}`,
      title: `Doc ${i}`,
    }));

    const ctx = createMockCtx(docs);
    const result = await listIndexedDocumentsForAgent(ctx, {
      organizationId: 'org1',
      includeOrgKnowledge: true,
      limit: 3,
    });

    expect(result.documents).toHaveLength(3);
    expect(result.hasMore).toBe(true);
  });

  it('returns hasMore false when all results fit', async () => {
    const ctx = createMockCtx([
      { _id: 'doc1', fileId: 'file1', title: 'Only Doc' },
    ]);

    const result = await listIndexedDocumentsForAgent(ctx, {
      organizationId: 'org1',
      includeOrgKnowledge: true,
      limit: 10,
    });

    expect(result.hasMore).toBe(false);
    expect(result.cursor).toBeNull();
  });

  it('does not expose _id in response', async () => {
    const ctx = createMockCtx([
      { _id: 'doc1', fileId: 'file1', title: 'Secret Doc' },
    ]);

    const result = await listIndexedDocumentsForAgent(ctx, {
      organizationId: 'org1',
      includeOrgKnowledge: true,
    });

    const doc = result.documents[0];
    expect(doc).toEqual({
      fileId: 'file1',
      name: 'Secret Doc',
      sourceModifiedAt: null,
    });
    expect('_id' in doc).toBe(false);
  });

  it('supports cursor continuation across pages', async () => {
    const docs = Array.from({ length: 10 }, (_, i) => ({
      _id: `doc${i}`,
      fileId: `file${i}`,
      title: `Doc ${i}`,
    }));

    const ctx = createMockCtx(docs);

    // First page
    const page1 = await listIndexedDocumentsForAgent(ctx, {
      organizationId: 'org1',
      includeOrgKnowledge: true,
      limit: 4,
    });

    expect(page1.documents).toHaveLength(4);
    expect(page1.hasMore).toBe(true);
    expect(page1.cursor).not.toBeNull();

    // Second page using cursor
    const cursor1 = page1.cursor ?? undefined;
    const page2 = await listIndexedDocumentsForAgent(ctx, {
      organizationId: 'org1',
      includeOrgKnowledge: true,
      limit: 4,
      cursor: cursor1,
    });

    expect(page2.documents).toHaveLength(4);
    expect(page2.hasMore).toBe(true);

    // Third page - should get remaining 2
    const cursor2 = page2.cursor ?? undefined;
    const page3 = await listIndexedDocumentsForAgent(ctx, {
      organizationId: 'org1',
      includeOrgKnowledge: true,
      limit: 4,
      cursor: cursor2,
    });

    expect(page3.documents).toHaveLength(2);
    expect(page3.hasMore).toBe(false);

    // Verify no documents lost across pages
    const allFileIds = [
      ...page1.documents,
      ...page2.documents,
      ...page3.documents,
    ].map((d) => d.fileId);
    const uniqueFileIds = new Set(allFileIds);
    expect(uniqueFileIds.size).toBe(10);
  });

  it('encodes composite cursor with skip count when a DB page overflows limit', async () => {
    // 5 matching docs all returned in a single DB page (isDone=true).
    // With limit=3, the first call collects all 5, returns the first 3,
    // and the cursor must encode a skip count (JSON { c, s }) so the
    // next call re-fetches the same DB page and skips already-returned
    // matches.
    const docs = Array.from({ length: 5 }, (_, i) => ({
      _id: `doc${i}`,
      fileId: `file${i}`,
      title: `Doc ${i}`,
    }));

    const queryFn = () => ({
      withIndex: () => ({
        order: () => ({
          paginate: async () => ({
            page: docs,
            isDone: true,
            continueCursor: 'end',
          }),
        }),
      }),
    });
    const ctx = { db: { query: queryFn } } as unknown as Parameters<
      typeof listIndexedDocumentsForAgent
    >[0];

    // First page: returns 3 docs, cursor encodes skip
    const page1 = await listIndexedDocumentsForAgent(ctx, {
      organizationId: 'org1',
      includeOrgKnowledge: true,
      limit: 3,
    });

    expect(page1.documents).toHaveLength(3);
    expect(page1.hasMore).toBe(true);
    expect(page1.cursor).not.toBeNull();

    // The cursor must be a JSON-encoded composite with `c` and `s` fields
    const cursor = page1.cursor ?? '';
    const parsed = JSON.parse(cursor);
    expect(parsed).toHaveProperty('c');
    expect(parsed).toHaveProperty('s');
    expect(parsed.s).toBe(3);

    // Second page: pass the composite cursor back; skip=3 means docs 3 & 4
    const page2 = await listIndexedDocumentsForAgent(ctx, {
      organizationId: 'org1',
      includeOrgKnowledge: true,
      limit: 3,
      cursor,
    });

    expect(page2.documents).toHaveLength(2);
    expect(page2.hasMore).toBe(false);
    expect(page2.cursor).toBeNull();

    // All 5 docs returned with no duplicates
    const allFileIds = [...page1.documents, ...page2.documents].map(
      (d) => d.fileId,
    );
    expect(new Set(allFileIds).size).toBe(5);
    expect(allFileIds).toEqual(['file0', 'file1', 'file2', 'file3', 'file4']);
  });

  it('does not lose documents when filtering reduces page results', async () => {
    // Mix of team-a and team-b docs — only team-a matches
    const docs = Array.from({ length: 20 }, (_, i) => ({
      _id: `doc${i}`,
      fileId: `file${i}`,
      title: `Doc ${i}`,
      teamId: i % 2 === 0 ? 'team-a' : 'team-b',
    }));

    const ctx = createMockCtx(docs);

    const allDocs: Array<{ fileId: string }> = [];
    let cursor: string | null = null;
    let iterations = 0;

    do {
      const result = await listIndexedDocumentsForAgent(ctx, {
        organizationId: 'org1',
        agentTeamId: 'team-a',
        includeTeamKnowledge: true,
        includeOrgKnowledge: false,
        limit: 3,
        cursor: cursor ?? undefined,
      });
      allDocs.push(...result.documents);
      cursor = result.cursor;
      iterations++;
      if (iterations > 20) break; // safety valve
    } while (cursor);

    // All 10 team-a docs should be returned (indices 0,2,4,6,8,10,12,14,16,18)
    expect(allDocs).toHaveLength(10);
    const uniqueFileIds = new Set(allDocs.map((d) => d.fileId));
    expect(uniqueFileIds.size).toBe(10);
  });
});
