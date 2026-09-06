import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { isAudioOrVideo } from '../../../lib/shared/file-types.ts';
import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import { rateLimitedResponse } from '../../lib/rate-limit-response.ts';
import {
  checkUserRateLimit,
  RateLimitExceededError,
} from '../../lib/rate-limit.ts';
import type { ProjectAuthContext } from '../projects/service.ts';
import {
  assertFileReadable,
  resolveFileReadAccess,
  viewerForMember,
} from './access.ts';
import { MAX_UPLOAD_BYTES, readBodyBounded } from './bounded-body.ts';
import {
  createRestUploadHandoff,
  deleteFile,
  deleteOrgBlobRefs,
  deleteRejectedUploadBlob,
  FileError,
  getFileMetadataByIdOrRef,
  getFileUrl,
  putOrgBlobBytes,
  registerUpload,
} from './service.ts';
import {
  queueTranscription,
  retryTranscription,
  skipTranscription,
  transcribeDictation,
} from './transcription.ts';
import { recordUploadIntent, uploadPurposeSchema } from './upload-intents.ts';

const registerSchema = z.object({
  storageRef: z.string().min(1).max(1024),
  fileName: z.string().min(1).max(512),
  contentType: z.string().min(1).max(255),
  threadId: z.string().max(200).optional(),
  source: z.string().max(100).optional(),
});

function handleError<E extends OrgEnv>(
  c: Context<E>,
  error: unknown,
): Response {
  if (error instanceof FileError) {
    return c.json({ error: error.code }, error.status);
  }
  if (error instanceof RateLimitExceededError) {
    return rateLimitedResponse(c, error);
  }
  throw error;
}

/**
 * /api/app/files — upload handshake, presigned serve, delete.
 *
 * Two rules hold on every lane here. A key the server mints for a browser is
 * recorded as the caller's upload intent (`upload-intents.ts`), and only that
 * caller can later bind it — the ref alone, which every reader of a document
 * holds, binds nothing. And a row is served or touched only after the read
 * gate (`access.ts`) has admitted the caller through the row's bound parent
 * (uploader, document, thread, conversation, task); a refused row is 404.
 */
