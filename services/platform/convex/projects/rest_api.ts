/**
 * Projects REST API handlers — the machine door for an external worker that
 * finds or creates a client project, prepares its folders, uploads ledger
 * files into them, and verifies the result.
 *
 * Endpoints:
 *   GET  /api/v1/projects?externalItemId=… — Look up by caller-owned key
 *   POST /api/v1/projects                  — Create project
 *   GET  /api/v1/projects/:id              — Get project
 *   GET  /api/v1/projects/:id/folders      — List the project's root folders
 *   POST /api/v1/projects/:id/folders      — Get-or-create a folder
 *   POST /api/v1/projects/:id/uploads      — Mint an upload handoff (intent)
 *   POST /api/v1/projects/:id/files        — Bind an uploaded blob as a file
 *   GET  /api/v1/projects/:id/files        — List the project's files
 *
 * Every handler runs with `{ requireExplicitOrgSlug: true }`: this door
 * WRITES into a tenant, so a multi-org key must name its organization via
 * `X-Organization-Slug` instead of riding the dashboard's drifting
 * last-active pointer.
 *
 * Visibility is the MINTING USER's, re-run per request with the explicit
 * userId: a project the key holder cannot see answers exactly like one that
 * does not exist (opaque 404, or an empty lookup). Writes additionally
 * require the org editor role (the same set the session mutations admit) AND
 * project edit access.
 */

import { ConvexError } from 'convex/values';

import { internal } from '../_generated/api';
import {
  applyRateLimit,
  extractPathParts,
  jsonCreated,
  jsonError,
  jsonOk,
  optionalBoolean,
  optionalString,
  parsePageLimit,
  readJsonObject,
  readJsonObjectOrEmpty,
  requiredString,
  resolveRestOrgRole,
  withRestAuth,
  type RestContext,
} from '../lib/rest/helpers';
import { EDITOR_ROLES } from './access';

const PREFIX = '/api/v1/projects/';

/**
 * Session-surface folder validation codes (`validateFolderName`, the depth
 * walk) that have no entry in the central REST status map — `helpers.ts` is
 * a shared surface this door must not widen — so the get-or-create endpoint
 * answers them as plain 400s here.
 */
const FOLDER_VALIDATION_CODES = new Set([
  'FOLDER_NAME_EMPTY',
  'FOLDER_NAME_TOO_LONG',
  'FOLDER_NAME_INVALID',
  'FOLDER_NAME_HAS_SEPARATOR',
  'FOLDER_MAX_DEPTH_EXCEEDED',
]);

function folderValidationResponse(error: unknown): Response | null {
  if (!(error instanceof ConvexError)) return null;
  const data: unknown = error.data;
  if (typeof data !== 'object' || data === null) return null;
  const code =
    'code' in data && typeof data.code === 'string' ? data.code : undefined;
  if (code === undefined || !FOLDER_VALIDATION_CODES.has(code)) return null;
  const message =
    'message' in data && typeof data.message === 'string'
      ? data.message
      : 'Invalid folder name';
  return jsonError(message, 400);
}

/**
 * The org editor gate — the same set the session `createProject` admits
 * (`EDITOR_ROLES` is the canonical `canEdit` set in `access.ts`). Throws the
 * coded `RBAC_FORBIDDEN` the wrapper maps to 403; `resolveRestOrgRole`
 * already refuses non-members as `ORG_FORBIDDEN`.
 */
async function requireRestEditor(rc: RestContext): Promise<void> {
  const role = await resolveRestOrgRole(rc);
  if (!EDITOR_ROLES.has(role)) {
    throw new ConvexError({
      code: 'RBAC_FORBIDDEN',
      message: `Role "${role}" cannot modify projects.`,
    });
  }
}

interface ProjectLookupRow {
  _id: string;
  name: string;
  key?: string;
  description?: string;
  externalItemId?: string;
  archivedAt?: number;
}

