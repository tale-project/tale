'use node';

/**
 * Internal actions for RAG document operations.
 *
 * Thin Convex wrappers over the ported `RagService` singleton (in
 * `./lib/rag_service`) plus the folder-path / metadata bulk-update SQL ported
 * verbatim from `services/rag/app/routes/documents.ts` (the PATCH
 * `/documents/folder-paths` and `/documents/metadata` handlers).
 *
 * Date fields are serialized to ISO strings before returning — Convex action
 * return values must be JSON values (no `Date` objects). Upload bytes are read
 * from Convex storage via `ctx.storage.get(storageId)` (a Blob) or supplied
 * inline as base64.
 */

import { v } from 'convex/values';

import { isRecord } from '../../lib/utils/type-utils';
import { internal } from '../_generated/api';
import { internalAction, type ActionCtx } from '../_generated/server';
import {
  getKnowledgePoolForOrg,
  PRIVATE_KNOWLEDGE_SCHEMA as SCHEMA,
} from '../lib/knowledge/db/knowledge_db';
import { withRetry } from '../lib/knowledge/db/retry';
import { readBlobBytes } from '../lib/storage/blob_access';
import { validateMetadataObject } from './lib/document_metadata';
import { normalizeFolderPath } from './lib/folder_path';
import { markDocumentFailed } from './lib/indexing_service';
import {
  ragService,
  type DocumentContentResult,
  type DocumentStatusRecord,
} from './lib/rag_service';

/** ISO-serialize a nullable `Date`. */
function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/**
 * Resolve upload bytes from a stored blob reference (a Convex `_storage` id OR
 * an `s3:<key>` ref — `readBlobBytes` routes to the org's backend) or, when the
 * caller already holds the bytes, from inline base64.
 */
async function readUploadBytes(
  ctx: ActionCtx,
  orgSlug: string,
  ref: string | null | undefined,
  base64Content: string | null,
): Promise<Uint8Array> {
  if (ref != null && ref !== '') {
    return await readBlobBytes(ctx, orgSlug, ref);
  }
  if (base64Content != null) {
    return new Uint8Array(Buffer.from(base64Content, 'base64'));
  }
  throw new Error('upload requires either storageId or base64 content');
}

/**
 * Wall-clock budget for ONE upload/indexing slice (#2752). Indexing a
 * near-cap document (extract → chunk → embed → store tens of thousands of
 * chunks) can far exceed a single Convex action's wall-clock limit — observed
 * as a kill at exactly ~300 s that rolled back every chunk and left the file
 * permanently unindexable. Past this soft budget the store loop commits its
 * in-flight batch, returns `partial`, and `upload` schedules itself as a
 * continuation that resumes from the committed chunk prefix. Keep the default
 * comfortably inside the deployment's action cap.
 */
function indexSliceBudgetMs(): number {
  const raw = process.env.RAG_INDEX_SLICE_BUDGET_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 210_000;
}

/**
 * Continuation-chain backstop: every slice commits at least one batch, so this
 * only trips when something pathological keeps yielding without finishing
 * (~48 slices × 3.5 min ≈ 2.8 h of pure indexing).
 */
const MAX_INDEX_SLICES = 48;

