/**
 * The projects REST surface (the machine door), pinned at the delegation
 * boundary: which backing function each route calls, with which arguments
 * (the explicit minting-user identity above all), and which status each
 * refusal becomes. Three postures matter most: an invisible project answers
 * EXACTLY like an absent one (opaque 404 / empty lookup), the bind step
 * consumes its intent ATOMICALLY with the document create (the uploadId
 * travels into the one mutation), and `skipRagIndexing` defaults to TRUE on
 * this door. Full-DB behavior lives in `rest_machine_door.test.ts` /
 * `rest_upload_intents.test.ts`.
 */

import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../_generated/server', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  httpAction: (handler: unknown) => handler,
}));

vi.mock('../lib/rate_limiter/helpers', () => ({
  checkIpRateLimit: vi.fn(),
  checkOrganizationRateLimit: vi.fn(),
  RateLimitExceededError: class RateLimitExceededError extends Error {},
}));

const getSession = vi.fn();
vi.mock('../auth', () => ({
  createAuth: () => ({ api: { getSession } }),
}));

import { listDocuments } from '../documents/rest_api';
import { checkIpRateLimit } from '../lib/rate_limiter/helpers';
import {
  anonymousRequest,
  argsOf,
  called,
  jsonBody,
  restCtx,
  restRequest,
  testSession,
  TEST_ORG_ID,
  TEST_USER_ID,
  type StubRoutes,
} from '../lib/rest/handler_kit.testkit';
import type { HttpCtx } from '../lib/rest/helpers';
import {
  createProjectRest,
  getProjectResource,
  lookupProjects,
  projectPostActions,
} from './rest_api';

type Handler = (ctx: HttpCtx, request: Request) => Promise<Response>;

const LOOKUP = 'projects/internal_queries:getProjectByExternalItemId';
const GET_BY_ID = 'projects/internal_queries:getProjectByIdForOrg';
const ACCESS = 'projects/internal_queries:getProjectAccessForUser';
const CREATE_PROJECT = 'projects/internal_mutations:createProjectForUser';
const LIST_FOLDERS = 'folders/internal_queries:listProjectRootFoldersForUser';
const GET_OR_CREATE_FOLDER =
  'folders/internal_mutations:getOrCreateProjectFolder';
const BLOB_HANDOFF = 'files/blob_actions:generateRestBlobUpload';
const MINT_INTENT = 'projects/rest_upload_intents:createRestUploadIntent';
const CREATE_FILE =
  'documents/internal_mutations:createDocumentFromUploadForUser';
const LIST_FILES = 'documents/internal_queries:listProjectFilesForUser';
const QUERY_DOCS = 'documents/internal_queries:queryDocuments';

function projectRow() {
  return {
    _id: 'proj_1',
    name: 'Acme Books',
    key: 'ACME',
    externalItemId: 'erp-42',
  };
}

const canEdit = { canRead: true, canEdit: true };
const invisible = { canRead: false, canEdit: false };

/** Routes for a write endpoint whose project resolves and is editable. */
function writable(routes: StubRoutes): StubRoutes {
  return { [ACCESS]: () => canEdit, ...routes };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(testSession());
});

describe('authentication', () => {
  it('refuses a request with no Authorization header (401)', async () => {
    const { ctx } = restCtx();
    const response = await (lookupProjects as unknown as Handler)(
      ctx,
      anonymousRequest('/api/v1/projects?externalItemId=erp-42'),
    );
    expect(response.status).toBe(401);
  });
});