/** The wire shape of one project — `archivedAt` is the archived marker. */
function projectPayload(project: ProjectLookupRow): Record<string, unknown> {
  return {
    id: project._id,
    name: project.name,
    key: project.key,
    description: project.description,
    externalItemId: project.externalItemId,
    archivedAt: project.archivedAt,
  };
}

/** The minting user's access matrix on a wire project id. */
async function projectAccess(
  rc: RestContext,
  projectId: string,
): Promise<{ canRead: boolean; canEdit: boolean }> {
  return await rc.ctx.runQuery(
    internal.projects.internal_queries.getProjectAccessForUser,
    {
      organizationId: rc.org.organizationId,
      userId: rc.user.userId,
      projectId,
    },
  );
}

// ---------------------------------------------------------------------------
// /api/v1/projects (exact path)
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/projects?externalItemId=<value> — a lookup door, not a
 * list-all: the query parameter is REQUIRED. An invisible match answers the
 * same empty list as no match, and the row carries `archivedAt` so a caller
 * can detect an archived project holding the key.
 */
export const lookupProjects = withRestAuth(
  'rest:api',
  async (rc, request) => {
    const url = new URL(request.url);
    const externalItemId = url.searchParams.get('externalItemId')?.trim();
    if (!externalItemId) {
      return jsonError('The "externalItemId" query parameter is required', 400);
    }

    const project = await rc.ctx.runQuery(
      internal.projects.internal_queries.getProjectByExternalItemId,
      { organizationId: rc.org.organizationId, externalItemId },
    );
    if (!project) return jsonOk({ projects: [] });

    const access = await projectAccess(rc, String(project._id));
    if (!access.canRead) return jsonOk({ projects: [] });

    return jsonOk({ projects: [projectPayload(project)] });
  },
  { requireExplicitOrgSlug: true },
);

/** POST /api/v1/projects — create a project attributed to the key holder. */
export const createProjectRest = withRestAuth(
  'rest:api',
  async (rc, request) => {
    await requireRestEditor(rc);

    const body = await readJsonObject(request);
    const name = requiredString(body, 'name', 80);
    const key = optionalString(body, 'key', 32);
    const description = optionalString(body, 'description', 500);
    const externalItemId = optionalString(body, 'externalItemId', 256);

    const project = await rc.ctx.runMutation(
      internal.projects.internal_mutations.createProjectForUser,
      {
        organizationId: rc.org.organizationId,
        userId: rc.user.userId,
        userEmail: rc.user.email || undefined,
        name,
        key,
        description,
        externalItemId,
      },
    );

    return jsonCreated({ project });
  },
  { requireExplicitOrgSlug: true },
);

// ---------------------------------------------------------------------------
// /api/v1/projects/{id}[...] (prefix) — GET
// ---------------------------------------------------------------------------

async function getProjectDetail(
  rc: RestContext,
  id: string,
): Promise<Response> {
  const project = await rc.ctx.runQuery(
    internal.projects.internal_queries.getProjectByIdForOrg,
    { organizationId: rc.org.organizationId, projectId: id },
  );
  if (!project) return jsonError('Project not found', 404);

  const access = await projectAccess(rc, id);
  if (!access.canRead) return jsonError('Project not found', 404);

  return jsonOk({ project: projectPayload(project) });
}

async function listProjectFolders(
  rc: RestContext,
  id: string,
): Promise<Response> {
  const folders = await rc.ctx.runQuery(
    internal.folders.internal_queries.listProjectRootFoldersForUser,
    {
      organizationId: rc.org.organizationId,
      userId: rc.user.userId,
      projectId: id,
    },
  );
  if (folders === null) return jsonError('Project not found', 404);
  return jsonOk({ folders });
}

