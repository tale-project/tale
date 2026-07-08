import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { MutationCtx } from '../_generated/server';
import { MAX_KB_REFERENCES } from './resolve_referenced_files';
import {
  MAX_FOLDER_PIN_FILES,
  resolveReferencedFolders,
} from './resolve_referenced_folders';

vi.mock('../lib/get_user_teams', () => ({
  getUserTeamIds: vi.fn(),
}));
vi.mock('../lib/rls/organization/get_organization_member', () => ({
  getOrganizationMember: vi.fn(),
}));

import { getUserTeamIds } from '../lib/get_user_teams';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

const mockGetUserTeamIds = vi.mocked(getUserTeamIds);
const mockGetOrganizationMember = vi.mocked(getOrganizationMember);

interface FakeFileMeta {
  fileName: string;
  contentType: string;
  size: number;
  ragStatus?: 'queued' | 'running' | 'completed' | 'failed';
}

/**
 * Table-dispatching mock: `db.get` serves folders/projects by id;
 * `db.query('folders')` answers the children `.take()`; `db.query('documents')`
 * answers the per-folder async iteration; `db.query('fileMetadata')` answers
 * the by_storageId `.first()`. The LAST `.eq()` value is the lookup key in
 * every case (parentId / folderId / storageId).
 */
function createCtx(opts: {
  rowsById?: Record<string, Record<string, unknown>>;
  childFoldersByParent?: Record<string, Record<string, unknown>[]>;
  docsByFolder?: Record<string, Record<string, unknown>[]>;
  fileMetaByStorageId?: Record<string, FakeFileMeta>;
}) {
  const {
    rowsById = {},
    childFoldersByParent = {},
    docsByFolder = {},
    fileMetaByStorageId = {},
  } = opts;
  return {
    db: {
      get: vi.fn(async (id: string) => rowsById[id] ?? null),
      query: vi.fn((table: string) => ({
        withIndex: (
          _name: string,
          cb: (q: { eq: (field: string, value: unknown) => unknown }) => void,
        ) => {
          const eqs: unknown[] = [];
          const chain = {
            eq: (_field: string, value: unknown) => {
              eqs.push(value);
              return chain;
            },
          };
          cb(chain);
          const key = String(eqs[eqs.length - 1]);
          if (table === 'folders') {
            return {
              take: async () => childFoldersByParent[key] ?? [],
            };
          }
          if (table === 'documents') {
            const rows = docsByFolder[key] ?? [];
            return {
              async *[Symbol.asyncIterator]() {
                for (const row of rows) yield row;
              },
            };
          }
          return {
            first: async () => fileMetaByStorageId[key] ?? null,
          };
        },
      })),
    },
  } as unknown as MutationCtx;
}

const META: FakeFileMeta = {
  fileName: 'file.pdf',
  contentType: 'application/pdf',
  size: 10,
  ragStatus: 'completed',
};

const ARGS = { organizationId: 'org1', userId: 'user1' };

function folderIds(ids: string[]) {
  return ids as unknown as Parameters<
    typeof resolveReferencedFolders
  >[1]['referencedFolderIds'];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUserTeamIds.mockResolvedValue([]);
});

