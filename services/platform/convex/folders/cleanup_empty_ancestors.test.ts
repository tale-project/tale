import { describe, expect, it, vi } from 'vitest';

import { cleanupEmptyAncestorFolders } from './cleanup_empty_ancestors';

type MockFolder = {
  _id: string;
  organizationId: string;
  name: string;
  parentId?: string;
};

type MockDoc = {
  _id: string;
  organizationId: string;
  folderId?: string;
  lifecycleStatus?: string;
};

interface MockQB {
  eq: (field: string, value: unknown) => MockQB;
}

function createMockCtx() {
  const folders = new Map<string, MockFolder>();
  const documents = new Map<string, MockDoc>();
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  const ctx = {
    db: {
      get: (id: string) =>
        Promise.resolve(folders.get(id) ?? documents.get(id) ?? null),
      delete: vi.fn((id: string) => {
        folders.delete(id);
        documents.delete(id);
        return Promise.resolve();
      }),
      query: (table: string) => {
        const store = table === 'folders' ? folders : documents;
        const filters: Record<string, unknown> = {};

        return {
          withIndex: (_index: string, cb: (q: MockQB) => void) => {
            const qb: MockQB = {
              eq: (field: string, value: unknown) => {
                filters[field] = value;
                return qb;
              },
            };
            cb(qb);
            return {
              first: () => {
                for (const row of store.values()) {
                  const r = row as Record<string, unknown>;
                  const ok = Object.entries(filters).every(
                    ([k, v]) => r[k] === v,
                  );
                  if (ok) return Promise.resolve(row);
                }
                return Promise.resolve(null);
              },
            };
          },
        };
      },
    },
  };

  return { ctx, folders, documents, warnSpy };
}

const ORG = 'org_1';

