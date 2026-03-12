import { describe, expect, it, vi } from 'vitest';

import type { QueryCtx } from '../../_generated/server';

import { listDocumentsForAgent } from '../list_documents_for_agent';

vi.mock('../../folders/queries', () => ({
  buildBreadcrumb: vi.fn().mockImplementation((_ctx, folderId: string) => {
    const paths: Record<string, Array<{ _id: string; name: string }>> = {
      f_contracts: [{ _id: 'f_contracts', name: 'contracts' }],
      f_2024: [
        { _id: 'f_contracts', name: 'contracts' },
        { _id: 'f_2024', name: '2024' },
      ],
      f_marketing: [{ _id: 'f_marketing', name: 'marketing' }],
      f_sub1: [
        { _id: 'f_templates', name: 'templates' },
        { _id: 'f_sub1', name: 'sub' },
      ],
      f_sub2: [
        { _id: 'f_templates', name: 'templates' },
        { _id: 'f_sub1', name: 'sub' },
        { _id: 'f_sub2', name: 'sub' },
      ],
      f_docs_a: [
        { _id: 'f_a', name: 'team_a' },
        { _id: 'f_docs_a', name: 'docs' },
      ],
      f_docs_b: [
        { _id: 'f_b', name: 'team_b' },
        { _id: 'f_docs_b', name: 'docs' },
      ],
      f_sales: [{ _id: 'f_sales', name: 'sales' }],
      f_q1: [
        { _id: 'f_sales', name: 'sales' },
        { _id: 'f_q1', name: 'q1' },
      ],
      f_shared: [{ _id: 'f_shared', name: 'shared' }],
      f_team_docs: [
        { _id: 'f_root', name: 'projects' },
        { _id: 'f_team_docs', name: 'team-docs' },
      ],
    };
    return Promise.resolve(paths[folderId] ?? []);
  }),
}));

interface MockDoc {
  _id: string;
  _creationTime: number;
  organizationId: string;
  title?: string;
  extension?: string;
  fileId?: string;
  teamId?: string;
  folderId?: string;
  metadata?: Record<string, unknown>;
}

interface MockFolder {
  name: string;
  organizationId: string;
  parentId?: string;
  teamId?: string;
  teamTags?: string[];
}

function createMockCtx(
  folders: Record<string, MockFolder>,
  documents: MockDoc[],
) {
  return {
    db: {
      query: vi.fn().mockImplementation((table: string) => {
        let orgFilter: string | undefined;
        let parentFilter: string | undefined;
        let nameFilter: string | undefined;
        let folderFilter: string | undefined;
        let extensionFilter: string | undefined;
        let indexUsed: string | undefined;

        const getIterator = () => {
          let matches: unknown[];
          if (table === 'folders') {
            matches = Object.entries(folders)
              .filter(([, f]) => f.organizationId === orgFilter)
              .map(([id, f]) => ({ _id: id, ...f }));
          } else {
            matches = documents.filter((d) => {
              if (d.organizationId !== orgFilter) return false;
              if (
                indexUsed === 'by_organizationId_and_folderId' &&
                d.folderId !== folderFilter
              )
                return false;
              if (
                indexUsed === 'by_organizationId_and_extension' &&
                d.extension !== extensionFilter
              )
                return false;
              return true;
            });
          }
          let i = 0;
          return {
            next: () =>
              Promise.resolve(
                i < matches.length
                  ? { value: matches[i++], done: false }
                  : { value: undefined, done: true },
              ),
          };
        };

        const orderedBuilder = {
          [Symbol.asyncIterator]: getIterator,
        };

        const builder = {
          withIndex: vi
            .fn()
            .mockImplementation(
              (indexName: string, cb: (q: unknown) => void) => {
                indexUsed = indexName;
                const qb = {
                  eq: vi
                    .fn()
                    .mockImplementation((field: string, value: unknown) => {
                      if (field === 'organizationId')
                        orgFilter = value as string;
                      if (field === 'parentId')
                        parentFilter = value as string | undefined;
                      if (field === 'name') nameFilter = value as string;
                      if (field === 'folderId')
                        folderFilter = value as string | undefined;
                      if (field === 'extension')
                        extensionFilter = value as string | undefined;
                      return qb;
                    }),
                };
                cb(qb);
                return builder;
              },
            ),
          order: vi.fn().mockReturnValue(orderedBuilder),
          first: vi.fn().mockImplementation(() => {
            if (table === 'folders') {
              for (const [id, f] of Object.entries(folders)) {
                if (
                  f.organizationId === orgFilter &&
                  f.parentId === parentFilter &&
                  f.name === nameFilter
                ) {
                  return Promise.resolve({ _id: id, ...f });
                }
              }
              return Promise.resolve(null);
            }
            return Promise.resolve(null);
          }),
          [Symbol.asyncIterator]: getIterator,
        };

        return builder;
      }),
    },
  };
}

const baseArgs = {
  organizationId: 'org1',
  userTeamIds: ['team1', 'team2'],
};

function makeDoc(overrides: Partial<MockDoc> & { _id: string }): MockDoc {
  return {
    _creationTime: Date.now(),
    organizationId: 'org1',
    title: 'Untitled',
    fileId: `file_${overrides._id}`,
    ...overrides,
  };
}

