import { randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { projectAgentInputSchema } from '../../lib/shared/schemas/projects.ts';
import {
  createDocumentFromUpload,
  DocumentError,
  loadDocumentOrThrow,
  validateDocumentUploadForOrg,
  type DocumentRow,
} from '../domains/documents/service.ts';
import {
  createRestUploadHandoff,
  FileError,
  getFileUrl,
  registerUpload,
  statOrgBlob,
} from '../domains/files/service.ts';
import { sweepUploadIntents } from '../domains/files/upload-intents.ts';
import {
  getOrCreateProjectFolder,
  listFolders,
} from '../domains/folders/service.ts';
import {
  assertReadable,
  createProject,
  createProjectAgent,
  deleteProjectAgent,
  getProjectAgent,
  getProjectByExternalItemId,
  listProjectAgents,
  loadProjectOrThrow,
  updateProjectAgent,
  type ProjectAuthContext,
  type ProjectRow,
} from '../domains/projects/service.ts';
import { chargeOrgRateLimit } from '../lib/rate-limit-response.ts';
import {
  assertExplicitOrg,
  chargeLane,
  domainErrorResponse,
  formatKeysetCursor,
  invalidBodyResponse,
  loadRestProject,
  lockRestProjectForWrite,
  readJsonBody,
  readKeysetCursor,
  readOptionalJsonBody,
  readPageLimit,
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
const projectAgentBody = projectAgentInputSchema.strict();

function projectPayload(project: ProjectRow): Record<string, unknown> {
  return {
    id: project.id,
    name: project.name,
    key: project.key ?? undefined,
    description: project.description ?? undefined,
    externalItemId: project.externalItemId ?? undefined,
    archivedAt: project.archivedAt ?? undefined,
  };
}

export function createProjectRestRoutes(deps: { sql: Sql }): Hono<RestEnv> {
  const app = new Hono<RestEnv>();

  // Org-strict middleware, scoped to THIS family's paths (an unscoped
  // `use` would leak onto every sibling family mounted beside this one).
  const orgStrict = async (
    c: Context<RestEnv>,
    next: () => Promise<void>,
  ): Promise<Response | void> => {
    const ambiguous = await assertExplicitOrg(deps.sql, c);
    if (ambiguous) return ambiguous;
    return next();
  };
  app.use('/projects', orgStrict);
  app.use('/projects/*', orgStrict);

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
   * GET /projects?externalItemId=… — a lookup door, not a list-all: the
   * query parameter is REQUIRED; an invisible match answers the same empty
   * list as no match.
   */
  app.get('/projects', async (c) => {
    const externalItemId = c.req.query('externalItemId')?.trim();
    if (!externalItemId) {
      return c.json(
        { error: 'The "externalItemId" query parameter is required' },
        400,
      );
    }
    const project = await getProjectByExternalItemId(
      deps.sql,
      c.get('organizationId'),
      externalItemId,
    );
    if (project === null) return c.json({ projects: [] });
    const auth = await restProjectAuth(deps.sql, c);
    try {
      assertReadable(project, auth);
    } catch {
      return c.json({ projects: [] });
    }
    return c.json({ projects: [projectPayload(project)] });
  });

  app.post('/projects', async (c) => {
    const body = z
      .object({
        name: z.string().min(1).max(80),
        key: z.string().max(32).optional(),
        description: z.string().max(500).optional(),
        externalItemId: z.string().max(256).optional(),
      })
      .strict()
      .safeParse(await readJsonBody(c));
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
    }
    try {
      requireEditor(c);
      const auth = await restProjectAuth(deps.sql, c);
      const projectId = await deps.sql.begin((tx) =>
        createProject(tx, auth, body.data),
      );
      const project = await loadProjectOrThrow(deps.sql, projectId);
      return c.json({ project: projectPayload(project) }, 201);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.get('/projects/:id', async (c) => {
    const auth = await restProjectAuth(deps.sql, c);
    const project = await loadVisibleProject(c, auth, c.req.param('id'));
    if (project instanceof Response) return project;
    return c.json({ project: projectPayload(project) });
  });

  // ---- project agents -------------------------------------------------------
  app.get('/projects/:id/agents', async (c) => {
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

  app.post('/projects/:id/agents', async (c) => {
    const body = projectAgentBody.safeParse(await readJsonBody(c));
    if (!body.success) return invalidBodyResponse(c, body.error);
    try {
      const auth = await restProjectAuth(deps.sql, c);
      const project = await loadEditableProject(c, auth, c.req.param('id'));
      if (project instanceof Response) return project;
      const agent = await transactSerializable(deps.sql, async (tx) => {
        const id = await createProjectAgent(tx, auth, {
          ...body.data,
          projectId: project.id,
        });
        return getProjectAgent(tx, auth, project.id, id);
      });
      return c.json({ agent }, 201);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.get('/projects/:id/agents/:agentId', async (c) => {
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
      if (agent === null) return c.json({ error: 'Agent not found' }, 404);
      return c.json({ agent });
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  app.put('/projects/:id/agents/:agentId', async (c) => {
    const body = projectAgentBody.safeParse(await readJsonBody(c));
    if (!body.success) return invalidBodyResponse(c, body.error);
    try {
      const auth = await restProjectAuth(deps.sql, c);
      const project = await loadEditableProject(c, auth, c.req.param('id'));
      if (project instanceof Response) return project;
      const agentId = c.req.param('agentId');
      const agent = await transactSerializable(deps.sql, async (tx) => {
        if ((await getProjectAgent(tx, auth, project.id, agentId)) === null)
          return null;
        await updateProjectAgent(tx, auth, { ...body.data, agentId });
        return getProjectAgent(tx, auth, project.id, agentId);
      });
      if (agent === null) return c.json({ error: 'Agent not found' }, 404);
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
      if (!deleted) return c.json({ error: 'Agent not found' }, 404);
      return c.body(null, 204);
    } catch (error) {
      return domainErrorResponse(c, error);
    }
  });

  // ---- folders --------------------------------------------------------------
  app.get('/projects/:id/folders', async (c) => {
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

  /** GET-OR-CREATE: an exact-name match under the same parent answers 200
   * `{folder, created: false}`; otherwise 201 `{folder, created: true}`. */
  app.post('/projects/:id/folders', async (c) => {
    const body = z
      .object({
        name: z.string().min(1).max(255),
        parentId: z.string().max(64).optional(),
      })
      .strict()
      .safeParse(await readJsonBody(c));
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
    }
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
          name: body.data.name,
          ...(body.data.parentId !== undefined
            ? { parentId: body.data.parentId }
            : {}),
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
    const body = z
      .object({
        fileName: z.string().max(1024).optional(),
        contentType: z.string().max(255).optional(),
      })
      .strict()
      .safeParse(await readOptionalJsonBody(c));
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
    }
    try {
      // Gate BEFORE presigning: refusing after would hand the caller a
      // signed PUT no intent row tracks.
      const auth = await restProjectAuth(deps.sql, c);
      const project = await loadEditableProject(c, auth, c.req.param('id'));
      if (project instanceof Response) return project;
      const uploadId = randomUUID();
      const now = Date.now();
      const expiresAt = now + UPLOAD_INTENT_TTL_MS;
      const handoff = await deps.sql.begin(async (tx) => {
        await lockRestProjectForWrite(tx, auth, project.id);
        const signed = await createRestUploadHandoff(
          deps.sql,
          { organizationId: c.get('organizationId') },
          body.data.contentType !== undefined
            ? { contentType: body.data.contentType }
            : {},
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
    const body = z
      .object({
        uploadId: z.string().min(1).max(64),
        fileId: z.string().min(1).max(2048),
        folderId: z.string().min(1).max(64),
        fileName: z.string().min(1).max(1024),
        contentType: z.string().max(255).optional(),
        skipRagIndexing: z.boolean().optional(),
      })
      .strict()
      .safeParse(await readJsonBody(c));
    if (!body.success) {
      return invalidBodyResponse(c, body.error);
    }
    try {
      const auth = await restProjectAuth(deps.sql, c);
      const project = await loadEditableProject(c, auth, c.req.param('id'));
      if (project instanceof Response) return project;
      // ONE transaction: the intent is consumed atomically with the
      // register + document create — any refusal rolls the consume back.
      const documentId = await deps.sql.begin(async (tx) => {
        await lockRestProjectForWrite(tx, auth, project.id);
        const consumed = await tx<{ id: string }[]>`
          UPDATE app.rest_upload_intents SET consumed_at_ms = ${Date.now()}
          WHERE id = ${body.data.uploadId}
            AND org_id = ${c.get('organizationId')}
            AND user_id = ${c.get('userId')}
            AND project_id = ${project.id}
            AND s3_ref = ${body.data.fileId}
            AND consumed_at_ms IS NULL
            AND expires_at_ms > ${Date.now()}
          RETURNING id
        `;
        if (consumed.length === 0) {
          throw new RestRefusal(
            'Unknown, expired, or already-used uploadId for this blob.',
            409,
          );
        }
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
          body.data.fileId,
        );
        if (stat === null) {
          throw new FileError('BLOB_NOT_FOUND', 'Blob was not uploaded', 404);
        }
        const validated = await validateDocumentUploadForOrg(tx, auth, {
          fileName: body.data.fileName,
          ...(body.data.contentType !== undefined
            ? { contentType: body.data.contentType }
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
            storageRef: body.data.fileId,
            fileName: body.data.fileName,
            contentType: validated.contentType,
            source: 'rest',
          },
          // Ownership was proven by the `rest_upload_intents` consume above,
          // in this same transaction.
          { kind: 'external' },
        );
        const created = await createDocumentFromUpload(tx, auth, {
          fileId: registered.fileId,
          fileName: body.data.fileName,
          projectId: project.id,
          folderId: body.data.folderId,
        });
        // Project working material is NOT org knowledge by default: an
        // explicit `false` opts back into RAG indexing (0.4 parity). The
        // create core queued the index job; a default/true skip persists
        // the opt-out and the job's own guard drops it.
        const skipRagIndexing = body.data.skipRagIndexing ?? true;
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
            fileName: body.data.fileName,
            folderId: body.data.folderId,
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
    const auth = await restProjectAuth(deps.sql, c);
    const project = await loadVisibleProject(c, auth, c.req.param('id'));
    if (project instanceof Response) return project;
    const folderId = c.req.query('folderId')?.trim() || undefined;
    const limit = readPageLimit(c, { fallback: 25, max: 100 });
    if (limit instanceof Response) return limit;
    const cursor = readKeysetCursor(c);
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
        return c.json({ error: 'Folder not found' }, 404);
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
    return c.json({
      files: page,
      ...(rows.length > limit && last
        ? { cursor: formatKeysetCursor(last.createdAt, last.id) }
        : {}),
    });
  });

  /** The result lane: a 302 to a short-lived presigned GET (every 0.5 blob
   * is S3-backed) — the document must belong to the project and be visible
   * to the minting user; everything else is the same opaque 404. */
  app.get('/projects/:id/files/:documentId/content', async (c) => {
    const auth = await restProjectAuth(deps.sql, c);
    const project = await loadVisibleProject(c, auth, c.req.param('id'));
    if (project instanceof Response) return project;
    let doc: DocumentRow;
    try {
      doc = await loadDocumentOrThrow(deps.sql, c.req.param('documentId'));
    } catch (error) {
      if (error instanceof DocumentError && error.status === 404) {
        return c.json({ error: 'File not found' }, 404);
      }
      throw error;
    }
    if (
      doc.organizationId !== c.get('organizationId') ||
      doc.projectId !== project.id ||
      doc.fileRef === null ||
      (doc.lifecycleStatus !== null && doc.lifecycleStatus !== 'active')
    ) {
      return c.json({ error: 'File not found' }, 404);
    }
    let presigned: string;
    try {
      // Object keys are nameless (`<org>/<uuid>`); the document's title is
      // the filename the documented Content-Disposition carries.
      presigned = await getFileUrl(
        deps.sql,
        { organizationId: c.get('organizationId') },
        doc.fileRef,
        doc.title !== null ? { filename: doc.title } : {},
      );
    } catch (error) {
      if (!(error instanceof FileError)) throw error;
      console.warn(
        '[projects-rest] refused content serve:',
        error instanceof Error ? error.message : String(error),
      );
      return c.json({ error: 'File not found' }, 404);
    }
    return c.body(null, 302, { location: presigned });
  });

  return app;
}
