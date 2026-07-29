// Regression coverage for issue #2546 — "Remove from project" cleared
// `documents.projectId` with no destination semantics, silently publishing
// the file to the org-wide Knowledge Hub. Detach now demands an explicit
// destination at the API surface and the audit log records the scope
// transition.
//
// The mutation factory is mocked to hand the config straight through (same
// pattern as documents/create_document_from_upload.test.ts) so the handler
// bodies are unit-testable without a running backend; the real `ConvexError`
// is preserved so structured throws construct correctly.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('convex/values', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const stub = () => 'validator';
  return {
    ...actual,
    v: {
      string: stub,
      number: stub,
      boolean: stub,
      optional: stub,
      id: stub,
      object: stub,
      union: stub,
      literal: stub,
      array: stub,
      null: stub,
      record: stub,
    },
  };
});

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    mutation: (config: Record<string, unknown>) => config,
  };
});

const mockGetAuthUserIdentity = vi.fn();
vi.mock('../lib/rls/auth/get_auth_user_identity', () => ({
  getAuthUserIdentity: (...args: unknown[]) => mockGetAuthUserIdentity(...args),
}));

const mockGetOrgMember = vi.fn();
vi.mock('../lib/rls/organization/get_organization_member', () => ({
  getOrganizationMember: (...args: unknown[]) => mockGetOrgMember(...args),
}));

vi.mock('../lib/get_user_teams', () => ({
  getUserTeamIds: vi.fn().mockResolvedValue(['team_1']),
}));

vi.mock('../lib/rate_limiter/helpers', () => ({
  checkUserRateLimit: vi.fn().mockResolvedValue(undefined),
  RateLimitExceededError: class RateLimitExceededError extends Error {
    retryAfter = 0;
  },
}));

const mockCreateAuditLog = vi.fn();
vi.mock('../audit_logs/helpers', () => ({
  createAuditLog: (...args: unknown[]) => mockCreateAuditLog(...args),
}));