describe('GET /api/v1/projects (lookup by externalItemId)', () => {
  it('requires the externalItemId parameter (400) — a lookup door, not a list-all', async () => {
    const { ctx, calls } = restCtx({ [LOOKUP]: () => projectRow() });
    const response = await (lookupProjects as unknown as Handler)(
      ctx,
      restRequest('/api/v1/projects'),
    );
    expect(response.status).toBe(400);
    expect(called(calls, LOOKUP)).toBe(false);
  });

  it('answers the visible match with its archived marker', async () => {
    const { ctx, calls } = restCtx({
      [LOOKUP]: () => ({ ...projectRow(), archivedAt: 1700000000000 }),
      [ACCESS]: () => canEdit,
    });
    const response = await (lookupProjects as unknown as Handler)(
      ctx,
      restRequest('/api/v1/projects?externalItemId=erp-42'),
    );
    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual({
      projects: [
        {
          id: 'proj_1',
          name: 'Acme Books',
          key: 'ACME',
          externalItemId: 'erp-42',
          archivedAt: 1700000000000,
        },
      ],
    });
    expect(argsOf(calls, LOOKUP)).toEqual({
      organizationId: TEST_ORG_ID,
      externalItemId: 'erp-42',
    });
    expect(argsOf(calls, ACCESS)).toEqual({
      organizationId: TEST_ORG_ID,
      userId: TEST_USER_ID,
      projectId: 'proj_1',
    });
  });

  it('answers a team-restricted invisible match EXACTLY like no match (empty list)', async () => {
    const { ctx: withMatch } = restCtx({
      [LOOKUP]: () => projectRow(),
      [ACCESS]: () => invisible,
    });
    const hidden = await (lookupProjects as unknown as Handler)(
      withMatch,
      restRequest('/api/v1/projects?externalItemId=erp-42'),
    );

    const { ctx: withoutMatch, calls } = restCtx({ [LOOKUP]: () => null });
    const absent = await (lookupProjects as unknown as Handler)(
      withoutMatch,
      restRequest('/api/v1/projects?externalItemId=erp-42'),
    );

    expect(hidden.status).toBe(200);
    expect(absent.status).toBe(200);
    expect(await jsonBody(hidden)).toEqual({ projects: [] });
    expect(await jsonBody(absent)).toEqual({ projects: [] });
    // No match → no access check either.
    expect(called(calls, ACCESS)).toBe(false);
  });
});

describe('POST /api/v1/projects', () => {
  const request = () =>
    restRequest('/api/v1/projects', {
      method: 'POST',
      json: { name: 'Acme Books', externalItemId: 'erp-42' },
    });

  it('creates attributed to the key holder and answers 201 with the projection', async () => {
    const { ctx, calls } = restCtx({
      [CREATE_PROJECT]: () => ({
        id: 'proj_new',
        name: 'Acme Books',
        key: 'ACME',
        externalItemId: 'erp-42',
      }),
    });
    const response = await (createProjectRest as unknown as Handler)(
      ctx,
      request(),
    );
    expect(response.status).toBe(201);
    expect(await jsonBody(response)).toEqual({
      project: {
        id: 'proj_new',
        name: 'Acme Books',
        key: 'ACME',
        externalItemId: 'erp-42',
      },
    });
    expect(argsOf(calls, CREATE_PROJECT)).toEqual({
      organizationId: TEST_ORG_ID,
      userId: TEST_USER_ID,
      userEmail: 'key@tale.test',
      name: 'Acme Books',
      externalItemId: 'erp-42',
    });
  });

  it('maps a duplicate externalItemId to 409', async () => {
    const { ctx } = restCtx({
      [CREATE_PROJECT]: () => {
        throw new ConvexError({
          code: 'PROJECT_DUPLICATE_EXTERNAL_ID',
          message: 'A project with externalItemId "erp-42" already exists',
        });
      },
    });
    const response = await (createProjectRest as unknown as Handler)(
      ctx,
      request(),
    );
    expect(response.status).toBe(409);
    expect(await jsonBody(response)).toEqual({
      error: 'A project with externalItemId "erp-42" already exists',
    });
  });

  it('maps a blank externalItemId to 400', async () => {
    const { ctx } = restCtx({
      [CREATE_PROJECT]: () => {
        throw new ConvexError({
          code: 'PROJECT_EXTERNAL_ITEM_ID_INVALID',
          message: 'externalItemId must be 1-256 characters after trimming',
        });
      },
    });
    const response = await (createProjectRest as unknown as Handler)(
      ctx,
      restRequest('/api/v1/projects', {
        method: 'POST',
        json: { name: 'Acme Books', externalItemId: '   ' },
      }),
    );
    expect(response.status).toBe(400);
  });

  it('refuses a plain member (403) without touching the mutation', async () => {
    const { ctx, calls } = restCtx(
      { [CREATE_PROJECT]: () => ({ id: 'x', name: 'x' }) },
      { role: 'member' },
    );
    const response = await (createProjectRest as unknown as Handler)(
      ctx,
      request(),
    );
    expect(response.status).toBe(403);
    expect(called(calls, CREATE_PROJECT)).toBe(false);
  });

  it('refuses a body without a name (400)', async () => {
    const { ctx, calls } = restCtx({
      [CREATE_PROJECT]: () => ({ id: 'x', name: 'x' }),
    });
    const response = await (createProjectRest as unknown as Handler)(
      ctx,
      restRequest('/api/v1/projects', { method: 'POST', json: {} }),
    );
    expect(response.status).toBe(400);
    expect(called(calls, CREATE_PROJECT)).toBe(false);
  });
});

