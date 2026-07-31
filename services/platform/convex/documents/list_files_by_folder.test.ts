import { describe, expect, it } from 'vitest';

import { listFilesByFolder } from './list_files_by_folder';

interface MockFolder {
  _id: string;
  name: string;
  organizationId: string;
  parentId?: string;
}

interface MockDocument {
  _id: string;
  organizationId: string;
  folderId?: string;
  title?: string;
  extension?: string;
  fileId?: string;
  lifecycleStatus?: string;
}

/** Duck-typed QueryCtx.db covering exactly what the helper touches: `get` on
 * folders, and `by_org_parent_name` (folders) / `by_organizationId_and_folderId`
 * (documents) index scans. */
function createMockCtx(folders: MockFolder[], documents: MockDocument[]) {
  const raw = {
    db: {
      get: (id: string) =>
        Promise.resolve(folders.find((f) => f._id === id) ?? null),
      query: (table: string) => ({
        withIndex: (
          _indexName: string,
          cb: (q: { eq: (field: string, value: unknown) => unknown }) => void,
        ) => {
          const filters: Record<string, unknown> = {};
          const qb = {
            eq: (field: string, value: unknown) => {
              filters[field] = value;
              return qb;
            },
          };
          cb(qb);
          const source: Record<string, unknown>[] = (
            table === 'folders' ? folders : documents
          ).map((row) => Object.fromEntries(Object.entries(row)));
          const rows = source.filter((row) =>
            Object.entries(filters).every(([k, val]) => row[k] === val),
          );
          return {
            first: () => Promise.resolve(rows[0] ?? null),
            [Symbol.asyncIterator]: function* () {
              yield* rows;
            },
          };
        },
      }),
    },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return raw as unknown as Parameters<typeof listFilesByFolder>[0];
}

const ORG = 'org1';
const FOLDERS: MockFolder[] = [
  { _id: 'clients', name: 'Clients', organizationId: ORG },
  { _id: 'acme', name: 'Acme GmbH', organizationId: ORG, parentId: 'clients' },
  { _id: 'q1', name: '2026-Q1', organizationId: ORG, parentId: 'acme' },
  { _id: 'other-org', name: 'Foreign', organizationId: 'org2' },
];

describe('listFilesByFolder', () => {
  it('resolves a folder path and lists its stored files', async () => {
    const ctx = createMockCtx(FOLDERS, [
      {
        _id: 'd1',
        organizationId: ORG,
        folderId: 'q1',
        title: 'sales',
        extension: 'xlsx',
        fileId: 'f1',
      },
      {
        _id: 'd2',
        organizationId: ORG,
        folderId: 'q1',
        title: 'import-batch.pdf',
        extension: 'pdf',
        fileId: 'f2',
      },
    ]);
    const files = await listFilesByFolder(ctx, {
      organizationId: ORG,
      folderPath: 'Clients/Acme GmbH/2026-Q1',
    });
    expect(files).toEqual([
      // extension re-attached when the title lacks it…
      { fileId: 'f1', name: 'sales.xlsx' },
      // …but never doubled when the title already carries it
      { fileId: 'f2', name: 'import-batch.pdf' },
    ]);
  });

  it('returns null for a path that does not resolve', async () => {
    const ctx = createMockCtx(FOLDERS, []);
    const files = await listFilesByFolder(ctx, {
      organizationId: ORG,
      folderPath: 'Clients/No Such Client',
    });
    expect(files).toBeNull();
  });

  it('denies a folderId from another org (coherence)', async () => {
    const ctx = createMockCtx(FOLDERS, []);
    const files = await listFilesByFolder(ctx, {
      organizationId: ORG,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      folderId: 'other-org' as never,
    });
    expect(files).toBeNull();
  });

  it('skips trashed docs and rows without a stored blob', async () => {
    const ctx = createMockCtx(FOLDERS, [
      {
        _id: 'd1',
        organizationId: ORG,
        folderId: 'q1',
        title: 'kept',
        extension: 'csv',
        fileId: 'f1',
      },
      {
        _id: 'd2',
        organizationId: ORG,
        folderId: 'q1',
        title: 'trashed',
        fileId: 'f2',
        lifecycleStatus: 'trashed',
      },
      {
        _id: 'd3',
        organizationId: ORG,
        folderId: 'q1',
        title: 'text-only note',
      },
    ]);
    const files = await listFilesByFolder(ctx, {
      organizationId: ORG,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      folderId: 'q1' as never,
    });
    expect(files).toEqual([{ fileId: 'f1', name: 'kept.csv' }]);
  });
});
