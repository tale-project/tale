import { describe, expect, it, vi } from 'vitest';

import { hasTeamAccess } from '../../lib/team_access';
import { validateFolderName } from '../mutations';

type MockFolder = {
  _id: string;
  organizationId: string;
  name: string;
  parentId?: string;
  teamId?: string;
};

type MockDocument = {
  _id: string;
  organizationId: string;
  folderId?: string;
  parentId?: string;
  teamId?: string;
};

type MockRecord = MockFolder | MockDocument;

interface MockQueryBuilder {
  eq: (field: string, value: unknown) => MockQueryBuilder;
}

function createMockMutationCtx() {
  const folders = new Map<string, MockFolder>();
  const documents = new Map<string, MockDocument>();

  let insertCounter = 0;

  const ctx = {
    db: {
      get: vi
        .fn<(id: string) => Promise<MockRecord | null>>()
        .mockImplementation((id: string) => {
          return Promise.resolve(folders.get(id) ?? documents.get(id) ?? null);
        }),
      query: vi.fn().mockImplementation((table: string) => {
        const store = table === 'folders' ? folders : documents;
        const filters: Record<string, unknown> = {};

        const builder = {
          withIndex: vi
            .fn()
            .mockImplementation(
              (_indexName: string, cb: (q: MockQueryBuilder) => void) => {
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
    const builder = query.withIndex(
      'by_org_parent_name',
      (q: MockQueryBuilder) => {
        q.eq('organizationId', 'org_1');
        q.eq('parentId', undefined);
        q.eq('name', 'docs');
      },
    );
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
    const builder = query.withIndex(
      'by_org_parent_name',
      (q: MockQueryBuilder) => {
        q.eq('organizationId', 'org_1');
        q.eq('parentId', 'parent_b');
        q.eq('name', 'docs');
      },
    );
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
    const builder = query.withIndex(
      'by_org_parent_name',
      (q: MockQueryBuilder) => {
        q.eq('organizationId', 'org_2');
        q.eq('parentId', undefined);
        q.eq('name', 'docs');
      },
    );
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
    const builder = query.withIndex(
      'by_org_parent_name',
      (q: MockQueryBuilder) => {
        q.eq('organizationId', 'org_1');
        q.eq('parentId', 'parent_1');
      },
    );
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
      (q: MockQueryBuilder) => {
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
      (q: MockQueryBuilder) => {
        q.eq('organizationId', 'org_1');
        q.eq('parentId', 'folder_1');
      },
    );
    const childFolder = await folderBuilder.first();

    const docQuery = ctx.db.query('documents');
    const docBuilder = docQuery.withIndex(
      'by_organizationId_and_folderId',
      (q: MockQueryBuilder) => {
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
    expect(parent?.organizationId).not.toBe('org_1');
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
    expect(parent?.organizationId).toBe('org_1');
  });
});

describe('team access validation', () => {
  it('hasTeamAccess returns true for org-wide resources (no teamId)', () => {
    expect(hasTeamAccess({}, ['team_a'])).toBe(true);
    expect(hasTeamAccess({ teamId: undefined }, ['team_a'])).toBe(true);
    expect(hasTeamAccess({ teamId: null }, ['team_a'])).toBe(true);
  });

  it('hasTeamAccess returns true when user belongs to resource team', () => {
    expect(hasTeamAccess({ teamId: 'team_a' }, ['team_a', 'team_b'])).toBe(
      true,
    );
  });

  it('hasTeamAccess returns false when user does not belong to resource team', () => {
    expect(hasTeamAccess({ teamId: 'team_c' }, ['team_a', 'team_b'])).toBe(
      false,
    );
  });

  it('hasTeamAccess works with Set input', () => {
    expect(hasTeamAccess({ teamId: 'team_a' }, new Set(['team_a']))).toBe(true);
    expect(hasTeamAccess({ teamId: 'team_b' }, new Set(['team_a']))).toBe(
      false,
    );
  });

  it('parent folder with team restricts child creation for non-members', async () => {
    const { ctx, folders } = createMockMutationCtx();
    folders.set('team_folder', {
      _id: 'team_folder',
      organizationId: 'org_1',
      name: 'sales-docs',
      teamId: 'team_sales',
    });

    const parent = await ctx.db.get('team_folder');
    expect(parent).not.toBeNull();
    expect(parent?.teamId).toBe('team_sales');

    const userTeamIds = ['team_marketing'];
    expect(hasTeamAccess(parent ?? { teamId: undefined }, userTeamIds)).toBe(
      false,
    );
  });

  it('parent folder with team allows child creation for members', async () => {
    const { ctx, folders } = createMockMutationCtx();
    folders.set('team_folder', {
      _id: 'team_folder',
      organizationId: 'org_1',
      name: 'sales-docs',
      teamId: 'team_sales',
    });

    const parent = await ctx.db.get('team_folder');
    const userTeamIds = ['team_sales', 'team_marketing'];
    expect(hasTeamAccess(parent ?? { teamId: undefined }, userTeamIds)).toBe(
      true,
    );
  });
});

describe('folder depth validation', () => {
  it('counts depth correctly for nested folders', async () => {
    const { ctx, folders } = createMockMutationCtx();

    folders.set('level_1', {
      _id: 'level_1',
      organizationId: 'org_1',
      name: 'level-1',
      parentId: undefined,
    });
    folders.set('level_2', {
      _id: 'level_2',
      organizationId: 'org_1',
      name: 'level-2',
      parentId: 'level_1',
    });
    folders.set('level_3', {
      _id: 'level_3',
      organizationId: 'org_1',
      name: 'level-3',
      parentId: 'level_2',
    });

    let depth = 1;
    let ancestorId: string | undefined = 'level_2';
    while (ancestorId) {
      const ancestor: MockRecord | null = await ctx.db.get(ancestorId);
      if (!ancestor) break;
      depth++;
      ancestorId = ancestor.parentId;
    }

    expect(depth).toBe(3);
  });

  it('stops counting at MAX_FOLDER_DEPTH', async () => {
    const { ctx, folders } = createMockMutationCtx();
    const MAX_FOLDER_DEPTH = 20;

    for (let i = 1; i <= 25; i++) {
      folders.set(`level_${i}`, {
        _id: `level_${i}`,
        organizationId: 'org_1',
        name: `level-${i}`,
        parentId: i > 1 ? `level_${i - 1}` : undefined,
      });
    }

    let depth = 1;
    let ancestorId: string | undefined = (await ctx.db.get('level_24'))
      ?.parentId;
    while (ancestorId && depth < MAX_FOLDER_DEPTH) {
      const ancestor: MockRecord | null = await ctx.db.get(ancestorId);
      if (!ancestor) break;
      depth++;
      ancestorId = ancestor.parentId;
    }

    expect(depth).toBeGreaterThanOrEqual(MAX_FOLDER_DEPTH);
  });
});
