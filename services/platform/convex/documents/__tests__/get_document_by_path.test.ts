import { describe, expect, it, vi } from 'vitest';

import type { QueryCtx } from '../../_generated/server';

import { getDocumentByPath } from '../get_document_by_path';

vi.mock('../transform_to_document_item', () => ({
  transformDocumentsBatch: vi.fn().mockImplementation((_ctx, docs) =>
    Promise.resolve(
      docs.map((d: { _id: string; title: string }) => ({
        id: d._id,
        name: d.title,
        type: 'file' as const,
      })),
    ),
  ),
}));

function createMockCtx(
  folders: Record<
    string,
    { name: string; organizationId: string; parentId?: string }
  >,
  documents: Array<{
    _id: string;
    title: string;
    organizationId: string;
    folderId?: string;
    metadata?: { storagePath?: string };
  }>,
) {
  return {
    db: {
      query: vi.fn().mockImplementation((table: string) => {
        let orgFilter: string | undefined;
        let parentFilter: string | undefined;
        let nameFilter: string | undefined;
        let folderFilter: string | undefined;

        const builder = {
          withIndex: vi
            .fn()
            .mockImplementation(
              (indexName: string, cb: (q: unknown) => void) => {
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
                      return qb;
                    }),
                };
                cb(qb);
                return builder;
              },
            ),
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
          [Symbol.asyncIterator]: () => {
            const matches = documents.filter(
              (d) =>
                d.organizationId === orgFilter && d.folderId === folderFilter,
            );
            let i = 0;
            return {
              next: () =>
                Promise.resolve(
                  i < matches.length
                    ? { value: matches[i++], done: false }
                    : { value: undefined, done: true },
                ),
            };
          },
        };
        return builder;
      }),
    },
  };
}

describe('getDocumentByPath', () => {
  it('finds a root-level document by title', async () => {
    const ctx = createMockCtx({}, [
      {
        _id: 'doc1',
        title: 'report.pdf',
        organizationId: 'org1',
        folderId: undefined,
      },
    ]);

    const result = await getDocumentByPath(ctx as unknown as QueryCtx, {
      organizationId: 'org1',
      storagePath: 'report.pdf',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.item.id).toBe('doc1');
    }
  });

  it('traverses folders to find a nested document', async () => {
    const ctx = createMockCtx(
      {
        f1: { name: 'docs', organizationId: 'org1', parentId: undefined },
        f2: { name: 'reports', organizationId: 'org1', parentId: 'f1' },
      },
      [
        {
          _id: 'doc1',
          title: 'annual.pdf',
          organizationId: 'org1',
          folderId: 'f2',
        },
      ],
    );

    const result = await getDocumentByPath(ctx as unknown as QueryCtx, {
      organizationId: 'org1',
      storagePath: 'docs/reports/annual.pdf',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.item.id).toBe('doc1');
    }
  });

  it('strips org prefix from path', async () => {
    const ctx = createMockCtx({}, [
      {
        _id: 'doc1',
        title: 'file.txt',
        organizationId: 'org1',
        folderId: undefined,
      },
    ]);

    const result = await getDocumentByPath(ctx as unknown as QueryCtx, {
      organizationId: 'org1',
      storagePath: 'org1/file.txt',
    });

    expect(result.success).toBe(true);
  });

  it('returns error for missing folder in path', async () => {
    const ctx = createMockCtx({}, []);

    const result = await getDocumentByPath(ctx as unknown as QueryCtx, {
      organizationId: 'org1',
      storagePath: 'nonexistent/file.txt',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Document not found');
    }
  });

  it('returns error for empty path', async () => {
    const ctx = createMockCtx({}, []);

    const result = await getDocumentByPath(ctx as unknown as QueryCtx, {
      organizationId: 'org1',
      storagePath: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Invalid path');
    }
  });

  it('falls back to storagePath filename when title does not match', async () => {
    const ctx = createMockCtx({}, [
      {
        _id: 'doc1',
        title: 'Renamed Title',
        organizationId: 'org1',
        folderId: undefined,
        metadata: { storagePath: 'org1/original.pdf' },
      },
    ]);

    const result = await getDocumentByPath(ctx as unknown as QueryCtx, {
      organizationId: 'org1',
      storagePath: 'original.pdf',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.item.id).toBe('doc1');
    }
  });

  it('prefers title match over storagePath fallback', async () => {
    const ctx = createMockCtx({}, [
      {
        _id: 'doc_fallback',
        title: 'Other',
        organizationId: 'org1',
        folderId: undefined,
        metadata: { storagePath: 'org1/report.pdf' },
      },
      {
        _id: 'doc_title',
        title: 'report.pdf',
        organizationId: 'org1',
        folderId: undefined,
      },
    ]);

    const result = await getDocumentByPath(ctx as unknown as QueryCtx, {
      organizationId: 'org1',
      storagePath: 'report.pdf',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.item.id).toBe('doc_title');
    }
  });
});
