import { transactSerializable } from '@tale/shared/db/serializable';
import { Hono, type Context } from 'hono';
import type { Sql } from 'postgres';
import { z } from 'zod';

import { isAudioOrVideo } from '../../../lib/shared/file-types.ts';
import type { Auth } from '../../auth/auth.ts';
import { requireOrgMember, type OrgEnv } from '../../auth/org.ts';
import { requireSession } from '../../auth/session.ts';
import {
  checkUserRateLimit,
  RateLimitExceededError,
} from '../../lib/rate-limit.ts';
import {
  createUploadHandoff,
  deleteFile,
  FileError,
  getFileMetadata,
  getFileUrl,
  registerUpload,
} from './service.ts';
import {
  queueTranscription,
  retryTranscription,
  skipTranscription,
  transcribeDictation,
} from './transcription.ts';

const handoffSchema = z.object({
  contentType: z.string().min(1).max(255),
  size: z.number().int().positive(),
});

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
    return c.json(
      { error: 'RATE_LIMITED', data: { retryAfterMs: error.retryAfter } },
      429,
    );
  }
  throw error;
}

/** /api/app/files — upload handshake, presigned serve, delete. */
export function createFileRoutes(deps: { sql: Sql; auth: Auth }): Hono<OrgEnv> {
  const app = new Hono<OrgEnv>();
  app.use(requireSession(deps.auth), requireOrgMember(deps.sql));

  app.post('/upload-handoff', async (c) => {
    const body = handoffSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: 'invalid body' }, 400);
    }
    try {
      const userId = c.get('sessionBundle').user.id;
      await checkUserRateLimit(deps.sql, 'file:upload', userId);
      return c.json(
        await createUploadHandoff(
          deps.sql,
          { organizationId: c.get('orgId') },
          body.data,
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
        registerUpload(deps.sql, tx, scope, body.data),
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

  app.post('/transcription/skip', async (c) => {
    const body = z
      .object({ storageRef: z.string().min(1).max(1024) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    try {
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
      await retryTranscription(deps.sql, c.get('orgId'), body.data.storageRef);
      return c.json({ ok: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  // Batch pipeline statuses for staged attachments (the 0.4
  // `getByStorageIds` shape; first row per ref, capped at 20).
  app.post('/statuses', async (c) => {
    const body = z
      .object({ storageIds: z.array(z.string().min(1).max(1024)).max(20) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    const orgId = c.get('orgId');
    const statuses: Record<string, unknown>[] = [];
    for (const storageId of body.data.storageIds) {
      const rows = await deps.sql<
        {
          storageRef: string;
          documentId: string | null;
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
        SELECT storage_ref AS "storageRef", document_id AS "documentId",
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

  app.get('/:fileId', async (c) => {
    try {
      const meta = await getFileMetadata(
        deps.sql,
        c.get('orgId'),
        c.req.param('fileId'),
      );
      if (!meta) {
        return c.json({ error: 'FILE_NOT_FOUND' }, 404);
      }
      return c.json({ file: meta });
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.get('/:fileId/url', async (c) => {
    try {
      const orgId = c.get('orgId');
      const meta = await getFileMetadata(
        deps.sql,
        orgId,
        c.req.param('fileId'),
      );
      if (!meta) {
        return c.json({ error: 'FILE_NOT_FOUND' }, 404);
      }
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
      const meta = await getFileMetadata(
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
