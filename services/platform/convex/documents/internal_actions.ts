'use node';

import { makeFunctionReference } from 'convex/server';
import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { indexFileBlob } from '../knowledge/ingest_file';
import {
  getKnowledgePoolForOrg,
  PRIVATE_KNOWLEDGE_SCHEMA,
} from '../knowledge/pool';
import type {
  DeleteDocumentArgs,
  DeleteDocumentResult,
} from '../legacy/knowledge_delete';
import { orgSlugFromIdOrNull } from '../lib/helpers/org_slug';
import {
  buildBlobServeUrl,
  buildDownloadUrl,
} from '../lib/helpers/public_storage_url';
import { putBlob } from '../lib/storage/blob_access';
import {
  blobRefValidator,
  isS3Ref,
  type BlobRef,
} from '../lib/storage/blob_ref';
// `generate_document` / `generate_docx` are `'use node'` modules and are NOT
// re-exported by the V8-reachable `./helpers` barrel — import them directly.
import { generateDocument as generateDocumentImpl } from './generate_document';
import {
  generateDocx as generateDocxImpl,
  type GenerateDocxResult,
} from './generate_docx';
import type { GenerateDocumentResult } from './types';
import { uploadBase64ToStorage } from './upload_base64_to_storage';

// The RAG hooks below (`uploadDocumentToRag`, `reindexDocumentInRag`,
// `deleteDocumentFromRag`'s corpus cleanup, `syncRagFolderPaths`) run against
// the rebuilt in-process ingestion pipeline: indexing goes through
// `indexFileBlob` (extract → embed → commit into the org's corpus), and
// corpus deletion through `legacy/knowledge_delete` — the same action GDPR
// erasure and retention cleanup already use.
//
// The corpus-delete reference is built by hand (the `convex/server` escape
// hatch, mirroring `governance/erasure.ts`): dereferencing
// `internal.legacy.knowledge_delete.*` from this module collapses the
// generated api types to `any` deployment-wide (the self-referential
// api-type trap — ~400 downstream implicit-any errors), while the hand-built
// reference stays type-only.
const deleteKnowledgeDocument = makeFunctionReference<
  'action',
  DeleteDocumentArgs,
  DeleteDocumentResult
>('legacy/knowledge_delete:deleteDocument');

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
 *
 * Kept — a pure function with no RAG dependency of its own.
 * Nothing schedules a poll loop that uses it any more (`file_metadata`'s
 * `pollFileRagStatus` is a no-op), but `get_polling_interval.test.ts` still
 * exercises it directly.
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

/**
 * Document CRUD must keep working, so this still deletes
 * the local Tale document row (the actual delete executor — the public
 * `deleteDocument` mutation only validates + schedules this). Only the
 * best-effort RAG-corpus cleanup (and its retry loop) is dropped: with RAG
 * offline there is no corpus entry to purge. See file header.
 */