describe('GET /api/v1/projects/:id', () => {
  it('answers the project', async () => {
    const { ctx } = restCtx({
      [GET_BY_ID]: () => projectRow(),
      [ACCESS]: () => canEdit,
    });
    const response = await (getProjectResource as unknown as Handler)(
      ctx,
      restRequest('/api/v1/projects/proj_1'),
    );
    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual({
      project: {
        id: 'proj_1',
        name: 'Acme Books',
        key: 'ACME',
        externalItemId: 'erp-42',
      },
    });
  });

  it('answers the SAME opaque 404 for cross-org/garbage ids and invisible projects', async () => {
    const { ctx: foreign } = restCtx({ [GET_BY_ID]: () => null });
    const foreignResponse = await (getProjectResource as unknown as Handler)(
      foreign,
      restRequest('/api/v1/projects/proj_of_org_b'),
    );

    const { ctx: hidden } = restCtx({
      [GET_BY_ID]: () => projectRow(),
      [ACCESS]: () => invisible,
    });
    const hiddenResponse = await (getProjectResource as unknown as Handler)(
      hidden,
      restRequest('/api/v1/projects/proj_1'),
    );

    for (const response of [foreignResponse, hiddenResponse]) {
      expect(response.status).toBe(404);
      expect(await jsonBody(response)).toEqual({ error: 'Project not found' });
    }
  });

  it('rejects an unknown sub-resource with 404', async () => {
    const { ctx } = restCtx({ [GET_BY_ID]: () => projectRow() });
    const response = await (getProjectResource as unknown as Handler)(
      ctx,
      restRequest('/api/v1/projects/proj_1/settings'),
    );
    expect(response.status).toBe(404);
  });
});

describe('GET /api/v1/projects/:id/folders', () => {
  it('answers the generic root-folder shape', async () => {
    const { ctx, calls } = restCtx({
      [LIST_FOLDERS]: () => [{ id: 'folder_1', name: 'Q1' }],
    });
    const response = await (getProjectResource as unknown as Handler)(
      ctx,
      restRequest('/api/v1/projects/proj_1/folders'),
    );
    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual({
      folders: [{ id: 'folder_1', name: 'Q1' }],
    });
    expect(argsOf(calls, LIST_FOLDERS)).toEqual({
      organizationId: TEST_ORG_ID,
      userId: TEST_USER_ID,
      projectId: 'proj_1',
    });
  });

  it('answers the opaque 404 when the project does not resolve for this user', async () => {
    const { ctx } = restCtx({ [LIST_FOLDERS]: () => null });
    const response = await (getProjectResource as unknown as Handler)(
      ctx,
      restRequest('/api/v1/projects/proj_x/folders'),
    );
    expect(response.status).toBe(404);
    expect(await jsonBody(response)).toEqual({ error: 'Project not found' });
  });
});

