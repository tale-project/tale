'use node';

import { v } from 'convex/values';

import { extractExtension } from '../../lib/shared/file-types';
import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { blobRefValidator } from '../lib/storage/blob_ref';

// Both RAG hooks below (`uploadFileToRag`, `pollFileRagStatus`)
// called the moved RAG pipeline (`convex/workflow_engine/action_defs/rag/`,
// `convex/rag/`) — gone with the rest of the knowledge-base rewrite. They are
// no-ops now so file/document upload mutations that schedule them (directly,
// or via `file_metadata/rag_dispatch.ts`) keep working; uploaded files simply
// stay un-indexed until the rewrite lands.

/**
 * RAG indexing is offline. Immediately marks the row
 * `'failed'` with an explanatory `ragError` (reusing the existing terminal
 * failure contract) instead of leaving it stuck at `'queued'`/`'running'`
 * forever with nothing left to advance it — the RAG watchdog and the client
 * poll (`checkFileRagStatuses`) are both gone/no-op too.
 */
export const uploadFileToRag = internalAction({
  args: {
    organizationId: v.string(),
    storageId: blobRefValidator,
    fileName: v.string(),
    contentType: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    console.debug(
      `[uploadFileToRag] RAG indexing is offline while the platform AI backend is rewritten; marking ${args.storageId} failed`,
    );
    await ctx.runMutation(
      internal.file_metadata.internal_mutations.updateFileRagStatus,
      {
        storageId: args.storageId,
        ragStatus: 'failed',
        ragError:
          'RAG indexing is offline while the platform AI backend is rewritten.',
      },
    );
    return null;
  },
});

/**
 * No-op. The RAG status poll this used to drive
 * (`internal.rag.documents.getStatuses`) no longer exists — `uploadFileToRag`
 * above no longer schedules this, but `documents/actions.ts` and
 * `documents/internal_actions.ts` still reference it directly, so it stays
 * exported as a harmless no-op rather than removed.
 */
export const pollFileRagStatus = internalAction({
  args: {
    storageId: blobRefValidator,
    organizationId: v.string(),
    attempt: v.number(),
  },
  returns: v.null(),
  handler: async (_ctx, args): Promise<null> => {
    console.debug(
      `[pollFileRagStatus] RAG status polling is offline while the platform AI backend is rewritten; not polling ${args.storageId} (attempt ${args.attempt})`,
    );
    return null;
  },
});

const EXTRACT_METADATA_EXTENSIONS = new Set(['pdf', 'docx', 'pptx']);
const IMAGE_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

/**
 * Extract vision/OCR metadata and document dates for an uploaded file.
 *
 * Triggered by saveFileMetadata on new inserts. For images, sets defaults
 * directly. For other file types (CSV, TXT, XLSX) and — the knowledge rebuild —
 * PDF/DOCX/PPTX, sets visionRequired=false.
 *
 * PDF/DOCX/PPTX in-process extraction
 * (`extractDocumentMetadata`) lived in `convex/crawler/lib/document_metadata`,
 * moved out with the rest of the crawler/RAG rewrite. Until it's restored,
 * these formats fall through to the same "no vision needed" default as plain
 * text formats — page count / scanned-page detection / source dates are not
 * populated, and a scanned PDF will not get OCR'd. `attempt` stays in the
 * args validator (unused) so the exported signature is unchanged for callers.
 */
export const extractFileMetadata = internalAction({
  args: {
    storageId: blobRefValidator,
    fileName: v.string(),
    contentType: v.string(),
    organizationId: v.string(),
    attempt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    // Images: always need vision, no crawler call needed
    if (IMAGE_CONTENT_TYPES.has(args.contentType)) {
      await ctx.runMutation(
        internal.file_metadata.internal_mutations.updateFileVisionMetadata,
        {
          storageId: args.storageId,
          pageCount: 1,
          scannedPagesDetected: 0,
          visionRequired: true,
        },
      );
      return null;
    }

    const ext = extractExtension(args.fileName);
    if (ext && EXTRACT_METADATA_EXTENSIONS.has(ext)) {
      console.debug(
        `[extractFileMetadata] in-process ${ext} metadata extraction is offline while the platform AI backend is rewritten; defaulting to no vision required for ${args.storageId}`,
      );
    }

    // PDF/DOCX/PPTX (offline, see above) and all other file types: no vision
    // needed.
    await ctx.runMutation(
      internal.file_metadata.internal_mutations.updateFileVisionMetadata,
      {
        storageId: args.storageId,
        scannedPagesDetected: 0,
        visionRequired: false,
      },
    );
    return null;
  },
});
