'use node';

import { v } from 'convex/values';

import { extractExtension } from '../../lib/shared/file-types';
import {
  isRecord,
  getNumber,
  getString,
  getBoolean,
} from '../../lib/utils/type-guards';
import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { getCrawlerUrl } from '../documents/generate_document_helpers';
import { getPollingInterval } from '../documents/internal_actions';
import {
  isUpstreamHttpError,
  UpstreamHttpError,
} from '../lib/errors/upstream_http_error';
import { orgSlugFromIdOrNull } from '../lib/helpers/org_slug';
import { ragFetch } from '../lib/helpers/rag_config';
import { ragAction } from '../workflow_engine/action_defs/rag/rag_action';

const INITIAL_POLLING_DELAY_MS = 10_000;
const MAX_POLL_ATTEMPTS = 50;

/**
 * Upload a file to the RAG service for indexing, then start a server-driven
 * status poll.
 *
 * Triggered by saveFileMetadata on new inserts. The chat UI's
 * checkFileRagStatuses still polls while a chat is open, but it is the only
 * client poller — so this schedules pollFileRagStatus to advance status to
 * 'completed' server-side even when no client is watching (e.g. a Document-Hub
 * upload). Both pollers hit the same RAG /statuses endpoint and write the same
 * canonical fileMetadata.ragStatus.
 */
export const uploadFileToRag = internalAction({
  args: {
    organizationId: v.string(),
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
        { organizationId: args.organizationId },
      );
      await ctx.scheduler.runAfter(
        INITIAL_POLLING_DELAY_MS,
        internal.file_metadata.internal_actions.pollFileRagStatus,
        {
          storageId: args.storageId,
          organizationId: args.organizationId,
          attempt: 1,
        },
      );
    } catch (error) {
      // For upstream HTTP errors, keep the response detail (e.g. FastAPI's
      // "Unsupported file type: .xls …" or a secret-scanner rejection) —
      // `bodySnippet` is already truncated and secret-scrubbed by
      // `sanitizeError`. Without it, a RAG 4xx stores an unactionable
      // "returned HTTP 400." as the failure reason.
      const ragError = isUpstreamHttpError(error)
        ? [error.safeMessage, error.bodySnippet].filter(Boolean).join(' ')
        : error instanceof Error
          ? error.message
          : String(error);
      console.error(
        `[uploadFileToRag] Failed to upload file ${args.storageId}: ${ragError}`,
      );
      await ctx.runMutation(
        internal.file_metadata.internal_mutations.updateFileRagStatus,
        {
          storageId: args.storageId,
          ragStatus: 'failed',
          ragError,
        },
      );
    }

    return null;
  },
});

/**
 * Server-driven RAG status poller for a single fileMetadata row.
 *
 * Scheduled by uploadFileToRag after the blob is pushed to RAG. Self-reschedules
 * (progressive backoff via getPollingInterval) until ragStatus is terminal,
 * writing the canonical fileMetadata.ragStatus via updateFileRagStatus. This is
 * the server-side counterpart to the chat UI's checkFileRagStatuses poll — both
 * hit the same RAG /statuses endpoint and write the same field — so every
 * upload reaches 'completed' even with no client polling. Source dates / OCR are
 * handled separately by extractFileMetadata, so this only advances status.
 */