describe('POST /api/v1/projects/:id/folders (get-or-create)', () => {
  const request = (json: unknown = { name: 'Q1' }) =>
    restRequest('/api/v1/projects/proj_1/folders', { method: 'POST', json });

  it('answers 200 {created: false} for an exact-name match', async () => {
    const { ctx, calls } = restCtx(
      writable({
        [GET_OR_CREATE_FOLDER]: () => ({
          folderId: 'folder_1',
          name: 'Q1',
          created: false,
        }),
      }),
    );
    const response = await (projectPostActions as unknown as Handler)(
      ctx,
      request(),
    );
    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual({
      folder: { id: 'folder_1', name: 'Q1' },
      created: false,
    });
    expect(argsOf(calls, GET_OR_CREATE_FOLDER)).toEqual({
      organizationId: TEST_ORG_ID,
      projectId: 'proj_1',
      userId: TEST_USER_ID,
      name: 'Q1',
    });
  });

  it('answers 201 {created: true} for a fresh folder, passing the parent through', async () => {
    const { ctx, calls } = restCtx(
      writable({
        [GET_OR_CREATE_FOLDER]: () => ({
          folderId: 'folder_2',
          name: 'Ledgers',
          created: true,
        }),
      }),
    );
    const response = await (projectPostActions as unknown as Handler)(
      ctx,
      request({ name: 'Ledgers', parentId: 'folder_1' }),
    );
    expect(response.status).toBe(201);
    expect(await jsonBody(response)).toEqual({
      folder: { id: 'folder_2', name: 'Ledgers' },
      created: true,
    });
    expect(argsOf(calls, GET_OR_CREATE_FOLDER)?.parentId).toBe('folder_1');
  });

  it('charges the folders sub-path against BOTH the upload lane and the CRUD bucket', async () => {
    const { ctx } = restCtx(
      writable({
        [GET_OR_CREATE_FOLDER]: () => ({
          folderId: 'folder_1',
          name: 'Q1',
          created: false,
        }),
      }),
    );
    await (projectPostActions as unknown as Handler)(ctx, request());
    const buckets = vi
      .mocked(checkIpRateLimit)
      .mock.calls.map((call) => call[1]);
    expect(buckets).toContain('rest:upload');
    expect(buckets).toContain('rest:api');
  });

  it('maps a parent from another project to the opaque 404', async () => {
    const { ctx } = restCtx(
      writable({
        [GET_OR_CREATE_FOLDER]: () => {
          throw new ConvexError({
            code: 'FOLDER_NOT_FOUND',
            message: 'Folder not found',
          });
        },
      }),
    );
    const response = await (projectPostActions as unknown as Handler)(
      ctx,
      request({ name: 'Q1', parentId: 'folder_of_other_project' }),
    );
    expect(response.status).toBe(404);
    expect(await jsonBody(response)).toEqual({ error: 'Folder not found' });
  });

  it('answers folder-name validation codes as plain 400s', async () => {
    const { ctx } = restCtx(
      writable({
        [GET_OR_CREATE_FOLDER]: () => {
          throw new ConvexError({
            code: 'FOLDER_NAME_HAS_SEPARATOR',
            message: 'Folder name cannot contain path separators',
          });
        },
      }),
    );
    const response = await (projectPostActions as unknown as Handler)(
      ctx,
      request({ name: 'a/b' }),
    );
    expect(response.status).toBe(400);
    expect(await jsonBody(response)).toEqual({
      error: 'Folder name cannot contain path separators',
    });
  });
});

