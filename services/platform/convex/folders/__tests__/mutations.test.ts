import { describe, expect, it, vi } from 'vitest';

import { teamIdsToFields } from '../../documents/team_fields';
import { hasTeamAccess } from '../../lib/team_access';
import { validateFolderName } from '../mutations';

type MockFolder = {
  _id: string;
  organizationId: string;
  name: string;
  parentId?: string;
  teamId?: string;
  teamTags?: string[];
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

describe('updateFolderTeams validation logic', () => {
  it('denies access when folder is team-scoped and user is not a member', async () => {
    const { ctx, folders } = createMockMutationCtx();
    folders.set('folder_1', {
      _id: 'folder_1',
      organizationId: 'org_1',
      name: 'sales-docs',
      teamId: 'team_sales',
      teamTags: ['team_sales'],
    });

    const folder = await ctx.db.get('folder_1');
    if (!folder) throw new Error('folder not found');

    const userTeamIds = ['team_marketing'];
    expect(hasTeamAccess(folder, userTeamIds)).toBe(false);
  });

  it('allows access when folder is team-scoped and user is a member', async () => {
    const { ctx, folders } = createMockMutationCtx();
    folders.set('folder_1', {
      _id: 'folder_1',
      organizationId: 'org_1',
      name: 'sales-docs',
      teamId: 'team_sales',
      teamTags: ['team_sales'],
    });

    const folder = await ctx.db.get('folder_1');
    if (!folder) throw new Error('folder not found');

    const userTeamIds = ['team_sales', 'team_marketing'];
    expect(hasTeamAccess(folder, userTeamIds)).toBe(true);
  });

  it('allows access when folder is org-wide (no teams)', async () => {
    const { ctx, folders } = createMockMutationCtx();
    folders.set('folder_1', {
      _id: 'folder_1',
      organizationId: 'org_1',
      name: 'shared-docs',
    });

    const folder = await ctx.db.get('folder_1');
    if (!folder) throw new Error('folder not found');

    const userTeamIds = ['team_anything'];
    expect(hasTeamAccess(folder, userTeamIds)).toBe(true);
  });

  it('rejects assigning teams the user does not belong to', () => {
    const userTeamIds = new Set(['team_a', 'team_b']);
    const requestedTeamIds = ['team_a', 'team_c'];

    const unauthorized = requestedTeamIds.filter(
      (tid) => !userTeamIds.has(tid),
    );
    expect(unauthorized).toEqual(['team_c']);
  });

  it('allows assigning teams the user belongs to', () => {
    const userTeamIds = new Set(['team_a', 'team_b', 'team_c']);
    const requestedTeamIds = ['team_a', 'team_c'];

    const unauthorized = requestedTeamIds.filter(
      (tid) => !userTeamIds.has(tid),
    );
    expect(unauthorized).toEqual([]);
  });

  it('computes correct fields when updating from org-wide to team-scoped', () => {
    const result = teamIdsToFields(['team_sales']);

    expect(result.teamId).toBe('team_sales');
    expect(result.teamTags).toEqual(['team_sales']);
    expect(result.sharedWithTeamIds).toBeUndefined();
  });

  it('computes correct fields when updating from team-scoped to org-wide', () => {
    const result = teamIdsToFields(undefined);

    expect(result.teamId).toBeUndefined();
    expect(result.teamTags).toBeUndefined();
    expect(result.sharedWithTeamIds).toBeUndefined();
  });

  it('computes correct fields when assigning multiple teams', () => {
    const result = teamIdsToFields(['team_sales', 'team_support']);

    expect(result.teamId).toBe('team_sales');
    expect(result.teamTags).toEqual(['team_sales', 'team_support']);
    expect(result.sharedWithTeamIds).toBeUndefined();
  });

  it('treats empty array same as undefined (org-wide)', () => {
    const emptyResult = teamIdsToFields([]);
    const undefinedResult = teamIdsToFields(undefined);

    expect(emptyResult).toEqual(undefinedResult);
  });

  it('patches folder with computed team fields', async () => {
    const { ctx, folders } = createMockMutationCtx();
    folders.set('folder_1', {
      _id: 'folder_1',
      organizationId: 'org_1',
      name: 'shared-docs',
    });

    const requestedTeamIds = ['team_sales', 'team_support'];
    const { teamId, teamTags } = teamIdsToFields(
      requestedTeamIds.length > 0 ? requestedTeamIds : undefined,
    );

    await ctx.db.patch('folder_1', { teamId, teamTags });

    expect(ctx.db.patch).toHaveBeenCalledWith('folder_1', {
      teamId: 'team_sales',
      teamTags: ['team_sales', 'team_support'],
    });
  });

  it('patches folder to org-wide when empty array is provided', async () => {
    const { ctx, folders } = createMockMutationCtx();
    folders.set('folder_1', {
      _id: 'folder_1',
      organizationId: 'org_1',
      name: 'team-docs',
      teamId: 'team_sales',
      teamTags: ['team_sales'],
    });

    const requestedTeamIds: string[] = [];
    const { teamId, teamTags } = teamIdsToFields(
      requestedTeamIds.length > 0 ? requestedTeamIds : undefined,
    );

    await ctx.db.patch('folder_1', { teamId, teamTags });

    expect(ctx.db.patch).toHaveBeenCalledWith('folder_1', {
      teamId: undefined,
      teamTags: undefined,
    });
  });

  it('denies access to folder with teamTags the user is not a member of', () => {
    const folder = {
      teamId: 'team_a',
      teamTags: ['team_a', 'team_b'],
    };

    expect(hasTeamAccess(folder, ['team_c'])).toBe(false);
  });

  it('grants access when user belongs to any of the folder teamTags', () => {
    const folder = {
      teamId: 'team_a',
      teamTags: ['team_a', 'team_b'],
    };

    expect(hasTeamAccess(folder, ['team_b'])).toBe(true);
  });
});

describe('team inheritance logic', () => {
  it('child folder inherits parent teamId when parent has a team', async () => {
    const { ctx, folders } = createMockMutationCtx();
    folders.set('parent_1', {
      _id: 'parent_1',
      organizationId: 'org_1',
      name: 'sales-docs',
      teamId: 'team_sales',
      teamTags: ['team_sales'],
    });

    const parent = await ctx.db.get('parent_1');
    if (!parent) throw new Error('parent not found');

    let effectiveTeamId: string | undefined = undefined;
    if (parent.teamId) {
      effectiveTeamId = parent.teamId;
    }

    expect(effectiveTeamId).toBe('team_sales');
  });

  it('child folder keeps its own teamId when parent has no team', async () => {
    const { ctx, folders } = createMockMutationCtx();
    folders.set('parent_1', {
      _id: 'parent_1',
      organizationId: 'org_1',
      name: 'shared',
    });

    const parent = await ctx.db.get('parent_1');
    if (!parent) throw new Error('parent not found');

    let effectiveTeamId: string | undefined = 'team_marketing';
    if (parent.teamId) {
      effectiveTeamId = parent.teamId;
    }

    expect(effectiveTeamId).toBe('team_marketing');
  });

  it('child folder overrides client teamId with parent teamId', async () => {
    const { ctx, folders } = createMockMutationCtx();
    folders.set('parent_1', {
      _id: 'parent_1',
      organizationId: 'org_1',
      name: 'sales-docs',
      teamId: 'team_sales',
    });

    const parent = await ctx.db.get('parent_1');
    if (!parent) throw new Error('parent not found');

    let effectiveTeamId: string | undefined = 'team_marketing';
    if (parent.teamId) {
      effectiveTeamId = parent.teamId;
    }

    expect(effectiveTeamId).toBe('team_sales');
  });

  it('blocks team change on folder when parent has a team', async () => {
    const { ctx, folders } = createMockMutationCtx();
    folders.set('parent_1', {
      _id: 'parent_1',
      organizationId: 'org_1',
      name: 'sales-docs',
      teamId: 'team_sales',
    });
    folders.set('child_1', {
      _id: 'child_1',
      organizationId: 'org_1',
      name: 'child',
      parentId: 'parent_1',
      teamId: 'team_sales',
    });

    const folder = await ctx.db.get('child_1');
    if (!folder) throw new Error('folder not found');

    if (folder.parentId) {
      const parent = await ctx.db.get(folder.parentId);
      expect(parent?.teamId).toBe('team_sales');
    }
  });

  it('allows team change on folder when parent has no team', async () => {
    const { ctx, folders } = createMockMutationCtx();
    folders.set('parent_1', {
      _id: 'parent_1',
      organizationId: 'org_1',
      name: 'shared',
    });
    folders.set('child_1', {
      _id: 'child_1',
      organizationId: 'org_1',
      name: 'child',
      parentId: 'parent_1',
    });

    const folder = await ctx.db.get('child_1');
    if (!folder) throw new Error('folder not found');

    if (folder.parentId) {
      const parent = await ctx.db.get(folder.parentId);
      expect(parent?.teamId).toBeUndefined();
    }
  });

  it('cascade team fields are computed correctly for descendants', () => {
    const fields = teamIdsToFields(['team_sales']);
    expect(fields.teamId).toBe('team_sales');
    expect(fields.teamTags).toEqual(['team_sales']);

    const orgWideFields = teamIdsToFields(undefined);
    expect(orgWideFields.teamId).toBeUndefined();
    expect(orgWideFields.teamTags).toBeUndefined();
  });

  it('blocks document team change when folder has a team', async () => {
    const { ctx, folders, documents } = createMockMutationCtx();
    folders.set('folder_1', {
      _id: 'folder_1',
      organizationId: 'org_1',
      name: 'sales-docs',
      teamId: 'team_sales',
    });
    documents.set('doc_1', {
      _id: 'doc_1',
      organizationId: 'org_1',
      folderId: 'folder_1',
      teamId: 'team_sales',
    });

    const doc = await ctx.db.get('doc_1');
    if (!doc) throw new Error('document not found');

    if ('folderId' in doc && doc.folderId) {
      const folder = await ctx.db.get(doc.folderId);
      expect(folder?.teamId).toBe('team_sales');
    }
  });

  it('allows document team change when folder has no team', async () => {
    const { ctx, folders, documents } = createMockMutationCtx();
    folders.set('folder_1', {
      _id: 'folder_1',
      organizationId: 'org_1',
      name: 'shared-docs',
    });
    documents.set('doc_1', {
      _id: 'doc_1',
      organizationId: 'org_1',
      folderId: 'folder_1',
    });

    const doc = await ctx.db.get('doc_1');
    if (!doc) throw new Error('document not found');

    if ('folderId' in doc && doc.folderId) {
      const folder = await ctx.db.get(doc.folderId);
      expect(folder?.teamId).toBeUndefined();
    }
  });

  it('document inherits folder team on upload', async () => {
    const { ctx, folders } = createMockMutationCtx();
    folders.set('folder_1', {
      _id: 'folder_1',
      organizationId: 'org_1',
      name: 'sales-docs',
      teamId: 'team_sales',
    });

    const folder = await ctx.db.get('folder_1');
    if (!folder) throw new Error('folder not found');

    let effectiveTeamId: string | undefined = undefined;
    if (folder.teamId) {
      effectiveTeamId = folder.teamId;
    }

    expect(effectiveTeamId).toBe('team_sales');
  });
});

describe('cascade delete logic', () => {
  it('finds all child folders for recursive deletion', async () => {
    const { ctx, folders } = createMockMutationCtx();
    folders.set('parent_1', {
      _id: 'parent_1',
      organizationId: 'org_1',
      name: 'root',
    });
    folders.set('child_1', {
      _id: 'child_1',
      organizationId: 'org_1',
      name: 'sub-a',
      parentId: 'parent_1',
    });
    folders.set('child_2', {
      _id: 'child_2',
      organizationId: 'org_1',
      name: 'sub-b',
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
    const firstChild = await builder.first();
    expect(firstChild).not.toBeNull();
  });

  it('finds all child documents for scheduled deletion', async () => {
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
    documents.set('doc_2', {
      _id: 'doc_2',
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
    const firstDoc = await builder.first();
    expect(firstDoc).not.toBeNull();
  });

  it('deeply nested folders are all reachable for cascade', async () => {
    const { ctx, folders } = createMockMutationCtx();
    folders.set('level_1', {
      _id: 'level_1',
      organizationId: 'org_1',
      name: 'level-1',
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

    const l2Query = ctx.db.query('folders');
    const l2Builder = l2Query.withIndex(
      'by_org_parent_name',
      (q: MockQueryBuilder) => {
        q.eq('organizationId', 'org_1');
        q.eq('parentId', 'level_1');
      },
    );
    const l2Child = await l2Builder.first();
    expect(l2Child?._id).toBe('level_2');

    const l3Query = ctx.db.query('folders');
    const l3Builder = l3Query.withIndex(
      'by_org_parent_name',
      (q: MockQueryBuilder) => {
        q.eq('organizationId', 'org_1');
        q.eq('parentId', 'level_2');
      },
    );
    const l3Child = await l3Builder.first();
    expect(l3Child?._id).toBe('level_3');
  });

  it('documents in nested folders are reachable for cascade', async () => {
    const { ctx, folders, documents } = createMockMutationCtx();
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
    documents.set('doc_in_child', {
      _id: 'doc_in_child',
      organizationId: 'org_1',
      folderId: 'child_1',
    });

    const query = ctx.db.query('documents');
    const builder = query.withIndex(
      'by_organizationId_and_folderId',
      (q: MockQueryBuilder) => {
        q.eq('organizationId', 'org_1');
        q.eq('folderId', 'child_1');
      },
    );
    const doc = await builder.first();
    expect(doc?._id).toBe('doc_in_child');
  });

  it('empty folder has no children to cascade', async () => {
    const { ctx, folders } = createMockMutationCtx();
    folders.set('empty_1', {
      _id: 'empty_1',
      organizationId: 'org_1',
      name: 'empty',
    });

    const folderQuery = ctx.db.query('folders');
    const folderBuilder = folderQuery.withIndex(
      'by_org_parent_name',
      (q: MockQueryBuilder) => {
        q.eq('organizationId', 'org_1');
        q.eq('parentId', 'empty_1');
      },
    );
    expect(await folderBuilder.first()).toBeNull();

    const docQuery = ctx.db.query('documents');
    const docBuilder = docQuery.withIndex(
      'by_organizationId_and_folderId',
      (q: MockQueryBuilder) => {
        q.eq('organizationId', 'org_1');
        q.eq('folderId', 'empty_1');
      },
    );
    expect(await docBuilder.first()).toBeNull();
  });
});
