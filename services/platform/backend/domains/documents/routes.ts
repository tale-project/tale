import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { purgeIncompleteResponse } from '../../lib/purge-incomplete-response.ts';
import {
  rateLimitExceededCause,
  rateLimitedResponse,
} from '../../lib/rate-limit-response.ts';
import { FileError, getFileUrl } from '../files/service.ts';
import { FolderError } from '../folders/service.ts';
import { syncRagDocumentScope } from '../knowledge/service.ts';
import { LegalHoldError } from '../legal_holds/service.ts';
import {
  getProjectAuthContext,
  ProjectError,
  type ProjectAuthContext,
} from '../projects/service.ts';
import { PurgeIncompleteError } from '../retention/service.ts';
import {
  ensureProjectTextDocument,
  readProjectTextValues,
} from './project-text.ts';
import {
  getLastDocumentRecordReview,
  getPendingDocumentRecordReview,
  listEligibleDocumentReviewerIds,
  markControlled,
  openRecordRevision,
  respondToDocumentRecordReview,
  submitRecordForReview,
} from './records.ts';
import {
  beginReplacementUpload,
  cancelReplacementUpload,
  finalizeReplacementUpload,
  getReplacementUploadStatus,
} from './replacement.ts';
import {
  approxCountDocumentsForOrg,
  attachDocumentToProject,
  computeUploadUsageForUser,
  createDocumentFromBlobUpload,
  createDocumentFromUpload,
  deleteDocumentHard,
  detachDocumentFromProject,
  DocumentError,
  getDocumentByExternalItemIdView,
  getDocumentById,
  listDocuments,
  listDocumentVersionsView,
  listHubDocumentsPaginated,
  listProjectDocuments,
  retryRagIndexingForDocument,
  searchDocumentsForMention,
  searchDocumentsView,
  setDocumentTrashed,
  updateDocument,
} from './service.ts';
import { toDocumentItems } from './view.ts';

const projectTextReadSchema = z.object({
  projectId: z.string().min(1).max(128),
  folderName: z.string().max(200),
  fileName: z.string().min(1).max(512),
});

const projectTextWriteSchema = projectTextReadSchema.extend({
  content: z.string().max(1_000_000).optional(),
  yaml: z.record(z.string(), z.string()).optional(),
  contentType: z.string().max(200).optional(),
  externalItemId: z.string().max(512).optional(),
});

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
  teamIds: z.array(z.string().min(1)).max(64).optional(),
});

const createFromBlobUploadSchema = z.object({
  storageRef: z.string().min(1),
  fileName: z.string().min(1).max(512),
  contentType: z.string().max(255).optional(),
  contentHash: z.string().max(128).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  teamId: z.string().optional(),
  projectId: z.string().optional(),
  folderId: z.string().optional(),
  skipRagIndexing: z.boolean().optional(),
});