export const upload = internalAction({
  args: {
    orgSlug: v.string(),
    fileId: v.string(),
    filename: v.string(),
    // A stored blob reference for the uploaded file: a Convex `_storage` id OR
    // an `s3:<key>` ref (the bytes are read via `readBlobBytes`, which routes to
    // the org's backend). `content` is an alternative inline base64 path for
    // callers that already hold the bytes.
    storageId: v.optional(v.union(v.string(), v.null())),
    content: v.optional(v.union(v.string(), v.null())),
    sourceCreatedAt: v.optional(v.union(v.number(), v.null())),
    sourceModifiedAt: v.optional(v.union(v.number(), v.null())),
    // 1-based continuation counter; set only by the self-scheduled slices.
    sliceAttempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const deadline = Date.now() + indexSliceBudgetMs();
    const sliceAttempt = args.sliceAttempt ?? 1;
    try {
      const bytes = await readUploadBytes(
        ctx,
        args.orgSlug,
        args.storageId,
        args.content ?? null,
      );

      const sourceCreatedAt =
        args.sourceCreatedAt != null ? new Date(args.sourceCreatedAt) : null;
      const sourceModifiedAt =
        args.sourceModifiedAt != null ? new Date(args.sourceModifiedAt) : null;

      const result = await ragService.addDocument(
        args.orgSlug,
        bytes,
        args.fileId,
        args.filename,
        { sourceCreatedAt, sourceModifiedAt, deadline },
      );

      if (result.partial) {
        if (sliceAttempt >= MAX_INDEX_SLICES) {
          const error =
            `Indexing did not finish within ${MAX_INDEX_SLICES} continuation ` +
            `slices (${result.chunks_total ?? '?'} chunks total)`;
          const sql = await getKnowledgePoolForOrg(args.orgSlug);
          await markDocumentFailed(sql, args.orgSlug, args.fileId, error);
          return {
            success: false,
            file_id: result.file_id,
            chunks_created: result.chunks_created,
            skipped: false,
            skip_reason: null,
            partial: false,
          };
        }
        await ctx.scheduler.runAfter(0, internal.rag.documents.upload, {
          orgSlug: args.orgSlug,
          fileId: args.fileId,
          filename: args.filename,
          storageId: args.storageId ?? null,
          content: args.content ?? null,
          sourceCreatedAt: args.sourceCreatedAt ?? null,
          sourceModifiedAt: args.sourceModifiedAt ?? null,
          sliceAttempt: sliceAttempt + 1,
        });
      }

      return {
        success: result.success,
        file_id: result.file_id,
        chunks_created: result.chunks_created,
        skipped: result.skipped,
        skip_reason: result.skip_reason,
        partial: result.partial ?? false,
      };
    } catch (err) {
      // A continuation slice has no awaiting parent to surface the failure
      // (the original caller returned slices ago) — stamp the document row
      // failed so the status poller reports a terminal state instead of an
      // eternal `processing`, then rethrow for the action log.
      if (sliceAttempt > 1) {
        const message = err instanceof Error ? err.message : String(err);
        try {
          const sql = await getKnowledgePoolForOrg(args.orgSlug);
          await markDocumentFailed(sql, args.orgSlug, args.fileId, message);
        } catch (markErr) {
          console.error(
            `[rag.documents.upload] failed to mark ${args.fileId} failed after slice error:`,
            markErr,
          );
        }
      }
      throw err;
    }
  },
});

/** Serialize a `DocumentContentResult` for return (Date -> ISO). */
function serializeContent(result: DocumentContentResult): {
  file_id: string;
  title: string | null;
  content: string;
  chunk_range: { start: number; end: number };
  total_chunks: number;
  total_chars: number;
  source_created_at: string | null;
  source_modified_at: string | null;
  chunks: { index: number; content: string }[] | null;
} {
  return {
    file_id: result.file_id,
    title: result.title,
    content: result.content,
    chunk_range: result.chunk_range,
    total_chunks: result.total_chunks,
    total_chars: result.total_chars,
    source_created_at: toIso(result.source_created_at),
    source_modified_at: toIso(result.source_modified_at),
    chunks: result.chunks ?? null,
  };
}

export const getContent = internalAction({
  args: {
    orgSlug: v.string(),
    fileId: v.string(),
    chunkStart: v.optional(v.union(v.number(), v.null())),
    chunkEnd: v.optional(v.union(v.number(), v.null())),
    returnChunks: v.optional(v.union(v.boolean(), v.null())),
  },
  handler: async (_ctx, args) => {
    const result = await ragService.getDocumentContent(
      args.orgSlug,
      args.fileId,
      {
        chunkStart: args.chunkStart ?? undefined,
        chunkEnd: args.chunkEnd ?? null,
        returnChunks: args.returnChunks ?? undefined,
      },
    );
    return result === null ? null : serializeContent(result);
  },
});

/** Serialize a `DocumentStatusRecord` for return (Date -> ISO). */
function serializeStatus(record: DocumentStatusRecord): {
  status: string;
  error: string | null;
  progress_phase: string | null;
  progress_detail: string | null;
  source_created_at: string | null;
  source_modified_at: string | null;
  ocr_applied: boolean | null;
} {
  return {
    status: record.status,
    error: record.error,
    progress_phase: record.progress_phase,
    progress_detail: record.progress_detail,
    source_created_at: toIso(record.source_created_at),
    source_modified_at: toIso(record.source_modified_at),
    ocr_applied: record.ocr_applied,
  };
}

export const getStatuses = internalAction({
  args: {
    orgSlug: v.string(),
    fileIds: v.array(v.string()),
  },
  handler: async (_ctx, args) => {
    const statusesRaw = await ragService.getDocumentStatuses(
      args.orgSlug,
      args.fileIds,
    );
    const statuses: Record<string, ReturnType<typeof serializeStatus> | null> =
      {};
    for (const [fileId, record] of Object.entries(statusesRaw)) {
      statuses[fileId] = record ? serializeStatus(record) : null;
    }
    return { statuses };
  },
});

