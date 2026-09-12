import { randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import {
  PROJECT_AGENT_NAME_MAX,
  projectAgentInputSchema,
} from '@tale/shared/schemas/projects';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { attachmentDisposition } from '../../lib/shared/http/content-disposition.ts';
import { externalKeySchema } from '../../lib/shared/utils/external-key.ts';
import { ADMIN_ROLES } from '../core/projects/access.ts';
import {
  assertUploadTypeAllowedForOrg,
  createDocumentFromUpload,
  deleteDocumentHard,
  deleteFolderCascade,
  DocumentError,
  type DocumentRow,
  loadDocumentOrThrow,
  validateDocumentUploadForOrg,
} from '../domains/documents/service.ts';
import {
  createRestUploadHandoff,
  type FileContent,
  FileError,
  openFileContent,
  registerUpload,
  statOrgBlob,
} from '../domains/files/service.ts';
import { sweepUploadIntents } from '../domains/files/upload-intents.ts';
import {
  FolderError,
  type FolderRow,
  getOrCreateProjectFolder,
  listFolders,
  loadFolderOrThrow,
} from '../domains/folders/service.ts';
import {
  archiveProject,
  assertReadable,
  createProject,
  createProjectAgent,
  deleteProject,
  deleteProjectAgent,
  getProjectAgent,
  getProjectByExternalItemId,
  listProjectAgents,
  listProjectsPage,
  loadProjectOrThrow,
  restoreProject,
  updateProjectAgent,
  type ProjectAuthContext,
  type ProjectRow,
} from '../domains/projects/service.ts';
import { chargeOrgRateLimit } from '../lib/rate-limit-response.ts';
import {
  chargeLane,
  documentDeleteRefusal,
  domainErrorResponse,
  formatKeysetCursor,
  invalidQueryResponse,
  loadRestProject,
  lockRestProjectForWrite,
  mintCursor,
  noQuery,
  notFound,
  PAGE_QUERY,
  parseBody,
  queryFilter,
  readKeysetCursor,
  readPageLimit,
  readQuery,
  requireEditor,
  type RestEnv,
  restProjectAuth,
  RestRefusal,
} from './shared.ts';

/**
 * /api/v1 projects — the machine door for an external worker that finds or
 * creates a client project, prepares its folders, uploads ledger files into
 * them, and downloads what an automation filed back.
 *
 * Every route runs org-strict (a multi-org key must NAME its organization,
 * reads included). Visibility is the MINTING USER's: a project the key
 * holder cannot see answers exactly like one that does not exist. Writes
 * additionally need the org editor role AND project edit access.
 *
 * The upload lane is a single-use handshake: `POST …/uploads` mints a
 * presigned PUT tracked by an intent row; `POST …/files` consumes the
 * intent and binds the landed blob as a project document. A refused bind
 * rolls the consume back, so the handshake survives for a corrected retry.
 */

const UPLOAD_INTENT_TTL_MS = 30 * 60_000;
/** The caps the domain enforces, checked at the door so a value past them
 * is named as a body problem (`INVALID_BODY` at its path) rather than a
 * domain refusal: the project name and the folder name at the domain's own
 * limits (the folder door used to accept 255 where the domain caps at
 * 128), the explicit key at 6, the external key at 256. */
const PROJECT_NAME_MAX = 80;
const PROJECT_KEY_MAX = 6;
const PROJECT_DESCRIPTION_MAX = 500;
const PROJECT_EXTERNAL_ITEM_ID_MAX = 256;
const FOLDER_NAME_MAX = 128;
/** The shared agent shape with the door's own trims: a name of only
 * whitespace is refused by name here, never as a domain refusal. */
const projectAgentBody = projectAgentInputSchema
  .extend({
    name: z.string().trim().min(1).max(PROJECT_AGENT_NAME_MAX),
  })
  .strict();
/** The PUT body: the full configuration plus the optimistic precondition
 * every full-replace door needs — `expectedUpdatedAt` is the `updatedAt`
 * the caller last read, and a save against a changed agent answers 409
 * `PROJECT_AGENT_STALE` (the contacts/products/documents idiom). */
const projectAgentUpdateBody = projectAgentBody
  .extend({
    expectedUpdatedAt: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
  })
  .strict();
const projectCreateBody = z
  .object({
    name: z.string().trim().min(1).max(PROJECT_NAME_MAX),
    // Blank means "derive from the name", like an omitted key.
    key: z.string().trim().max(PROJECT_KEY_MAX).optional(),
    description: z.string().max(PROJECT_DESCRIPTION_MAX).optional(),
    externalItemId: externalKeySchema(PROJECT_EXTERNAL_ITEM_ID_MAX).optional(),
  })
  .strict();
const projectPatchBody = z.object({ archived: z.boolean() }).strict();
/** How `DELETE /projects/{id}` treats the project's content — the app's
 * own delete shape (`deleteProjectInputSchema`), minus the confirmation
 * phrase the door supplies itself. Default `cascade`. */
const projectDeleteBody = z
  .object({ mode: z.enum(['cascade', 'detach']).optional() })
  .strict();
const folderBody = z
  .object({
    name: z.string().trim().min(1).max(FOLDER_NAME_MAX),
    parentId: z.string().max(64).optional(),
  })
  .strict();
const PROJECT_ARCHIVED_FILTERS = ['exclude', 'include', 'only'] as const;

/**
 * A file name is a name, never a path: no separators, no `.`/`..`, no
 * control characters (a NUL cannot be stored at all, the rest cannot be
 * signed into a download disposition). The same rule the session lanes
 * apply — checked at the mint too, so a bad name fails before the bytes
 * are uploaded, not after.
 */
const FILE_NAME_FORBIDDEN = /[/\\\u0000-\u001f\u007f]/;
function isPlainFileName(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed !== '' &&
    trimmed !== '.' &&
    trimmed !== '..' &&
    !trimmed.includes('..') &&
    !FILE_NAME_FORBIDDEN.test(trimmed)
  );
}
const fileNameSchema = z.string().min(1).max(1024).refine(isPlainFileName, {
  message:
    'must be a file name — no path separators, no "..", no control characters',
});