export function createFileRoutes(deps: { sql: Sql; auth: Auth }): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  const viewerOf = (c: Context<OrgEnv>): Promise<ProjectAuthContext> =>
    viewerForMember(deps.sql, {
      organizationId: c.get('orgId'),
      userId: c.get('sessionBundle').user.id,
      role: c.get('orgMember').role,
    });

  /** Direct byte upload (the 0.4 Convex `generateUploadUrl` POST contract):
   * the client POSTs the file body to this URL and gets `{ storageId }` —
   * on pg that id IS the org-scoped blob ref. Serves every legacy POST-lane
   * uploader without per-component surgery. `?purpose=` names the bind lane
   * the blob is staged for (default `file`); the skill and automation bundle
   * lanes stage through here and consume only their own purpose. */
  app.post('/upload', async (c) => {
    const purpose = uploadPurposeSchema.safeParse(
      c.req.query('purpose') ?? 'file',
    );
    if (!purpose.success) {
      return c.json({ error: 'invalid purpose' }, 400);
    }
    try {
      const userId = c.get('sessionBundle').user.id;
      await checkUserRateLimit(deps.sql, 'file:upload', userId);
      // Refused past the ceiling BEFORE the body is buffered — on the declared
      // length, then on the bytes as they arrive.
      const bytes = await readBodyBounded(c.req.raw, MAX_UPLOAD_BYTES);
      const storageId = await putOrgBlobBytes(deps.sql, c.get('orgId'), {
        bytes,
        contentType: c.req.header('content-type') ?? 'application/octet-stream',
      });
      // The bytes are already in the bucket; the intent row is the ONLY
      // record they exist. If it cannot be written, reclaim the blob before
      // answering the error — otherwise nothing would ever find it again.
      try {
        await recordUploadIntent(deps.sql, {
          organizationId: c.get('orgId'),
          userId,
          purpose: purpose.data,
          storageRef: storageId,
        });
      } catch (error) {
        await deleteOrgBlobRefs(deps.sql, c.get('orgId'), [storageId]);
        throw error;
      }
      return c.json({ storageId });
    } catch (error) {
      return handleError(c, error);
    }
  });

  /** Session presign, size-free (the 0.4 `generateBlobUpload` wire): the
   * bind step attests the landed object, so the ceiling is enforced there. */
  app.post('/blob-upload', async (c) => {
    const body = z
      .object({ contentType: z.string().max(255).optional() })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const userId = c.get('sessionBundle').user.id;
      await checkUserRateLimit(deps.sql, 'file:upload', userId);
      const handoff = await createRestUploadHandoff(
        deps.sql,
        { organizationId: c.get('orgId') },
        body.data,
      );
      await recordUploadIntent(deps.sql, {
        organizationId: c.get('orgId'),
        userId,
        purpose: 'file',
        storageRef: handoff.storageRef,
      });
      return c.json({
        url: handoff.uploadUrl,
        method: 'PUT',
        s3Ref: handoff.storageRef,
      });
    } catch (error) {
      return handleError(c, error);
    }
  });

  /** Reclaim a landed-but-rejected upload blob (never a registered file,
   * never another member's staged key — the reclaim consumes the caller's
   * own upload intent). */
  app.post('/reject-blob', async (c) => {
    const body = z
      .object({ storageRef: z.string().min(1).max(1024) })
      .safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      return c.json(
        await deleteRejectedUploadBlob(
          deps.sql,
          {
            organizationId: c.get('orgId'),
            userId: c.get('sessionBundle').user.id,
          },
          body.data.storageRef,
        ),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/register', async (c) => {
    const body = registerSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const scope = {
        organizationId: c.get('orgId'),
        userId: c.get('sessionBundle').user.id,
      };
      const result = await transactSerializable(deps.sql, (tx) =>
        registerUpload(deps.sql, tx, scope, body.data, {
          kind: 'app',
          purpose: 'file',
        }),
      );
      // Audio/video uploads transcribe server-side (the 0.4 saveFileMetadata
      // audio branch): stamp queued + enqueue the pipeline job.
      if (isAudioOrVideo(body.data.contentType)) {
        await queueTranscription(deps.sql, {
          organizationId: scope.organizationId,
          storageRef: body.data.storageRef,
          fileName: body.data.fileName,
          contentType: body.data.contentType,
        });
      }
      return c.json(result);
    } catch (error) {
      return handleError(c, error);
    }
  });

  /** One-shot dictation transcription (inline bytes, never persisted). */
  app.post('/dictation', async (c) => {
    const body = z
      .object({
        audioBase64: z.string().min(1).max(12_000_000),
        mimeType: z.string().min(1).max(255),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      const audio = new Uint8Array(
        Buffer.from(body.data.audioBase64, 'base64'),
      );
      return c.json(
        await transcribeDictation(deps.sql, {
          organizationId: c.get('orgId'),
          userId: c.get('sessionBundle').user.id,
          audio,
          mimeType: body.data.mimeType,
        }),
      );
    } catch (error) {
      return handleError(c, error);
    }
  });

  /** The transcription verbs act on a row named by ref — the same read gate
   * as serving decides whether the caller may steer that row's pipeline. */
  const loadReadableByRef = async (
    c: Context<OrgEnv>,
    storageRef: string,
  ): Promise<void> => {
    const meta = await getFileMetadataByIdOrRef(
      deps.sql,
      c.get('orgId'),
      storageRef,
    );
    if (!meta) {
      throw new FileError('FILE_NOT_FOUND', 'File not found', 404);
    }
    await assertFileReadable(deps.sql, await viewerOf(c), meta);
  };

  app.post('/transcription/skip', async (c) => {
    const body = z
      .object({ storageRef: z.string().min(1).max(1024) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      await loadReadableByRef(c, body.data.storageRef);
      await skipTranscription(deps.sql, c.get('orgId'), body.data.storageRef);
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post('/transcription/retry', async (c) => {
    const body = z
      .object({ storageRef: z.string().min(1).max(1024) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
      await loadReadableByRef(c, body.data.storageRef);
      await retryTranscription(deps.sql, c.get('orgId'), body.data.storageRef);
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // Batch pipeline statuses for staged attachments (the 0.4
  // `getByStorageIds` shape; first row per ref, capped at 20). A row the
  // caller may not read is simply absent — the transcript rides here.
  app.post('/statuses', async (c) => {
    const body = z
      .object({ storageIds: z.array(z.string().min(1).max(1024)).max(20) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const orgId = c.get('orgId');
    const viewer = await viewerOf(c);
    const statuses: Record<string, unknown>[] = [];
    for (const storageId of body.data.storageIds) {
      const rows = await deps.sql<
        {
          organizationId: string;
          storageRef: string;
          uploadedBy: string | null;
          documentId: string | null;
          threadId: string | null;
          conversationId: string | null;
          fileName: string;
          contentType: string;
          size: number;
          ragStatus: string | null;
          ragError: string | null;
          ragProgress: string | null;
          pageCount: number | null;
          scannedPagesDetected: number | null;
          visionRequired: boolean | null;
          transcript: string | null;
          transcriptionStatus: string | null;
          transcriptionError: string | null;
          transcriptionDurationSec: number | null;
          transcriptionProgress: string | null;
          transcriptRagStatus: string | null;
          transcriptRagError: string | null;
          createdAt: number;
        }[]
      >`
        SELECT org_id AS "organizationId", storage_ref AS "storageRef",
               uploaded_by AS "uploadedBy", document_id AS "documentId",
               thread_id AS "threadId", conversation_id AS "conversationId",
               file_name AS "fileName", content_type AS "contentType",
               size::float8 AS "size", rag_status AS "ragStatus",
               rag_error AS "ragError", rag_progress AS "ragProgress",
               page_count AS "pageCount",
               scanned_pages_detected AS "scannedPagesDetected",
               vision_required AS "visionRequired", transcript,
               transcription_status AS "transcriptionStatus",
               transcription_error AS "transcriptionError",
               transcription_duration_sec::float8
                 AS "transcriptionDurationSec",
               transcription_progress AS "transcriptionProgress",
               transcript_rag_status AS "transcriptRagStatus",
               transcript_rag_error AS "transcriptRagError",
               created_at_ms::float8 AS "createdAt"
        FROM app.file_metadata
        WHERE storage_ref = ${storageId} AND org_id = ${orgId}
        ORDER BY created_at_ms ASC
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) continue;
      if (!(await resolveFileReadAccess(deps.sql, viewer, row))) continue;
      statuses.push(
        Object.assign(
          {
            storageId: row.storageRef,
            fileName: row.fileName,
            contentType: row.contentType,
            size: row.size,
            _creationTime: row.createdAt,
          },
          row.documentId !== null ? { documentId: row.documentId } : {},
          row.ragStatus !== null ? { ragStatus: row.ragStatus } : {},
          row.ragError !== null ? { ragError: row.ragError } : {},
          row.ragProgress !== null ? { ragProgress: row.ragProgress } : {},
          row.pageCount !== null ? { pageCount: row.pageCount } : {},
          row.scannedPagesDetected !== null
            ? { scannedPagesDetected: row.scannedPagesDetected }
            : {},
          row.visionRequired !== null
            ? { visionRequired: row.visionRequired }
            : {},
          row.transcript !== null ? { transcript: row.transcript } : {},
          row.transcriptionStatus !== null
            ? { transcriptionStatus: row.transcriptionStatus }
            : {},
          row.transcriptionError !== null
            ? { transcriptionError: row.transcriptionError }
            : {},
          row.transcriptionDurationSec !== null
            ? { transcriptionDurationSec: row.transcriptionDurationSec }
            : {},
          row.transcriptionProgress !== null
            ? { transcriptionProgress: row.transcriptionProgress }
            : {},
          row.transcriptRagStatus !== null
            ? { transcriptRagStatus: row.transcriptRagStatus }
            : {},
          row.transcriptRagError !== null
            ? { transcriptRagError: row.transcriptRagError }
            : {},
        ),
      );
    }
    return c.json({ statuses });
  });

  /**
   * URLs for several blobs at once — the attachment lists. Never truncates
   * (a cap here used to silently drop thumbnails while titles rendered); an
   * unresolvable ref — missing, or not the caller's to read — answers
   * `url: null` rather than failing the batch.
   */
  app.post('/urls', async (c) => {
    const body = z
      .object({ fileIds: z.array(z.string().min(1).max(1024)).max(200) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const orgId = c.get('orgId');
    const viewer = await viewerOf(c);
    const seen = new Set<string>();
    const urls: { fileId: string; url: string | null }[] = [];
    for (const fileId of body.data.fileIds) {
      if (seen.has(fileId)) continue;
      seen.add(fileId);
      try {
        const meta = await getFileMetadataByIdOrRef(deps.sql, orgId, fileId);
        const readable =
          meta !== null &&
          (await resolveFileReadAccess(deps.sql, viewer, meta));
        urls.push({
          fileId,
          url:
            meta === null || !readable
              ? null
              : await getFileUrl(
                  deps.sql,
                  { organizationId: orgId },
                  meta.storageRef,
                ),
        });
      } catch (error) {
        console.warn(`[files] url resolve failed for ${fileId}:`, error);
        urls.push({ fileId, url: null });
      }
    }
    return c.json({ urls });
  });

  /**
   * Link-shaped blob serve: 302 to a fresh presigned GET (a presigned URL
   * minted at store time would expire, and the 0.4 `/http_api/storage` door
   * this replaced retired with the Convex runtime). Session-gated like every
   * lane here (the browser opens it same-origin, so cookies ride along), and
   * the ref must name a row the caller may READ through its bound parent —
   * the same `access.ts` gate as the sibling url doors, so a bare ref grants
   * nothing here either. Declared before the `/:fileId` routes so `serve`
   * never parses as a file id.
   */
  app.get('/serve', async (c) => {
    const ref = c.req.query('ref');
    if (!ref) return c.json({ error: 'ref is required' }, 400);
    const filename = c.req.query('filename');
    try {
      await loadReadableByRef(c, ref);
      const url = await getFileUrl(
        deps.sql,
        { organizationId: c.get('orgId') },
        ref,
        filename !== undefined && filename !== '' ? { filename } : {},
      );
      return c.redirect(url, 302);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/:fileId', async (c) => {
    try {
      const meta = await getFileMetadataByIdOrRef(
        deps.sql,
        c.get('orgId'),
        c.req.param('fileId'),
      );
      if (!meta) {
        return c.json({ error: 'FILE_NOT_FOUND' }, 404);
      }
      await assertFileReadable(deps.sql, await viewerOf(c), meta);
      return c.json({ file: meta });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/:fileId/url', async (c) => {
    try {
      const orgId = c.get('orgId');
      const meta = await getFileMetadataByIdOrRef(
        deps.sql,
        orgId,
        c.req.param('fileId'),
      );
      if (!meta) {
        return c.json({ error: 'FILE_NOT_FOUND' }, 404);
      }
      await assertFileReadable(deps.sql, await viewerOf(c), meta);
      const url = await getFileUrl(
        deps.sql,
        { organizationId: orgId },
        meta.storageRef,
      );
      return c.json({ url });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.delete('/:fileId', async (c) => {
    try {
      const orgId = c.get('orgId');
      const session = c.get('sessionBundle');
      const meta = await getFileMetadataByIdOrRef(
        deps.sql,
        orgId,
        c.req.param('fileId'),
      );
      if (!meta) {
        return c.json({ ok: true });
      }
      const role = c.get('orgMember').role;
      const isAdmin = role === 'owner' || role === 'admin';
      if (!isAdmin && meta.uploadedBy !== session.user.id) {
        return c.json({ error: 'FILE_DELETE_FORBIDDEN' }, 403);
      }
      await transactSerializable(deps.sql, (tx) =>
        deleteFile(deps.sql, tx, { organizationId: orgId }, meta.id),
      );
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
