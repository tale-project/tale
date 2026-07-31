'use node';

/**
 * File → corpus, in process: the ingestion half of the knowledge rebuild.
 *
 * One function, {@link indexFileBlob}, owns the whole journey — read the
 * blob, extract its text, resolve the organization's pool and embedding
 * model, and hand the text to `indexDocument` slice by slice — and BOTH
 * ingestion actions (`uploadFileToRag` for plain uploads,
 * `uploadDocumentToRag` for Document Hub rows) call it, so there is exactly
 * one place status transitions are decided.
 *
 * Status contract (`fileMetadata.ragStatus`, written through
 * `updateFileRagStatus`):
 *
 *  - `running` the moment work starts, with a human-readable `ragProgress`
 *    that advances per committed slice — the badge shows it live.
 *  - `completed` when every chunk is committed (or the content was already
 *    indexed — dedup and unchanged re-uploads are successes, not errors).
 *  - `unsupported` for a format no extractor can read TODAY: images and
 *    scanned documents need the OCR/vision arm, which has not been rebuilt.
 *    Unsupported is terminal and the retry surface refuses it, because
 *    retrying reproduces the same answer.
 *  - `failed` for everything else, with `ragError` naming the cause in
 *    words the uploader can act on (no embedding model configured, secret
 *    detected, extraction failure, provider error). Failed rows keep the
 *    Retry affordance.
 *
 * Large documents: `indexDocument` commits one slice per call and resumes
 * from the committed prefix. This function loops slices in process and, past
 * a per-invocation budget, reschedules ITSELF (same args) through the
 * scheduler — the resumed run re-extracts (cheap, deterministic) and the
 * ingest plan skips the committed prefix. A run killed at the Convex action
 * ceiling is picked up by the RAG watchdog, which re-queues stale rows.
 */

import { extname } from 'node:path';

import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { orgSlugFromIdOrNull } from '../lib/helpers/org_slug';
import { SUPPORTED_IMAGE_EXTENSIONS } from '../lib/knowledge/extraction/image';
import { extractText, isSupported } from '../lib/knowledge/extraction/router';
import { readBlobBytes } from '../lib/storage/blob_access';
import type { BlobRef } from '../lib/storage/blob_ref';
import { sanitizeError } from '../lib/utils/sanitize_secrets';
import { readOrgEmbeddingConfig } from './connection';
import { pinDimensions } from './dimensions';
import { EmbeddingNotConfigured, embedderForOrg } from './embedding';
import { indexDocument } from './indexing';
import {
  getKnowledgePoolForOrg,
  PRIVATE_KNOWLEDGE_SCHEMA,
  resolveOrgUrl,
} from './pool';
import { RAG_ERROR_EMBEDDING_NOT_CONFIGURED } from './rag_error_codes';

/** Slices committed per invocation before the continuation reschedules —
 * bounds one run well under the Convex action ceiling while still moving
 * ~20 × 64 chunks of a large document per hop. */
const MAX_SLICES_PER_INVOCATION = 20;

/** Enough of an upstream error for the badge dialog, never a whole body. */
const ERROR_EXCERPT = 300;

const UNSUPPORTED_IMAGE_MESSAGE =
  'Images need the OCR/vision arm of the indexing pipeline, which is not ' +
  'available yet.';

const EMPTY_TEXT_MESSAGE =
  'No text could be extracted from this file. A scanned document needs ' +
  'OCR, which is not available yet — re-upload a text-based copy to index it.';

export interface IndexFileBlobArgs {
  readonly organizationId: string;
  readonly storageId: BlobRef;
  readonly fileName: string;
  readonly contentType: string;
  /** Document Hub placement, when the blob backs a hub document. */
  readonly folderPath?: string | null;
  readonly sourceCreatedAtMs?: number | null;
  readonly sourceModifiedAtMs?: number | null;
}

type RagStatusPatch = {
  ragStatus: 'running' | 'completed' | 'failed' | 'unsupported';
  ragError?: string;
  ragProgress?: string;
};

async function writeStatus(
  ctx: ActionCtx,
  storageId: BlobRef,
  patch: RagStatusPatch,
): Promise<void> {
  await ctx.runMutation(
    internal.file_metadata.internal_mutations.updateFileRagStatus,
    { storageId, ...patch },
  );
}

/**
 * Index one uploaded blob into its organization's `private_knowledge`
 * corpus. Never throws — every outcome, success or failure, lands on the
 * `fileMetadata` row where the badge (and the watchdog) read it.
 */
