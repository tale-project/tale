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
  teamId?: string;
  folderId?: string;
  metadata?: Record<string, unknown>;
}

interface MockFolder {
  name: string;
  organizationId: string;
  parentId?: string;
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
          const matches = documents.filter((d) => {
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

    it('filters by title query (case-insensitive)', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1', title: 'Annual Report 2024' }),
        makeDoc({ _id: 'doc2', title: 'Budget Plan' }),
        makeDoc({ _id: 'doc3', title: 'Quarterly Report Q3' }),
      ]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        query: 'report',
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
        query: 'report',
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

  describe('whitespace query', () => {
    it('treats whitespace-only query as no filter', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1', title: 'Alpha' }),
        makeDoc({ _id: 'doc2', title: 'Bravo' }),
      ]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        query: '   ',
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
        query: 'invoice',
      });

      expect(result.documents).toHaveLength(1);
      expect(result.documents[0]?.id).toBe('doc1');
    });
  });

  describe('title search edge cases', () => {
    it('does not match documents with undefined title', async () => {
      const ctx = createMockCtx({}, [
        makeDoc({ _id: 'doc1', title: undefined }),
        makeDoc({ _id: 'doc2', title: 'Report' }),
      ]);

      const result = await listDocumentsForAgent(ctx as unknown as QueryCtx, {
        ...baseArgs,
        query: 'untitled',
      });

      expect(result.documents).toHaveLength(0);
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
  });
});
