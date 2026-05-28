'use node';

import { v } from 'convex/values';

import { extractExtension } from '../../lib/shared/file-types';
import { isRecord, getNumber } from '../../lib/utils/type-guards';
import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { getCrawlerUrl } from '../documents/generate_document_helpers';
import {
  isUpstreamHttpError,
  UpstreamHttpError,
} from '../lib/errors/upstream_http_error';
import { orgSlugFromId } from '../lib/helpers/org_slug';
import { ragAction } from '../workflow_engine/action_defs/rag/rag_action';

/**
 * Upload a file to the RAG service for indexing.
 *
 * Triggered by saveFileMetadata on new inserts. Only uploads — status
 * polling is driven by the client via checkFileRagStatus.
 */
export const uploadFileToRag = internalAction({
  args: {
    storageId: v.id('_storage'),
    fileName: v.string(),
    contentType: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    try {
      await ragAction.execute(
        ctx,
        {
          operation: 'upload_document',
          fileId: args.storageId,
          fileName: args.fileName,
          contentType: args.contentType,
        },
        {},
      );
    } catch (error) {
      console.error(
        `[uploadFileToRag] Failed to upload file ${args.storageId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      await ctx.runMutation(
        internal.file_metadata.internal_mutations.updateFileRagStatus,
        {
          storageId: args.storageId,
          ragStatus: 'failed',
          ragError: error instanceof Error ? error.message : String(error),
        },
      );
    }

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
const EXTRACT_METADATA_RETRY_DELAYS = [30_000, 60_000, 120_000];

/**
 * Extract vision/OCR metadata and document dates for an uploaded file.
 *
 * Triggered by saveFileMetadata on new inserts. For PDF/DOCX/PPTX, calls
 * the crawler extract-metadata endpoint. For images, sets defaults directly.
 * For other file types (CSV, TXT, XLSX), sets visionRequired=false.
 */
export const extractFileMetadata = internalAction({
  args: {
    storageId: v.id('_storage'),
    fileName: v.string(),
    contentType: v.string(),
    organizationId: v.string(),
    attempt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const attempt = args.attempt ?? 0;
    const ext = extractExtension(args.fileName);

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

    // PDF/DOCX/PPTX: call crawler extract-metadata
    if (ext && EXTRACT_METADATA_EXTENSIONS.has(ext)) {
      try {
        const fileUrl = await ctx.storage.getUrl(args.storageId);
        if (!fileUrl) {
          console.warn(
            `[extractFileMetadata] No URL for file ${args.storageId}, skipping`,
          );
          return null;
        }

        const fileResponse = await fetch(fileUrl, {
          signal: AbortSignal.timeout(30_000),
        });
        if (!fileResponse.ok) {
          throw new Error(
            `Failed to download file: ${fileResponse.status} ${fileResponse.statusText}`,
          );
        }

        const fileBlob = await fileResponse.blob();
        const crawlerUrl = getCrawlerUrl();
        const endpoint = `${crawlerUrl}/api/v1/${ext}/extract-metadata`;
        const orgSlug = await orgSlugFromId(ctx, args.organizationId);

        const formData = new FormData();
        formData.append('file', fileBlob, args.fileName);

        const metadataResponse = await fetch(endpoint, {
          method: 'POST',
          headers: { 'x-tale-org': orgSlug },
          body: formData,
          signal: AbortSignal.timeout(30_000),
        });

        if (!metadataResponse.ok) {
          const errorText = await metadataResponse.text().catch(() => '');
          throw UpstreamHttpError.fromResponse(
            'crawler',
            metadataResponse,
            errorText,
            `/api/v1/${ext}/extract-metadata`,
          );
        }

        let body: unknown;
        try {
          body = await metadataResponse.json();
        } catch {
          throw new Error('Crawler returned non-JSON response');
        }

        if (!isRecord(body)) {
          throw new Error(
            'Invalid response shape from crawler extract-metadata',
          );
        }

        const pageCount = getNumber(body, 'page_count');
        const scannedPagesDetected = getNumber(body, 'scanned_pages_detected');
        const createdAt = getNumber(body, 'created_at');
        const modifiedAt = getNumber(body, 'modified_at');

        // Write vision metadata to fileMetadata
        await ctx.runMutation(
          internal.file_metadata.internal_mutations.updateFileVisionMetadata,
          {
            storageId: args.storageId,
            pageCount: pageCount ?? undefined,
            scannedPagesDetected: scannedPagesDetected ?? undefined,
            visionRequired:
              scannedPagesDetected != null ? scannedPagesDetected > 0 : false,
          },
        );

        // Write dates and scanned page info to linked document (if any)
        const fileMetadata = await ctx.runQuery(
          internal.file_metadata.internal_queries.getByStorageId,
          { storageId: args.storageId },
        );

        if (fileMetadata?.documentId) {
          await ctx.runMutation(
            internal.documents.internal_mutations.updateDocumentDates,
            {
              documentId: fileMetadata.documentId,
              sourceCreatedAt: createdAt,
              sourceModifiedAt: modifiedAt,
              scannedPagesDetected: scannedPagesDetected ?? undefined,
            },
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Default to permanent. Only the upstream `UpstreamHttpError` path
        // gives us a positive retry signal (`retryable` set from
        // 5xx/408/429 classification). Everything else — `orgSlugFromId`
        // throws, malformed JSON, "Invalid response shape", blob fetch
        // failures before we even hit the crawler — is treated as
        // non-transient: retrying 3× burns scheduler slots without
        // progress. The trade-off (a genuine network blip surfaces as
        // a permanent failure instead of self-healing) is acceptable
        // because the original deterministic-error retry storms were
        // far more damaging.
        const isTransient = isUpstreamHttpError(error) && error.retryable;
        console.error(
          `[extractFileMetadata] Error for file ${args.storageId} (attempt ${attempt}, transient=${isTransient}): ${message}`,
        );

        if (!isTransient) {
          console.warn(
            `[extractFileMetadata] Permanent failure for file ${args.storageId}; not retrying: ${message}`,
          );
          // Stamp a terminal marker so downstream consumers exit the
          // "still extracting" state. Without this, visionRequired
          // stayed undefined forever on a permanent failure and the
          // UI / scannedPagesDetected gating couldn't distinguish
          // "extraction pending" from "extraction failed". We treat
          // permanent failure as "no vision needed" — RAG will still
          // pick up the file via the other ingest path.
          try {
            await ctx.runMutation(
              internal.file_metadata.internal_mutations
                .updateFileVisionMetadata,
              {
                storageId: args.storageId,
                scannedPagesDetected: 0,
                visionRequired: false,
              },
            );
          } catch (markerErr) {
            console.warn(
              `[extractFileMetadata] Failed to stamp permanent-failure marker for ${args.storageId}:`,
              markerErr instanceof Error ? markerErr.message : markerErr,
            );
          }
        } else if (attempt < EXTRACT_METADATA_RETRY_DELAYS.length) {
          const retryDelay = EXTRACT_METADATA_RETRY_DELAYS[attempt];
          await ctx.scheduler.runAfter(
            retryDelay,
            internal.file_metadata.internal_actions.extractFileMetadata,
            {
              storageId: args.storageId,
              fileName: args.fileName,
              contentType: args.contentType,
              organizationId: args.organizationId,
              attempt: attempt + 1,
            },
          );
        } else {
          console.warn(
            `[extractFileMetadata] All retries exhausted for file ${args.storageId}: ${message}`,
          );
        }
      }
      return null;
    }

    // All other file types: no vision needed
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
