import { randomUUID } from 'node:crypto';

import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import {
  createDocumentFromUpload,
  loadDocumentOrThrow,
  type DocumentRow,
} from '../domains/documents/service.ts';
import {
  createRestUploadHandoff,
  getFileUrl,
  registerUpload,
} from '../domains/files/service.ts';
import {
  getOrCreateProjectFolder,
  listFolders,
} from '../domains/folders/service.ts';
import {
  assertReadable,
  createProject,
  getProjectByExternalItemId,
  loadProjectOrThrow,
  type ProjectAuthContext,
  type ProjectRow,
} from '../domains/projects/service.ts';
import {
  assertExplicitOrg,
  chargeLane,
  domainErrorResponse,
  requireEditor,
  restProjectAuth,
  RestRefusal,
  type RestEnv,
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
    let project: ProjectRow;
    try {
      project = await loadProjectOrThrow(deps.sql, projectId);
      assertReadable(project, auth);
    } catch {
      return c.json({ error: 'Project not found' }, 404);
    }
    if (project.organizationId !== c.get('organizationId')) {
      return c.json({ error: 'Project not found' }, 404);
    }
    return project;
  };

  /** Write preamble: editor role, then project EDIT access. */
  const loadEditableProject = async (
    c: Context<RestEnv>,
    auth: ProjectAuthContext,
    projectId: string,
  ): Promise<ProjectRow | Response> => {
    requireEditor(c);
    const project = await loadVisibleProject(c, auth, projectId);
    if (project instanceof Response) return project;
    if (project.archivedAt !== null) {
      return c.json(
        { error: 'You do not have permission to modify this project' },
        403,
      );
    }
    return project;
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
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body ("name" is required)' }, 400);
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
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body ("name" is required)' }, 400);
    }
    try {
      const auth = await restProjectAuth(deps.sql, c);
      const project = await loadEditableProject(c, auth, c.req.param('id'));
      if (project instanceof Response) return project;
      const result = await deps.sql.begin((tx) =>
        getOrCreateProjectFolder(tx, auth, {
          projectId: project.id,
          name: body.data.name,
          ...(body.data.parentId !== undefined
            ? { parentId: body.data.parentId }
            : {}),
        }),
      );
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
      .safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      // Gate BEFORE presigning: refusing after would hand the caller a
      // signed PUT no intent row tracks.
      const auth = await restProjectAuth(deps.sql, c);
      const project = await loadEditableProject(c, auth, c.req.param('id'));
      if (project instanceof Response) return project;
      const handoff = await createRestUploadHandoff(
        deps.sql,
        { organizationId: c.get('organizationId') },
        body.data.contentType !== undefined
          ? { contentType: body.data.contentType }
          : {},
      );
      const uploadId = randomUUID();
      const now = Date.now();
      const expiresAt = now + UPLOAD_INTENT_TTL_MS;
      await deps.sql`
        INSERT INTO app.rest_upload_intents (
          id, org_id, user_id, project_id, s3_ref, expires_at_ms,
          created_at_ms
        ) VALUES (
          ${uploadId}, ${c.get('organizationId')}, ${c.get('userId')},
          ${project.id}, ${handoff.storageRef}, ${expiresAt}, ${now}
        )
      `;
      // Lazy sweep of dead handshakes (consumed, or expired a day ago).
      await deps.sql`
        DELETE FROM app.rest_upload_intents
        WHERE org_id = ${c.get('organizationId')}
          AND (consumed_at_ms IS NOT NULL
            OR expires_at_ms < ${now - 24 * 3_600_000})
      `;
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
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await restProjectAuth(deps.sql, c);
      const project = await loadEditableProject(c, auth, c.req.param('id'));
      if (project instanceof Response) return project;
      // ONE transaction: the intent is consumed atomically with the
      // register + document create — any refusal rolls the consume back.
      const documentId = await deps.sql.begin(async (tx) => {
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
            contentType: body.data.contentType ?? 'application/octet-stream',
            source: 'rest',
          },
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
    const limitRaw = Number(c.req.query('limit') ?? '25');
    const limit = Math.min(
      Math.max(Number.isFinite(limitRaw) ? limitRaw : 25, 1),
      100,
    );
    const cursor = c.req.query('cursor') ?? null;
    let cursorCreatedAt: number | null = null;
    let cursorId: string | null = null;
    if (cursor !== null && cursor !== '') {
      const split = cursor.indexOf(':');
      const createdAt = Number(cursor.slice(0, split));
      if (split > 0 && Number.isFinite(createdAt)) {
        cursorCreatedAt = createdAt;
        cursorId = cursor.slice(split + 1);
      }
    }
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
        AND lifecycle_status IS DISTINCT FROM 'trashed'
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
        ? { cursor: `${last.createdAt}:${last.id}` }
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
    } catch {
      return c.json({ error: 'File not found' }, 404);
    }
    if (
      doc.organizationId !== c.get('organizationId') ||
      doc.projectId !== project.id ||
      doc.fileRef === null ||
      doc.lifecycleStatus === 'trashed'
    ) {
      return c.json({ error: 'File not found' }, 404);
    }
    let presigned: string;
    try {
      presigned = await getFileUrl(
        deps.sql,
        { organizationId: c.get('organizationId') },
        doc.fileRef,
      );
    } catch (error) {
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
