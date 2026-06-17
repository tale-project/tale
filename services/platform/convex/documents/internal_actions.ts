'use node';

import { v } from 'convex/values';

import {
  fetchJson,
  getBoolean,
  getString,
  isRecord,
} from '../../lib/utils/type-utils';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { internalAction, type ActionCtx } from '../_generated/server';
import { orgSlugFromIdOrNull } from '../lib/helpers/org_slug';
import { buildDownloadUrl } from '../lib/helpers/public_storage_url';
import { deleteDocumentById } from '../workflow_engine/action_defs/rag/helpers/delete_document';
import { ragAction } from '../workflow_engine/action_defs/rag/rag_action';
// `generate_document` / `generate_docx` are `'use node'` modules and are NOT
// re-exported by the V8-reachable `./helpers` barrel — import them directly.
import { generateDocument as generateDocumentImpl } from './generate_document';
import {
  generateDocx as generateDocxImpl,
  type GenerateDocxResult,
} from './generate_docx';
import type { GenerateDocumentResult } from './types';

const INITIAL_POLLING_DELAY_MS = 10_000;

/**
 * Best-effort RAG DELETE for a stale fileId during re-index. Logs and
 * returns; never throws. Used by `reindexDocumentInRag` after the new
 * upload succeeds — a failure to delete the old entry leaves orphan
 * chunks but does not regress the user-visible reindex result.
 */
async function deleteOldRagEntry(
  ctx: ActionCtx,
  organizationId: string,
  oldFileId: string,
  documentId: string,
): Promise<void> {
  const orgSlug = await orgSlugFromIdOrNull(ctx, organizationId);
  if (orgSlug === null) {
    console.warn(
      `[reindexDocumentInRag] org ${organizationId} unresolvable; skipping old RAG delete for oldFileId=${oldFileId} (documentId=${documentId})`,
    );
    return;
  }
  // In-process delete (replaces the external RAG DELETE). The in-process
  // delete is idempotent — a missing document returns success with
  // `deletedCount: 0` (no 404 to special-case).
  const result = await deleteDocumentById(ctx, { orgSlug, fileId: oldFileId });
  if (!result.success) {
    console.warn(
      `[reindexDocumentInRag] Failed to delete old RAG entry ${oldFileId}: ${result.error ?? result.message}`,
    );
  }
}

const documentSourceTypeValidator = v.union(
  v.literal('markdown'),
  v.literal('html'),
  v.literal('url'),
);

const documentOutputFormatValidator = v.union(
  v.literal('pdf'),
  v.literal('image'),
  v.literal('docx'),
  v.literal('pptx'),
);

const pdfOptionsValidator = v.optional(
  v.object({
    format: v.optional(v.string()),
    landscape: v.optional(v.boolean()),
    marginTop: v.optional(v.string()),
    marginBottom: v.optional(v.string()),
    marginLeft: v.optional(v.string()),
    marginRight: v.optional(v.string()),
    printBackground: v.optional(v.boolean()),
  }),
);

