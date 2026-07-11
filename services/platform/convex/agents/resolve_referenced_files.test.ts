import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { resolveReferencedFiles } from './resolve_referenced_files';

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
  ragStatus?: 'queued' | 'running' | 'completed' | 'failed' | 'unsupported';
}

/** `db.get` serves documents AND projects from one map (both are point reads
 *  by id); `db.query('fileMetadata')` mirrors the by_storageId point lookup. */
function createCtx(
  rowsById: Record<string, Record<string, unknown>>,
  fileMetaByStorageId: Record<string, FakeFileMeta>,
) {
  return {
    db: {
      get: vi.fn(async (id: string) => rowsById[id] ?? null),
      query: vi.fn(() => ({
        withIndex: (
          _name: string,
          cb: (q: { eq: (field: string, value: unknown) => object }) => unknown,
        ) => {
          let storageId: unknown;
          cb({
            eq: (_field, value) => {
              storageId = value;
              return {};
            },
          });
          return {
            first: () =>
              Promise.resolve(fileMetaByStorageId[String(storageId)] ?? null),
          };
        },
      })),
    },
  } as unknown as MutationCtx;
}

const COMPLETED_META: FakeFileMeta = {
  fileName: 'file.pdf',
  contentType: 'application/pdf',
  size: 10,
  ragStatus: 'completed',
};

const ROWS: Record<string, Record<string, unknown>> = {
  d_hub: { organizationId: 'org1', title: 'Hub doc', fileId: 'f_hub' },
  d_team_b: {
    organizationId: 'org1',
    title: 'Team B doc',
    teamId: 'team_b',
    fileId: 'f_team_b',
  },
  d_proj: {
    organizationId: 'org1',
    title: 'Project doc',
    projectId: 'p1',
    fileId: 'f_proj',
  },
  p1: { _id: 'p1', organizationId: 'org1', teamId: 'team_a' },
};

const FILE_META: Record<string, FakeFileMeta> = {
  f_hub: COMPLETED_META,
  f_team_b: COMPLETED_META,
  f_proj: COMPLETED_META,
};

const BASE_ARGS = {
  organizationId: 'org1',
  userId: 'user1',
};

function refs(...ids: string[]) {
  return ids as Id<'documents'>[];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUserTeamIds.mockResolvedValue(['team_a']);
  mockGetOrganizationMember.mockResolvedValue({
    userId: 'user1',
    role: 'member',
  } as Awaited<ReturnType<typeof getOrganizationMember>>);
});

describe('resolveReferencedFiles', () => {
  it('resolves an org-wide hub document', async () => {
    const ctx = createCtx(ROWS, FILE_META);
    const resolved = await resolveReferencedFiles(ctx, {
      ...BASE_ARGS,
      referencedDocumentIds: refs('d_hub'),
    });
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      documentId: 'd_hub',
      fileId: 'f_hub',
      fileName: 'Hub doc',
    });
  });

  it('rejects a hub document from a team the sender is not in', async () => {
    const ctx = createCtx(ROWS, FILE_META);
    await expect(
      resolveReferencedFiles(ctx, {
        ...BASE_ARGS,
        referencedDocumentIds: refs('d_team_b'),
      }),
    ).rejects.toMatchObject({ data: { code: 'KB_REF_INVALID' } });
  });

  it('resolves a project document inside its own project thread', async () => {
    const ctx = createCtx(ROWS, FILE_META);
    const resolved = await resolveReferencedFiles(ctx, {
      ...BASE_ARGS,
      referencedDocumentIds: refs('d_proj'),
      threadProjectId: 'p1' as Id<'projects'>,
    });
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      documentId: 'd_proj',
      fileId: 'f_proj',
    });
  });

  it('rejects a project document in a global (no-project) chat, even for a project member', async () => {
    const ctx = createCtx(ROWS, FILE_META);
    await expect(
      resolveReferencedFiles(ctx, {
        ...BASE_ARGS,
        referencedDocumentIds: refs('d_proj'),
      }),
    ).rejects.toMatchObject({ data: { code: 'KB_REF_INVALID' } });
  });

  it("rejects a project document pinned from a different project's thread", async () => {
    const ctx = createCtx(ROWS, FILE_META);
    await expect(
      resolveReferencedFiles(ctx, {
        ...BASE_ARGS,
        referencedDocumentIds: refs('d_proj'),
        threadProjectId: 'p2' as Id<'projects'>,
      }),
    ).rejects.toMatchObject({ data: { code: 'KB_REF_INVALID' } });
  });

  it('rejects a project document when the sender has no access to the project', async () => {
    mockGetUserTeamIds.mockResolvedValue(['team_z']);
    const ctx = createCtx(ROWS, FILE_META);
    await expect(
      resolveReferencedFiles(ctx, {
        ...BASE_ARGS,
        referencedDocumentIds: refs('d_proj'),
        threadProjectId: 'p1' as Id<'projects'>,
      }),
    ).rejects.toMatchObject({ data: { code: 'KB_REF_INVALID' } });
  });

  it('rejects when more than MAX_KB_REFERENCES documents are pinned', async () => {
    const ctx = createCtx(ROWS, FILE_META);
    await expect(
      resolveReferencedFiles(ctx, {
        ...BASE_ARGS,
        referencedDocumentIds: refs('a', 'b', 'c', 'd', 'e', 'f'),
      }),
    ).rejects.toMatchObject({ data: { code: 'KB_REF_INVALID' } });
  });

  it('rejects a document whose blob is not RAG-indexed, naming the file + a "not_indexed" reason', async () => {
    const ctx = createCtx(ROWS, {
      ...FILE_META,
      f_hub: { ...COMPLETED_META, ragStatus: 'queued' },
    });
    await expect(
      resolveReferencedFiles(ctx, {
        ...BASE_ARGS,
        referencedDocumentIds: refs('d_hub'),
      }),
    ).rejects.toMatchObject({
      data: {
        code: 'KB_REF_INVALID',
        reason: 'not_indexed',
        fileName: 'Hub doc',
      },
    });
  });

  it('rejects a document whose format has no extractor with an "unsupported" reason (#2598)', async () => {
    const ctx = createCtx(ROWS, {
      ...FILE_META,
      f_hub: { ...COMPLETED_META, ragStatus: 'unsupported' },
    });
    await expect(
      resolveReferencedFiles(ctx, {
        ...BASE_ARGS,
        referencedDocumentIds: refs('d_hub'),
      }),
    ).rejects.toMatchObject({
      data: {
        code: 'KB_REF_INVALID',
        reason: 'unsupported',
        fileName: 'Hub doc',
      },
    });
  });
});
