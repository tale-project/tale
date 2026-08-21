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
            collect: () => Promise.resolve(rows),
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
  { _id: 'reports', name: 'Reports', organizationId: ORG, parentId: 'acme' },
  { _id: 'other-org', name: 'Foreign', organizationId: 'org2' },
];

describe('listFilesByFolder', () => {
  it('resolves a folder path and lists its stored files', async () => {
    const ctx = createMockCtx(FOLDERS, [
      {
        _id: 'd1',
        organizationId: ORG,
        folderId: 'reports',
        title: 'sales',
        extension: 'xlsx',
        fileId: 'f1',
      },
      {
        _id: 'd2',
        organizationId: ORG,
        folderId: 'reports',
        title: 'import-batch.pdf',
        extension: 'pdf',
        fileId: 'f2',
      },
    ]);
    const listing = await listFilesByFolder(ctx, {
      organizationId: ORG,
      folderPath: 'Clients/Acme GmbH/Reports',
    });
    expect(listing).toEqual({
      files: [
        // extension re-attached when the title lacks it…
        { fileId: 'f1', name: 'sales.xlsx' },
        // …but never doubled when the title already carries it
        { fileId: 'f2', name: 'import-batch.pdf' },
      ],
      truncated: false,
    });
  });

  it('returns null for a path that does not resolve', async () => {
    const ctx = createMockCtx(FOLDERS, []);
    const listing = await listFilesByFolder(ctx, {
      organizationId: ORG,
      folderPath: 'Clients/No Such Client',
    });
    expect(listing).toBeNull();
  });

  it('denies a folderId from another org (coherence)', async () => {
    const ctx = createMockCtx(FOLDERS, []);
    const listing = await listFilesByFolder(ctx, {
      organizationId: ORG,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      folderId: 'other-org' as never,
    });
    expect(listing).toBeNull();
  });

  it('skips trashed docs and rows without a stored blob', async () => {
    const ctx = createMockCtx(FOLDERS, [
      {
        _id: 'd1',
        organizationId: ORG,
        folderId: 'reports',
        title: 'kept',
        extension: 'csv',
        fileId: 'f1',
      },
      {
        _id: 'd2',
        organizationId: ORG,
        folderId: 'reports',
        title: 'trashed',
        fileId: 'f2',
        lifecycleStatus: 'trashed',
      },
      {
        _id: 'd3',
        organizationId: ORG,
        folderId: 'reports',
        title: 'text-only note',
      },
    ]);
    const listing = await listFilesByFolder(ctx, {
      organizationId: ORG,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      folderId: 'reports' as never,
    });
    expect(listing).toEqual({
      files: [{ fileId: 'f1', name: 'kept.csv' }],
      truncated: false,
    });
  });

  it('recursive: walks subfolders and prefixes names with the relative path', async () => {
    const folders: MockFolder[] = [
      { _id: 'delivery', name: 'Delivery', organizationId: ORG },
      {
        _id: 'docs',
        name: 'Documentation',
        organizationId: ORG,
        parentId: 'delivery',
      },
      {
        _id: 'scans',
        name: 'Scans',
        organizationId: ORG,
        parentId: 'docs',
      },
    ];
    const ctx = createMockCtx(folders, [
      {
        _id: 'root-doc',
        organizationId: ORG,
        folderId: 'delivery',
        title: 'email',
        extension: 'txt',
        fileId: 'f-root',
      },
      {
        _id: 'inv',
        organizationId: ORG,
        folderId: 'docs',
        title: 'Invoice 123',
        extension: 'pdf',
        fileId: 'f-inv',
      },
      {
        _id: 'scan',
        organizationId: ORG,
        folderId: 'scans',
        title: 'IMG_1',
        extension: 'jpg',
        fileId: 'f-scan',
      },
    ]);
    const listing = await listFilesByFolder(ctx, {
      organizationId: ORG,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      folderId: 'delivery' as never,
      recursive: true,
    });
    expect(listing).toEqual({
      files: [
        { fileId: 'f-root', name: 'email.txt' },
        { fileId: 'f-inv', name: 'Documentation/Invoice 123.pdf' },
        { fileId: 'f-scan', name: 'Documentation/Scans/IMG_1.jpg' },
      ],
      truncated: false,
    });
  });

  it('non-recursive stays direct-only even when subfolders hold files', async () => {
    const folders: MockFolder[] = [
      { _id: 'delivery', name: 'Delivery', organizationId: ORG },
      {
        _id: 'docs',
        name: 'Documentation',
        organizationId: ORG,
        parentId: 'delivery',
      },
    ];
    const ctx = createMockCtx(folders, [
      {
        _id: 'inv',
        organizationId: ORG,
        folderId: 'docs',
        title: 'Invoice',
        extension: 'pdf',
        fileId: 'f-inv',
      },
    ]);
    const listing = await listFilesByFolder(ctx, {
      organizationId: ORG,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      folderId: 'delivery' as never,
    });
    expect(listing).toEqual({ files: [], truncated: false });
  });

  it('flattens a title that would traverse or nest paths (the prefix stays)', async () => {
    // Folder names are write-validated; titles are free text. A title must
    // never add or climb a path level once it becomes a staged file name —
    // `../../output/x` staged verbatim would land in the harvest box as a
    // forged deliverable.
    const folders: MockFolder[] = [
      { _id: 'delivery', name: 'Delivery', organizationId: ORG },
      {
        _id: 'docs',
        name: 'Documentation',
        organizationId: ORG,
        parentId: 'delivery',
      },
    ];
    const ctx = createMockCtx(folders, [
      {
        _id: 'd1',
        organizationId: ORG,
        folderId: 'delivery',
        title: '../../output/forged',
        extension: 'xml',
        fileId: 'f1',
      },
      {
        _id: 'd2',
        organizationId: ORG,
        folderId: 'docs',
        title: 'a/b',
        extension: 'pdf',
        fileId: 'f2',
      },
      {
        _id: 'd3',
        organizationId: ORG,
        folderId: 'delivery',
        title: '..',
        fileId: 'f3',
      },
    ]);
    const listing = await listFilesByFolder(ctx, {
      organizationId: ORG,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      folderId: 'delivery' as never,
      recursive: true,
    });
    expect(listing).toEqual({
      files: [
        { fileId: 'f1', name: '.._.._output_forged.xml' },
        { fileId: 'f3', name: 'file' },
        { fileId: 'f2', name: 'Documentation/a_b.pdf' },
      ],
      truncated: false,
    });
  });

  it('marks the listing truncated at the file cap instead of returning a complete-looking array', async () => {
    const documents: MockDocument[] = Array.from({ length: 501 }, (_, i) => ({
      _id: `d${i}`,
      organizationId: ORG,
      folderId: 'reports',
      title: `file-${String(i).padStart(3, '0')}`,
      extension: 'pdf',
      fileId: `f${i}`,
    }));
    const ctx = createMockCtx(FOLDERS, documents);
    const listing = await listFilesByFolder(ctx, {
      organizationId: ORG,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      folderId: 'reports' as never,
    });
    expect(listing?.files).toHaveLength(500);
    expect(listing?.truncated).toBe(true);
  });

  it('marks the listing truncated when the depth cap hides deeper subfolders', async () => {
    // A chain one level past the walk cap, with the only file at the bottom:
    // the walk must terminate AND declare itself incomplete.
    const folders: MockFolder[] = [
      { _id: 'lv0', name: 'lv0', organizationId: ORG },
    ];
    for (let i = 1; i <= 22; i++) {
      folders.push({
        _id: `lv${i}`,
        name: `lv${i}`,
        organizationId: ORG,
        parentId: `lv${i - 1}`,
      });
    }
    const ctx = createMockCtx(folders, [
      {
        _id: 'deep',
        organizationId: ORG,
        folderId: 'lv22',
        title: 'deep',
        extension: 'txt',
        fileId: 'f-deep',
      },
    ]);
    const listing = await listFilesByFolder(ctx, {
      organizationId: ORG,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      folderId: 'lv0' as never,
      recursive: true,
    });
    expect(listing?.files).toEqual([]);
    expect(listing?.truncated).toBe(true);
  });

  it('a tree exactly at the depth cap lists completely (no false truncation)', async () => {
    const folders: MockFolder[] = [
      { _id: 'lv0', name: 'lv0', organizationId: ORG },
    ];
    for (let i = 1; i <= 20; i++) {
      folders.push({
        _id: `lv${i}`,
        name: `lv${i}`,
        organizationId: ORG,
        parentId: `lv${i - 1}`,
      });
    }
    const ctx = createMockCtx(folders, [
      {
        _id: 'leaf',
        organizationId: ORG,
        folderId: 'lv20',
        title: 'leaf',
        extension: 'txt',
        fileId: 'f-leaf',
      },
    ]);
    const listing = await listFilesByFolder(ctx, {
      organizationId: ORG,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      folderId: 'lv0' as never,
      recursive: true,
    });
    expect(listing?.files).toHaveLength(1);
    expect(listing?.truncated).toBe(false);
  });

  it('terminates on a parentId cycle and lists each file exactly once', async () => {
    // Corrupt data (no write path creates cycles): the visited set — not the
    // depth cap — must defuse it without duplicated entries.
    const folders: MockFolder[] = [
      { _id: 'a', name: 'A', organizationId: ORG, parentId: 'b' },
      { _id: 'b', name: 'B', organizationId: ORG, parentId: 'a' },
    ];
    const ctx = createMockCtx(folders, [
      {
        _id: 'd1',
        organizationId: ORG,
        folderId: 'a',
        title: 'in-a',
        extension: 'txt',
        fileId: 'f-a',
      },
      {
        _id: 'd2',
        organizationId: ORG,
        folderId: 'b',
        title: 'in-b',
        extension: 'txt',
        fileId: 'f-b',
      },
    ]);
    const listing = await listFilesByFolder(ctx, {
      organizationId: ORG,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      folderId: 'a' as never,
      recursive: true,
    });
    expect(listing?.files).toEqual([
      { fileId: 'f-a', name: 'in-a.txt' },
      { fileId: 'f-b', name: 'B/in-b.txt' },
    ]);
    expect(listing?.truncated).toBe(false);
  });
});