describe('cleanupEmptyAncestorFolders', () => {
  it('deletes a linear chain up to the sync root (exclusive)', async () => {
    const { ctx, folders } = createMockCtx();
    folders.set('root', {
      _id: 'root',
      organizationId: ORG,
      name: 'Google Drive',
    });
    folders.set('sub1', {
      _id: 'sub1',
      organizationId: ORG,
      name: 'sub1',
      parentId: 'root',
    });
    folders.set('sub2', {
      _id: 'sub2',
      organizationId: ORG,
      name: 'sub2',
      parentId: 'sub1',
    });

    // doc has just been deleted; we walk from its former folderId
    await cleanupEmptyAncestorFolders(
      ctx as never,
      'sub2' as never,
      'root' as never,
      ORG,
    );

    expect(folders.has('sub2')).toBe(false);
    expect(folders.has('sub1')).toBe(false);
    expect(folders.has('root')).toBe(true);
  });

  it('preserves a folder that still has a sibling document', async () => {
    const { ctx, folders, documents } = createMockCtx();
    folders.set('root', {
      _id: 'root',
      organizationId: ORG,
      name: 'Google Drive',
    });
    folders.set('sub2', {
      _id: 'sub2',
      organizationId: ORG,
      name: 'sub2',
      parentId: 'root',
    });
    documents.set('d_keep', {
      _id: 'd_keep',
      organizationId: ORG,
      folderId: 'sub2',
    });

    await cleanupEmptyAncestorFolders(
      ctx as never,
      'sub2' as never,
      'root' as never,
      ORG,
    );

    expect(folders.has('sub2')).toBe(true);
    expect(folders.has('root')).toBe(true);
  });

  it('preserves a folder that still has a sibling subfolder', async () => {
    const { ctx, folders } = createMockCtx();
    folders.set('root', {
      _id: 'root',
      organizationId: ORG,
      name: 'Google Drive',
    });
    folders.set('sub2', {
      _id: 'sub2',
      organizationId: ORG,
      name: 'sub2',
      parentId: 'root',
    });
    folders.set('manual', {
      _id: 'manual',
      organizationId: ORG,
      name: 'manual',
      parentId: 'sub2',
    });

    await cleanupEmptyAncestorFolders(
      ctx as never,
      'sub2' as never,
      'root' as never,
      ORG,
    );

    expect(folders.has('sub2')).toBe(true);
    expect(folders.has('manual')).toBe(true);
    expect(folders.has('root')).toBe(true);
  });

  it('a trashed sibling document keeps the folder alive', async () => {
    // The by_organizationId_and_folderId index does not filter on
    // lifecycleStatus, so a soft-deleted (trashed) doc still occupies
    // the folder until purge. Cleanup must respect this.
    const { ctx, folders, documents } = createMockCtx();
    folders.set('root', {
      _id: 'root',
      organizationId: ORG,
      name: 'Google Drive',
    });
    folders.set('sub2', {
      _id: 'sub2',
      organizationId: ORG,
      name: 'sub2',
      parentId: 'root',
    });
    documents.set('d_trashed', {
      _id: 'd_trashed',
      organizationId: ORG,
      folderId: 'sub2',
      lifecycleStatus: 'trashed',
    });

    await cleanupEmptyAncestorFolders(
      ctx as never,
      'sub2' as never,
      'root' as never,
      ORG,
    );

    expect(folders.has('sub2')).toBe(true);
  });

  it('aborts when parentId chain reaches root before stopAt (cross-subtree folderId)', async () => {
    // The deleted doc's folderId pointed at a folder OUTSIDE the sync
    // subtree. Climbing up never hits stopAt — we must not delete any
    // folder in this case.
    const { ctx, folders, warnSpy } = createMockCtx();
    folders.set('user_folder', {
      _id: 'user_folder',
      organizationId: ORG,
      name: 'user-stuff',
    });
    folders.set('sync_root', {
      _id: 'sync_root',
      organizationId: ORG,
      name: 'Google Drive',
    });

    await cleanupEmptyAncestorFolders(
      ctx as never,
      'user_folder' as never,
      'sync_root' as never,
      ORG,
    );

    expect(folders.has('user_folder')).toBe(true);
    expect(folders.has('sync_root')).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('reached root'),
    );
  });

  it('stops immediately if start === stopAt (sync root never deleted)', async () => {
    const { ctx, folders } = createMockCtx();
    folders.set('root', {
      _id: 'root',
      organizationId: ORG,
      name: 'Google Drive',
    });

    await cleanupEmptyAncestorFolders(
      ctx as never,
      'root' as never,
      'root' as never,
      ORG,
    );

    expect(folders.has('root')).toBe(true);
  });

  it('stops cleanly if the folder is already missing', async () => {
    const { ctx, folders } = createMockCtx();
    folders.set('root', {
      _id: 'root',
      organizationId: ORG,
      name: 'Google Drive',
    });

    await cleanupEmptyAncestorFolders(
      ctx as never,
      'ghost' as never,
      'root' as never,
      ORG,
    );

    expect(folders.has('root')).toBe(true);
  });

  it('aborts on cross-tenant folderId without deleting', async () => {
    const { ctx, folders, warnSpy } = createMockCtx();
    folders.set('foreign', {
      _id: 'foreign',
      organizationId: 'other_org',
      name: 'foreign',
    });

    await cleanupEmptyAncestorFolders(
      ctx as never,
      'foreign' as never,
      'never' as never,
      ORG,
    );

    expect(folders.has('foreign')).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('org mismatch'),
    );
  });

  it('warns and stops at MAX_FOLDER_DEPTH', async () => {
    const { ctx, folders, warnSpy } = createMockCtx();
    folders.set('root', {
      _id: 'root',
      organizationId: ORG,
      name: 'root',
    });
    for (let i = 1; i <= 25; i++) {
      folders.set(`level_${i}`, {
        _id: `level_${i}`,
        organizationId: ORG,
        name: `level-${i}`,
        parentId: i === 1 ? 'root' : `level_${i - 1}`,
      });
    }

    await cleanupEmptyAncestorFolders(
      ctx as never,
      'level_25' as never,
      'root' as never,
      ORG,
    );

    // Deleted exactly MAX_FOLDER_DEPTH (20) levels then warned.
    expect(folders.has('root')).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('depth cap'));
  });
});
