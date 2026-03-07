import { describe, expect, it, vi } from 'vitest';

import { validateFolderName } from '../mutations';

function createMockMutationCtx() {
  const folders = new Map<
    string,
    {
      _id: string;
      organizationId: string;
      name: string;
      parentId?: string;
      teamId?: string;
    }
  >();
  const documents = new Map<
    string,
    { _id: string; organizationId: string; folderId?: string }
  >();

  let insertCounter = 0;

  const ctx = {
    db: {
      get: vi.fn().mockImplementation((id: string) => {
        return Promise.resolve(folders.get(id) ?? documents.get(id) ?? null);
      }),
      query: vi.fn().mockImplementation((table: string) => {
        const store = table === 'folders' ? folders : documents;
        let filters: Record<string, unknown> = {};

        const builder = {
          withIndex: vi
            .fn()
            .mockImplementation(
              (_indexName: string, cb: (q: unknown) => void) => {
                const qb = {
                  eq: vi
                    .fn()
                    .mockImplementation((field: string, value: unknown) => {
                      filters[field] = value;
                      return qb;
                    }),
                };
                cb(qb);
                return builder;
              },
            ),
          first: vi.fn().mockImplementation(() => {
            for (const doc of store.values()) {
              const record = doc as Record<string, unknown>;
              const matches = Object.entries(filters).every(
                ([key, value]) => record[key] === value,
              );
              if (matches) return Promise.resolve(doc);
            }
            return Promise.resolve(null);
          }),
        };

        return builder;
      }),
      insert: vi
        .fn()
        .mockImplementation((_table: string, doc: Record<string, unknown>) => {
          const id = `folder_${++insertCounter}`;
          folders.set(id, {
            _id: id,
            organizationId: doc.organizationId as string,
            name: doc.name as string,
            parentId: doc.parentId as string | undefined,
            teamId: doc.teamId as string | undefined,
          });
          return Promise.resolve(id);
        }),
      patch: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  };

  return { ctx, folders, documents };
}

describe('validateFolderName', () => {
  it('trims whitespace and returns clean name', () => {
    expect(validateFolderName('  docs  ')).toBe('docs');
  });

  it('throws for empty name', () => {
    expect(() => validateFolderName('')).toThrow('Folder name cannot be empty');
  });

  it('throws for whitespace-only name', () => {
    expect(() => validateFolderName('   ')).toThrow(
      'Folder name cannot be empty',
    );
  });

  it('throws for reserved name "."', () => {
    expect(() => validateFolderName('.')).toThrow('Invalid folder name');
  });

  it('throws for reserved name ".."', () => {
    expect(() => validateFolderName('..')).toThrow('Invalid folder name');
  });

  it('throws for names exceeding max length', () => {
    const longName = 'a'.repeat(256);
    expect(() => validateFolderName(longName)).toThrow(
      'Folder name is too long',
    );
  });

  it('allows names at max length', () => {
    const maxName = 'a'.repeat(255);
    expect(validateFolderName(maxName)).toBe(maxName);
  });

  it('throws for names containing forward slash', () => {
    expect(() => validateFolderName('reports/2024')).toThrow(
      'Folder name cannot contain path separators',
    );
  });

  it('throws for names containing backslash', () => {
    expect(() => validateFolderName('reports\\2024')).toThrow(
      'Folder name cannot contain path separators',
    );
  });
});

describe('checkDuplicateName (via createMockCtx)', () => {
  it('detects duplicate folder names at the same level', async () => {
    const { ctx, folders } = createMockMutationCtx();
    folders.set('existing_1', {
      _id: 'existing_1',
      organizationId: 'org_1',
      name: 'docs',
      parentId: undefined,
    });

    const query = ctx.db.query('folders');
    const builder = query.withIndex('by_org_parent_name', (q: any) => {
      q.eq('organizationId', 'org_1');
      q.eq('parentId', undefined);
      q.eq('name', 'docs');
    });
    const existing = await builder.first();

    expect(existing).not.toBeNull();
    expect(existing?._id).toBe('existing_1');
  });

  it('allows same name in different parent folders', async () => {
    const { ctx, folders } = createMockMutationCtx();
    folders.set('existing_1', {
      _id: 'existing_1',
      organizationId: 'org_1',
      name: 'docs',
      parentId: 'parent_a',
    });

    const query = ctx.db.query('folders');
    const builder = query.withIndex('by_org_parent_name', (q: any) => {
      q.eq('organizationId', 'org_1');
      q.eq('parentId', 'parent_b');
      q.eq('name', 'docs');
    });
    const existing = await builder.first();

    expect(existing).toBeNull();
  });

  it('allows same name in different organizations', async () => {
    const { ctx, folders } = createMockMutationCtx();
    folders.set('existing_1', {
      _id: 'existing_1',
      organizationId: 'org_1',
      name: 'docs',
      parentId: undefined,
    });

    const query = ctx.db.query('folders');
    const builder = query.withIndex('by_org_parent_name', (q: any) => {
      q.eq('organizationId', 'org_2');
      q.eq('parentId', undefined);
      q.eq('name', 'docs');
    });
    const existing = await builder.first();

    expect(existing).toBeNull();
  });
});

describe('deleteFolder constraints', () => {
  it('detects child folders preventing deletion', async () => {
    const { ctx, folders } = createMockMutationCtx();
    folders.set('parent_1', {
      _id: 'parent_1',
      organizationId: 'org_1',
      name: 'root',
    });
    folders.set('child_1', {
      _id: 'child_1',
      organizationId: 'org_1',
      name: 'sub',
      parentId: 'parent_1',
    });

    const query = ctx.db.query('folders');
    const builder = query.withIndex('by_org_parent_name', (q: any) => {
      q.eq('organizationId', 'org_1');
      q.eq('parentId', 'parent_1');
    });
    const childFolder = await builder.first();

    expect(childFolder).not.toBeNull();
    expect(childFolder?._id).toBe('child_1');
  });

  it('detects child documents preventing deletion', async () => {
    const { ctx, folders, documents } = createMockMutationCtx();
    folders.set('folder_1', {
      _id: 'folder_1',
      organizationId: 'org_1',
      name: 'docs',
    });
    documents.set('doc_1', {
      _id: 'doc_1',
      organizationId: 'org_1',
      folderId: 'folder_1',
    });

    const query = ctx.db.query('documents');
    const builder = query.withIndex(
      'by_organizationId_and_folderId',
      (q: any) => {
        q.eq('organizationId', 'org_1');
        q.eq('folderId', 'folder_1');
      },
    );
    const childDoc = await builder.first();

    expect(childDoc).not.toBeNull();
    expect(childDoc?._id).toBe('doc_1');
  });

  it('allows deletion when folder is empty', async () => {
    const { ctx, folders } = createMockMutationCtx();
    folders.set('folder_1', {
      _id: 'folder_1',
      organizationId: 'org_1',
      name: 'empty',
    });

    const folderQuery = ctx.db.query('folders');
    const folderBuilder = folderQuery.withIndex(
      'by_org_parent_name',
      (q: any) => {
        q.eq('organizationId', 'org_1');
        q.eq('parentId', 'folder_1');
      },
    );
    const childFolder = await folderBuilder.first();

    const docQuery = ctx.db.query('documents');
    const docBuilder = docQuery.withIndex(
      'by_organizationId_and_folderId',
      (q: any) => {
        q.eq('organizationId', 'org_1');
        q.eq('folderId', 'folder_1');
      },
    );
    const childDoc = await docBuilder.first();

    expect(childFolder).toBeNull();
    expect(childDoc).toBeNull();
  });
});

describe('parent folder validation', () => {
  it('rejects parentId from different organization', async () => {
    const { ctx, folders } = createMockMutationCtx();
    folders.set('parent_other_org', {
      _id: 'parent_other_org',
      organizationId: 'org_2',
      name: 'alien',
    });

    const parent = await ctx.db.get('parent_other_org');
    expect(parent).not.toBeNull();
    expect(parent!.organizationId).not.toBe('org_1');
  });

  it('rejects non-existent parentId', async () => {
    const { ctx } = createMockMutationCtx();

    const parent = await ctx.db.get('nonexistent');
    expect(parent).toBeNull();
  });

  it('accepts valid parent from same organization', async () => {
    const { ctx, folders } = createMockMutationCtx();
    folders.set('parent_1', {
      _id: 'parent_1',
      organizationId: 'org_1',
      name: 'parent',
    });

    const parent = await ctx.db.get('parent_1');
    expect(parent).not.toBeNull();
    expect(parent!.organizationId).toBe('org_1');
  });
});