export const pollFileRagStatus = internalAction({
  args: {
    storageId: v.id('_storage'),
    organizationId: v.string(),
    attempt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const metadata = await ctx.runQuery(
      internal.file_metadata.internal_queries.getByStorageId,
      { storageId: args.storageId },
    );
    // Row gone, never RAG-queued (audio → transcript pipeline), or already
    // terminal → nothing to advance.
    if (
      !metadata ||
      metadata.ragStatus === undefined ||
      metadata.ragStatus === 'completed' ||
      metadata.ragStatus === 'failed'
    ) {
      return null;
    }

    if (args.attempt > MAX_POLL_ATTEMPTS) {
      console.warn(
        `[pollFileRagStatus] Max attempts (${MAX_POLL_ATTEMPTS}) reached for ${args.storageId}`,
      );
      await ctx.runMutation(
        internal.file_metadata.internal_mutations.updateFileRagStatus,
        {
          storageId: args.storageId,
          ragStatus: 'failed',
          ragError: `Status check timed out after ${MAX_POLL_ATTEMPTS} attempts`,
        },
      );
      return null;
    }

    // A missing/unresolvable slug is terminal — retrying just re-throws.
    const orgSlug = await orgSlugFromIdOrNull(ctx, args.organizationId);
    if (orgSlug === null) {
      console.warn(
        `[pollFileRagStatus] org ${args.organizationId} unresolvable for ${args.storageId}; marking failed (no retry)`,
      );
      await ctx.runMutation(
        internal.file_metadata.internal_mutations.updateFileRagStatus,
        {
          storageId: args.storageId,
          ragStatus: 'failed',
          ragError: 'Organization unresolvable (deleted or missing slug).',
        },
      );
      return null;
    }

    const reschedule = () =>
      ctx.scheduler.runAfter(
        getPollingInterval(args.attempt),
        internal.file_metadata.internal_actions.pollFileRagStatus,
        {
          storageId: args.storageId,
          organizationId: args.organizationId,
          attempt: args.attempt + 1,
        },
      );

    try {
      const response = await ragFetch('/api/v1/documents/statuses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_ids: [args.storageId] }),
        timeoutMs: 10_000,
        orgSlug,
      });

      if (response.status === 429 || (!response.ok && response.status >= 500)) {
        await reschedule();
        return null;
      }
      if (response.status >= 400 && response.status < 500) {
        console.error(
          `[pollFileRagStatus] RAG returned ${response.status} for ${args.storageId}, not retrying`,
        );
        await ctx.runMutation(
          internal.file_metadata.internal_mutations.updateFileRagStatus,
          {
            storageId: args.storageId,
            ragStatus: 'failed',
            ragError: `RAG service returned ${response.status}`,
          },
        );
        return null;
      }
      if (!response.ok) {
        await reschedule();
        return null;
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        await reschedule();
        return null;
      }
      if (!isRecord(body) || !isRecord(body.statuses)) {
        await reschedule();
        return null;
      }

      const docStatus = body.statuses[args.storageId];
      if (!isRecord(docStatus)) {
        // RAG hasn't ingested it yet — keep polling.
        await reschedule();
        return null;
      }

      const status = getString(docStatus, 'status');
      const error = getString(docStatus, 'error');
      const progressPhase = getString(docStatus, 'progress_phase');
      const progressDetail = getString(docStatus, 'progress_detail');
      const ragProgress =
        progressPhase && progressDetail
          ? `${progressPhase} ${progressDetail}`
          : progressPhase || undefined;

      if (status === 'completed') {
        const ocrApplied = getBoolean(docStatus, 'ocr_applied');
        await ctx.runMutation(
          internal.file_metadata.internal_mutations.updateFileRagStatus,
          {
            storageId: args.storageId,
            ragStatus: 'completed',
            ...(ocrApplied != null && { ocrApplied }),
          },
        );
        return null;
      }
      if (status === 'failed') {
        await ctx.runMutation(
          internal.file_metadata.internal_mutations.updateFileRagStatus,
          {
            storageId: args.storageId,
            ragStatus: 'failed',
            ragError: error || 'Unknown error',
          },
        );
        return null;
      }
      if (status === 'processing') {
        await ctx.runMutation(
          internal.file_metadata.internal_mutations.updateFileRagStatus,
          { storageId: args.storageId, ragStatus: 'running', ragProgress },
        );
      }
      await reschedule();
    } catch (error) {
      console.error(
        `[pollFileRagStatus] Error (attempt ${args.attempt}/${MAX_POLL_ATTEMPTS}):`,
        error,
      );
      await reschedule();
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
      // Resolve org slug OUTSIDE the try block. Previously the lookup
      // sat inside the catch-permanent branch — a slug miss got
      // classified as "permanent" and stamped `visionRequired:false`,
      // permanently disabling vision/OCR for legitimate uploads on a
      // deleted-org race. With `OrNull` we exit cleanly without
      // stamping a terminal marker, leaving the row's pending state
      // alone so a subsequent ingest can re-run.
      const orgSlug = await orgSlugFromIdOrNull(ctx, args.organizationId);
      if (orgSlug === null) {
        console.warn(
          `[extractFileMetadata] org ${args.organizationId} unresolvable; skipping vision-metadata extraction for storageId=${args.storageId} (will not stamp permanent-failure marker)`,
        );
        return null;
      }

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
