import { describe, expect, it } from 'vitest';

import { listOrphanedExternalDocs } from '../list_orphaned_external_docs';

interface MockDoc {
  _id: string;
  organizationId: string;
  sourceProvider?: string;
  externalItemId?: string;
  fileId?: string;
  folderPath?: string;
}

function createMockCtx(docs: MockDoc[]) {
  return {
    db: {
      query: () => ({
        withIndex: (
          _indexName: string,
          builder: (q: {
            eq: (field: string, value: unknown) => unknown;
            gte: (field: string, value: unknown) => unknown;
            lt: (field: string, value: unknown) => unknown;
          }) => unknown,
        ) => {
          let orgEq: string | undefined;
          let pathEq: string | undefined;
          let pathGte: string | undefined;
          let pathLt: string | undefined;

          const q = {
            eq: (field: string, value: unknown) => {
              if (field === 'organizationId') orgEq = value as string;
              else if (field === 'folderPath') pathEq = value as string;
              return q;
            },
            gte: (field: string, value: unknown) => {
              if (field === 'folderPath') pathGte = value as string;
              return q;
            },
            lt: (field: string, value: unknown) => {
              if (field === 'folderPath') pathLt = value as string;
              return q;
            },
          };
          builder(q);

          const matched = docs.filter((doc) => {
            if (doc.organizationId !== orgEq) return false;
            const path = doc.folderPath ?? '';
            if (pathEq !== undefined && doc.folderPath !== pathEq) return false;
            if (pathGte !== undefined && path < pathGte) return false;
            if (pathLt !== undefined && path >= pathLt) return false;
            return true;
          });

          return {
            [Symbol.asyncIterator]: async function* () {
              for (const m of matched) yield m;
            },
          };
        },
      }),
    },
  };
}

const ORG = 'org1';
const PROVIDER = 'google_drive';

