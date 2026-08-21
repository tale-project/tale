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
import type { Id } from '../_generated/dataModel';
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
  /**
   * Document scope, from the backing document row (`teamTags`/`projectId` —
   * mutually exclusive; both absent = org hub, which is also what plain file
   * uploads with no document row get). Stamped onto the corpus row so
   * retrieval can filter by the caller's visibility. `teamIds` is the FULL
   * team list of a shared document; `teamId` is the deprecated single-team
   * form, still accepted so scheduled jobs staged before the multi-team
   * change (and any not-yet-updated caller) keep their scope — `teamIds`
   * wins when both are present, mirroring `hasTeamAccess`.
   */
  readonly teamIds?: readonly string[] | null;
  readonly teamId?: string | null;
  readonly projectId?: string | null;
  readonly sourceCreatedAtMs?: number | null;
  readonly sourceModifiedAtMs?: number | null;
  /** Backing Document Hub row. When present, every corpus/status write is
   * fenced against its current fileId so an outgoing worker cannot resurrect
   * stale chunks after a draft replacement. */
  readonly documentId?: Id<'documents'>;
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
  expectedDocumentId?: Id<'documents'>,
): Promise<void> {
  await ctx.runMutation(
    internal.file_metadata.internal_mutations.updateFileRagStatus,
    {
      storageId,
      ...patch,
      ...(expectedDocumentId !== undefined ? { expectedDocumentId } : {}),
    },
  );
}

async function stopSupersededDocumentIndex(
  ctx: ActionCtx,
  args: IndexFileBlobArgs,
): Promise<boolean> {
  if (args.documentId === undefined) return false;
  const current = await ctx.runQuery(
    internal.documents.internal_queries.getDocumentByIdRaw,
    { documentId: args.documentId },
  );
  if ((current?.fileId ?? '') === args.storageId) return false;

  await writeStatus(ctx, args.storageId, {
    ragStatus: 'failed',
    ragError: 'Indexing stopped because this file was replaced.',
  });
  return true;
}

/**
 * Index one uploaded blob into its organization's `private_knowledge`
 * corpus. Never throws — every outcome, success or failure, lands on the
 * `fileMetadata` row where the badge (and the watchdog) read it.
 */
/**
 * The chunk header for an emailed attachment: its filename plus the mail it
 * arrived on. `null` for anything that did not arrive by mail, so the header
 * stays exactly the filename and Document Hub behaviour is untouched.
 *
 * Deliberately plain text joined with em-dashes rather than a labelled format:
 * the header is embedded and BM25-indexed as prose, so it should read as prose.
 */
function mailContextTitle(
  fileName: string,
  binding: { subject?: string; correspondent?: string } | null,
): string | null {
  if (binding === null) return null;
  const parts = [fileName];
  if (binding.subject !== undefined) parts.push(binding.subject);
  if (binding.correspondent !== undefined) {
    parts.push(`from ${binding.correspondent}`);
  }
  return parts.length > 1 ? parts.join(' — ') : null;
}

export async function indexFileBlob(
  ctx: ActionCtx,
  args: IndexFileBlobArgs,
): Promise<void> {
  const { storageId } = args;
  try {
    if (await stopSupersededDocumentIndex(ctx, args)) return;
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
    if (await stopSupersededDocumentIndex(ctx, args)) return;

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
    if (await stopSupersededDocumentIndex(ctx, args)) return;

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
    // The conversation this blob arrived on, when it is an emailed attachment.
    // Read from Convex truth rather than taken as an argument: the stamp then
    // cannot disagree with the binding, and a retry or a later slice picks up a
    // rebinding for free. Null for every other file, which is every file with a
    // Document Hub row.
    const binding = await ctx.runQuery(
      internal.file_metadata.internal_queries.getConversationBindingForBlob,
      { organizationId: args.organizationId, storageId },
    );
    const conversationId = binding?.conversationId ?? null;
    // An attachment inherits the mail's context. Without it the only text in
    // the header is the filename, so a CV named for its author is unfindable
    // by the role it was sent for.
    const mailTitle = mailContextTitle(args.fileName, binding);
    // The deprecated single-team arg reads as a one-element list; the full
    // list wins when both are present (`hasTeamAccess` precedence).
    const teamIds: string[] | null =
      args.teamIds != null
        ? [...args.teamIds]
        : args.teamId != null
          ? [args.teamId]
          : null;
    // The secret scan runs on the FIRST slice only — one scan per content.
    let scanBytes: Uint8Array | undefined = bytes;
    let written = 0;
    for (let slice = 0; slice < MAX_SLICES_PER_INVOCATION; slice += 1) {
      if (await stopSupersededDocumentIndex(ctx, args)) return;
      const result = await indexDocument({
        sql,
        orgSlug,
        fileId,
        filename: args.fileName,
        text,
        ...(scanBytes !== undefined ? { bytes: scanBytes } : {}),
        embedder,
        folderPath: args.folderPath ?? null,
        teamIds,
        projectId: args.projectId ?? null,
        conversationId,
        ...(mailTitle !== null ? { title: mailTitle } : {}),
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
      // The document can be replaced while one slice is embedding/committing.
      // Stop the stale worker, but keep its corpus row: another active
      // document may share this immutable blob.
      if (await stopSupersededDocumentIndex(ctx, args)) return;

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
        // The mutation compares the backing document and expected file in the
        // same Convex transaction that exposes `completed`.
        await writeStatus(
          ctx,
          storageId,
          { ragStatus: 'completed' },
          args.documentId,
        );
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
        // The continuation carries the RESOLVED list, so a job staged with
        // the deprecated single-team arg resumes with the same scope.
        ...(teamIds !== null ? { teamIds } : {}),
        ...(args.projectId != null ? { projectId: args.projectId } : {}),
        ...(args.sourceCreatedAtMs != null
          ? { sourceCreatedAtMs: args.sourceCreatedAtMs }
          : {}),
        ...(args.sourceModifiedAtMs != null
          ? { sourceModifiedAtMs: args.sourceModifiedAtMs }
          : {}),
        ...(args.documentId !== undefined
          ? { documentId: args.documentId }
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