describe('listDocumentsForAgent', () => {
  describe('basic listing', () => {
    it('returns empty result when no documents exist', async () => {
      const ctx = createMockCtx({}, []);
      const result = await listDocumentsForAgent(
        ctx as unknown as QueryCtx,
        baseArgs,
      );

      expect(result.documents).toEqual([]);
      expect(result.totalCount).toBe(0);
      expect(result.hasMore).toBe(false);
      expect(result.cursor).toBeNull();
      expect(result.warning).toBeNull();
    });

    it('returns documents with correct fields', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({
          _id: 'doc1',
          fileId: 'file1',
          title: 'report.pdf',
          extension: 'pdf',
          _creationTime: 1000,
          metadata: { size: 12345 },
        }),
      ]);

      const result = await listDocumentsForAgent(
        ctx as unknown as QueryCtx,
        baseArgs,
      );

      expect(result.documents).toHaveLength(1);
      expect(result.documents[0]).toEqual({
        id: 'doc1',
        fileId: 'file1',
        title: 'report.pdf',
        extension: 'pdf',
        folderPath: null,
        teamId: null,
        createdAt: 1000,
        sizeBytes: 12345,
      });
    });

    it('returns "Untitled" when document has no title', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1', title: undefined }),
      ]);

      const result = await listDocumentsForAgent(
        ctx as unknown as QueryCtx,
        baseArgs,
      );

      expect(result.documents[0]?.title).toBe('Untitled');
    });

    it('returns fileId when document has a file', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({
          _id: 'doc1',
          fileId: 'storage_abc123',
          title: 'report.pdf',
        }),
      ]);

      const result = await listDocumentsForAgent(
        ctx as unknown as QueryCtx,
        baseArgs,
      );

      expect(result.documents[0]?.fileId).toBe('storage_abc123');
    });

    it('skips documents without fileId', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1', fileId: 'file1', title: 'with-file.pdf' }),
        makeDoc({ _id: 'doc2', fileId: undefined, title: 'no-file.txt' }),
      ]);

      const result = await listDocumentsForAgent(
        ctx as unknown as QueryCtx,
        baseArgs,
      );

      expect(result.documents).toHaveLength(1);
      expect(result.documents[0]?.id).toBe('doc1');
    });

    it('returns null sizeBytes when metadata is missing', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1', metadata: undefined }),
      ]);

      const result = await listDocumentsForAgent(
        ctx as unknown as QueryCtx,
        baseArgs,
      );

      expect(result.documents[0]?.sizeBytes).toBeNull();
    });
  });

  describe('filtering', () => {
    it('filters by extension', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1', extension: 'pdf' }),
        makeDoc({ _id: 'doc2', extension: 'docx' }),
        makeDoc({ _id: 'doc3', extension: 'pdf' }),
      ]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        extension: 'pdf',
      });

      expect(result.documents).toHaveLength(2);
      expect(result.documents.every((d) => d.extension === 'pdf')).toBe(true);
    });

    it('filters by folderPath', async () => {
      const ctx = createMockCtx(
        {
          f_contracts: {
            name: 'contracts',
            organizationId: 'org1',
            parentId: undefined,
          },
        },
        [
          makeDoc({ _id: 'doc1', folderId: 'f_contracts', title: 'a.pdf' }),
          makeDoc({ _id: 'doc2', folderId: undefined, title: 'b.pdf' }),
        ],
      );

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        folderPath: 'contracts',
      });

      expect(result.documents).toHaveLength(1);
      expect(result.documents[0]?.id).toBe('doc1');
      expect(result.documents[0]?.folderPath).toBe('contracts');
    });

    it('returns empty for non-existent folderPath', async () => {
      const ctx = createMockCtx({}, [makeDoc({ _id: 'doc1' })]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        folderPath: 'nonexistent',
      });

      expect(result.documents).toEqual([]);
      expect(result.totalCount).toBe(0);
    });

    it('filters by date range', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1', _creationTime: 1000 }),
        makeDoc({ _id: 'doc2', _creationTime: 2000 }),
        makeDoc({ _id: 'doc3', _creationTime: 3000 }),
      ]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        dateFrom: 1500,
        dateTo: 2500,
      });

      expect(result.documents).toHaveLength(1);
      expect(result.documents[0]?.id).toBe('doc2');
    });

    it('filters by fileName (case-insensitive)', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1', title: 'Annual Report 2024' }),
        makeDoc({ _id: 'doc2', title: 'Budget Plan' }),
        makeDoc({ _id: 'doc3', title: 'Quarterly Report Q3' }),
      ]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        fileName: 'report',
      });

      expect(result.documents).toHaveLength(2);
      const ids = result.documents.map((d) => d.id);
      expect(ids).toContain('doc1');
      expect(ids).toContain('doc3');
    });

    it('applies combined filters', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({
          _id: 'doc1',
          extension: 'pdf',
          title: 'Report',
          _creationTime: 2000,
        }),
        makeDoc({
          _id: 'doc2',
          extension: 'docx',
          title: 'Report',
          _creationTime: 2000,
        }),
        makeDoc({
          _id: 'doc3',
          extension: 'pdf',
          title: 'Notes',
          _creationTime: 2000,
        }),
        makeDoc({
          _id: 'doc4',
          extension: 'pdf',
          title: 'Report',
          _creationTime: 500,
        }),
      ]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        extension: 'pdf',
        fileName: 'report',
        dateFrom: 1000,
      });

      expect(result.documents).toHaveLength(1);
      expect(result.documents[0]?.id).toBe('doc1');
    });
  });

  describe('team access control', () => {
    it('returns org-wide documents (no teamId) for any user', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1', teamId: undefined }),
      ]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        userTeamIds: [],
      });

      expect(result.documents).toHaveLength(1);
    });

    it('filters out documents from teams user does not belong to', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1', teamId: 'team1' }),
        makeDoc({ _id: 'doc2', teamId: 'team3' }),
        makeDoc({ _id: 'doc3', teamId: undefined }),
      ]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        userTeamIds: ['team1'],
      });

      expect(result.documents).toHaveLength(2);
      const ids = result.documents.map((d) => d.id);
      expect(ids).toContain('doc1');
      expect(ids).toContain('doc3');
    });

    it('filters by specific teamId', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1', teamId: 'team1' }),
        makeDoc({ _id: 'doc2', teamId: 'team2' }),
        makeDoc({ _id: 'doc3', teamId: undefined }),
      ]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        teamId: 'team1',
      });

      expect(result.documents).toHaveLength(1);
      expect(result.documents[0]?.id).toBe('doc1');
    });

    it('returns empty when teamId filter is not in user teams', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1', teamId: 'team3' }),
      ]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        userTeamIds: ['team1'],
        teamId: 'team3',
      });

      expect(result.documents).toEqual([]);
    });
  });

  describe('sorting', () => {
    it('sorts by createdAt desc by default', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1', _creationTime: 1000 }),
        makeDoc({ _id: 'doc2', _creationTime: 3000 }),
        makeDoc({ _id: 'doc3', _creationTime: 2000 }),
      ]);

      const result = await listDocumentsForAgent(
        ctx as unknown as QueryCtx,
        baseArgs,
      );

      expect(result.documents.map((d) => d.id)).toEqual([
        'doc2',
        'doc3',
        'doc1',
      ]);
    });

    it('sorts by createdAt asc', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1', _creationTime: 3000 }),
        makeDoc({ _id: 'doc2', _creationTime: 1000 }),
        makeDoc({ _id: 'doc3', _creationTime: 2000 }),
      ]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        sortBy: 'createdAt',
        sortOrder: 'asc',
      });

      expect(result.documents.map((d) => d.id)).toEqual([
        'doc2',
        'doc3',
        'doc1',
      ]);
    });

    it('sorts by name asc', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1', title: 'Charlie' }),
        makeDoc({ _id: 'doc2', title: 'Alpha' }),
        makeDoc({ _id: 'doc3', title: 'Bravo' }),
      ]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        sortBy: 'name',
        sortOrder: 'asc',
      });

      expect(result.documents.map((d) => d.title)).toEqual([
        'Alpha',
        'Bravo',
        'Charlie',
      ]);
    });

    it('sorts by name desc', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1', title: 'Alpha' }),
        makeDoc({ _id: 'doc2', title: 'Charlie' }),
        makeDoc({ _id: 'doc3', title: 'Bravo' }),
      ]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        sortBy: 'name',
        sortOrder: 'desc',
      });

      expect(result.documents.map((d) => d.title)).toEqual([
        'Charlie',
        'Bravo',
        'Alpha',
      ]);
    });
  });

  describe('limit and pagination', () => {
    it('defaults to limit 20', async () => {
      const docs = Array.from({ length: 25 }, (_, i) =>
        makeDoc({ _id: `doc${i}`, _creationTime: i }),
      );
      const ctx = createMockCtx({}, docs);

      const result = await listDocumentsForAgent(
        ctx as unknown as QueryCtx,
        baseArgs,
      );

      expect(result.documents).toHaveLength(20);
      expect(result.hasMore).toBe(true);
      expect(result.totalCount).toBe(25);
    });

    it('respects custom limit', async () => {
      const docs = Array.from({ length: 10 }, (_, i) =>
        makeDoc({ _id: `doc${i}`, _creationTime: i }),
      );
      const ctx = createMockCtx({}, docs);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        limit: 5,
      });

      expect(result.documents).toHaveLength(5);
      expect(result.hasMore).toBe(true);
    });

    it('clamps limit to max 50', async () => {
      const docs = Array.from({ length: 60 }, (_, i) =>
        makeDoc({ _id: `doc${i}`, _creationTime: i }),
      );
      const ctx = createMockCtx({}, docs);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        limit: 100,
      });

      expect(result.documents).toHaveLength(50);
    });

    it('clamps limit to min 1', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1' }),
        makeDoc({ _id: 'doc2' }),
      ]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        limit: 0,
      });

      expect(result.documents).toHaveLength(1);
    });

    it('sets hasMore=false when all results fit', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1' }),
        makeDoc({ _id: 'doc2' }),
      ]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        limit: 10,
      });

      expect(result.hasMore).toBe(false);
      expect(result.cursor).toBeNull();
    });

    it('returns cursor for pagination', async () => {
      const docs = Array.from({ length: 5 }, (_, i) =>
        makeDoc({ _id: `doc${i}`, _creationTime: (4 - i) * 1000 }),
      );
      const ctx = createMockCtx({}, docs);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        limit: 3,
      });

      expect(result.documents).toHaveLength(3);
      expect(result.hasMore).toBe(true);
      expect(result.cursor).toBe(3);
    });

    it('supports cursor-based pagination for next page', async () => {
      const docs = Array.from({ length: 5 }, (_, i) =>
        makeDoc({ _id: `doc${i}`, _creationTime: (4 - i) * 1000 }),
      );
      const ctx = createMockCtx({}, docs);

      // First page
      const page1 = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        limit: 3,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });
      expect(page1.documents).toHaveLength(3);
      expect(page1.hasMore).toBe(true);

      // Second page
      const page2 = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        limit: 3,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        cursor: page1.cursor ?? undefined,
      });
      expect(page2.documents).toHaveLength(2);
      expect(page2.hasMore).toBe(false);

      // No overlap between pages
      const page1Ids = new Set(page1.documents.map((d) => d.id));
      for (const doc of page2.documents) {
        expect(page1Ids.has(doc.id)).toBe(false);
      }
    });
  });

  describe('edge cases', () => {
    it('paginates correctly with sortBy name using offset cursor', async () => {
      const docs = Array.from({ length: 5 }, (_, i) =>
        makeDoc({
          _id: `doc${i}`,
          title: String.fromCharCode(65 + i),
          _creationTime: (4 - i) * 1000,
        }),
      );
      const ctx = createMockCtx({}, docs);

      const page1 = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        sortBy: 'name',
        sortOrder: 'asc',
        limit: 3,
      });

      expect(page1.documents).toHaveLength(3);
      expect(page1.documents.map((d) => d.title)).toEqual(['A', 'B', 'C']);
      expect(page1.hasMore).toBe(true);
      expect(page1.cursor).toBe(3);

      const page2 = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        sortBy: 'name',
        sortOrder: 'asc',
        limit: 3,
        cursor: page1.cursor ?? undefined,
      });

      expect(page2.documents.map((d) => d.title)).toEqual(['D', 'E']);
      expect(page2.hasMore).toBe(false);
    });

    it('does not skip documents with duplicate _creationTime at page boundary', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc0', _creationTime: 3000 }),
        makeDoc({ _id: 'doc1', _creationTime: 2000 }),
        makeDoc({ _id: 'doc2', _creationTime: 2000 }),
        makeDoc({ _id: 'doc3', _creationTime: 2000 }),
        makeDoc({ _id: 'doc4', _creationTime: 1000 }),
      ]);

      const page1 = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        limit: 2,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });

      expect(page1.documents).toHaveLength(2);
      expect(page1.cursor).toBe(2);

      const page2 = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        limit: 2,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        cursor: page1.cursor ?? undefined,
      });

      expect(page2.documents).toHaveLength(2);
      expect(page2.hasMore).toBe(true);

      const page3 = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        limit: 2,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        cursor: page2.cursor ?? undefined,
      });

      expect(page3.documents).toHaveLength(1);
      expect(page3.hasMore).toBe(false);

      // All 5 docs returned across 3 pages with no skipping
      const allIds = [
        ...page1.documents,
        ...page2.documents,
        ...page3.documents,
      ].map((d) => d.id);
      expect(new Set(allIds).size).toBe(5);
    });

    it('returns exact totalCount when under scan limit', async () => {
      const docs = Array.from({ length: 25 }, (_, i) =>
        makeDoc({ _id: `doc${i}`, _creationTime: i }),
      );
      const ctx = createMockCtx({}, docs);

      const result = await listDocumentsForAgent(
        ctx as unknown as QueryCtx,
        baseArgs,
      );

      // With 25 docs (< MAX_SCAN), totalCount is exact
      expect(result.totalCount).toBe(25);
    });

    it('does not filter when dateFrom is NaN (NaN comparisons are always false)', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1', _creationTime: 1000 }),
        makeDoc({ _id: 'doc2', _creationTime: 2000 }),
      ]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        dateFrom: NaN,
      });

      expect(result.documents).toHaveLength(2);
    });

    it('treats folderPath "/" as no folder filter', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1' }),
        makeDoc({ _id: 'doc2' }),
      ]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        folderPath: '/',
      });

      // "/" resolves to empty segments → no folder filter applied
      expect(result.documents).toHaveLength(2);
    });

    it('treats folderPath "" as no folder filter', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1' }),
        makeDoc({ _id: 'doc2' }),
      ]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        folderPath: '',
      });

      expect(result.documents).toHaveLength(2);
    });

    it('applies dateFrom filter when value is 0', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1', _creationTime: 1000 }),
        makeDoc({ _id: 'doc2', _creationTime: 2000 }),
      ]);

      // dateFrom: 0 means epoch start — all docs with _creationTime >= 0 pass
      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        dateFrom: 0,
      });

      expect(result.documents).toHaveLength(2);
    });

    it('uses _id as tiebreaker for deterministic sort', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc_b', _creationTime: 1000 }),
        makeDoc({ _id: 'doc_a', _creationTime: 1000 }),
        makeDoc({ _id: 'doc_c', _creationTime: 1000 }),
      ]);

      const result = await listDocumentsForAgent(
        ctx as unknown as QueryCtx,
        baseArgs,
      );

      // Same _creationTime, sorted by _id as tiebreaker
      expect(result.documents.map((d) => d.id)).toEqual([
        'doc_a',
        'doc_b',
        'doc_c',
      ]);
    });
  });

  describe('folder path resolution', () => {
    it('resolves nested folder path', async () => {
      const ctx = createMockCtx(
        {
          f_contracts: {
            name: 'contracts',
            organizationId: 'org1',
            parentId: undefined,
          },
          f_2024: {
            name: '2024',
            organizationId: 'org1',
            parentId: 'f_contracts',
          },
        },
        [makeDoc({ _id: 'doc1', folderId: 'f_2024', title: 'invoice.pdf' })],
      );

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        folderPath: 'contracts/2024',
      });

      expect(result.documents).toHaveLength(1);
      expect(result.documents[0]?.folderPath).toBe('contracts/2024');
    });

    it('handles leading slash in folderPath', async () => {
      const ctx = createMockCtx(
        {
          f_contracts: {
            name: 'contracts',
            organizationId: 'org1',
            parentId: undefined,
          },
        },
        [makeDoc({ _id: 'doc1', folderId: 'f_contracts' })],
      );

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        folderPath: '/contracts',
      });

      expect(result.documents).toHaveLength(1);
    });
  });

  describe('scan limit and warning', () => {
    it('sets warning and totalCount null when scan limit is hit', async () => {
      const docs = Array.from({ length: 8 }, (_, i) =>
        makeDoc({ _id: `doc${i}`, _creationTime: i * 1000 }),
      );
      const ctx = createMockCtx({}, docs);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        _maxScan: 5,
      });

      expect(result.totalCount).toBeNull();
      expect(result.warning).toContain('Scan limit reached');
    });

    it('returns no warning when under scan limit', async () => {
      const docs = Array.from({ length: 3 }, (_, i) =>
        makeDoc({ _id: `doc${i}`, _creationTime: i * 1000 }),
      );
      const ctx = createMockCtx({}, docs);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        _maxScan: 100,
      });

      expect(result.totalCount).toBe(3);
      expect(result.warning).toBeNull();
    });

    it('terminates pagination without infinite loop when scan limit is hit', async () => {
      const docs = Array.from({ length: 10 }, (_, i) =>
        makeDoc({ _id: `doc${i}`, _creationTime: i * 1000 }),
      );
      const ctx = createMockCtx({}, docs);

      const allIds: string[] = [];
      let cursor: number | undefined;
      let pages = 0;

      // Paginate until done — should terminate
      while (pages < 20) {
        const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
          ...baseArgs,
          limit: 3,
          _maxScan: 7,
          cursor,
        });

        allIds.push(...result.documents.map((d) => d.id));
        pages++;

        if (!result.hasMore) break;
        cursor = result.cursor ?? undefined;
      }

      // Should terminate well under 20 pages
      expect(pages).toBeLessThan(10);
      // Should have gotten some documents
      expect(allIds.length).toBeGreaterThan(0);
      // No duplicates
      expect(new Set(allIds).size).toBe(allIds.length);
    });
  });

  describe('defensive cursor handling', () => {
    it('clamps negative cursor to 0', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1', _creationTime: 2000 }),
        makeDoc({ _id: 'doc2', _creationTime: 1000 }),
      ]);

      const withNegative = await listDocumentsForAgent(
        ctx as unknown as QueryCtx,
        { ...baseArgs, cursor: -5 },
      );
      const withZero = await listDocumentsForAgent(
        ctx as unknown as QueryCtx,
        baseArgs,
      );

      expect(withNegative.documents.map((d) => d.id)).toEqual(
        withZero.documents.map((d) => d.id),
      );
    });

    it('returns empty page for cursor beyond total results', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1' }),
        makeDoc({ _id: 'doc2' }),
      ]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        cursor: 999,
      });

      expect(result.documents).toEqual([]);
      expect(result.hasMore).toBe(false);
    });
  });

  describe('combined filters', () => {
    it('filters by extension when both extension and folderId are provided', async () => {
      const ctx = createMockCtx(
        {
          f_contracts: {
            name: 'contracts',
            organizationId: 'org1',
            parentId: undefined,
          },
        },
        [
          makeDoc({
            _id: 'doc1',
            folderId: 'f_contracts',
            extension: 'pdf',
          }),
          makeDoc({
            _id: 'doc2',
            folderId: 'f_contracts',
            extension: 'docx',
          }),
          makeDoc({
            _id: 'doc3',
            folderId: 'f_contracts',
            extension: 'pdf',
          }),
        ],
      );

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        folderPath: 'contracts',
        extension: 'pdf',
      });

      expect(result.documents).toHaveLength(2);
      expect(result.documents.every((d) => d.extension === 'pdf')).toBe(true);
    });
  });

  describe('dateTo filter', () => {
    it('filters by dateTo without dateFrom', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1', _creationTime: 1000 }),
        makeDoc({ _id: 'doc2', _creationTime: 2000 }),
        makeDoc({ _id: 'doc3', _creationTime: 3000 }),
      ]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        dateTo: 2500,
      });

      expect(result.documents).toHaveLength(2);
      const ids = result.documents.map((d) => d.id);
      expect(ids).toContain('doc1');
      expect(ids).toContain('doc2');
    });

    it('filters by dateFrom and dateTo on the same day', async () => {
      const dayStart = new Date('2026-03-15').getTime();
      const dayEnd = dayStart + 86_400_000 - 1;

      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1', _creationTime: dayStart - 1 }),
        makeDoc({ _id: 'doc2', _creationTime: dayStart }),
        makeDoc({ _id: 'doc3', _creationTime: dayStart + 43_200_000 }),
        makeDoc({ _id: 'doc4', _creationTime: dayEnd }),
        makeDoc({ _id: 'doc5', _creationTime: dayEnd + 1 }),
      ]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        dateFrom: dayStart,
        dateTo: dayEnd,
      });

      expect(result.documents).toHaveLength(3);
      const ids = result.documents.map((d) => d.id);
      expect(ids).toContain('doc2');
      expect(ids).toContain('doc3');
      expect(ids).toContain('doc4');
    });
  });

  describe('whitespace fileName', () => {
    it('treats whitespace-only fileName as no filter', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1', title: 'Alpha' }),
        makeDoc({ _id: 'doc2', title: 'Bravo' }),
      ]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        fileName: '   ',
      });

      expect(result.documents).toHaveLength(2);
    });
  });

  describe('metadata.name fallback', () => {
    it('uses metadata.name as fallback when title is undefined', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({
          _id: 'doc1',
          title: undefined,
          metadata: { name: 'Invoice Q3' },
        }),
      ]);

      const result = await listDocumentsForAgent(
        ctx as unknown as QueryCtx,
        baseArgs,
      );

      expect(result.documents[0]?.title).toBe('Invoice Q3');
    });

    it('ignores non-string metadata.name', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({
          _id: 'doc1',
          title: undefined,
          metadata: { name: 123 },
        }),
      ]);

      const result = await listDocumentsForAgent(
        ctx as unknown as QueryCtx,
        baseArgs,
      );

      expect(result.documents[0]?.title).toBe('Untitled');
    });

    it('searches by metadata.name when title is undefined', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({
          _id: 'doc1',
          title: undefined,
          metadata: { name: 'Invoice Q3' },
        }),
        makeDoc({ _id: 'doc2', title: 'Budget Report' }),
      ]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        fileName: 'invoice',
      });

      expect(result.documents).toHaveLength(1);
      expect(result.documents[0]?.id).toBe('doc1');
    });
  });

  describe('title search edge cases', () => {
    it('matches untitled docs when searching for "untitled"', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1', title: undefined }),
        makeDoc({ _id: 'doc2', title: 'Report' }),
      ]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        fileName: 'untitled',
      });

      expect(result.documents).toHaveLength(1);
      expect(result.documents[0]?.id).toBe('doc1');
    });
  });

  describe('resolveFolderPaths error isolation', () => {
    it('returns folderPath null when buildBreadcrumb throws', async () => {
      const { buildBreadcrumb } = await import('../../folders/queries');
      const mockBuildBreadcrumb = vi.mocked(buildBreadcrumb);
      mockBuildBreadcrumb.mockImplementation((_ctx, folderId) => {
        if (folderId === 'f_broken') {
          return Promise.reject(new Error('corrupt folder'));
        }
        return Promise.resolve([{ _id: folderId, name: 'ok-folder' }] as never);
      });

      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1', folderId: 'f_broken' }),
        makeDoc({ _id: 'doc2', folderId: 'f_healthy' }),
      ]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
      });

      expect(result.documents).toHaveLength(2);
      const broken = result.documents.find((d) => d.id === 'doc1');
      const healthy = result.documents.find((d) => d.id === 'doc2');
      expect(broken?.folderPath).toBeNull();
      expect(healthy?.folderPath).toBe('ok-folder');
    });

    it('logs console.warn when buildBreadcrumb throws', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { buildBreadcrumb } = await import('../../folders/queries');
      const mockBuildBreadcrumb = vi.mocked(buildBreadcrumb);
      mockBuildBreadcrumb.mockRejectedValue(new Error('corrupt folder'));

      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1', folderId: 'f_broken' }),
      ]);

      await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('buildBreadcrumb failed for folder'),
        expect.any(Error),
      );
      warnSpy.mockRestore();
    });
  });

  describe('lock-in: current behavior before refactor', () => {
    it('sorts by name case-insensitively', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1', title: 'banana' }),
        makeDoc({ _id: 'doc2', title: 'Apple' }),
        makeDoc({ _id: 'doc3', title: 'Cherry' }),
      ]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        sortBy: 'name',
        sortOrder: 'asc',
      });

      // Case-insensitive: apple < banana < cherry
      expect(result.documents.map((d) => d.title)).toEqual([
        'Apple',
        'banana',
        'Cherry',
      ]);
    });

    it('returns warning when teamId filter is not in user teams', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1', teamId: 'team3' }),
      ]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        userTeamIds: ['team1'],
        teamId: 'team3',
      });

      expect(result.documents).toEqual([]);
      expect(result.warning).toBe(
        'No access to the specified team, or team does not exist.',
      );
    });

    it('returns warning when folder path not found', async () => {
      const ctx = createMockCtx({}, [makeDoc({ _id: 'doc1' })]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        folderPath: 'nonexistent',
      });

      expect(result.documents).toEqual([]);
      expect(result.warning).toBe("Folder 'nonexistent' not found.");
    });

    it('matches untitled docs when searching for "untitled" via getDocumentTitle', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1', title: undefined }),
        makeDoc({ _id: 'doc2', title: 'Report' }),
      ]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        fileName: 'untitled',
      });

      expect(result.documents).toHaveLength(1);
      expect(result.documents[0]?.id).toBe('doc1');
    });
  });

  describe('fuzzy folder path matching', () => {
    it('resolves case-insensitive folder name', async () => {
      const ctx = createMockCtx(
        {
          f_contracts: {
            name: 'contracts',
            organizationId: 'org1',
            parentId: undefined,
          },
        },
        [makeDoc({ _id: 'doc1', folderId: 'f_contracts' })],
      );

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        folderPath: 'Contracts',
      });

      expect(result.documents).toHaveLength(1);
    });

    it('resolves prefix match (singular → plural)', async () => {
      const ctx = createMockCtx(
        {
          f_contracts: {
            name: 'contracts',
            organizationId: 'org1',
            parentId: undefined,
          },
        },
        [makeDoc({ _id: 'doc1', folderId: 'f_contracts' })],
      );

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        folderPath: 'contract',
      });

      expect(result.documents).toHaveLength(1);
    });

    it('resolves typo via levenshtein', async () => {
      const ctx = createMockCtx(
        {
          f_contracts: {
            name: 'contracts',
            organizationId: 'org1',
            parentId: undefined,
          },
        },
        [makeDoc({ _id: 'doc1', folderId: 'f_contracts' })],
      );

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        folderPath: 'contracs',
      });

      expect(result.documents).toHaveLength(1);
    });

    it('resolves nested fuzzy path', async () => {
      const ctx = createMockCtx(
        {
          f_contracts: {
            name: 'contracts',
            organizationId: 'org1',
            parentId: undefined,
          },
          f_2024: {
            name: '2024',
            organizationId: 'org1',
            parentId: 'f_contracts',
          },
        },
        [makeDoc({ _id: 'doc1', folderId: 'f_2024', title: 'invoice.pdf' })],
      );

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        folderPath: 'Contract/2024',
      });

      expect(result.documents).toHaveLength(1);
    });

    it('returns documents from all matching folders with warning when multiple match', async () => {
      const ctx = createMockCtx(
        {
          f_contracts: {
            name: 'contracts',
            organizationId: 'org1',
            parentId: undefined,
          },
          f_contractors: {
            name: 'contractors',
            organizationId: 'org1',
            parentId: undefined,
          },
        },
        [
          makeDoc({ _id: 'doc1', folderId: 'f_contracts' }),
          makeDoc({ _id: 'doc2', folderId: 'f_contractors' }),
        ],
      );

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        folderPath: 'contract',
      });

      expect(result.documents).toHaveLength(2);
      expect(result.warning).toContain('Showing results from 2 folders');
      expect(result.warning).toContain('contracts');
      expect(result.warning).toContain('contractors');
    });
  });

  describe('global folder search (non-root folders)', () => {
    it('finds nested folder by single-segment name', async () => {
      const ctx = createMockCtx(
        {
          f_templates: {
            name: 'templates',
            organizationId: 'org1',
            parentId: undefined,
          },
          f_sub: {
            name: 'sub',
            organizationId: 'org1',
            parentId: 'f_templates',
          },
        },
        [makeDoc({ _id: 'doc1', folderId: 'f_sub' })],
      );

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        folderPath: 'sub',
      });

      expect(result.documents).toHaveLength(1);
      expect(result.documents[0]?.id).toBe('doc1');
    });

    it('returns documents from all same-name folders with warning', async () => {
      const ctx = createMockCtx(
        {
          f_templates: {
            name: 'templates',
            organizationId: 'org1',
            parentId: undefined,
          },
          f_sub1: {
            name: 'sub',
            organizationId: 'org1',
            parentId: 'f_templates',
          },
          f_sub2: {
            name: 'sub',
            organizationId: 'org1',
            parentId: 'f_sub1',
          },
        },
        [
          makeDoc({ _id: 'doc1', folderId: 'f_sub1' }),
          makeDoc({ _id: 'doc2', folderId: 'f_sub2' }),
        ],
      );

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        folderPath: 'sub',
      });

      expect(result.documents).toHaveLength(2);
      expect(result.warning).toContain('Showing results from 2 folders');
      expect(result.warning).toContain('templates/sub');
      expect(result.warning).toContain('templates/sub/sub');
    });

    it('resolves multi-segment path not starting from root', async () => {
      const ctx = createMockCtx(
        {
          f_root: {
            name: 'projects',
            organizationId: 'org1',
            parentId: undefined,
          },
          f_templates: {
            name: 'templates',
            organizationId: 'org1',
            parentId: 'f_root',
          },
          f_sub: {
            name: 'sub',
            organizationId: 'org1',
            parentId: 'f_templates',
          },
        },
        [makeDoc({ _id: 'doc1', folderId: 'f_sub' })],
      );

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        folderPath: 'templates/sub',
      });

      expect(result.documents).toHaveLength(1);
      expect(result.documents[0]?.id).toBe('doc1');
    });

    it('returns documents from ambiguous folders with warning', async () => {
      const ctx = createMockCtx(
        {
          f_a: {
            name: 'team_a',
            organizationId: 'org1',
            parentId: undefined,
          },
          f_b: {
            name: 'team_b',
            organizationId: 'org1',
            parentId: undefined,
          },
          f_docs_a: {
            name: 'docs',
            organizationId: 'org1',
            parentId: 'f_a',
          },
          f_docs_b: {
            name: 'docs',
            organizationId: 'org1',
            parentId: 'f_b',
          },
        },
        [
          makeDoc({ _id: 'doc1', folderId: 'f_docs_a' }),
          makeDoc({ _id: 'doc2', folderId: 'f_docs_b' }),
        ],
      );

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        folderPath: 'docs',
      });

      expect(result.documents).toHaveLength(2);
      expect(result.warning).toContain('Showing results from 2 folders');
      expect(result.warning).toContain('team_a/docs');
      expect(result.warning).toContain('team_b/docs');
    });
  });

  describe('fuzzy fileName matching', () => {
    it('matches with typo in file name', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1', title: 'contracts_2024.pdf' }),
        makeDoc({ _id: 'doc2', title: 'budget_plan.xlsx' }),
      ]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        fileName: 'contracs 2024',
      });

      expect(result.documents).toHaveLength(1);
      expect(result.documents[0]?.id).toBe('doc1');
    });

    it('matches with different separators', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1', title: 'Q1_report_final.docx' }),
        makeDoc({ _id: 'doc2', title: 'budget.xlsx' }),
      ]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        fileName: 'Q1 report',
      });

      expect(result.documents).toHaveLength(1);
      expect(result.documents[0]?.id).toBe('doc1');
    });
  });

  describe('folder team access filtering in resolveFolderPathFuzzy', () => {
    it('returns not found for cross-team folder path', async () => {
      const ctx = createMockCtx(
        {
          f_sales: {
            name: 'sales',
            organizationId: 'org1',
            parentId: undefined,
            teamId: 'team_b',
            teamTags: ['team_b'],
          },
        },
        [makeDoc({ _id: 'doc1', folderId: 'f_sales' })],
      );

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        userTeamIds: ['team_a'],
        folderPath: 'sales',
      });

      expect(result.documents).toEqual([]);
      expect(result.warning).toBe("Folder 'sales' not found.");
    });

    it('resolves same-team nested folder path', async () => {
      const ctx = createMockCtx(
        {
          f_sales: {
            name: 'sales',
            organizationId: 'org1',
            parentId: undefined,
            teamId: 'team_a',
            teamTags: ['team_a'],
          },
          f_q1: {
            name: 'q1',
            organizationId: 'org1',
            parentId: 'f_sales',
            teamId: 'team_a',
            teamTags: ['team_a'],
          },
        },
        [makeDoc({ _id: 'doc1', folderId: 'f_q1', teamId: 'team_a' })],
      );

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        userTeamIds: ['team_a'],
        folderPath: 'sales/q1',
      });

      expect(result.documents).toHaveLength(1);
      expect(result.documents[0]?.id).toBe('doc1');
    });

    it('allows org-wide folders (no teamId) for all users', async () => {
      const ctx = createMockCtx(
        {
          f_shared: {
            name: 'shared',
            organizationId: 'org1',
            parentId: undefined,
          },
        },
        [makeDoc({ _id: 'doc1', folderId: 'f_shared' })],
      );

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        userTeamIds: ['team_x'],
        folderPath: 'shared',
      });

      expect(result.documents).toHaveLength(1);
      expect(result.documents[0]?.id).toBe('doc1');
    });

    it('resolves mixed org-wide parent + team-scoped child', async () => {
      const ctx = createMockCtx(
        {
          f_root: {
            name: 'projects',
            organizationId: 'org1',
            parentId: undefined,
          },
          f_team_docs: {
            name: 'team-docs',
            organizationId: 'org1',
            parentId: 'f_root',
            teamId: 'team_a',
            teamTags: ['team_a'],
          },
        },
        [
          makeDoc({
            _id: 'doc1',
            folderId: 'f_team_docs',
            teamId: 'team_a',
          }),
        ],
      );

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        userTeamIds: ['team_a'],
        folderPath: 'projects/team-docs',
      });

      expect(result.documents).toHaveLength(1);
      expect(result.documents[0]?.id).toBe('doc1');
    });

    it('blocks team-scoped child even when parent is org-wide', async () => {
      const ctx = createMockCtx(
        {
          f_root: {
            name: 'projects',
            organizationId: 'org1',
            parentId: undefined,
          },
          f_team_docs: {
            name: 'team-docs',
            organizationId: 'org1',
            parentId: 'f_root',
            teamId: 'team_b',
            teamTags: ['team_b'],
          },
        },
        [
          makeDoc({
            _id: 'doc1',
            folderId: 'f_team_docs',
            teamId: 'team_b',
          }),
        ],
      );

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        userTeamIds: ['team_a'],
        folderPath: 'projects/team-docs',
      });

      expect(result.documents).toEqual([]);
      expect(result.warning).toBe("Folder 'projects/team-docs' not found.");
    });
  });
});