vi.mock('../events/emit', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

// `defineTable` insists on real validators, which the `v` stub above breaks;
// mutations.ts only pulls the mode validators from the schema module.
vi.mock('./schema', () => ({
  projectModeValidator: 'validator',
  projectKnowledgeModeValidator: 'validator',
  projectConnectorsModeValidator: 'validator',
}));

type Handler = (
  ctx: unknown,
  args: Record<string, unknown>,
) => Promise<unknown>;

async function getMutation(): Promise<{
  args: Record<string, unknown>;
  handler: Handler;
}> {
  const { detachDocumentFromProject } = await import('./mutations');
  return detachDocumentFromProject as unknown as {
    args: Record<string, unknown>;
    handler: Handler;
  };
}

async function getAttachMutation(): Promise<{
  args: Record<string, unknown>;
  handler: Handler;
}> {
  const { attachDocumentToProject } = await import('./mutations');
  return attachDocumentToProject as unknown as {
    args: Record<string, unknown>;
    handler: Handler;
  };
}

const AUTH_USER = { userId: 'user_1', email: 'test@example.com' };

const PROJECT = {
  _id: 'project_1',
  organizationId: 'org_1',
  name: 'Apollo',
  teamId: undefined,
  sharedWithTeamIds: undefined,
};

const DOC = {
  _id: 'doc_1',
  organizationId: 'org_1',
  projectId: 'project_1',
};

function createMockCtx(
  fixtures: Record<string, unknown>,
  opts: { fileMetadata?: Record<string, unknown> | null } = {},
) {
  return {
    db: {
      get: vi.fn((id: string) => Promise.resolve(fixtures[id] ?? null)),
      patch: vi.fn().mockResolvedValue(undefined),
      insert: vi.fn().mockResolvedValue('row_new'),
      // Serves the fileMetadata-by-storageId lookup on the detach RAG-sync
      // branch; the fixture stands in for every .withIndex().first() chain.
      query: vi.fn(() => ({
        withIndex: vi.fn(() => ({
          first: vi.fn().mockResolvedValue(opts.fileMetadata ?? null),
        })),
      })),
    },
    scheduler: {
      runAfter: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe('detachDocumentFromProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUserIdentity.mockResolvedValue(AUTH_USER);
    mockGetOrgMember.mockResolvedValue({
      _id: 'member_1',
      organizationId: 'org_1',
      userId: 'user_1',
      role: 'editor',
    });
  });

  it('declares an explicit destination argument (no silent publish)', async () => {
    const detach = await getMutation();

    // The Convex arg validator is the enforcement: a caller cannot detach
    // without stating where the file lands.
    expect(detach.args).toHaveProperty('destination');
  });

  it('clears projectId (and any folder link) and audits the scope transition', async () => {
    const ctx = createMockCtx({ doc_1: DOC, project_1: PROJECT });
    const detach = await getMutation();

    await detach.handler(ctx, {
      documentId: 'doc_1',
      destination: 'organization',
    });

    // Folder fields clear with the project link: a project folder is not a
    // hub row, so a detached doc must not keep pointing at one.
    expect(ctx.db.patch).toHaveBeenCalledWith('doc_1', {
      projectId: undefined,
      folderId: undefined,
      folderPath: undefined,
    });
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        action: 'project.file.detached',
        resourceId: 'project_1',
        metadata: expect.objectContaining({
          documentId: 'doc_1',
          destination: 'organization',
        }),
      }),
    );
  });

  it('clears the folder link on the stale-project branch too', async () => {
    const ctx = createMockCtx({
      doc_1: { ...DOC, projectId: 'project_gone', folderId: 'folder_1' },
    });
    const detach = await getMutation();

    await detach.handler(ctx, {
      documentId: 'doc_1',
      destination: 'organization',
    });

    expect(ctx.db.patch).toHaveBeenCalledWith('doc_1', {
      projectId: undefined,
      folderId: undefined,
      folderPath: undefined,
    });
  });

  it('syncs the cleared folder path to RAG for an indexed doc', async () => {
    const ctx = createMockCtx(
      {
        doc_1: {
          ...DOC,
          folderId: 'folder_1',
          folderPath: 'Reports',
          fileId: 'storage_1',
        },
        project_1: PROJECT,
      },
      { fileMetadata: { ragStatus: 'completed' } },
    );
    const detach = await getMutation();

    await detach.handler(ctx, {
      documentId: 'doc_1',
      destination: 'organization',
    });

    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      0,
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org_1',
        updates: [{ fileId: 'storage_1', folderPath: undefined }],
      }),
    );
  });

  it('skips the RAG folder-path sync for non-indexed docs', async () => {
    const ctx = createMockCtx(
      {
        doc_1: {
          ...DOC,
          folderId: 'folder_1',
          fileId: 'storage_1',
        },
        project_1: PROJECT,
      },
      { fileMetadata: { ragStatus: 'queued' } },
    );
    const detach = await getMutation();

    await detach.handler(ctx, {
      documentId: 'doc_1',
      destination: 'organization',
    });

    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it('is a no-op for a document not attached to any project', async () => {
    const ctx = createMockCtx({
      doc_1: { ...DOC, projectId: undefined },
    });
    const detach = await getMutation();

    await detach.handler(ctx, {
      documentId: 'doc_1',
      destination: 'organization',
    });

    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(mockCreateAuditLog).not.toHaveBeenCalled();
  });

  it('still requires project edit access', async () => {
    mockGetOrgMember.mockResolvedValue({
      _id: 'member_1',
      organizationId: 'org_1',
      userId: 'user_1',
      role: 'member',
    });
    const ctx = createMockCtx({ doc_1: DOC, project_1: PROJECT });
    const detach = await getMutation();

    await expect(
      detach.handler(ctx, { documentId: 'doc_1', destination: 'organization' }),
    ).rejects.toMatchObject({ data: { code: 'RBAC_FORBIDDEN' } });
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
});

describe('attachDocumentToProject — hub-scope conflicts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUserIdentity.mockResolvedValue(AUTH_USER);
    mockGetOrgMember.mockResolvedValue({
      _id: 'member_1',
      organizationId: 'org_1',
      userId: 'user_1',
      role: 'editor',
    });
  });

  it('rejects a document that lives in a hub folder', async () => {
    const ctx = createMockCtx({
      project_1: PROJECT,
      doc_1: {
        _id: 'doc_1',
        organizationId: 'org_1',
        folderId: 'folder_hub',
      },
    });
    const attach = await getAttachMutation();

    // Same remedy the teamId conflict shows: take the doc out of the hub
    // library (its folder) before attaching it to a project.
    await expect(
      attach.handler(ctx, { documentId: 'doc_1', projectId: 'project_1' }),
    ).rejects.toMatchObject({ data: { code: 'DOCUMENT_SCOPE_CONFLICT' } });
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it('still attaches a folder-less hub document', async () => {
    const ctx = createMockCtx({
      project_1: PROJECT,
      doc_1: { _id: 'doc_1', organizationId: 'org_1' },
    });
    const attach = await getAttachMutation();

    await attach.handler(ctx, {
      documentId: 'doc_1',
      projectId: 'project_1',
    });

    expect(ctx.db.patch).toHaveBeenCalledWith('doc_1', {
      projectId: 'project_1',
    });
  });
});
