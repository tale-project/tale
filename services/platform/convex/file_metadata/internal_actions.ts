'use node';

import { v } from 'convex/values';

import { extractExtension } from '../../lib/shared/file-types';
import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { indexFileBlob } from '../knowledge/ingest_file';
import { blobRefValidator } from '../lib/storage/blob_ref';

/**
 * Index one uploaded file into the organization's knowledge corpus —
 * dispatched by `rag_dispatch.ts` under the per-org/global concurrency caps.
 *
 * The work happens IN PROCESS (`indexFileBlob`: read blob → extract text →
 * embed → commit chunks slice by slice) and every outcome lands on the
 * `fileMetadata` row, so there is no status poll: the row IS the status.
 * The optional hub fields carry a Document Hub row's placement into the
 * corpus without a second dispatch path.
 */
export const uploadFileToRag = internalAction({
  args: {
    organizationId: v.string(),
    storageId: blobRefValidator,
    fileName: v.string(),
    contentType: v.string(),
    folderPath: v.optional(v.string()),
    sourceCreatedAtMs: v.optional(v.number()),
    sourceModifiedAtMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await indexFileBlob(ctx, {
      organizationId: args.organizationId,
      storageId: args.storageId,
      fileName: args.fileName,
      contentType: args.contentType,
      ...(args.folderPath !== undefined ? { folderPath: args.folderPath } : {}),
      ...(args.sourceCreatedAtMs !== undefined
        ? { sourceCreatedAtMs: args.sourceCreatedAtMs }
        : {}),
      ...(args.sourceModifiedAtMs !== undefined
        ? { sourceModifiedAtMs: args.sourceModifiedAtMs }
        : {}),
    });
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