describe('POST /api/v1/projects/:id/uploads', () => {
  const request = (json: unknown = { fileName: 'ledger.pdf' }) =>
    restRequest('/api/v1/projects/proj_1/uploads', { method: 'POST', json });

  it('mints the handoff and the intent (Convex POST lane: no s3Ref)', async () => {
    const { ctx, calls } = restCtx(
      writable({
        [BLOB_HANDOFF]: () => ({
          url: 'https://public.example/upload',
          method: 'POST',
        }),
        [MINT_INTENT]: () => ({ uploadId: 'intent_1', expiresAt: 4200 }),
      }),
    );
    const response = await (projectPostActions as unknown as Handler)(
      ctx,
      request({ contentType: 'application/pdf' }),
    );
    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual({
      uploadId: 'intent_1',
      url: 'https://public.example/upload',
      method: 'POST',
      expiresAt: 4200,
    });
    expect(argsOf(calls, BLOB_HANDOFF)).toEqual({
      organizationId: TEST_ORG_ID,
      contentType: 'application/pdf',
    });
    expect(argsOf(calls, MINT_INTENT)).toEqual({
      organizationId: TEST_ORG_ID,
      userId: TEST_USER_ID,
      projectId: 'proj_1',
    });
  });

  it('carries the S3 lane through: s3Ref in the intent AND the response', async () => {
    const { ctx, calls } = restCtx(
      writable({
        [BLOB_HANDOFF]: () => ({
          url: 'https://bucket.example/key?sig=1',
          method: 'PUT',
          s3Ref: 's3:org/key',
        }),
        [MINT_INTENT]: () => ({ uploadId: 'intent_2', expiresAt: 4200 }),
      }),
    );
    const response = await (projectPostActions as unknown as Handler)(
      ctx,
      request(),
    );
    expect(await jsonBody(response)).toMatchObject({
      method: 'PUT',
      s3Ref: 's3:org/key',
    });
    expect(argsOf(calls, MINT_INTENT)?.s3Ref).toBe('s3:org/key');
  });

  it('refuses BEFORE presigning: invisible project → 404, member role → 403', async () => {
    const { ctx: hidden, calls: hiddenCalls } = restCtx({
      [ACCESS]: () => invisible,
      [BLOB_HANDOFF]: () => ({}),
    });
    const hiddenResponse = await (projectPostActions as unknown as Handler)(
      hidden,
      request(),
    );
    expect(hiddenResponse.status).toBe(404);
    expect(called(hiddenCalls, BLOB_HANDOFF)).toBe(false);

    const { ctx: member, calls: memberCalls } = restCtx(
      { [ACCESS]: () => canEdit, [BLOB_HANDOFF]: () => ({}) },
      { role: 'member' },
    );
    const memberResponse = await (projectPostActions as unknown as Handler)(
      member,
      request(),
    );
    expect(memberResponse.status).toBe(403);
    expect(called(memberCalls, BLOB_HANDOFF)).toBe(false);
  });
});

describe('POST /api/v1/projects/:id/files (bind)', () => {
  const bindBody = {
    uploadId: 'intent_1',
    fileId: 'blob_1',
    folderId: 'folder_1',
    fileName: 'ledger.pdf',
  };
  const request = (json: Record<string, unknown> = bindBody) =>
    restRequest('/api/v1/projects/proj_1/files', { method: 'POST', json });

  it('binds through ONE mutation carrying the uploadId, skipRagIndexing defaulting TRUE, answers 201', async () => {
    const { ctx, calls } = restCtx(
      writable({
        [CREATE_FILE]: () => ({ documentId: 'doc_1' }),
      }),
    );
    const response = await (projectPostActions as unknown as Handler)(
      ctx,
      request(),
    );
    expect(response.status).toBe(201);
    expect(await jsonBody(response)).toEqual({
      file: {
        id: 'doc_1',
        fileName: 'ledger.pdf',
        folderId: 'folder_1',
        projectId: 'proj_1',
      },
    });
    // The intent travels INTO the create mutation (consumed in the same
    // transaction, so a refused create rolls the consume back).
    expect(argsOf(calls, CREATE_FILE)).toEqual({
      organizationId: TEST_ORG_ID,
      userId: TEST_USER_ID,
      userEmail: 'key@tale.test',
      projectId: 'proj_1',
      folderId: 'folder_1',
      fileId: 'blob_1',
      fileName: 'ledger.pdf',
      skipRagIndexing: true,
      uploadId: 'intent_1',
    });
  });

  it('passes an explicit skipRagIndexing: false through (documented opt-in)', async () => {
    const { ctx, calls } = restCtx(
      writable({
        [CREATE_FILE]: () => ({ documentId: 'doc_1' }),
      }),
    );
    await (projectPostActions as unknown as Handler)(
      ctx,
      request({ ...bindBody, skipRagIndexing: false }),
    );
    expect(argsOf(calls, CREATE_FILE)?.skipRagIndexing).toBe(false);
  });

  it('maps a refused handshake to 400 with the opaque message', async () => {
    const { ctx } = restCtx(
      writable({
        [CREATE_FILE]: () => {
          throw new ConvexError({
            code: 'UPLOAD_BLOB_INVALID',
            message: 'Upload not found or expired',
          });
        },
      }),
    );
    const response = await (projectPostActions as unknown as Handler)(
      ctx,
      request(),
    );
    expect(response.status).toBe(400);
    expect(await jsonBody(response)).toEqual({
      error: 'Upload not found or expired',
    });
  });

  it('maps a folder from another project to the opaque 404', async () => {
    const { ctx } = restCtx(
      writable({
        [CREATE_FILE]: () => {
          throw new ConvexError({
            code: 'FOLDER_NOT_FOUND',
            message: 'Folder not found',
          });
        },
      }),
    );
    const response = await (projectPostActions as unknown as Handler)(
      ctx,
      request(),
    );
    expect(response.status).toBe(404);
  });

  it('rejects an unknown POST sub-resource with 404', async () => {
    const { ctx } = restCtx(writable({}));
    const response = await (projectPostActions as unknown as Handler)(
      ctx,
      restRequest('/api/v1/projects/proj_1/exports', { method: 'POST' }),
    );
    expect(response.status).toBe(404);
  });
});