export async function indexFileBlob(
  ctx: ActionCtx,
  args: IndexFileBlobArgs,
): Promise<void> {
  const { storageId } = args;
  try {
    await writeStatus(ctx, storageId, {
      ragStatus: 'running',
      ragProgress: 'Extracting text…',
    });

    const orgSlug = await orgSlugFromIdOrNull(ctx, args.organizationId);
    if (orgSlug === null) {
      await writeStatus(ctx, storageId, {
        ragStatus: 'failed',
        ragError: 'Organization unresolvable (deleted or missing slug).',
      });
      return;
    }

    const suffix = extname(args.fileName).toLowerCase();
    if (SUPPORTED_IMAGE_EXTENSIONS.has(suffix)) {
      await writeStatus(ctx, storageId, {
        ragStatus: 'unsupported',
        ragError: UNSUPPORTED_IMAGE_MESSAGE,
      });
      return;
    }
    if (!isSupported(args.fileName)) {
      await writeStatus(ctx, storageId, {
        ragStatus: 'unsupported',
        ragError: `No text extractor exists for "${suffix || args.contentType}" files.`,
      });
      return;
    }

    const bytes = await readBlobBytes(ctx, orgSlug, storageId);
    const [text] = await extractText(bytes, args.fileName, {
      visionClient: null,
    });

    if (text.trim().length === 0) {
      await writeStatus(ctx, storageId, {
        ragStatus: 'failed',
        ragError: EMPTY_TEXT_MESSAGE,
      });
      return;
    }

    // Resolve the org's embedding model and corpus pool. Both refuse loudly
    // (no model configured, BYO database unreachable, vector width mismatch)
    // — each refusal names the fix, so it lands on the row verbatim.
    const config = await readOrgEmbeddingConfig(orgSlug);
    const embedder = await embedderForOrg(ctx, {
      organizationId: args.organizationId,
      orgSlug,
      config,
    });
    const [sql, dbUrl] = await Promise.all([
      getKnowledgePoolForOrg(orgSlug),
      resolveOrgUrl(orgSlug),
    ]);
    await pinDimensions({
      sql,
      dbUrl,
      schema: PRIVATE_KNOWLEDGE_SCHEMA,
      dimensions: embedder.dimensions,
      context: `organization "${orgSlug}"`,
    });

    const fileId = String(storageId);
    // The secret scan runs on the FIRST slice only — one scan per content.
    let scanBytes: Uint8Array | undefined = bytes;
    let written = 0;
    for (let slice = 0; slice < MAX_SLICES_PER_INVOCATION; slice += 1) {
      const result = await indexDocument({
        sql,
        orgSlug,
        fileId,
        filename: args.fileName,
        text,
        ...(scanBytes !== undefined ? { bytes: scanBytes } : {}),
        embedder,
        folderPath: args.folderPath ?? null,
        sourceCreatedAt:
          args.sourceCreatedAtMs != null
            ? new Date(args.sourceCreatedAtMs)
            : null,
        sourceModifiedAt:
          args.sourceModifiedAtMs != null
            ? new Date(args.sourceModifiedAtMs)
            : null,
      });
      scanBytes = undefined;

      if (result.skipped === 'secret-detected') {
        await writeStatus(ctx, storageId, {
          ragStatus: 'failed',
          ragError:
            result.refusal ??
            'The file appears to contain a credential and was not indexed.',
        });
        return;
      }
      if (result.skipped === 'empty') {
        await writeStatus(ctx, storageId, {
          ragStatus: 'failed',
          ragError: EMPTY_TEXT_MESSAGE,
        });
        return;
      }

      if (!result.partial) {
        await writeStatus(ctx, storageId, { ragStatus: 'completed' });
        return;
      }

      // A continuation run's counter restarts at the committed prefix, so
      // the hint under-reports briefly after a hop — a progress hint, not a
      // ledger.
      written += result.chunksWritten;
      await writeStatus(ctx, storageId, {
        ragStatus: 'running',
        ragProgress: `Indexed ${written} of ${result.chunksTotal} chunks`,
      });
    }

    // Slice budget spent with chunks remaining: hand the tail to a fresh
    // invocation. The resumed run re-extracts and the plan skips the
    // committed prefix, so no work is lost and no run outgrows its budget.
    await ctx.scheduler.runAfter(
      0,
      internal.file_metadata.internal_actions.uploadFileToRag,
      {
        organizationId: args.organizationId,
        storageId,
        fileName: args.fileName,
        contentType: args.contentType,
        ...(args.folderPath != null ? { folderPath: args.folderPath } : {}),
        ...(args.sourceCreatedAtMs != null
          ? { sourceCreatedAtMs: args.sourceCreatedAtMs }
          : {}),
        ...(args.sourceModifiedAtMs != null
          ? { sourceModifiedAtMs: args.sourceModifiedAtMs }
          : {}),
      },
    );
  } catch (error) {
    const notConfigured = error instanceof EmbeddingNotConfigured;
    const reason = notConfigured
      ? error.message
      : `Indexing failed: ${sanitizeError(error, ERROR_EXCERPT)}`;
    console.error(
      `[indexFileBlob] indexing failed for ${String(storageId)}:`,
      error instanceof Error ? error.message : error,
    );
    try {
      await writeStatus(ctx, storageId, {
        ragStatus: 'failed',
        ragError: reason,
        // The stable code lets the failed-indexing dialog deep-link the fix
        // (Settings → Data residency) instead of dead-ending on prose.
        ...(notConfigured
          ? { ragErrorCode: RAG_ERROR_EMBEDDING_NOT_CONFIGURED }
          : {}),
      });
    } catch (statusError) {
      console.error(
        `[indexFileBlob] could not record the failure for ${String(storageId)}:`,
        statusError,
      );
    }
  }
}