async function listProjectFiles(
  rc: RestContext,
  id: string,
  url: URL,
): Promise<Response> {
  const folderId = url.searchParams.get('folderId')?.trim() || undefined;
  const cursor = url.searchParams.get('cursor') ?? null;
  const limit = parsePageLimit(url, 25, 100);

  const result = await rc.ctx.runQuery(
    internal.documents.internal_queries.listProjectFilesForUser,
    {
      organizationId: rc.org.organizationId,
      userId: rc.user.userId,
      projectId: id,
      folderId,
      paginationOpts: { numItems: limit, cursor },
    },
  );
  if (result === null) return jsonError('Project not found', 404);
  if (result.status === 'folder_not_found') {
    return jsonError('Folder not found', 404);
  }

  return jsonOk({
    files: result.page,
    ...(result.isDone ? {} : { cursor: result.continueCursor }),
  });
}

export const getProjectResource = withRestAuth(
  'rest:api',
  async (rc, request) => {
    const url = new URL(request.url);
    const { id, subPath } = extractPathParts(url, PREFIX);
    if (!id) return jsonError('Missing project ID', 400);

    if (subPath === null) return await getProjectDetail(rc, id);
    if (subPath === 'folders') return await listProjectFolders(rc, id);
    if (subPath === 'files') return await listProjectFiles(rc, id, url);

    return jsonError(`Unknown resource: ${subPath}`, 404);
  },
  { requireExplicitOrgSlug: true },
);

// ---------------------------------------------------------------------------
// /api/v1/projects/{id}/… (prefix) — POST
// ---------------------------------------------------------------------------

/**
 * Shared write preamble: editor role, then the minting user's project
 * access. An invisible project is an opaque 404; a visible one without edit
 * access is a 403. Returns null when the write may proceed.
 */
async function refuseUnlessProjectEditor(
  rc: RestContext,
  id: string,
): Promise<Response | null> {
  await requireRestEditor(rc);
  const access = await projectAccess(rc, id);
  if (!access.canRead) return jsonError('Project not found', 404);
  if (!access.canEdit) {
    return jsonError('You do not have permission to modify this project', 403);
  }
  return null;
}

/**
 * POST /api/v1/projects/{id}/folders — GET-OR-CREATE: an exact-name match
 * under the same parent answers 200 `{folder, created: false}`; otherwise the
 * folder is created and answers 201 `{folder, created: true}`.
 */
async function createProjectFolderAction(
  rc: RestContext,
  request: Request,
  id: string,
): Promise<Response> {
  const refusal = await refuseUnlessProjectEditor(rc, id);
  if (refusal) return refusal;

  const body = await readJsonObject(request);
  const name = requiredString(body, 'name', 255);
  const parentId = optionalString(body, 'parentId', 64);

  try {
    const result = await rc.ctx.runMutation(
      internal.folders.internal_mutations.getOrCreateProjectFolder,
      {
        organizationId: rc.org.organizationId,
        projectId: id,
        userId: rc.user.userId,
        name,
        parentId,
      },
    );
    const payload = {
      folder: { id: result.folderId, name: result.name },
      created: result.created,
    };
    return result.created ? jsonCreated(payload) : jsonOk(payload);
  } catch (error) {
    const translated = folderValidationResponse(error);
    if (translated) return translated;
    throw error;
  }
}

/**
 * POST /api/v1/projects/{id}/uploads — mint a backend-aware upload handoff
 * plus its single-use intent. The caller then sends the bytes to `url` with
 * `method` (binding `s3Ref` for a PUT, the returned `_storage` id for a
 * POST) and binds via `POST …/files` before `expiresAt`.
 */