describe('GET /api/v1/projects/:id/files', () => {
  it('answers the file page, carrying the cursor only while more remain', async () => {
    const page = [
      {
        id: 'doc_1',
        fileName: 'ledger.pdf',
        folderId: 'folder_1',
        createdAt: 1,
        size: 9,
        ragStatus: undefined,
      },
    ];
    const { ctx, calls } = restCtx({
      [LIST_FILES]: () => ({
        status: 'ok',
        page,
        isDone: false,
        continueCursor: 'cursor_2',
      }),
    });
    const response = await (getProjectResource as unknown as Handler)(
      ctx,
      restRequest('/api/v1/projects/proj_1/files?folderId=folder_1&limit=1'),
    );
    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual({
      files: [
        {
          id: 'doc_1',
          fileName: 'ledger.pdf',
          folderId: 'folder_1',
          createdAt: 1,
          size: 9,
        },
      ],
      cursor: 'cursor_2',
    });
    expect(argsOf(calls, LIST_FILES)).toEqual({
      organizationId: TEST_ORG_ID,
      userId: TEST_USER_ID,
      projectId: 'proj_1',
      folderId: 'folder_1',
      paginationOpts: { numItems: 1, cursor: null },
    });

    const { ctx: lastPage } = restCtx({
      [LIST_FILES]: () => ({
        status: 'ok',
        page,
        isDone: true,
        continueCursor: 'end',
      }),
    });
    const complete = await (getProjectResource as unknown as Handler)(
      lastPage,
      restRequest('/api/v1/projects/proj_1/files'),
    );
    expect(await jsonBody(complete)).not.toHaveProperty('cursor');
  });

  it('answers opaque 404s for an unresolved project and a foreign folder', async () => {
    const { ctx: noProject } = restCtx({ [LIST_FILES]: () => null });
    const projectMissing = await (getProjectResource as unknown as Handler)(
      noProject,
      restRequest('/api/v1/projects/proj_x/files'),
    );
    expect(projectMissing.status).toBe(404);
    expect(await jsonBody(projectMissing)).toEqual({
      error: 'Project not found',
    });

    const { ctx: badFolder } = restCtx({
      [LIST_FILES]: () => ({ status: 'folder_not_found' }),
    });
    const folderMissing = await (getProjectResource as unknown as Handler)(
      badFolder,
      restRequest('/api/v1/projects/proj_1/files?folderId=folder_of_other'),
    );
    expect(folderMissing.status).toBe(404);
    expect(await jsonBody(folderMissing)).toEqual({
      error: 'Folder not found',
    });
  });
});

describe('hub isolation: GET /api/v1/documents', () => {
  it('keeps project files out of the knowledge-hub listing', async () => {
    const { ctx } = restCtx({
      [QUERY_DOCS]: () => ({
        page: [
          { _id: 'doc_hub', title: 'Handbook.pdf' },
          { _id: 'doc_project', title: 'ledger.pdf', projectId: 'proj_1' },
        ],
        isDone: true,
        continueCursor: '',
      }),
    });
    const response = await (listDocuments as unknown as Handler)(
      ctx,
      restRequest('/api/v1/documents'),
    );
    expect(response.status).toBe(200);
    const body = await jsonBody(response);
    const ids = (body.page as Array<{ _id: string }>).map((doc) => doc._id);
    expect(ids).toEqual(['doc_hub']);
  });
});