describe('resolveReferencedFolders', () => {
  it('expands a hub folder subtree to indexed blob-backed files, deduped', async () => {
    const ctx = createCtx({
      rowsById: {
        root: { _id: 'root', organizationId: 'org1', name: 'Reports' },
      },
      childFoldersByParent: {
        root: [{ _id: 'sub', organizationId: 'org1', name: 'Q3' }],
      },
      docsByFolder: {
        root: [
          { _id: 'd1', title: 'a.pdf', fileId: 'f1' },
          // Not blob-backed — skipped.
          { _id: 'd2', title: 'pending.pdf' },
          // Not indexed — skipped.
          { _id: 'd3', title: 'raw.pdf', fileId: 'f_raw' },
        ],
        sub: [
          { _id: 'd4', title: 'b.pdf', fileId: 'f2' },
          // Duplicate blob of d1 — deduped.
          { _id: 'd5', title: 'a-copy.pdf', fileId: 'f1' },
        ],
      },
      fileMetaByStorageId: {
        f1: META,
        f2: META,
        f_raw: { ...META, ragStatus: 'queued' },
      },
    });

    const result = await resolveReferencedFolders(ctx, {
      ...ARGS,
      referencedFolderIds: folderIds(['root']),
    });

    expect(result.files.map((f) => f.fileId)).toEqual(['f1', 'f2']);
    expect(result.folders).toEqual([
      { folderId: 'root', name: 'Reports', fileCount: 2 },
    ]);
    expect(result.truncated).toBe(false);
  });

  it('rejects a team folder outside the caller teams and a foreign-org folder', async () => {
    const ctx = createCtx({
      rowsById: {
        team: { _id: 'team', organizationId: 'org1', teamId: 'team_b' },
        foreign: { _id: 'foreign', organizationId: 'org2' },
      },
    });
    mockGetUserTeamIds.mockResolvedValue(['team_a']);

    await expect(
      resolveReferencedFolders(ctx, {
        ...ARGS,
        referencedFolderIds: folderIds(['team']),
      }),
    ).rejects.toMatchObject({ data: { code: 'KB_REF_INVALID' } });
    await expect(
      resolveReferencedFolders(ctx, {
        ...ARGS,
        referencedFolderIds: folderIds(['foreign']),
      }),
    ).rejects.toMatchObject({ data: { code: 'KB_REF_INVALID' } });
  });

  it('allows a project folder only in its own project thread with read access', async () => {
    const rows = {
      pf: { _id: 'pf', organizationId: 'org1', name: 'PF', projectId: 'p1' },
      p1: { _id: 'p1', organizationId: 'org1', teamId: 'team_a' },
    };
    mockGetOrganizationMember.mockResolvedValue({
      userId: 'user1',
      role: 'member',
    } as Awaited<ReturnType<typeof getOrganizationMember>>);
    mockGetUserTeamIds.mockResolvedValue(['team_a']);

    // Wrong thread project → opaque invalid.
    await expect(
      resolveReferencedFolders(createCtx({ rowsById: rows }), {
        ...ARGS,
        referencedFolderIds: folderIds(['pf']),
        threadProjectId: 'p_other' as never,
      }),
    ).rejects.toMatchObject({ data: { code: 'KB_REF_INVALID' } });

    // No project thread at all → opaque invalid.
    await expect(
      resolveReferencedFolders(createCtx({ rowsById: rows }), {
        ...ARGS,
        referencedFolderIds: folderIds(['pf']),
      }),
    ).rejects.toMatchObject({ data: { code: 'KB_REF_INVALID' } });

    // Same project thread + readable project → resolves (empty folder ok).
    const result = await resolveReferencedFolders(
      createCtx({ rowsById: rows }),
      {
        ...ARGS,
        referencedFolderIds: folderIds(['pf']),
        threadProjectId: 'p1' as never,
      },
    );
    expect(result.folders).toEqual([
      { folderId: 'pf', name: 'PF', fileCount: 0 },
    ]);
  });

  it('caps the expansion at MAX_FOLDER_PIN_FILES and surfaces truncation', async () => {
    const docs = Array.from({ length: MAX_FOLDER_PIN_FILES + 5 }, (_, i) => ({
      _id: `d${i}`,
      title: `doc${i}.pdf`,
      fileId: `f${i}`,
    }));
    const meta = Object.fromEntries(docs.map((d) => [d.fileId, META]));
    const ctx = createCtx({
      rowsById: {
        root: { _id: 'root', organizationId: 'org1', name: 'Big' },
      },
      docsByFolder: { root: docs },
      fileMetaByStorageId: meta,
    });

    const result = await resolveReferencedFolders(ctx, {
      ...ARGS,
      referencedFolderIds: folderIds(['root']),
    });

    expect(result.files).toHaveLength(MAX_FOLDER_PIN_FILES);
    expect(result.truncated).toBe(true);
  });

  it('rejects more folder refs than the shared cap', async () => {
    const ctx = createCtx({});
    await expect(
      resolveReferencedFolders(ctx, {
        ...ARGS,
        referencedFolderIds: folderIds(
          Array.from({ length: MAX_KB_REFERENCES + 1 }, (_, i) => `f${i}`),
        ),
      }),
    ).rejects.toMatchObject({ data: { code: 'KB_REF_INVALID' } });
  });
});