export const deleteDocumentFromRag = internalAction({
  args: {
    documentId: v.id('documents'),
    attempt: v.optional(v.number()),
    // Retry-only path from the old RAG-delete-retry loop. Offline: no RAG
    // side to retry, so this branch is now just a compat no-op for any
    // already-scheduled job carrying it across the rewrite.
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
    expectedFileId: v.optional(blobRefValidator),
    /**
     * Sync-reconcile only: forwarded to `deleteDocumentById` so the
     * mutation reaps now-empty ancestor folders up to (but not
     * including) this folder id (the sync target root).
     */
    cleanupAncestorsUpTo: v.optional(v.id('folders')),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if (args.rowAlreadyDeleted) {
      // The local row was already deleted by a prior attempt of this same
      // job; only the corpus-side purge remained. Retry it when the caller
      // staged the corpus key; give up quietly otherwise (retention/erasure
      // sweeps are the backstop).
      if (args.pendingRagFileId && args.pendingOrgSlug) {
        try {
          await ctx.runAction(deleteKnowledgeDocument, {
            orgSlug: args.pendingOrgSlug,
            fileId: args.pendingRagFileId,
          });
        } catch (error) {
          console.warn(
            `[deleteDocumentFromRag] corpus purge retry failed for ${args.pendingRagFileId}:`,
            error instanceof Error ? error.message : error,
          );
        }
      }
      return null;
    }

    const document = await ctx.runQuery(
      internal.documents.internal_queries.getDocumentByIdRaw,
      { documentId: args.documentId },
    );

    if (!document) {
      console.warn(
        `[deleteDocumentFromRag] Document ${args.documentId} already gone, skipping`,
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

    // Capture the corpus key BEFORE the local row disappears.
    const purgeFileId = document.fileId ? String(document.fileId) : null;
    const purgeOrgSlug = document.fileId
      ? await orgSlugFromIdOrNull(ctx, document.organizationId)
      : null;

    await ctx.runMutation(
      internal.documents.internal_mutations.deleteDocumentById,
      {
        documentId: args.documentId,
        cleanupAncestorsUpTo: args.cleanupAncestorsUpTo,
      },
    );

    // Best-effort corpus purge — idempotent on a never-indexed blob. The
    // Tale row is already gone either way; a failed purge leaves orphan
    // chunks for the retention/erasure sweeps rather than blocking the
    // delete.
    if (purgeFileId !== null && purgeOrgSlug !== null) {
      try {
        await ctx.runAction(deleteKnowledgeDocument, {
          orgSlug: purgeOrgSlug,
          fileId: purgeFileId,
        });
      } catch (error) {
        console.warn(
          `[deleteDocumentFromRag] corpus purge failed for ${purgeFileId} (row deleted; sweeps will reap):`,
          error instanceof Error ? error.message : error,
        );
      }
    }
    return null;
  },
});

/**
 * Index a Document Hub row's blob into the organization's knowledge corpus.
 * Ensures the `fileMetadata` bookkeeping row first (status home, documentId
 * linkage), then runs the shared in-process pipeline with the document's
 * placement (folder path, source dates) riding along.
 */
export const uploadDocumentToRag = internalAction({
  args: {
    documentId: v.id('documents'),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const document = await ctx.runQuery(
      internal.documents.internal_queries.getDocumentByIdRaw,
      { documentId: args.documentId },
    );
    if (!document?.fileId) {
      console.debug(
        `[uploadDocumentToRag] Document ${args.documentId} not found or has no fileId; nothing to do`,
      );
      return null;
    }

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

    await indexFileBlob(ctx, {
      organizationId: document.organizationId,
      storageId: document.fileId,
      fileName: document.title ?? 'document',
      contentType: document.mimeType ?? 'application/octet-stream',
      folderPath: document.folderPath ?? null,
      sourceCreatedAtMs: document.sourceCreatedAt ?? null,
      sourceModifiedAtMs: document.sourceModifiedAt ?? null,
    });
    return null;
  },
});

/**
 * Re-index a replaced document, upload-then-delete: the new blob's chunks
 * are committed FIRST, and only then are the old blob's corpus rows purged —
 * so search keeps hitting the previous revision until the new one is
 * actually searchable, and a failed upload never leaves the document with no
 * corpus entry at all.
 */
export const reindexDocumentInRag = internalAction({
  args: {
    documentId: v.id('documents'),
    oldFileId: blobRefValidator,
    /** Optional for backward compatibility with in-flight scheduled jobs.
     * New scheduler callers always pass it; when missing we fall back
     * to the current document's organizationId (which may have changed
     * or been deleted — best-effort). */
    oldOrganizationId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const document = await ctx.runQuery(
      internal.documents.internal_queries.getDocumentByIdRaw,
      { documentId: args.documentId },
    );
    if (document?.fileId) {
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
      await indexFileBlob(ctx, {
        organizationId: document.organizationId,
        storageId: document.fileId,
        fileName: document.title ?? 'document',
        contentType: document.mimeType ?? 'application/octet-stream',
        folderPath: document.folderPath ?? null,
        sourceCreatedAtMs: document.sourceCreatedAt ?? null,
        sourceModifiedAtMs: document.sourceModifiedAt ?? null,
      });
    }

    // Purge the replaced blob's corpus rows — best-effort and idempotent
    // (`deleteDocument` answers success on a missing row); a failure here
    // leaves a stale-but-searchable revision behind, and retention/erasure
    // sweeps remain the backstop.
    if (String(args.oldFileId) === (document?.fileId ?? '')) return null;
    const organizationId =
      args.oldOrganizationId ?? document?.organizationId ?? null;
    if (organizationId === null) {
      console.warn(
        `[reindexDocumentInRag] no organization for oldFileId=${args.oldFileId}; skipping corpus purge`,
      );
      return null;
    }
    const orgSlug = await orgSlugFromIdOrNull(ctx, organizationId);
    if (orgSlug === null) {
      console.warn(
        `[reindexDocumentInRag] org ${organizationId} unresolvable; skipping corpus purge for oldFileId=${args.oldFileId}`,
      );
      return null;
    }
    try {
      await ctx.runAction(deleteKnowledgeDocument, {
        orgSlug,
        fileId: String(args.oldFileId),
      });
    } catch (error) {
      console.warn(
        `[reindexDocumentInRag] corpus purge failed for oldFileId=${args.oldFileId}:`,
        error instanceof Error ? error.message : error,
      );
    }
    return null;
  },
});

/**
 * No-op. RAG indexing is offline — no folder-scoped search
 * filter to keep fresh. See file header.
 */
export const syncRagFolderPaths = internalAction({
  args: {
    organizationId: v.string(),
    updates: v.array(
      v.object({
        fileId: blobRefValidator,
        /** New folder path; omitted clears it (document moved to the root). */
        folderPath: v.optional(v.string()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    // Folder-scoped retrieval filters on the corpus row's `folder_path`;
    // moving documents must keep it fresh or a folder filter serves stale
    // placement. Best-effort: a miss (never-indexed blob) updates 0 rows.
    if (args.updates.length === 0) return null;
    const orgSlug = await orgSlugFromIdOrNull(ctx, args.organizationId);
    if (orgSlug === null) {
      console.warn(
        `[syncRagFolderPaths] org ${args.organizationId} unresolvable; skipping ${args.updates.length} folder-path update(s)`,
      );
      return null;
    }
    try {
      const sql = await getKnowledgePoolForOrg(orgSlug);
      for (const update of args.updates) {
        await sql.unsafe(
          `UPDATE ${PRIVATE_KNOWLEDGE_SCHEMA}.documents
              SET folder_path = $3, updated_at = NOW()
            WHERE org_slug = $1 AND file_id = $2`,
          [orgSlug, String(update.fileId), update.folderPath ?? null],
        );
      }
    } catch (error) {
      console.warn(
        `[syncRagFolderPaths] corpus update failed for org ${orgSlug}:`,
        error instanceof Error ? error.message : error,
      );
    }
    return null;
  },
});

/**
 * Store raw string content (e.g. HTML) directly as a file in Convex storage.
 * Used by tools that generate content locally without the crawler service.
 *
 * Unaffected by the AI-backend rewrite — no RAG/provider dependency.
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

    // Store through the backend-aware seam: an org with a bring-your-own bucket
    // gets the blob in its own S3, else Convex `_storage` (unchanged). The slug
    // resolves the org's store; a missing slug falls through to the default.
    const orgSlug = (await orgSlugFromIdOrNull(ctx, args.organizationId)) ?? '';
    const storageId: BlobRef = await putBlob(
      ctx,
      orgSlug,
      bytes,
      args.contentType,
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

    // An `s3:` blob is served through the node `/storage` route (which presigns
    // + 302-redirects); the `org` param addresses the right bucket. A Convex
    // blob keeps the direct `/storage?id=` download URL.
    const downloadUrl = isS3Ref(storageId)
      ? buildBlobServeUrl(String(storageId), args.organizationId, finalFileName)
      : buildDownloadUrl(String(storageId), finalFileName);

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

/**
 * Store base64-encoded file bytes as a blob (no document row) — the thin
 * registered wrapper `uploadBase64ToStorage`'s own doc asks for. Binary
 * seeding lanes (connector imports, test fixtures) pair it with
 * `upsertDocumentByExternalId` to file the blob into a folder.
 */
export const uploadFileFromBase64 = internalAction({
  args: {
    organizationId: v.string(),
    fileName: v.string(),
    contentType: v.string(),
    dataBase64: v.string(),
  },
  returns: v.object({
    fileStorageId: v.id('_storage'),
    size: v.number(),
  }),
  handler: async (ctx, args) => {
    const uploaded = await uploadBase64ToStorage(ctx, args);
    return { fileStorageId: uploaded.fileStorageId, size: uploaded.size };
  },
});