const imageOptionsValidator = v.optional(
  v.object({
    imageType: v.optional(v.string()),
    quality: v.optional(v.number()),
    fullPage: v.optional(v.boolean()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    scale: v.optional(v.number()),
  }),
);

const urlOptionsValidator = v.optional(
  v.object({
    waitUntil: v.optional(
      v.union(
        v.literal('load'),
        v.literal('domcontentloaded'),
        v.literal('networkidle'),
        v.literal('commit'),
      ),
    ),
  }),
);

const docxSectionValidator = v.object({
  type: v.union(
    v.literal('heading'),
    v.literal('paragraph'),
    v.literal('bullets'),
    v.literal('numbered'),
    v.literal('table'),
    v.literal('quote'),
    v.literal('code'),
  ),
  text: v.optional(v.string()),
  level: v.optional(v.number()),
  items: v.optional(v.array(v.string())),
  headers: v.optional(v.array(v.string())),
  rows: v.optional(v.array(v.array(v.string()))),
});

const docxContentValidator = v.object({
  title: v.optional(v.string()),
  subtitle: v.optional(v.string()),
  sections: v.array(docxSectionValidator),
});

export const generateDocument = internalAction({
  args: {
    organizationId: v.string(),
    fileName: v.string(),
    sourceType: documentSourceTypeValidator,
    outputFormat: documentOutputFormatValidator,
    content: v.string(),
    pdfOptions: pdfOptionsValidator,
    imageOptions: imageOptionsValidator,
    urlOptions: urlOptionsValidator,
    extraCss: v.optional(v.string()),
    wrapInTemplate: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<GenerateDocumentResult> => {
    return await generateDocumentImpl(ctx, args);
  },
});

export const generateDocx = internalAction({
  args: {
    organizationId: v.string(),
    fileName: v.string(),
    content: docxContentValidator,
  },
  handler: async (ctx, args): Promise<GenerateDocxResult> => {
    return await generateDocxImpl(ctx, args);
  },
});

/**
 * Progressive intervals to cover ~24 hours with 50 attempts:
 * - Attempts 1-30: 2 minutes each (~60 minutes total)
 * - Attempts 31-50: Progressive increase from 15 to 129 minutes (~24 hours total)
 */
export const getPollingInterval = (attempt: number): number => {
  const MINUTE = 60 * 1000;

  if (attempt < 30) {
    return 2 * MINUTE;
  }

  // After first hour: progressively increase interval
  // Formula: 15 + (attempt - 30) * 6 minutes
  return (15 + (attempt - 30) * 6) * MINUTE;
};

const DELETE_RETRY_DELAYS = [5_000, 30_000, 120_000];

export const deleteDocumentFromRag = internalAction({
  args: {
    documentId: v.id('documents'),
    attempt: v.optional(v.number()),
    // Retry-only path: the Tale row was deleted on a previous attempt; this
    // invocation is finishing the RAG-side cleanup with the cached key + slug.
    rowAlreadyDeleted: v.optional(v.boolean()),
    pendingRagFileId: v.optional(v.string()),
    pendingOrgSlug: v.optional(v.string()),
    /**
     * Snapshot-and-verify: when the caller (e.g. reconcile_deletes) knows
     * the externalItemId / fileId it intended to delete, pass them so we
     * can abort if the row was re-bound by an interleaving upsert (e.g.
     * a restore racing with a pending reconcile delete). Missing fields
     * preserve the legacy unconditional-delete behavior so already-
     * scheduled jobs from earlier code keep working.
     */
    expectedExternalItemId: v.optional(v.string()),
    expectedFileId: v.optional(v.id('_storage')),
    /**
     * Sync-reconcile only: forwarded to `deleteDocumentById` so the
     * mutation reaps now-empty ancestor folders up to (but not
     * including) this folder id (the sync target root).
     */
    cleanupAncestorsUpTo: v.optional(v.id('folders')),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const attempt = args.attempt ?? 0;

    let ragKey: string;
    let orgSlug: string;

    if (args.rowAlreadyDeleted) {
      if (!args.pendingRagFileId || !args.pendingOrgSlug) {
        console.error(
          `[deleteDocumentFromRag] retry invoked without cached key/slug for ${args.documentId}; aborting`,
        );
        return null;
      }
      ragKey = args.pendingRagFileId;
      orgSlug = args.pendingOrgSlug;
    } else {
      const document = await ctx.runQuery(
        internal.documents.internal_queries.getDocumentByIdRaw,
        { documentId: args.documentId },
      );

      if (!document?.fileId) {
        console.warn(
          `[deleteDocumentFromRag] Document ${args.documentId} has no fileId, skipping RAG delete`,
        );
        return null;
      }

      // Snapshot-and-verify (reconcile path): if the row's identifying
      // fields no longer match what the caller staged, abandon the
      // delete — the doc was re-bound (restore, externalItemId fixup,
      // or new upload under same documentId) since this job was
      // scheduled, and the orphan claim is stale.
      if (
        args.expectedExternalItemId !== undefined &&
        document.externalItemId !== args.expectedExternalItemId
      ) {
        console.warn(
          `[deleteDocumentFromRag] Aborting stale delete for ${args.documentId}: expected externalItemId=${args.expectedExternalItemId} but row now has ${document.externalItemId ?? 'undefined'}`,
        );
        return null;
      }
      if (
        args.expectedFileId !== undefined &&
        document.fileId !== args.expectedFileId
      ) {
        console.warn(
          `[deleteDocumentFromRag] Aborting stale delete for ${args.documentId}: expected fileId=${args.expectedFileId} but row now has ${document.fileId}`,
        );
        return null;
      }

      // Resolve slug OUTSIDE the retry-on-RAG-failure path. A missing slug
      // (org row deleted) is terminal — previously each retry re-threw
      // here, exhausted DELETE_RETRY_DELAYS, then "Document remains in
      // database" forever. Treat slug-missing as "RAG-side index is gone
      // too" and proceed with the local-row delete.
      const resolvedOrgSlug = await orgSlugFromIdOrNull(
        ctx,
        document.organizationId,
      );
      if (resolvedOrgSlug === null) {
        console.warn(
          `[deleteDocumentFromRag] org ${document.organizationId} unresolvable; assuming RAG index already purged and deleting local document ${args.documentId}`,
        );
        await ctx.runMutation(
          internal.documents.internal_mutations.deleteDocumentById,
          {
            documentId: args.documentId,
            cleanupAncestorsUpTo: args.cleanupAncestorsUpTo,
          },
        );
        return null;
      }

      ragKey = document.fileId;
      orgSlug = resolvedOrgSlug;

      // Tale-row first. assertNotHeld may throw on legal hold — when it
      // does, the RAG vectors stay intact (correct legal-hold semantics:
      // held docs remain both stored and searchable). The throw propagates
      // out of this action; scheduler logs it; no orphan side effects.
      await ctx.runMutation(
        internal.documents.internal_mutations.deleteDocumentById,
        {
          documentId: args.documentId,
          cleanupAncestorsUpTo: args.cleanupAncestorsUpTo,
        },
      );
    }

    // Tale row is now gone (either by this attempt or a previous one).
    // Best-effort corpus-side delete; retry only the delete step if it fails.
    // In-process delete is idempotent — a never-indexed / already-deleted
    // document returns success with `deletedCount: 0`.
    let ragSuccess = false;
    try {
      const result = await deleteDocumentById(ctx, {
        orgSlug,
        fileId: ragKey,
      });
      if (result.success) {
        ragSuccess = true;
      } else {
        console.error(
          `[deleteDocumentFromRag] RAG delete failed for ${args.documentId}: ${result.error ?? result.message}`,
        );
      }
    } catch (error) {
      console.error(
        `[deleteDocumentFromRag] RAG delete error for ${args.documentId}:`,
        error,
      );
    }

    if (!ragSuccess) {
      if (attempt < DELETE_RETRY_DELAYS.length) {
        console.warn(
          `[deleteDocumentFromRag] Tale row deleted; scheduling RAG-only retry ${attempt + 1}/${DELETE_RETRY_DELAYS.length} for ${args.documentId}`,
        );
        await ctx.scheduler.runAfter(
          DELETE_RETRY_DELAYS[attempt],
          internal.documents.internal_actions.deleteDocumentFromRag,
          {
            documentId: args.documentId,
            attempt: attempt + 1,
            rowAlreadyDeleted: true,
            pendingRagFileId: ragKey,
            pendingOrgSlug: orgSlug,
          },
        );
      } else {
        console.error(
          `[deleteDocumentFromRag] All RAG-side retries exhausted for ${args.documentId}. Tale row deleted; RAG entry may linger.`,
        );
      }
    }

    return null;
  },
});

export const uploadDocumentToRag = internalAction({
  args: {
    documentId: v.id('documents'),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    // RAG status is canonical on fileMetadata.ragStatus. This documents-pipeline
    // action keeps its synchronous upload but writes status + schedules the
    // server poll on the fileMetadata row (keyed by the document's storageId).
    // storageId is hoisted so the catch can still mark failure when the upload
    // throws after the document is resolved.
    let storageId: Id<'_storage'> | null = null;
    try {
      const document = await ctx.runQuery(
        internal.documents.internal_queries.getDocumentByIdRaw,
        { documentId: args.documentId },
      );

      if (!document) {
        throw new Error(`Document not found: ${args.documentId}`);
      }
      if (!document.fileId) {
        throw new Error(`Document has no file: ${args.documentId}`);
      }
      storageId = document.fileId;

      // Self-heal the canonical RAG-status home before writing status:
      // updateFileRagStatus below no-ops when the blob has no fileMetadata row
      // (e.g. a workflow-created or legacy file-backed doc), which would leave
      // status stuck. Schedules no extra upload — this action uploads below.
      await ctx.runMutation(
        internal.file_metadata.internal_mutations.ensureFileMetadataForDocument,
        {
          organizationId: document.organizationId,
          storageId: document.fileId,
          documentId: args.documentId,
          fileName: document.title ?? 'document',
          contentType: document.mimeType,
        },
      );

      const rawResult = await ragAction.execute(
        ctx,
        {
          operation: 'upload_document',
          fileId: document.fileId,
          fileName: document.title,
          contentType: document.mimeType,
          folderPath: document.folderPath,
        },
        { organizationId: document.organizationId },
      );
      const resultRec = isRecord(rawResult) ? rawResult : undefined;
      const success = resultRec
        ? (getBoolean(resultRec, 'success') ?? false)
        : false;

      if (success) {
        await ctx.runMutation(
          internal.file_metadata.internal_mutations.updateFileRagStatus,
          { storageId: document.fileId, ragStatus: 'queued' },
        );
        await ctx.scheduler.runAfter(
          INITIAL_POLLING_DELAY_MS,
          internal.file_metadata.internal_actions.pollFileRagStatus,
          {
            storageId: document.fileId,
            organizationId: document.organizationId,
            attempt: 1,
          },
        );
      } else {
        const error =
          (resultRec ? getString(resultRec, 'error') : undefined) ??
          'Upload to RAG failed';
        console.error(
          `[uploadDocumentToRag] Failed to upload document ${args.documentId}: ${error}`,
        );
        await ctx.runMutation(
          internal.file_metadata.internal_mutations.updateFileRagStatus,
          { storageId: document.fileId, ragStatus: 'failed', ragError: error },
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Upload to RAG failed';
      console.error(
        `[uploadDocumentToRag] Error uploading document ${args.documentId}: ${message}`,
      );
      if (storageId) {
        await ctx.runMutation(
          internal.file_metadata.internal_mutations.updateFileRagStatus,
          { storageId, ragStatus: 'failed', ragError: message },
        );
      }
      throw error;
    }

    return null;
  },
});

export const reindexDocumentInRag = internalAction({
  args: {
    documentId: v.id('documents'),
    oldFileId: v.id('_storage'),
    /** Optional for backward compatibility with in-flight scheduled jobs.
     * New scheduler callers always pass it; when missing we fall back
     * to the current document's organizationId (which may have changed
     * or been deleted — best-effort). */
    oldOrganizationId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    // upload-then-delete order: upload the new file first; only purge
    // `oldFileId` once the new chunks are committed. Previously the
    // delete ran before the upload, so a failed upload left the doc
    // with NO RAG entry (old chunks gone, new chunks never arrived) and
    // no automatic retry. Keeping the old entry around while the new
    // one queues means search still hits the previous revision until
    // re-index completes, and a failed upload is recoverable by
    // re-running this action on the same `oldFileId`.
    const document = await ctx.runQuery(
      internal.documents.internal_queries.getDocumentByIdRaw,
      { documentId: args.documentId },
    );

    // No current document or no new fileId — nothing to upload. We
    // still attempt the old-RAG delete below so chunks don't leak.
    if (!document || !document.fileId) {
      const deleteOrgIdNoUpload =
        args.oldOrganizationId ?? document?.organizationId ?? null;
      if (deleteOrgIdNoUpload) {
        await deleteOldRagEntry(
          ctx,
          deleteOrgIdNoUpload,
          args.oldFileId,
          args.documentId,
        );
      } else {
        console.warn(
          `[reindexDocumentInRag] No org context for old RAG delete; oldFileId ${args.oldFileId} may leak chunks (documentId=${args.documentId})`,
        );
      }
      return null;
    }

    // Title-only rename detection: when the caller passes the same fileId
    // as the row's current fileId, the upload would dedup against the
    // existing RAG row (RAG's content-hash dedup short-circuits before
    // touching `filename`), so the new title would never reach search
    // results. Purge the old RAG row FIRST so the subsequent upload
    // inserts a fresh row carrying the new filename. Brief search gap
    // until the new chunks land — acceptable; reconcile-tolerant.
    const sameFileId = args.oldFileId === document.fileId;
    if (sameFileId) {
      const deleteOrgId =
        args.oldOrganizationId ?? document.organizationId ?? null;
      if (deleteOrgId) {
        await deleteOldRagEntry(
          ctx,
          deleteOrgId,
          args.oldFileId,
          args.documentId,
        );
      } else {
        console.warn(
          `[reindexDocumentInRag] No org context for pre-upload old RAG delete; oldFileId ${args.oldFileId} may leak chunks (documentId=${args.documentId})`,
        );
      }
    }

    // Upload new file to RAG FIRST (for the content-change path; for the
    // same-fileId rename path the old row is already gone above).
    let uploadSuccess = false;
    try {
      const rawResult = await ragAction.execute(
        ctx,
        {
          operation: 'upload_document',
          fileId: document.fileId,
          fileName: document.title,
          contentType: document.mimeType,
          folderPath: document.folderPath,
        },
        { organizationId: document.organizationId },
      );
      const resultRec = isRecord(rawResult) ? rawResult : undefined;
      const success = resultRec
        ? (getBoolean(resultRec, 'success') ?? false)
        : false;

      if (success) {
        uploadSuccess = true;
        await ctx.runMutation(
          internal.file_metadata.internal_mutations.updateFileRagStatus,
          { storageId: document.fileId, ragStatus: 'queued' },
        );
        await ctx.scheduler.runAfter(
          INITIAL_POLLING_DELAY_MS,
          internal.file_metadata.internal_actions.pollFileRagStatus,
          {
            storageId: document.fileId,
            organizationId: document.organizationId,
            attempt: 1,
          },
        );
      } else {
        const error =
          (resultRec ? getString(resultRec, 'error') : undefined) ??
          'Re-index upload failed';
        await ctx.runMutation(
          internal.file_metadata.internal_mutations.updateFileRagStatus,
          { storageId: document.fileId, ragStatus: 'failed', ragError: error },
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Re-index upload failed';
      console.error(
        `[reindexDocumentInRag] Error re-indexing document ${args.documentId}: ${message}`,
      );
      await ctx.runMutation(
        internal.file_metadata.internal_mutations.updateFileRagStatus,
        { storageId: document.fileId, ragStatus: 'failed', ragError: message },
      );
    }

    // Content-change path: purge the old RAG entry once the new upload
    // is committed. A failed upload leaves the previous chunks in place
    // so search keeps returning the prior revision (degraded but
    // consistent) instead of returning nothing.
    //
    // Same-fileId (title-only rename) is already handled above by the
    // pre-upload delete, so we skip the post-upload purge for that path
    // to avoid deleting the freshly-uploaded chunks.
    if (uploadSuccess && !sameFileId) {
      const deleteOrgId =
        args.oldOrganizationId ?? document.organizationId ?? null;
      if (deleteOrgId) {
        await deleteOldRagEntry(
          ctx,
          deleteOrgId,
          args.oldFileId,
          args.documentId,
        );
      } else {
        console.warn(
          `[reindexDocumentInRag] No org context for old RAG delete; oldFileId ${args.oldFileId} may leak chunks (documentId=${args.documentId})`,
        );
      }
    }

    return null;
  },
});

const FOLDER_PATH_SYNC_BATCH_SIZE = 200;

/**
 * Best-effort sync of denormalized folder paths to the RAG service via
 * `PATCH /api/v1/documents/folder-paths` (no re-extraction/re-embedding).
 * Scheduled on folder moves/renames so the folder-scoped search filter
 * stays fresh.
 *
 * folder_path on the RAG side is a narrowing filter only — `file_ids`
 * stays the authorization boundary — so a failed sync degrades folder
 * filter precision but never leaks anything. Warn-and-skip on failure.
 */
export const syncRagFolderPaths = internalAction({
  args: {
    organizationId: v.string(),
    updates: v.array(
      v.object({
        fileId: v.id('_storage'),
        /** New folder path; omitted clears it (document moved to the root). */
        folderPath: v.optional(v.string()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if (args.updates.length === 0) return null;

    const orgSlug = await orgSlugFromIdOrNull(ctx, args.organizationId);
    if (orgSlug === null) {
      console.warn(
        `[syncRagFolderPaths] org ${args.organizationId} unresolvable; skipping folder-path sync for ${args.updates.length} file(s)`,
      );
      return null;
    }

    for (let i = 0; i < args.updates.length; i += FOLDER_PATH_SYNC_BATCH_SIZE) {
      const batch = args.updates.slice(i, i + FOLDER_PATH_SYNC_BATCH_SIZE);
      try {
        // In-process folder-path update (replaces the external RAG PATCH
        // `/api/v1/documents/folder-paths`).
        await ctx.runAction(internal.rag.documents.updateFolderPaths, {
          orgSlug,
          updates: batch.map((u) => ({
            file_id: u.fileId,
            folder_path: u.folderPath ?? null,
          })),
        });
      } catch (error) {
        console.warn(
          '[syncRagFolderPaths] Error syncing folder paths to RAG:',
          error,
        );
      }
    }

    return null;
  },
});

/**
 * Store raw string content (e.g. HTML) directly as a file in Convex storage.
 * Used by tools that generate content locally without the crawler service.
 */
export const storeRawContent = internalAction({
  args: {
    organizationId: v.string(),
    fileName: v.string(),
    content: v.string(),
    contentType: v.string(),
    extension: v.string(),
  },
  handler: async (ctx, args): Promise<GenerateDocumentResult> => {
    const bytes = new TextEncoder().encode(args.content);
    const size = bytes.byteLength;

    const uploadUrl = await ctx.storage.generateUploadUrl();
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': args.contentType },
      body: bytes,
    });

    if (!uploadResponse.ok) {
      throw new Error(
        `Failed to upload content: ${uploadResponse.status} ${uploadResponse.statusText}`,
      );
    }

    const { storageId } = await fetchJson<{ storageId: Id<'_storage'> }>(
      uploadResponse,
    );

    const lowerFileName = args.fileName.toLowerCase();
    const expectedSuffix = `.${args.extension.toLowerCase()}`;
    const finalFileName = lowerFileName.endsWith(expectedSuffix)
      ? args.fileName
      : `${args.fileName}.${args.extension}`;

    await ctx.runMutation(
      internal.file_metadata.internal_mutations.saveFileMetadata,
      {
        organizationId: args.organizationId,
        storageId,
        fileName: finalFileName,
        contentType: args.contentType,
        size,
        source: 'agent',
      },
    );

    const downloadUrl = buildDownloadUrl(storageId, finalFileName);

    return {
      success: true,
      fileStorageId: storageId,
      downloadUrl,
      fileName: finalFileName,
      contentType: args.contentType,
      size,
      extension: args.extension,
    };
  },
});
