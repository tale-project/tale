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
import { internalAction } from '../_generated/server';
import {
  getKnowledgePool,
  PRIVATE_KNOWLEDGE_SCHEMA as SCHEMA,
} from '../lib/knowledge/db/knowledge_db';
import { withRetry } from '../lib/knowledge/db/retry';
import { toId } from '../lib/type_cast_helpers';
import { validateMetadataObject } from './lib/document_metadata';
import { normalizeFolderPath } from './lib/folder_path';
import {
  ragService,
  type DocumentContentResult,
  type DocumentStatusRecord,
} from './lib/rag_service';

/** ISO-serialize a nullable `Date`. */
function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/** Resolve upload bytes from a storage id (preferred) or inline base64. */
async function resolveUploadBytes(
  // The caller passes a Convex `_storage` id for the uploaded file. The bytes
  // are read here so the ported indexing pipeline gets a `Uint8Array`.
  storageBlob: Blob | null,
  base64Content: string | null,
): Promise<Uint8Array> {
  if (storageBlob) {
    return new Uint8Array(await storageBlob.arrayBuffer());
  }
  if (base64Content != null) {
    return new Uint8Array(Buffer.from(base64Content, 'base64'));
  }
  throw new Error('upload requires either storageId or base64 content');
}

export const upload = internalAction({
  args: {
    orgSlug: v.string(),
    fileId: v.string(),
    filename: v.string(),
    // TODO(rewire): the caller passes a Convex `_storage` id for the uploaded
    // file; the bytes are read here via `ctx.storage.get`. `content` is an
    // alternative inline base64 path for callers that already hold the bytes.
    storageId: v.optional(v.union(v.string(), v.null())),
    content: v.optional(v.union(v.string(), v.null())),
    sourceCreatedAt: v.optional(v.union(v.number(), v.null())),
    sourceModifiedAt: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const storageBlob =
      args.storageId != null && args.storageId !== ''
        ? await ctx.storage.get(toId<'_storage'>(args.storageId))
        : null;
    const bytes = await resolveUploadBytes(storageBlob, args.content ?? null);

    const sourceCreatedAt =
      args.sourceCreatedAt != null ? new Date(args.sourceCreatedAt) : null;
    const sourceModifiedAt =
      args.sourceModifiedAt != null ? new Date(args.sourceModifiedAt) : null;

    const result = await ragService.addDocument(
      args.orgSlug,
      bytes,
      args.fileId,
      args.filename,
      { sourceCreatedAt, sourceModifiedAt },
    );
    return {
      success: result.success,
      file_id: result.file_id,
      chunks_created: result.chunks_created,
      skipped: result.skipped,
      skip_reason: result.skip_reason,
    };
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
    const baseBlob =
      args.baseStorageId != null && args.baseStorageId !== ''
        ? await ctx.storage.get(toId<'_storage'>(args.baseStorageId))
        : null;
    const comparisonBlob =
      args.comparisonStorageId != null && args.comparisonStorageId !== ''
        ? await ctx.storage.get(toId<'_storage'>(args.comparisonStorageId))
        : null;

    const baseBytes = await resolveUploadBytes(
      baseBlob,
      args.baseContent ?? null,
    );
    const comparisonBytes = await resolveUploadBytes(
      comparisonBlob,
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

    const sql = getKnowledgePool();
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

    const sql = getKnowledgePool();
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