/** The unique index a Postgres 23505 names, or null for any other error:
 * two concurrent creates can both pass the SELECT-then-INSERT checks and
 * one then hits `projects_org_key` / `projects_org_external_item`. */
function uniqueViolationOf(error: unknown): string | null {
  if (error === null || typeof error !== 'object') return null;
  if (Reflect.get(error, 'code') !== '23505') return null;
  const constraint: unknown = Reflect.get(error, 'constraint_name');
  return typeof constraint === 'string' ? constraint : '';
}

function projectPayload(project: ProjectRow): Record<string, unknown> {
  return {
    id: project.id,
    name: project.name,
    key: project.key ?? undefined,
    description: project.description ?? undefined,
    externalItemId: project.externalItemId ?? undefined,
    archivedAt: project.archivedAt ?? undefined,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

/** The org admin gate — the project lifecycle verbs (archive, restore,
 * delete) are the app's admin-only actions, so the door refuses a lesser
 * role before it charges a budget or asks the domain. */
function requireAdmin(c: Context<RestEnv>): void {
  if (!ADMIN_ROLES.has(c.get('role'))) {
    throw new RestRefusal(
      `Role "${c.get('role')}" cannot administer projects — an organization admin is required.`,
      403,
      'ROLE_FORBIDDEN',
    );
  }
}

export function createProjectRestRoutes(deps: { sql: Sql }): Hono<RestEnv> {
  const app = new Hono<RestEnv>();

  /** Load a project visible to the minting user, or the opaque 404. */
  const loadVisibleProject = async (
    c: Context<RestEnv>,
    auth: ProjectAuthContext,
    projectId: string,
  ): Promise<ProjectRow | Response> => {
    try {
      return await loadRestProject(deps.sql, auth, projectId);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  };

  /** Write preamble: editor role, then project EDIT access. */
  const loadEditableProject = async (
    c: Context<RestEnv>,
    auth: ProjectAuthContext,
    projectId: string,
  ): Promise<ProjectRow | Response> => {
    try {
      return await loadRestProject(deps.sql, auth, projectId, { write: true });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  };

  /**
   * GET /projects — two doors in one: with `externalItemId` a LOOKUP (at
   * most one project, the key compared in its canonical NFC + trimmed
   * form; an invisible match answers the same empty list as no match),
   * without it the LIST of every project the key holder can see, newest
   * first, keyset-paged like the files listing (`{projects, isDone,
   * cursor?}`), archived projects excluded unless `archived` says
   * otherwise. The list used to be a 400: an integrator that created one
   * project per external record could never reconcile or clean up.
   */
  app.get('/projects', async (c) => {
    const query = readQuery(c, {
      ...PAGE_QUERY,
      externalItemId: externalKeySchema(
        PROJECT_EXTERNAL_ITEM_ID_MAX,
      ).optional(),
      archived: z.enum(PROJECT_ARCHIVED_FILTERS).optional(),
    });
    if (query instanceof Response) return query;
    const auth = await restProjectAuth(deps.sql, c);
    if (query.externalItemId !== undefined) {
      // A lookup takes the key alone: a page parameter beside it would be
      // silently ignored, so it is named instead.
      const stray = (['cursor', 'limit', 'archived'] as const).find(
        (name) => query[name] !== undefined,
      );
      if (stray !== undefined) {
        return invalidQueryResponse(
          c,
          'INVALID_QUERY',
          `invalid query: "${stray}" — a lookup by externalItemId takes no cursor, limit or archived filter`,
          [{ path: stray, message: 'is not a parameter of the lookup' }],
        );
      }
      const project = await getProjectByExternalItemId(
        deps.sql,
        c.get('organizationId'),
        query.externalItemId,
      );
      if (project === null) return c.json({ projects: [] });
      try {
        assertReadable(project, auth);
      } catch (error) {
        console.warn(
          '[projects-rest] lookup match invisible to the key holder:',
          error instanceof Error ? error.message : String(error),
        );
        return c.json({ projects: [] });
      }
      return c.json({ projects: [projectPayload(project)] });
    }
    const limit = readPageLimit(c, { fallback: 25, max: 100 });
    if (limit instanceof Response) return limit;
    const cursor = readKeysetCursor(c, 'projects');
    if (cursor instanceof Response) return cursor;
    const page = await listProjectsPage(deps.sql, auth, {
      archived: query.archived ?? 'exclude',
      limit,
      cursor,
    });
    const last = page.projects[page.projects.length - 1];
    const isDone = !(page.hasMore && last);
    return c.json({
      projects: page.projects.map(projectPayload),
      isDone,
      ...(isDone || !last
        ? {}
        : {
            cursor: mintCursor(
              c,
              'projects',
              formatKeysetCursor(last.createdAt, last.id),
            ),
          }),
    });
  });

  app.post('/projects', async (c) => {
    const body = await parseBody(c, projectCreateBody);
    if (body instanceof Response) return body;
    try {
      requireEditor(c);
      const auth = await restProjectAuth(deps.sql, c);
      // The machine door derives the key from the name when none is sent,
      // and a derived key that is taken gets a numeric suffix (keyless when
      // none is free) — a name-only create never fails on a key the caller
      // never chose. An EXPLICIT key that is taken is the documented 409.
      // The uniqueness checks are SELECT-then-INSERT, so two concurrent
      // creates can both pass and one hits the unique index: an explicit
      // key or externalItemId twin is answered as the same 409, a derived
      // key twin is retried onto the next free suffix.
      const explicitKey = body.key ?? '';
      let projectId: string | null = null;
      for (let attempt = 0; attempt < 3 && projectId === null; attempt += 1) {
        try {
          projectId = await deps.sql.begin((tx) =>
            createProject(tx, auth, {
              ...body,
              deriveKeyOnCollision: true,
            }),
          );
        } catch (error) {
          const constraint = uniqueViolationOf(error);
          if (constraint === 'projects_org_external_item') {
            throw new RestRefusal(
              `A project with externalItemId "${body.externalItemId ?? ''}" already exists in this organization`,
              409,
              'PROJECT_DUPLICATE_EXTERNAL_ID',
            );
          }
          if (constraint === 'projects_org_key' && explicitKey !== '') {
            throw new RestRefusal(
              `Project key "${explicitKey.toUpperCase()}" is already taken in this organization`,
              409,
              'PROJECT_KEY_TAKEN',
            );
          }
          if (constraint !== 'projects_org_key') throw error;
        }
      }
      if (projectId === null) {
        throw new RestRefusal(
          'Could not allocate a free project key; retry the request',
          409,
          'PROJECT_KEY_TAKEN',
        );
      }
      const project = await loadProjectOrThrow(deps.sql, projectId);
      return c.json({ project: projectPayload(project) }, 201);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.get('/projects/:id', noQuery, async (c) => {
    const auth = await restProjectAuth(deps.sql, c);
    const project = await loadVisibleProject(c, auth, c.req.param('id'));
    if (project instanceof Response) return project;
    return c.json({ project: projectPayload(project) });
  });

  /** PATCH /projects/{id} `{archived}` — archive or restore, the app's
   * admin-only lifecycle toggle (the threads PATCH precedent); a no-op
   * when the project already is what the body says. */
  app.patch('/projects/:id', async (c) => {
    const body = await parseBody(c, projectPatchBody);
    if (body instanceof Response) return body;
    try {
      const auth = await restProjectAuth(deps.sql, c);
      const project = await loadVisibleProject(c, auth, c.req.param('id'));
      if (project instanceof Response) return project;
      requireAdmin(c);
      await transactSerializable(deps.sql, (tx) =>
        body.archived
          ? archiveProject(tx, auth, project.id)
          : restoreProject(tx, auth, project.id),
      );
      return c.json({
        project: projectPayload(await loadProjectOrThrow(deps.sql, project.id)),
      });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  /**
   * DELETE /projects/{id} — the app's project delete, admin only: `cascade`
   * (the default) destroys the project's content the way the dialog does —
   * documents expire into the retention pipeline, the caller's own threads
   * are trashed, tasks are retired with their runs — and `detach` releases
   * documents and threads instead; agents and folders go with the row
   * either way. The dialog's confirmation phrase is the project's name,
   * which the door supplies itself (the request names the project by id).
   * A cascade is charged against the per-user `project:delete-cascade`
   * budget the app charges too. A bound automation, a protected record or
   * a legal hold refuses the whole delete as a 409, before anything is
   * written. The `mode` rides in an optional body because no write on this
   * door reads a query parameter.
   */
  app.delete('/projects/:id', async (c) => {
    const body = await parseBody(c, projectDeleteBody, { optional: true });
    if (body instanceof Response) return body;
    const mode = body.mode ?? 'cascade';
    try {
      const auth = await restProjectAuth(deps.sql, c);
      const project = await loadVisibleProject(c, auth, c.req.param('id'));
      if (project instanceof Response) return project;
      requireAdmin(c);
      if (mode === 'cascade') {
        const limited = await chargeLane(deps.sql, c, 'project:delete-cascade');
        if (limited) return limited;
      }
      await transactSerializable(deps.sql, (tx) =>
        deleteProject(tx, auth, {
          projectId: project.id,
          mode,
          ...(mode === 'cascade' ? { confirmPhrase: project.name } : {}),
        }),
      );
      return c.body(null, 204);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  // ---- project agents -------------------------------------------------------
  app.get('/projects/:id/agents', noQuery, async (c) => {
    try {
      const auth = await restProjectAuth(deps.sql, c);
      const project = await loadVisibleProject(c, auth, c.req.param('id'));
      if (project instanceof Response) return project;
      return c.json({
        agents: await listProjectAgents(deps.sql, auth, project.id),
      });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  // An unknown secret NAME is refused here (`PROJECT_AGENT_SECRET_UNKNOWN`,
  // naming it), where the app dialog prunes it: an unattended caller has no
  // dialog to notice a grant that quietly vanished, and every other
  // equipment field on this door is already refused by name.
  app.post('/projects/:id/agents', async (c) => {
    const body = await parseBody(c, projectAgentBody);
    if (body instanceof Response) return body;
    try {
      const auth = await restProjectAuth(deps.sql, c);
      const project = await loadEditableProject(c, auth, c.req.param('id'));
      if (project instanceof Response) return project;
      const agent = await transactSerializable(deps.sql, async (tx) => {
        const id = await createProjectAgent(tx, auth, {
          ...body,
          projectId: project.id,
          unknownSecrets: 'refuse',
        });
        return getProjectAgent(tx, auth, project.id, id);
      });
      return c.json({ agent }, 201);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.get('/projects/:id/agents/:agentId', noQuery, async (c) => {
    try {
      const auth = await restProjectAuth(deps.sql, c);
      const project = await loadVisibleProject(c, auth, c.req.param('id'));
      if (project instanceof Response) return project;
      const agent = await getProjectAgent(
        deps.sql,
        auth,
        project.id,
        c.req.param('agentId'),
      );
      if (agent === null)
        return notFound(c, 'Agent not found', 'PROJECT_AGENT_NOT_FOUND');
      return c.json({ agent });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  /** A full replace with an optimistic precondition: `expectedUpdatedAt`
   * (the `updatedAt` last read) is compared inside the serializable
   * transaction, so two writers cannot silently clobber each other. */
  app.put('/projects/:id/agents/:agentId', async (c) => {
    const body = await parseBody(c, projectAgentUpdateBody);
    if (body instanceof Response) return body;
    try {
      const auth = await restProjectAuth(deps.sql, c);
      const project = await loadEditableProject(c, auth, c.req.param('id'));
      if (project instanceof Response) return project;
      const agentId = c.req.param('agentId');
      const agent = await transactSerializable(deps.sql, async (tx) => {
        if ((await getProjectAgent(tx, auth, project.id, agentId)) === null)
          return null;
        await updateProjectAgent(tx, auth, {
          ...body,
          agentId,
          unknownSecrets: 'refuse',
        });
        return getProjectAgent(tx, auth, project.id, agentId);
      });
      if (agent === null)
        return notFound(c, 'Agent not found', 'PROJECT_AGENT_NOT_FOUND');
      return c.json({ agent });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.delete('/projects/:id/agents/:agentId', async (c) => {
    try {
      const auth = await restProjectAuth(deps.sql, c);
      const project = await loadEditableProject(c, auth, c.req.param('id'));
      if (project instanceof Response) return project;
      const agentId = c.req.param('agentId');
      const deleted = await transactSerializable(deps.sql, async (tx) => {
        if ((await getProjectAgent(tx, auth, project.id, agentId)) === null)
          return false;
        await deleteProjectAgent(tx, auth, agentId);
        return true;
      });
      if (!deleted)
        return notFound(c, 'Agent not found', 'PROJECT_AGENT_NOT_FOUND');
      return c.body(null, 204);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  // ---- folders --------------------------------------------------------------
  app.get('/projects/:id/folders', noQuery, async (c) => {
    const auth = await restProjectAuth(deps.sql, c);
    const project = await loadVisibleProject(c, auth, c.req.param('id'));
    if (project instanceof Response) return project;
    try {
      const folders = await listFolders(deps.sql, auth, {
        projectId: project.id,
        parentId: null,
      });
      return c.json({
        folders: folders.map((folder) => ({
          id: folder.id,
          name: folder.name,
        })),
      });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  /** GET-OR-CREATE: a same-name sibling (compared without regard to case,
   * the sibling rule) under the same parent answers 200 `{folder, created:
   * false}` with the stored spelling; otherwise 201 `{folder, created:
   * true}`. */
  app.post('/projects/:id/folders', async (c) => {
    const body = await parseBody(c, folderBody);
    if (body instanceof Response) return body;
    try {
      const auth = await restProjectAuth(deps.sql, c);
      const project = await loadEditableProject(c, auth, c.req.param('id'));
      if (project instanceof Response) return project;
      // The per-org budget the in-app folder actions share, on top of the
      // general lane — the spec and the rate-limits page promise it.
      const limited = await chargeOrgRateLimit(
        deps.sql,
        c,
        'folder:mutate',
        c.get('organizationId'),
      );
      if (limited) return limited;
      const result = await deps.sql.begin(async (tx) => {
        await lockRestProjectForWrite(tx, auth, project.id);
        return getOrCreateProjectFolder(tx, auth, {
          projectId: project.id,
          name: body.name,
          ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
        });
      });
      const payload = {
        folder: { id: result.folderId, name: result.name },
        created: result.created,
      };
      return c.json(payload, result.created ? 201 : 200);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  // ---- uploads (mint) --------------------------------------------------------
  app.post('/projects/:id/uploads', async (c) => {
    const limited = await chargeLane(deps.sql, c, 'rest:upload');
    if (limited) return limited;
    const body = await parseBody(
      c,
      z
        .object({
          // A hint, checked against the bind's own rules so a bad name —
          // or a type the policy refuses — fails here, before the bytes
          // are uploaded, rather than at the bind.
          fileName: fileNameSchema.optional(),
          contentType: z.string().max(255).optional(),
        })
        .strict(),
      { optional: true },
    );
    if (body instanceof Response) return body;
    try {
      // Gate BEFORE presigning: refusing after would hand the caller a
      // signed PUT no intent row tracks.
      const auth = await restProjectAuth(deps.sql, c);
      const project = await loadEditableProject(c, auth, c.req.param('id'));
      if (project instanceof Response) return project;
      // The type half of the bind's upload policy runs on the name the
      // caller declared: the same 400s (`UPLOAD_POLICY_REJECTED`,
      // `UNSUPPORTED_FILE_TYPE`) the bind answers, before any bytes travel
      // — a refused blob used to sit in the bucket until the sweep.
      if (body.fileName !== undefined) {
        await assertUploadTypeAllowedForOrg(deps.sql, auth, {
          fileName: body.fileName,
          ...(body.contentType !== undefined
            ? { contentType: body.contentType }
            : {}),
        });
      }
      const uploadId = randomUUID();
      const now = Date.now();
      const expiresAt = now + UPLOAD_INTENT_TTL_MS;
      const handoff = await deps.sql.begin(async (tx) => {
        await lockRestProjectForWrite(tx, auth, project.id);
        // The signed PUT lives exactly as long as the intent: the URL and
        // the `expiresAt` answered beside it are one deadline (the store's
        // default signature was half of it, so a PUT inside the advertised
        // window answered 403 from the bucket).
        const signed = await createRestUploadHandoff(
          deps.sql,
          { organizationId: c.get('organizationId') },
          {
            ...(body.contentType !== undefined
              ? { contentType: body.contentType }
              : {}),
            expiresInSec: UPLOAD_INTENT_TTL_MS / 1000,
          },
        );
        await tx`
          INSERT INTO app.rest_upload_intents (
            id, org_id, user_id, project_id, s3_ref, expires_at_ms,
            created_at_ms
          ) VALUES (
            ${uploadId}, ${c.get('organizationId')}, ${c.get('userId')},
            ${project.id}, ${signed.storageRef}, ${expiresAt}, ${now}
          )
        `;
        return signed;
      });
      // Lazy sweep of dead handshakes (consumed) and ABANDONED uploads (never
      // bound: their blob is reclaimed with the row — the intent is the only
      // record the bytes exist).
      await sweepUploadIntents(deps.sql, {
        organizationId: c.get('organizationId'),
        ledger: 'app.rest_upload_intents',
      });
      return c.json({
        uploadId,
        url: handoff.uploadUrl,
        method: 'PUT',
        s3Ref: handoff.storageRef,
        expiresAt,
      });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  // ---- files (bind + list + content) ------------------------------------------
  app.post('/projects/:id/files', async (c) => {
    const limited = await chargeLane(deps.sql, c, 'rest:upload');
    if (limited) return limited;
    const body = await parseBody(
      c,
      z
        .object({
          uploadId: z.string().min(1).max(64),
          fileId: z.string().min(1).max(2048),
          folderId: z.string().min(1).max(64),
          fileName: fileNameSchema,
          contentType: z.string().max(255).optional(),
          skipRagIndexing: z.boolean().optional(),
        })
        .strict(),
    );
    if (body instanceof Response) return body;
    try {
      const auth = await restProjectAuth(deps.sql, c);
      const project = await loadEditableProject(c, auth, c.req.param('id'));
      if (project instanceof Response) return project;
      // ONE transaction: the intent is consumed atomically with the
      // register + document create — any refusal rolls the consume back.
      const documentId = await deps.sql.begin(async (tx) => {
        await lockRestProjectForWrite(tx, auth, project.id);
        // The intent is looked up by its handle inside the caller's own
        // scope (a foreign one stays opaque), then judged: consumed and
        // expired are the intent's fault (mint a new one — UPLOAD_INTENT_
        // INVALID), a blob other than the one it was minted for is the
        // caller's plumbing (UPLOAD_FILE_MISMATCH). One UPDATE used to
        // fold every case into one sentence.
        const now = Date.now();
        const intents = await tx<
          {
            id: string;
            s3Ref: string;
            consumedAt: number | null;
            expiresAt: number;
          }[]
        >`
          SELECT id, s3_ref AS "s3Ref", consumed_at_ms AS "consumedAt",
                 expires_at_ms::float8 AS "expiresAt"
          FROM app.rest_upload_intents
          WHERE id = ${body.uploadId}
            AND org_id = ${c.get('organizationId')}
            AND user_id = ${c.get('userId')}
            AND project_id = ${project.id}
          LIMIT 1
          FOR UPDATE
        `;
        const intent = intents[0];
        if (intent === undefined) {
          throw new RestRefusal(
            'Unknown uploadId for this project — mint a new upload handoff',
            409,
            'UPLOAD_INTENT_INVALID',
          );
        }
        if (intent.consumedAt !== null) {
          throw new RestRefusal(
            'This uploadId was already used — mint a new upload handoff',
            409,
            'UPLOAD_INTENT_INVALID',
          );
        }
        if (intent.expiresAt <= now) {
          throw new RestRefusal(
            'This uploadId expired — mint a new upload handoff and upload again',
            409,
            'UPLOAD_INTENT_INVALID',
          );
        }
        if (intent.s3Ref !== body.fileId) {
          throw new RestRefusal(
            'fileId is not the s3Ref this uploadId was minted for',
            409,
            'UPLOAD_FILE_MISMATCH',
          );
        }
        await tx`
          UPDATE app.rest_upload_intents SET consumed_at_ms = ${now}
          WHERE id = ${intent.id}
        `;
        // HEAD → policy → row, in that order — the same choreography as the
        // session bind lane. The org's upload policy — the `file:upload`
        // budget, the size caps, the MIME/extension allowlists, the
        // per-user volume quota — gates the landed bytes with their
        // AUTHORITATIVE size (the HEAD), and it must run BEFORE the
        // metadata row exists: the volume quota sums `app.file_metadata`
        // on this same transaction, so a row written first would count the
        // file twice. A refusal rolls the whole consume back. The caller's
        // declared type is a hint the gate resolves against the file name,
        // so the row is written with the resolved one.
        const stat = await statOrgBlob(
          deps.sql,
          c.get('organizationId'),
          body.fileId,
        );
        if (stat === null) {
          throw new FileError('BLOB_NOT_FOUND', 'Blob was not uploaded', 404);
        }
        const validated = await validateDocumentUploadForOrg(tx, auth, {
          fileName: body.fileName,
          ...(body.contentType !== undefined
            ? { contentType: body.contentType }
            : {}),
          size: stat.size,
        });
        const registered = await registerUpload(
          deps.sql,
          tx,
          {
            organizationId: c.get('organizationId'),
            userId: c.get('userId'),
          },
          {
            storageRef: body.fileId,
            fileName: body.fileName,
            contentType: validated.contentType,
            source: 'rest',
          },
          // Ownership was proven by the `rest_upload_intents` consume above,
          // in this same transaction.
          { kind: 'external' },
        );
        const created = await createDocumentFromUpload(tx, auth, {
          fileId: registered.fileId,
          fileName: body.fileName,
          projectId: project.id,
          folderId: body.folderId,
        });
        // Project working material is NOT org knowledge by default: an
        // explicit `false` opts back into RAG indexing (0.4 parity). The
        // create core queued the index job; a default/true skip persists
        // the opt-out and the job's own guard drops it.
        const skipRagIndexing = body.skipRagIndexing ?? true;
        if (skipRagIndexing) {
          await tx`
            UPDATE app.file_metadata
            SET skip_rag_indexing = true, rag_status = NULL
            WHERE id = ${registered.fileId}
          `;
        }
        return created;
      });
      return c.json(
        {
          file: {
            id: documentId,
            fileName: body.fileName,
            folderId: body.folderId,
            projectId: project.id,
          },
        },
        201,
      );
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.get('/projects/:id/files', async (c) => {
    const query = readQuery(c, {
      ...PAGE_QUERY,
      folderId: queryFilter(128).optional(),
    });
    if (query instanceof Response) return query;
    const auth = await restProjectAuth(deps.sql, c);
    const project = await loadVisibleProject(c, auth, c.req.param('id'));
    if (project instanceof Response) return project;
    const folderId = query.folderId;
    const limit = readPageLimit(c, { fallback: 25, max: 100 });
    if (limit instanceof Response) return limit;
    const cursor = readKeysetCursor(c, `files:${project.id}`);
    if (cursor instanceof Response) return cursor;
    const cursorCreatedAt = cursor?.at ?? null;
    const cursorId = cursor?.id ?? null;
    if (folderId !== undefined) {
      const folders = await deps.sql<{ id: string }[]>`
        SELECT id FROM app.folders
        WHERE id = ${folderId} AND project_id = ${project.id}
          AND org_id = ${c.get('organizationId')}
        LIMIT 1
      `;
      if (folders.length === 0) {
        return notFound(c, 'Folder not found', 'FOLDER_NOT_FOUND');
      }
    }
    const rows = await deps.sql<
      {
        id: string;
        fileName: string | null;
        folderId: string | null;
        mimeType: string | null;
        createdAt: number;
      }[]
    >`
      SELECT id, title AS "fileName", folder_id AS "folderId",
             mime_type AS "mimeType", created_at_ms::float8 AS "createdAt"
      FROM app.documents
      WHERE org_id = ${c.get('organizationId')}
        AND project_id = ${project.id}
        AND (lifecycle_status IS NULL OR lifecycle_status = 'active')
        AND (${folderId ?? null}::text IS NULL
          OR folder_id = ${folderId ?? null})
        AND (${cursorCreatedAt}::bigint IS NULL
          OR created_at_ms < ${cursorCreatedAt}
          OR (created_at_ms = ${cursorCreatedAt} AND id < ${cursorId}))
      ORDER BY created_at_ms DESC, id DESC
      LIMIT ${limit + 1}
    `;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const isDone = !(rows.length > limit && last);
    return c.json({
      files: page,
      isDone,
      ...(isDone || !last
        ? {}
        : {
            cursor: mintCursor(
              c,
              `files:${project.id}`,
              formatKeysetCursor(last.createdAt, last.id),
            ),
          }),
    });
  });

  /** Delete a project file — permanently: the document row, its corpus
   * rows and its blob, through the same purge every hard-delete lane
   * funnels through (controlled-record protection, legal holds, the audit
   * row). Editors of an active project; a document outside the project,
   * without a file, trashed, or absent answers the same opaque 404. */
  app.delete('/projects/:id/files/:documentId', async (c) => {
    try {
      const auth = await restProjectAuth(deps.sql, c);
      const project = await loadEditableProject(c, auth, c.req.param('id'));
      if (project instanceof Response) return project;
      let doc: DocumentRow;
      try {
        doc = await loadDocumentOrThrow(deps.sql, c.req.param('documentId'));
      } catch (error) {
        if (error instanceof DocumentError && error.status === 404) {
          return notFound(c, 'File not found', 'FILE_NOT_FOUND');
        }
        throw error;
      }
      if (
        doc.organizationId !== c.get('organizationId') ||
        doc.projectId !== project.id ||
        doc.fileRef === null ||
        (doc.lifecycleStatus !== null && doc.lifecycleStatus !== 'active')
      ) {
        return notFound(c, 'File not found', 'FILE_NOT_FOUND');
      }
      await deleteDocumentHard(deps.sql, auth, doc.id);
      return c.body(null, 204);
    } catch (error) {
      return documentDeleteRefusal(c, error);
    }
  });

  /** Delete a project folder WITH everything beneath it — the app's own
   * cascade: every descendant file is purged (corpus rows released at
   * once, so project search stops matching them), then the subtree goes.
   * Editors of an active project, on the per-org `folder:mutate` budget
   * the in-app folder actions share; a folder of another project or
   * organization answers the same opaque 404. */
  app.delete('/projects/:id/folders/:folderId', async (c) => {
    try {
      const auth = await restProjectAuth(deps.sql, c);
      const project = await loadEditableProject(c, auth, c.req.param('id'));
      if (project instanceof Response) return project;
      const limited = await chargeOrgRateLimit(
        deps.sql,
        c,
        'folder:mutate',
        c.get('organizationId'),
      );
      if (limited) return limited;
      let folder: FolderRow;
      try {
        folder = await loadFolderOrThrow(deps.sql, c.req.param('folderId'));
      } catch (error) {
        if (error instanceof FolderError && error.status === 404) {
          return notFound(c, 'Folder not found', 'FOLDER_NOT_FOUND');
        }
        throw error;
      }
      if (
        folder.organizationId !== c.get('organizationId') ||
        folder.projectId !== project.id
      ) {
        return notFound(c, 'Folder not found', 'FOLDER_NOT_FOUND');
      }
      await deleteFolderCascade(deps.sql, auth, folder.id);
      return c.body(null, 204);
    } catch (error) {
      return documentDeleteRefusal(c, error);
    }
  });

  /** The result lane: the bytes themselves, streamed from the object store
   * with the document's title as the download name (RFC 6266) — the
   * document must belong to the project and be visible to the minting
   * user; everything else is the same opaque 404. `Range` is honoured
   * (206/416) and HEAD answers the metadata alone. This used to be a 302
   * to a presigned URL on the platform's own origin: every conforming
   * client re-sent its bearer across the same-origin hop, the store
   * refused the two authentications, and `curl -L -o` wrote that
   * refusal into the file with exit status 0. */
  app.get('/projects/:id/files/:documentId/content', noQuery, async (c) => {
    const auth = await restProjectAuth(deps.sql, c);
    const project = await loadVisibleProject(c, auth, c.req.param('id'));
    if (project instanceof Response) return project;
    let doc: DocumentRow;
    try {
      doc = await loadDocumentOrThrow(deps.sql, c.req.param('documentId'));
    } catch (error) {
      if (error instanceof DocumentError && error.status === 404) {
        return notFound(c, 'File not found', 'FILE_NOT_FOUND');
      }
      throw error;
    }
    if (
      doc.organizationId !== c.get('organizationId') ||
      doc.projectId !== project.id ||
      doc.fileRef === null ||
      (doc.lifecycleStatus !== null && doc.lifecycleStatus !== 'active')
    ) {
      return notFound(c, 'File not found', 'FILE_NOT_FOUND');
    }
    const range = c.req.header('range');
    let served: FileContent | null;
    try {
      served = await openFileContent(
        deps.sql,
        { organizationId: c.get('organizationId') },
        doc.fileRef,
        {
          head: c.req.method === 'HEAD',
          ...(range === undefined ? {} : { range }),
          signal: c.req.raw.signal,
        },
      );
    } catch (error) {
      if (!(error instanceof FileError)) throw error;
      console.warn(
        '[projects-rest] content serve failed:',
        error instanceof Error ? error.message : String(error),
      );
      if (error.status === 503) {
        return c.json(
          {
            error: 'The object store did not serve the file; retry shortly.',
            code: 'OBJECT_STORE_UNAVAILABLE',
          },
          503,
          { 'retry-after': '5' },
        );
      }
      return notFound(c, 'File not found', 'FILE_NOT_FOUND');
    }
    if (served === null) {
      return notFound(c, 'File not found', 'FILE_NOT_FOUND');
    }
    const headers = new Headers();
    for (const name of [
      'content-type',
      'content-length',
      'content-range',
      'etag',
      'last-modified',
      'accept-ranges',
    ]) {
      const value = served.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/octet-stream');
    }
    if (!headers.has('accept-ranges')) headers.set('accept-ranges', 'bytes');
    // Object keys are nameless (`<org>/<uuid>`); the document's title is
    // the filename the documented Content-Disposition carries. The bytes
    // are user-uploaded, so they never render as a document on this
    // origin: attachment + nosniff, as every blob lane.
    headers.set(
      'content-disposition',
      attachmentDisposition(doc.title ?? 'download'),
    );
    headers.set('x-content-type-options', 'nosniff');
    headers.set('cache-control', 'private, no-store');
    return new Response(served.body, { status: served.status, headers });
  });

  return app;
}
