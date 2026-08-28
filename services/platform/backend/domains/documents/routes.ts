import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { FileError, getFileUrl } from '../files/service.ts';
import { FolderError } from '../folders/service.ts';
import { LegalHoldError } from '../legal_holds/service.ts';
import {
  getProjectAuthContext,
  ProjectError,
  type ProjectAuthContext,
} from '../projects/service.ts';
import {
  attachDocumentToProject,
  createDocumentFromUpload,
  detachDocumentFromProject,
  DocumentError,
  getDocumentById,
  listDocuments,
  listProjectDocuments,
  searchDocumentsForMention,
  setDocumentTrashed,
  updateDocument,
} from './service.ts';

const createFromUploadSchema = z.object({
  fileId: z.string().min(1),
  fileName: z.string().min(1).max(512),
  teamId: z.string().optional(),
  projectId: z.string().optional(),
  folderId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const updateSchema = z.object({
  title: z.string().max(600).optional(),
  folderId: z.string().nullable().optional(),
  teamId: z.string().nullable().optional(),
});

function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (
    error instanceof DocumentError ||
    error instanceof FolderError ||
    error instanceof FileError ||
    error instanceof ProjectError ||
    error instanceof LegalHoldError
  ) {
    return c.json({ error: error.code }, error.status);
  }
  throw error;
}

/** /api/app/documents — the Document Hub surface. */
export function createDocumentRoutes(deps: {
  sql: Sql;
  auth: Auth;
}): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  const authCtx = (c: Context<OrgEnv>): Promise<ProjectAuthContext> =>
    getProjectAuthContext(
      deps.sql,
      {
        organizationId: c.get('orgId'),
        userId: c.get('sessionBundle').user.id,
        role: c.get('orgMember').role,
      },
      c.get('sessionBundle').user.email,
    );

  app.get('/', async (c) => {
    try {
      const auth = await authCtx(c);
      const folderParam = c.req.query('folderId');
      const folderId =
        folderParam === undefined ? undefined : folderParam || null;
      return c.json({
        documents: await listDocuments(deps.sql, auth, {
          ...(folderId !== undefined ? { folderId } : {}),
          includeTrashed: c.req.query('includeTrashed') === 'true',
        }),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/search', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json({
        documents: await searchDocumentsForMention(
          deps.sql,
          auth,
          c.req.query('q') ?? '',
        ),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/by-project/:projectId', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json({
        documents: await listProjectDocuments(
          deps.sql,
          auth,
          c.req.param('projectId'),
        ),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/from-upload', async (c) => {
    const body = createFromUploadSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      const documentId = await transactSerializable(deps.sql, (tx) =>
        createDocumentFromUpload(tx, auth, body.data),
      );
      return c.json({ documentId });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/:documentId', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json({
        document: await getDocumentById(
          deps.sql,
          auth,
          c.req.param('documentId'),
        ),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/:documentId/url', async (c) => {
    try {
      const auth = await authCtx(c);
      const doc = await getDocumentById(
        deps.sql,
        auth,
        c.req.param('documentId'),
      );
      if (!doc.fileRef) {
        return c.json({ error: 'DOCUMENT_HAS_NO_FILE' }, 404);
      }
      const url = await getFileUrl(
        deps.sql,
        { organizationId: auth.organizationId },
        doc.fileRef,
      );
      return c.json({ url });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:documentId', async (c) => {
    const body = updateSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        updateDocument(tx, auth, {
          documentId: c.req.param('documentId'),
          ...body.data,
        }),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:documentId/trash', async (c) => {
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        setDocumentTrashed(tx, auth, c.req.param('documentId'), true),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:documentId/restore', async (c) => {
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        setDocumentTrashed(tx, auth, c.req.param('documentId'), false),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:documentId/attach-to-project', async (c) => {
    const body = z
      .object({ projectId: z.string().min(1) })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        attachDocumentToProject(tx, auth, {
          documentId: c.req.param('documentId'),
          projectId: body.data.projectId,
        }),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:documentId/detach-from-project', async (c) => {
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        detachDocumentFromProject(tx, auth, c.req.param('documentId')),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