export const deleteDocument = internalAction({
  args: {
    orgSlug: v.string(),
    fileId: v.string(),
  },
  handler: async (_ctx, args) => {
    const result = await ragService.deleteDocument(args.orgSlug, args.fileId);
    return {
      success: result.success,
      message: result.message,
      deleted_count: result.deleted_count,
      deleted_data_ids: result.deleted_data_ids,
      processing_time_ms: result.processing_time_ms,
    };
  },
});

export const compareDocuments = internalAction({
  args: {
    orgSlug: v.string(),
    baseFileId: v.string(),
    comparisonFileId: v.string(),
    maxChanges: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (_ctx, args) => {
    const result = await ragService.compareDocuments(
      args.orgSlug,
      args.baseFileId,
      args.comparisonFileId,
      args.maxChanges ?? undefined,
    );
    // `CompareResult` has no Date fields (diff output + file_id/title), so it
    // is already JSON-serializable.
    return result;
  },
});

export const compareFiles = internalAction({
  args: {
    orgSlug: v.string(),
    baseStorageId: v.optional(v.union(v.string(), v.null())),
    baseContent: v.optional(v.union(v.string(), v.null())),
    baseFilename: v.string(),
    comparisonStorageId: v.optional(v.union(v.string(), v.null())),
    comparisonContent: v.optional(v.union(v.string(), v.null())),
    comparisonFilename: v.string(),
    maxChanges: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const baseBytes = await readUploadBytes(
      ctx,
      args.orgSlug,
      args.baseStorageId,
      args.baseContent ?? null,
    );
    const comparisonBytes = await readUploadBytes(
      ctx,
      args.orgSlug,
      args.comparisonStorageId,
      args.comparisonContent ?? null,
    );

    const result = await ragService.compareFiles(
      args.orgSlug,
      baseBytes,
      args.baseFilename,
      comparisonBytes,
      args.comparisonFilename,
      args.maxChanges ?? undefined,
    );
    // No Date fields — already JSON-serializable.
    return result;
  },
});

export const updateFolderPaths = internalAction({
  args: {
    orgSlug: v.string(),
    updates: v.array(
      v.object({
        file_id: v.string(),
        folder_path: v.union(v.string(), v.null()),
      }),
    ),
  },
  handler: async (_ctx, args) => {
    // Last occurrence wins for duplicate file_ids; normalize folder paths to
    // the canonical `parent/child` form before persisting.
    const deduped = new Map<string, string | null>();
    for (const u of args.updates) {
      deduped.set(u.file_id, normalizeFolderPath(u.folder_path));
    }
    const fileIds = [...deduped.keys()];
    const folderPaths = [...deduped.values()];

    const sql = await getKnowledgePoolForOrg(args.orgSlug);
    const result = await withRetry(() =>
      sql.unsafe(
        `UPDATE ${SCHEMA}.documents d
         SET folder_path = u.folder_path, updated_at = NOW()
         FROM unnest($2::text[], $3::text[]) AS u(file_id, folder_path)
         WHERE d.org_slug = $1 AND d.file_id = u.file_id`,
        [args.orgSlug, fileIds, folderPaths],
      ),
    );
    return { success: true, updated_count: result.count ?? 0 };
  },
});

export const updateMetadata = internalAction({
  args: {
    orgSlug: v.string(),
    updates: v.array(
      v.object({
        file_id: v.string(),
        metadata: v.any(),
      }),
    ),
  },
  handler: async (_ctx, args) => {
    const deduped = new Map<string, string>();
    for (const u of args.updates) {
      // Strict validation (reserved keys rejected, scalar-only) before storing.
      // `metadata` is `v.any()`; narrow it through a guard rather than an
      // unsafe assertion. A non-object (or null/undefined) becomes `{}`.
      const validated = validateMetadataObject(
        isRecord(u.metadata) ? u.metadata : {},
        false,
      );
      deduped.set(u.file_id, JSON.stringify(validated));
    }
    const fileIds = [...deduped.keys()];
    const metadataValues = [...deduped.values()];

    const sql = await getKnowledgePoolForOrg(args.orgSlug);
    const result = await withRetry(() =>
      sql.unsafe(
        `UPDATE ${SCHEMA}.documents d
         SET metadata = u.metadata::jsonb, updated_at = NOW()
         FROM unnest($2::text[], $3::text[]) AS u(file_id, metadata)
         WHERE d.org_slug = $1 AND d.file_id = u.file_id`,
        [args.orgSlug, fileIds, metadataValues],
      ),
    );
    return { success: true, updated_count: result.count ?? 0 };
  },
});