describe('listOrphanedExternalDocs', () => {
  it('returns nothing when every present id maps to a stored doc', async () => {
    const ctx = createMockCtx([
      {
        _id: 'd1',
        organizationId: ORG,
        sourceProvider: PROVIDER,
        externalItemId: 'gd-1',
        folderPath: 'Test',
      },
      {
        _id: 'd2',
        organizationId: ORG,
        sourceProvider: PROVIDER,
        externalItemId: 'gd-2',
        folderPath: 'Test/sub',
      },
    ]);

    const result = await listOrphanedExternalDocs(ctx as never, {
      organizationId: ORG,
      sourceProvider: PROVIDER,
      folderPathPrefix: 'Test',
      presentExternalIds: ['gd-1', 'gd-2'],
    });

    expect(result).toEqual([]);
  });

  it('returns the set difference (docs missing from present ids)', async () => {
    const ctx = createMockCtx([
      {
        _id: 'd1',
        organizationId: ORG,
        sourceProvider: PROVIDER,
        externalItemId: 'gd-1',
        fileId: 'f1',
        folderPath: 'Test',
      },
      {
        _id: 'd2',
        organizationId: ORG,
        sourceProvider: PROVIDER,
        externalItemId: 'gd-2',
        fileId: 'f2',
        folderPath: 'Test/sub',
      },
      {
        _id: 'd3',
        organizationId: ORG,
        sourceProvider: PROVIDER,
        externalItemId: 'gd-3',
        fileId: 'f3',
        folderPath: 'Test/sub/deep',
      },
    ]);

    const result = await listOrphanedExternalDocs(ctx as never, {
      organizationId: ORG,
      sourceProvider: PROVIDER,
      folderPathPrefix: 'Test',
      presentExternalIds: ['gd-1'],
    });

    expect(result.map((r) => r.externalItemId).sort()).toEqual([
      'gd-2',
      'gd-3',
    ]);
  });

  it('does not delete docs from a different sourceProvider', async () => {
    const ctx = createMockCtx([
      {
        _id: 'd1',
        organizationId: ORG,
        sourceProvider: 'upload',
        externalItemId: 'manual-1',
        folderPath: 'Test',
      },
      {
        _id: 'd2',
        organizationId: ORG,
        sourceProvider: PROVIDER,
        externalItemId: 'gd-stale',
        folderPath: 'Test',
      },
    ]);

    const result = await listOrphanedExternalDocs(ctx as never, {
      organizationId: ORG,
      sourceProvider: PROVIDER,
      folderPathPrefix: 'Test',
      presentExternalIds: [],
    });

    expect(result).toHaveLength(1);
    expect(result[0].externalItemId).toBe('gd-stale');
  });

  it('does not delete docs without an externalItemId (manual uploads sharing the path)', async () => {
    const ctx = createMockCtx([
      {
        _id: 'd1',
        organizationId: ORG,
        sourceProvider: PROVIDER,
        externalItemId: undefined,
        folderPath: 'Test',
      },
    ]);

    const result = await listOrphanedExternalDocs(ctx as never, {
      organizationId: ORG,
      sourceProvider: PROVIDER,
      folderPathPrefix: 'Test',
      presentExternalIds: [],
    });

    expect(result).toEqual([]);
  });

  it('respects the prefix boundary so "Test 2/x" is NOT treated as a child of "Test"', async () => {
    // This is the key bug from the plan review: a naive `< rootPath + '￿'`
    // bound would match "Test 2/x" because space (0x20) < '/' (0x2F).
    const ctx = createMockCtx([
      {
        _id: 'd1',
        organizationId: ORG,
        sourceProvider: PROVIDER,
        externalItemId: 'gd-test-root',
        folderPath: 'Test',
      },
      {
        _id: 'd2',
        organizationId: ORG,
        sourceProvider: PROVIDER,
        externalItemId: 'gd-test-child',
        folderPath: 'Test/sub',
      },
      {
        _id: 'd3',
        organizationId: ORG,
        sourceProvider: PROVIDER,
        externalItemId: 'gd-test2-child',
        folderPath: 'Test 2/x', // sibling sync, must NOT be deleted
      },
      {
        _id: 'd4',
        organizationId: ORG,
        sourceProvider: PROVIDER,
        externalItemId: 'gd-testbang',
        folderPath: 'Test!sibling', // also not a child
      },
    ]);

    const result = await listOrphanedExternalDocs(ctx as never, {
      organizationId: ORG,
      sourceProvider: PROVIDER,
      folderPathPrefix: 'Test',
      presentExternalIds: [], // every Test-subtree doc is "missing"
    });

    const ids = result.map((r) => r.externalItemId).sort();
    expect(ids).toEqual(['gd-test-child', 'gd-test-root']);
  });

  it('returns all candidates when presentIds is empty (caller decides safety)', async () => {
    const ctx = createMockCtx([
      {
        _id: 'd1',
        organizationId: ORG,
        sourceProvider: PROVIDER,
        externalItemId: 'gd-1',
        folderPath: 'Test',
      },
      {
        _id: 'd2',
        organizationId: ORG,
        sourceProvider: PROVIDER,
        externalItemId: 'gd-2',
        folderPath: 'Test/sub',
      },
    ]);

    const result = await listOrphanedExternalDocs(ctx as never, {
      organizationId: ORG,
      sourceProvider: PROVIDER,
      folderPathPrefix: 'Test',
      presentExternalIds: [],
    });

    expect(result).toHaveLength(2);
  });

  it('forwards fileId so the caller can branch RAG vs DB delete', async () => {
    const ctx = createMockCtx([
      {
        _id: 'd1',
        organizationId: ORG,
        sourceProvider: PROVIDER,
        externalItemId: 'gd-1',
        fileId: 'f-storage-id',
        folderPath: 'Test',
      },
      {
        _id: 'd2',
        organizationId: ORG,
        sourceProvider: PROVIDER,
        externalItemId: 'gd-2',
        fileId: undefined,
        folderPath: 'Test',
      },
    ]);

    const result = await listOrphanedExternalDocs(ctx as never, {
      organizationId: ORG,
      sourceProvider: PROVIDER,
      folderPathPrefix: 'Test',
      presentExternalIds: [],
    });

    const byId = Object.fromEntries(
      result.map((r) => [r.externalItemId, r.fileId]),
    );
    expect(byId['gd-1']).toBe('f-storage-id');
    expect(byId['gd-2']).toBeUndefined();
  });
});