async function createProjectUploadAction(
  rc: RestContext,
  request: Request,
  id: string,
): Promise<Response> {
  // Gate BEFORE presigning: refusing after would leave the caller holding a
  // signed PUT URL no intent row tracks (an unsweepable orphan lane).
  const refusal = await refuseUnlessProjectEditor(rc, id);
  if (refusal) return refusal;

  const body = await readJsonObjectOrEmpty(request);
  // `fileName` is accepted for symmetry with the bind step but not needed to
  // presign — the authoritative name arrives at bind time.
  optionalString(body, 'fileName', 1024);
  const contentType = optionalString(body, 'contentType', 255);

  const handoff = await rc.ctx.runAction(
    internal.files.blob_actions.generateRestBlobUpload,
    { organizationId: rc.org.organizationId, contentType },
  );
  const intent = await rc.ctx.runMutation(
    internal.projects.rest_upload_intents.createRestUploadIntent,
    {
      organizationId: rc.org.organizationId,
      userId: rc.user.userId,
      projectId: id,
      s3Ref: handoff.s3Ref,
    },
  );

  return jsonOk({
    uploadId: intent.uploadId,
    url: handoff.url,
    method: handoff.method,
    ...(handoff.s3Ref !== undefined ? { s3Ref: handoff.s3Ref } : {}),
    expiresAt: intent.expiresAt,
  });
}

/**
 * POST /api/v1/projects/{id}/files — consume the upload intent, then create
 * the project document through the same core the session upload uses.
 * `skipRagIndexing` DEFAULTS TO TRUE here: these files are project working
 * material, not org knowledge — an explicit `false` opts back in.
 */
async function bindProjectFileAction(
  rc: RestContext,
  request: Request,
  id: string,
): Promise<Response> {
  const refusal = await refuseUnlessProjectEditor(rc, id);
  if (refusal) return refusal;

  const body = await readJsonObject(request);
  const uploadId = requiredString(body, 'uploadId', 64);
  const fileId = requiredString(body, 'fileId', 2048);
  const folderId = requiredString(body, 'folderId', 64);
  const fileName = requiredString(body, 'fileName', 1024);
  const contentType = optionalString(body, 'contentType', 255);
  const skipRagIndexing = optionalBoolean(body, 'skipRagIndexing') ?? true;

  // ONE mutation = one transaction: the intent is verified and consumed
  // atomically with the document create, so a refusal anywhere — foreign
  // folder, upload policy, the per-org `file:upload` budget — rolls the
  // consume back and the handshake survives for a corrected retry. Only a
  // successful bind burns it (single-use), and the claimed-blob probe commits
  // with the metadata insert, so parallel binds of one blob serialize.
  const created = await rc.ctx.runMutation(
    internal.documents.internal_mutations.createDocumentFromUploadForUser,
    {
      organizationId: rc.org.organizationId,
      userId: rc.user.userId,
      userEmail: rc.user.email || undefined,
      projectId: id,
      folderId,
      fileId,
      fileName,
      contentType,
      skipRagIndexing,
      uploadId,
    },
  );

  return jsonCreated({
    file: { id: created.documentId, fileName, folderId, projectId: id },
  });
}

/**
 * One POST handler serves the whole prefix (the router takes one handler per
 * method+prefix), wrapped in the `rest:upload` lane bucket the upload/bind
 * choreography is budgeted for. Folder creation belongs to the plain CRUD
 * budget, so that sub-path tops up with a `rest:api` charge — its effective
 * rate is the tighter of the two.
 */
export const projectPostActions = withRestAuth(
  'rest:upload',
  async (rc, request) => {
    const url = new URL(request.url);
    const { id, subPath } = extractPathParts(url, PREFIX);
    if (!id) return jsonError('Missing project ID', 400);

    if (subPath === 'folders') {
      const limited = await applyRateLimit(rc.ctx, 'rest:api', request);
      if (limited) return limited;
      return await createProjectFolderAction(rc, request, id);
    }
    if (subPath === 'uploads') {
      return await createProjectUploadAction(rc, request, id);
    }
    if (subPath === 'files') {
      return await bindProjectFileAction(rc, request, id);
    }

    return jsonError(`Unknown action: ${subPath ?? ''}`, 404);
  },
  { requireExplicitOrgSlug: true },
);