function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  // A spent budget answers the one 429 every door speaks, whether the
  // limiter threw it here or a service wrapped it as a coded refusal.
  const limited = rateLimitExceededCause(error);
  if (limited !== null) {
    return rateLimitedResponse(c, limited);
  }
  if (error instanceof DocumentError) {
    return c.json(
      {
        error: error.code,
        message: error.message,
        ...(error.data !== undefined ? { data: error.data } : {}),
      },
      error.status,
    );
  }
  if (
    error instanceof FolderError ||
    error instanceof FileError ||
    error instanceof ProjectError ||
    error instanceof LegalHoldError
  ) {
    return c.json({ error: error.code }, error.status);
  }
  if (error instanceof PurgeIncompleteError) {
    return purgeIncompleteResponse(c, error);
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
      const { documents, truncated } = await listDocuments(deps.sql, auth, {
        ...(folderId !== undefined ? { folderId } : {}),
        includeTrashed: c.req.query('includeTrashed') === 'true',
      });
      return c.json({
        documents: await toDocumentItems(
          deps.sql,
          auth.organizationId,
          documents,
        ),
        truncated,
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/paginated', async (c) => {
    try {
      const auth = await authCtx(c);
      const numItems = Number(c.req.query('numItems') ?? '25');
      const result = await listHubDocumentsPaginated(deps.sql, auth, {
        cursor: c.req.query('cursor') ?? null,
        numItems: Number.isFinite(numItems) ? numItems : 25,
        ...(c.req.query('folderId') !== undefined
          ? { folderId: c.req.query('folderId') }
          : {}),
        ...(c.req.query('sourceProvider') !== undefined
          ? { sourceProvider: c.req.query('sourceProvider') }
          : {}),
        ...(c.req.query('extension') !== undefined
          ? { extension: c.req.query('extension') }
          : {}),
      });
      return c.json({
        page: await toDocumentItems(deps.sql, auth.organizationId, result.page),
        isDone: result.isDone,
        continueCursor: result.continueCursor,
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/approx-count', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json({
        count: await approxCountDocumentsForOrg(deps.sql, auth.organizationId),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/upload-usage', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json(
        await computeUploadUsageForUser(
          deps.sql,
          auth.organizationId,
          auth.userId,
        ),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/versions/:documentId', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json({
        versions: await listDocumentVersionsView(
          deps.sql,
          auth,
          c.req.param('documentId'),
        ),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/by-external-item-id', async (c) => {
    try {
      const auth = await authCtx(c);
      const externalItemId = c.req.query('externalItemId') ?? '';
      const projectId = c.req.query('projectId');
      return c.json({
        document: await getDocumentByExternalItemIdView(deps.sql, auth, {
          externalItemId,
          ...(projectId !== undefined ? { projectId } : {}),
        }),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  /**
   * The automation settings panel's file pair: read a project folder's
   * flat-YAML file into `{key: value}`, and write it back. POST for the
   * read too — the folder/file names are user text, and a query string
   * would leak them into every access log and proxy cache.
   */
  app.post('/project-text/read', async (c) => {
    const body = projectTextReadSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      const auth = await authCtx(c);
      return c.json({
        values: await readProjectTextValues(deps.sql, auth, body.data),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/project-text', async (c) => {
    const body = projectTextWriteSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      const auth = await authCtx(c);
      return c.json(
        await ensureProjectTextDocument(deps.sql, auth, {
          projectId: body.data.projectId,
          folderName: body.data.folderName,
          fileName: body.data.fileName,
          ...(body.data.content !== undefined
            ? { content: body.data.content }
            : {}),
          ...(body.data.yaml !== undefined ? { yaml: body.data.yaml } : {}),
          ...(body.data.contentType !== undefined
            ? { contentType: body.data.contentType }
            : {}),
          ...(body.data.externalItemId !== undefined
            ? { externalItemId: body.data.externalItemId }
            : {}),
        }),
      );
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

  app.get('/search-hub', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json({
        documents: await searchDocumentsView(
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
      const rows = await listProjectDocuments(
        deps.sql,
        auth,
        c.req.param('projectId'),
      );
      return c.json({
        documents: await toDocumentItems(deps.sql, auth.organizationId, rows),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // Fixed prefixes, registered before the `/:documentId` family.
  app.post('/replacement-uploads/:intentId/finalize', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json(
        await finalizeReplacementUpload(
          deps.sql,
          auth,
          c.req.param('intentId'),
        ),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/replacement-uploads/:intentId/cancel', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json(
        await cancelReplacementUpload(deps.sql, auth, c.req.param('intentId')),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/replacement-uploads/:intentId/status', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json(
        await getReplacementUploadStatus(
          deps.sql,
          auth,
          c.req.param('intentId'),
        ),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/records/reviews/:approvalId/respond', async (c) => {
    const body = z
      .object({
        decision: z.enum(['approve', 'request_changes']),
        feedback: z.string().max(8000).optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      const result = await transactSerializable(deps.sql, (tx) =>
        respondToDocumentRecordReview(tx, auth, {
          approvalId: c.req.param('approvalId'),
          decision: body.data.decision,
          ...(body.data.feedback !== undefined
            ? { feedback: body.data.feedback }
            : {}),
        }),
      );
      return c.json(result);
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

  app.post('/from-blob-upload', async (c) => {
    const body = createFromBlobUploadSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      const documentId = await transactSerializable(deps.sql, (tx) =>
        createDocumentFromBlobUpload(deps.sql, tx, auth, body.data),
      );
      return c.json({ success: true, documentId });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/:documentId', async (c) => {
    try {
      const auth = await authCtx(c);
      const doc = await getDocumentById(
        deps.sql,
        auth,
        c.req.param('documentId'),
      );
      const items = await toDocumentItems(deps.sql, auth.organizationId, [doc]);
      return c.json({ document: items[0] ?? null });
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
      const documentId = c.req.param('documentId');
      const result = await transactSerializable(deps.sql, (tx) =>
        updateDocument(tx, auth, { documentId, ...body.data }),
      );
      // A team change or a folder move is a corpus FILTER change — re-stamp
      // retrieval filters without re-embedding. Best-effort by contract
      // (logged inside).
      if (
        (result.teamScopeChanged || result.folderChanged) &&
        result.fileRef !== null
      ) {
        await syncRagDocumentScope(deps.sql, auth.organizationId, documentId);
      }
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/:documentId/record/eligible-reviewer-ids', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json({
        userIds: await listEligibleDocumentReviewerIds(
          deps.sql,
          auth,
          c.req.param('documentId'),
        ),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/:documentId/record/pending-review', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json({
        review: await getPendingDocumentRecordReview(
          deps.sql,
          auth,
          c.req.param('documentId'),
        ),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/:documentId/record/last-review', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json({
        review: await getLastDocumentRecordReview(
          deps.sql,
          auth,
          c.req.param('documentId'),
        ),
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:documentId/replacement-upload/begin', async (c) => {
    const body = z
      .object({
        expectedRecordState: z.enum(['draft', 'approved']),
        expectedVersion: z.number().int().min(1),
        expectedFileId: z.string().min(1),
        fileName: z.string().min(1).max(512),
        contentType: z.string().max(255).optional(),
        lastModified: z.number().optional(),
      })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      return c.json(
        await beginReplacementUpload(deps.sql, auth, {
          documentId: c.req.param('documentId'),
          ...body.data,
        }),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:documentId/record/mark-controlled', async (c) => {
    try {
      const auth = await authCtx(c);
      await transactSerializable(deps.sql, (tx) =>
        markControlled(tx, auth, c.req.param('documentId')),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:documentId/record/submit', async (c) => {
    const body = z
      .object({ reviewerUserId: z.string().min(1) })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const auth = await authCtx(c);
      const result = await transactSerializable(deps.sql, (tx) =>
        submitRecordForReview(tx, auth, {
          documentId: c.req.param('documentId'),
          reviewerUserId: body.data.reviewerUserId,
        }),
      );
      return c.json(result);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:documentId/record/open-revision', async (c) => {
    try {
      const auth = await authCtx(c);
      const result = await transactSerializable(deps.sql, (tx) =>
        openRecordRevision(tx, auth, c.req.param('documentId')),
      );
      return c.json(result);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:documentId/retry-rag', async (c) => {
    try {
      const auth = await authCtx(c);
      return c.json(
        await retryRagIndexingForDocument(
          deps.sql,
          auth,
          c.req.param('documentId'),
        ),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:documentId/delete', async (c) => {
    try {
      const auth = await authCtx(c);
      await deleteDocumentHard(deps.sql, auth, c.req.param('documentId'));
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
      const documentId = c.req.param('documentId');
      const attached = await transactSerializable(deps.sql, (tx) =>
        attachDocumentToProject(tx, auth, {
          documentId,
          projectId: body.data.projectId,
        }),
      );
      // Moving into a project is a corpus SCOPE change like a team change:
      // the hub document's org-wide rows must become project-scoped or the
      // file keeps answering org-wide retrieval from inside a restricted
      // project.
      if (attached.fileRef !== null) {
        await syncRagDocumentScope(deps.sql, auth.organizationId, documentId);
      }
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/:documentId/detach-from-project', async (c) => {
    try {
      const auth = await authCtx(c);
      const documentId = c.req.param('documentId');
      const detached = await transactSerializable(deps.sql, (tx) =>
        detachDocumentFromProject(tx, auth, documentId),
      );
      // Back to the org-wide library: drop the old project's scope from the
      // corpus rows, or the document silently vanishes from hub retrieval.
      if (detached.fileRef !== null) {
        await syncRagDocumentScope(deps.sql, auth.organizationId, documentId);
      }
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
