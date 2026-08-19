import { v } from 'convex/values';

import {
  isAudioOrVideo,
  isRagIndexableFile,
  resolveFileType,
} from '../../lib/shared/file-types';
import { internal } from '../_generated/api';
import { internalMutation } from '../_generated/server';
import { isActiveDocument } from '../documents/_helpers';
import { scheduleHubDocumentRagIndexing } from '../documents/schedule_hub_document_rag_indexing';
import { isE2ECronSuppressed } from '../lib/e2e_cron_guard';
import {
  RateLimitExceededError,
  checkOrganizationRateLimit,
} from '../lib/rate_limiter/helpers';
import {
  blobRefValidator,
  convexStorageId,
  isS3Ref,
} from '../lib/storage/blob_ref';
import { maybeDispatchRagIndexing, promoteQueuedRagJobs } from './rag_dispatch';
import { sourceFromProvider } from './source_from_provider';

/**
 * Record the conversation an email attachment arrived on, and index it.
 *
 * Idempotent, and scoped: the row must already belong to the organization doing
 * the binding, so a storage id from elsewhere cannot be re-pointed. Writes only
 * when the value actually changes, so a re-poll of the same mail is a no-op
 * rather than a write.
 *
 * ## Why the indexing decision lives here
 *
 * The attachment is stored before its conversation is resolved (bytes are
 * drained per message inside the fetch), so at storage time there is nothing to
 * scope it to and it is stored unindexed. Here is the first moment the
 * conversation is known — which is also the moment the corpus row can be given
 * a visibility rule instead of landing as an org-wide hub document.
 *
 * Queueing and dispatching happen in this ONE transaction, deliberately. A
 * `'queued'` row that is neither dispatched nor parked counts against the
 * per-org RAG cap forever, and three of them starve every real upload — the
 * defect that made email attachments skip indexing in the first place. Marking
 * queued is a promise to dispatch, so the promise and the dispatch are made
 * together rather than across a best-effort boundary that is allowed to fail.
 *
 * Only a row that was never indexed is queued: a re-poll of the same mail must
 * not re-embed, and a file that already failed keeps its error for the watchdog
 * rather than looping.
 *
 * The two decisions are INDEPENDENT. An attachment bound before binding started
 * indexing is already pointed at its conversation and still has no `ragStatus`,
 * so treating "binding unchanged" as "nothing to do" would leave it unindexed
 * for good. Whether the binding moved and whether the file needs indexing are
 * answered separately.
 */
export const bindFileToConversation = internalMutation({
  args: {
    organizationId: v.string(),
    storageId: blobRefValidator,
    conversationId: v.id('conversations'),
  },
  returns: v.union(
    v.literal('not_found'),
    v.literal('other_org'),
    /** Already pointed at this conversation, and nothing to index. */
    v.literal('unchanged'),
    /** Already pointed at this conversation; queued because it never indexed. */
    v.literal('queued'),
    v.literal('bound'),
    v.literal('bound_and_queued'),
  ),
  async handler(ctx, args) {
    const row = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();
    if (!row) return 'not_found';
    if (row.organizationId !== args.organizationId) return 'other_org';

    const alreadyBound = row.conversationId === args.conversationId;

    // The same predicate the save paths use, so "indexable" has one meaning.
    // Audio is excluded as it is there: it indexes later, via its transcript.
    // That half is unreachable while the indexable extensions hold no audio or
    // video — an invariant asserted in `lib/shared/file-types.test.ts`, so
    // adding one there fails a test rather than silently routing a recording
    // into the text pipeline.
    const indexable =
      row.ragStatus === undefined &&
      row.lifecycleStatus !== 'trashed' &&
      !isAudioOrVideo(row.contentType) &&
      isRagIndexableFile(
        row.fileName,
        resolveFileType(row.fileName, row.contentType),
      );

    if (alreadyBound && !indexable) return 'unchanged';

    await ctx.db.patch(row._id, {
      ...(alreadyBound ? {} : { conversationId: args.conversationId }),
      ...(indexable ? { ragStatus: 'queued' as const } : {}),
    });
    if (!indexable) return 'bound';
    // Dispatches under the cap, parks over it. Either way the row is accounted
    // for before this transaction ends.
    await maybeDispatchRagIndexing(ctx, args.storageId);
    return alreadyBound ? 'queued' : 'bound_and_queued';
  },
});

export const saveFileMetadata = internalMutation({
  args: {
    organizationId: v.string(),
    storageId: blobRefValidator,
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
    documentId: v.optional(v.id('documents')),
    // Open provenance string (see fileMetadata schema): 'user' | 'agent' |
    // 'video_link' | a connector slug ('confluence', 'onedrive', 'webdav', …).
    source: v.optional(v.string()),
    uploadedBy: v.optional(v.string()),
    /** Chat-bound files (audio uploads, video-link transcripts) carry the
     * thread id so the soft-delete cascade + RAG thread-scope auth chain
     * work. Document Hub uploads omit this. */
    threadId: v.optional(v.string()),
    /**
     * Mark the row queued but do NOT dispatch — the caller schedules
     * `uploadDocumentToRag` itself, once the Hub document is linked, so the
     * job can read the document's folder/scope (see
     * `documents/schedule_hub_document_rag_indexing.ts`).
     *
     * Setting this is a PROMISE to dispatch. A `'queued'` row that is not
     * parked counts as in-flight against the per-org cap
     * (`rag_dispatch.ts:countRagInFlight`, and the `ragParked` contract in
     * `schema.ts`), so a caller that never follows through burns an indexing
     * slot forever and eventually starves every real upload — three of them
     * saturate `MAX_CONCURRENT_RAG_INDEXING_PER_ORG`. Use
     * `skipRagIndexing` when the intent is "never index this", NOT this flag.
     */
    deferRagDispatch: v.optional(v.boolean()),
    /**
     * Never index this file. Mirrors `skipRagIndexing` on the public
     * `mutations.saveFileMetadata`: the row keeps `ragStatus: undefined`
     * ("Not indexed"), nothing is scheduled, and no cap slot is consumed.
     * Email attachments use this — they are stored so the Inbox can show and
     * download them, not to enter the knowledge corpus. Still upgradable: a
     * later save of the same blob with indexing on re-queues it, because
     * `needsRagRetry` accepts an `undefined` status.
     */
    skipRagIndexing: v.optional(v.boolean()),
  },
  async handler(ctx, args) {
    const deferRagDispatch = args.deferRagDispatch ?? false;
    const existing = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();

    // Route Whisper from the caller-supplied MIME, not `resolveFileType`.
    // That helper intentionally never returns audio/*|video/* (media is
    // byte-classified elsewhere), so using its output here made every
    // video-link handoff look non-audio: no transcriptionStatus, no
    // transcribeAudio schedule, ragStatus=unsupported — chip stuck on
    // Transcribing…. Align with the public `mutations.saveFileMetadata`.
    const isAudio = isAudioOrVideo(args.contentType);
    const resolvedContentType = resolveFileType(
      args.fileName,
      args.contentType,
    );
    // `skipRagIndexing` folds in here — the same shape the public
    // `mutations.saveFileMetadata` uses — so a skipped file takes every
    // "not indexing this" branch below without a second code path.
    const shouldIndex =
      !args.skipRagIndexing &&
      !isAudio &&
      isRagIndexableFile(args.fileName, resolvedContentType);
    // No extractor exists for this format and it isn't routed through the
    // audio/video transcription pipeline either — this file will NEVER
    // index. Distinct from `shouldIndex === false && isAudio`, which is
    // deliberately left `undefined` (indexed later via the transcript).
    // Deliberately derived from the format alone, NOT from `shouldIndex`: a
    // caller-skipped file is indexable, just not being indexed, so it must
    // stay at `undefined` ("Not indexed") rather than claim the terminal,
    // retry-refusing `'unsupported'`.
    const isUnsupported =
      !isAudio && !isRagIndexableFile(args.fileName, resolvedContentType);

    if (existing) {
      const now = Date.now();
      const patchData: Record<string, unknown> = {
        fileName: args.fileName,
        contentType: args.contentType,
        size: args.size,
      };
      if (args.documentId !== undefined) {
        patchData.documentId = args.documentId;
      }
      if (args.source !== undefined) {
        patchData.source = args.source;
      }
      if (args.uploadedBy !== undefined) {
        patchData.uploadedBy = args.uploadedBy;
      }
      if (args.threadId !== undefined) patchData.threadId = args.threadId;

      const needsRagRetry =
        !deferRagDispatch &&
        shouldIndex &&
        (existing.ragStatus === undefined || existing.ragStatus === 'failed');
      const needsTranscribeRetry =
        isAudio &&
        (existing.transcriptionStatus === undefined ||
          existing.transcriptionStatus === 'failed');

      if (needsRagRetry) {
        patchData.ragStatus = 'queued';
        patchData.ragError = undefined;
        patchData.ragErrorCode = undefined;
        patchData.ragProgress = undefined;
        patchData.ragQueuedAt = now;
      } else if (shouldIndex && deferRagDispatch) {
        patchData.ragStatus = 'queued';
        patchData.ragError = undefined;
        patchData.ragErrorCode = undefined;
        patchData.ragProgress = undefined;
        patchData.ragQueuedAt = now;
      } else if (isUnsupported && existing.ragStatus !== 'unsupported') {
        // Self-heals a row saved before this terminal state existed (it
        // would otherwise sit at `undefined` — "Not indexed" with a retry
        // button that can never succeed — forever).
        patchData.ragStatus = 'unsupported';
        patchData.ragError = undefined;
        patchData.ragErrorCode = undefined;
        patchData.ragProgress = undefined;
        patchData.ragQueuedAt = undefined;
      }

      if (needsTranscribeRetry) {
        patchData.transcriptionStatus = 'queued';
        patchData.transcriptionError = undefined;
        patchData.transcriptionProgress = undefined;
      }

      await ctx.db.patch(existing._id, patchData);

      if (needsRagRetry) {
        await maybeDispatchRagIndexing(ctx, args.storageId);
      }
      if (needsTranscribeRetry) {
        // `transcribeAudio` is backend-aware: it reads the source blob from
        // Convex `_storage` OR the org's S3 bucket, so the full ref is passed
        // through (no `_storage`-only narrowing).
        await ctx.scheduler.runAfter(
          0,
          internal.file_metadata.transcribe_audio.transcribeAudio,
          {
            storageId: args.storageId,
            fileName: args.fileName,
            contentType: args.contentType,
            organizationId: args.organizationId,
          },
        );
      }

      return existing._id;
    }

    const id = await ctx.db.insert('fileMetadata', {
      organizationId: args.organizationId,
      storageId: args.storageId,
      fileName: args.fileName,
      contentType: args.contentType,
      size: args.size,
      ragStatus: shouldIndex
        ? 'queued'
        : isUnsupported
          ? 'unsupported'
          : undefined,
      ragQueuedAt: shouldIndex ? Date.now() : undefined,
      transcriptionStatus: isAudio ? 'queued' : undefined,
      ...(args.documentId !== undefined && { documentId: args.documentId }),
      ...(args.source !== undefined && { source: args.source }),
      ...(args.uploadedBy !== undefined && { uploadedBy: args.uploadedBy }),
      ...(args.threadId !== undefined && { threadId: args.threadId }),
    });

    if (shouldIndex && !deferRagDispatch) {
      await maybeDispatchRagIndexing(ctx, args.storageId);
    }

    if (isAudio) {
      // `transcribeAudio` is backend-aware (reads `_storage` OR the org's S3
      // bucket), so pass the full ref through.
      await ctx.scheduler.runAfter(
        0,
        internal.file_metadata.transcribe_audio.transcribeAudio,
        {
          storageId: args.storageId,
          fileName: args.fileName,
          contentType: args.contentType,
          organizationId: args.organizationId,
        },
      );
    }

    await ctx.scheduler.runAfter(
      0,
      internal.file_metadata.internal_actions.extractFileMetadata,
      {
        storageId: args.storageId,
        fileName: args.fileName,
        contentType: args.contentType,
        organizationId: args.organizationId,
      },
    );

    // An `s3:` blob was uploaded by a presigned PUT (no Content-Length gate),
    // so verify its real size server-side and reject/correct past the cap.
    if (isS3Ref(args.storageId)) {
      await ctx.scheduler.runAfter(
        0,
        internal.files.blob_actions.verifyS3BlobSize,
        {
          storageId: String(args.storageId),
          organizationId: args.organizationId,
        },
      );
    }

    try {
      await checkOrganizationRateLimit(
        ctx,
        'cleanup:retention',
        args.organizationId,
      );
      await ctx.scheduler.runAfter(
        0,
        internal.governance.retention_cleanup.runRetentionCleanup,
        {},
      );
    } catch (error) {
      if (!(error instanceof RateLimitExceededError)) {
        throw error;
      }
    }

    return id;
  },
});

/**
 * Retroactively bind chat-composed uploads to the thread their first send
 * created — the "bind retroactively" seam `useConvexFileUpload`'s threadId
 * JSDoc reserves. A file staged on the chat INDEX uploads before its thread
 * exists (`threadId === undefined`); without this bind it stays invisible
 * to the thread-scoped RAG retrieval (`filterRetrievableRagFileIds`) that
 * the send tells the model to use.
 *
 * Only fills a hole, never re-binds: a row already bound to a thread keeps
 * that binding, so re-sending a stored attachment into another thread can
 * never move (or widen) its retrieval scope. Org mismatch is skipped, not
 * thrown — the attachment gate already refused foreign refs; a race here
 * must not kill the turn.
 */
export const bindStorageIdsToThread = internalMutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    storageIds: v.array(blobRefValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const storageId of args.storageIds) {
      const row = await ctx.db
        .query('fileMetadata')
        .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
        .first();
      if (
        row === null ||
        row.organizationId !== args.organizationId ||
        row.threadId !== undefined
      ) {
        continue;
      }
      await ctx.db.patch(row._id, { threadId: args.threadId });
    }
    return null;
  },
});

export const updateFileRagStatus = internalMutation({
  args: {
    storageId: blobRefValidator,
    ragStatus: v.union(
      v.literal('queued'),
      v.literal('running'),
      v.literal('completed'),
      v.literal('failed'),
      // Terminal like `failed`, but non-retryable: no extractor exists for
      // the format (images and scans until the vision arm returns). The
      // retry surface refuses these rather than reproducing the rejection.
      v.literal('unsupported'),
    ),
    ragError: v.optional(v.string()),
    // Machine-readable cause for guidable failures (knowledge/rag_error_codes).
    ragErrorCode: v.optional(v.string()),
    ragProgress: v.optional(v.string()),
    ocrApplied: v.optional(v.boolean()),
    /** Document generation admitted by the scheduler. Completion is exposed
     * only if this document still points at `storageId`. */
    expectedDocumentId: v.optional(v.id('documents')),
  },
  async handler(ctx, args) {
    const metadata = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();
    if (!metadata) return;

    if (args.ragStatus === 'completed') {
      const expectedDocumentId = args.expectedDocumentId ?? metadata.documentId;
      if (expectedDocumentId !== undefined) {
        const document = await ctx.db.get(expectedDocumentId);
        const staleBinding =
          (metadata.documentId !== undefined &&
            metadata.documentId !== expectedDocumentId) ||
          document === null ||
          document.organizationId !== metadata.organizationId ||
          (document.fileId ?? '') !== args.storageId ||
          !isActiveDocument(document);
        if (staleBinding) {
          await ctx.db.patch(metadata._id, {
            ragStatus: 'failed',
            ragError: 'Indexing stopped because this file was replaced.',
            ragErrorCode: undefined,
            ragProgress: undefined,
            ragIndexedAt: undefined,
            ...(metadata.ragParked ? { ragParked: undefined } : {}),
          });
          await promoteQueuedRagJobs(ctx);
          return;
        }
      }
    }

    // Success is terminal for a given content: once `completed`, a straggling
    // `failed` write (a killed sibling dispatcher's catch, a dying poll chain)
    // must not pollute it. A legitimate re-index of CHANGED content always
    // passes through `queued` first, which stays allowed.
    if (args.ragStatus === 'failed' && metadata.ragStatus === 'completed') {
      console.info(
        `[updateFileRagStatus] ignoring stale failed write for completed ${args.storageId}`,
      );
      return;
    }

    const isTerminal =
      args.ragStatus === 'completed' ||
      args.ragStatus === 'failed' ||
      args.ragStatus === 'unsupported';

    // Never persist an empty failure reason: an interrupted indexing action
    // (e.g. a killed/timed-out job) surfaces an Error with no message, which
    // flowed through as `ragError: ''` and rendered as a bare "Unknown error"
    // with nothing actionable. Fall back to a plain, honest default so the row
    // at least says a retry is the next step. An `unsupported` row keeps its
    // explanation too — why THIS file cannot be indexed.
    const failureReason =
      args.ragStatus === 'failed'
        ? args.ragError && args.ragError.trim().length > 0
          ? args.ragError
          : 'Indexing did not finish. Retry to index this document.'
        : args.ragStatus === 'unsupported'
          ? args.ragError
          : undefined;

    await ctx.db.patch(metadata._id, {
      ragStatus: args.ragStatus,
      ragError: failureReason,
      // Lives and dies with `ragError`: only a failed write may carry a code,
      // and a failed write WITHOUT one clears whatever a previous failure left
      // (the new prose describes a new cause — a stale code would pin the old
      // guidance to it).
      ragErrorCode: args.ragStatus === 'failed' ? args.ragErrorCode : undefined,
      ragProgress: isTerminal ? undefined : args.ragProgress,
      // Stamp when re-queued so the watchdog can time it out. Clear on
      // completion so a later re-queue starts its own clock — but KEEP it on
      // `failed`: the watchdog's failed-row reconcile uses it to bound which
      // recent failures are still worth checking against the corpus (a late
      // completion self-heals the row instead of demanding a manual retry).
      ragQueuedAt:
        args.ragStatus === 'queued'
          ? Date.now()
          : args.ragStatus === 'completed'
            ? undefined
            : metadata.ragQueuedAt,
      // Canonical completion timestamp (replaces documents.ragInfo.indexedAt).
      // Stamp on completion; preserve the prior value otherwise. Unix SECONDS
      // to match every other consumer: the legacy ragInfo.indexedAt writer and
      // the backfill store seconds, and the RagStatusBadge renders it as
      // `new Date(indexedAt * 1000)`. Writing ms here renders a far-future date.
      ragIndexedAt:
        args.ragStatus === 'completed'
          ? Math.floor(Date.now() / 1000)
          : metadata.ragIndexedAt,
      // A terminal row is no longer parked/in-flight; clear the park flag so a
      // later re-queue starts clean and the promotion count is accurate.
      ...(isTerminal && metadata.ragParked ? { ragParked: undefined } : {}),
      ...(args.ocrApplied != null && { ocrApplied: args.ocrApplied }),
    });

    // A terminal transition frees an indexing slot — fairly promote parked jobs
    // (oldest-first across orgs, still per-org-capped) so the shared global
    // budget drains as jobs finish.
    if (isTerminal) {
      await promoteQueuedRagJobs(ctx);
    }

    // Sync ocrApplied to linked document so the list view can show it
    if (args.ocrApplied != null && metadata.documentId) {
      const doc = await ctx.db.get(metadata.documentId);
      if (doc) {
        await ctx.db.patch(metadata.documentId, {
          ocrApplied: args.ocrApplied,
        });
      }
    }
  },
});

/**
 * Re-queue one file for indexing and dispatch it (or park it under the
 * concurrency caps) in the SAME transaction — the retry surface's write.
 * Clears the previous failure so the badge flips to "Queued" immediately.
 */
export const requeueFileForRagIndexing = internalMutation({
  args: { storageId: blobRefValidator },
  returns: v.null(),
  async handler(ctx, args) {
    const metadata = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();
    if (!metadata) return null;
    await ctx.db.patch(metadata._id, {
      ragStatus: 'queued',
      ragError: undefined,
      ragProgress: undefined,
      ragParked: undefined,
      ragQueuedAt: Date.now(),
    });
    await maybeDispatchRagIndexing(ctx, args.storageId);
    return null;
  },
});

/**
 * Record the authoritative byte size of an `s3:`-backed blob (from a server
 * HEAD), correcting the row that was created with the client-declared size — a
 * presigned PUT enforces no Content-Length. When the real size is over the
 * product cap, mark the row `ragStatus: 'failed'` with a size error so the user
 * sees why (the blob itself is deleted by the caller). The corrected `size`
 * flows into `computeUserUploadVolumeBytes` so volume accounting is honest;
 * per the existing quota model a failed row counts until the user deletes it.
 */
export const applyVerifiedBlobSize = internalMutation({
  args: {
    storageId: blobRefValidator,
    size: v.number(),
    overCap: v.boolean(),
    limitBytes: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const metadata = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();
    if (!metadata) return null;

    const overCapPatch = args.overCap
      ? {
          ragStatus: 'failed' as const,
          ragError: `File exceeds the ${Math.round(
            args.limitBytes / (1024 * 1024),
          )} MB limit`,
          ragQueuedAt: undefined,
          ragProgress: undefined,
        }
      : {};
    await ctx.db.patch(metadata._id, { size: args.size, ...overCapPatch });
    return null;
  },
});

/**
 * Ensure the canonical `fileMetadata` row exists for a document blob that the
 * documents pipeline RAG-indexes directly via `ragAction` (`retryRagIndexing`,
 * `uploadDocumentToRag`). Those actions push the blob themselves and then write
 * status via `updateFileRagStatus`, which silently no-ops when the row is
 * missing — so a file-backed document that never got a `fileMetadata` row (e.g.
 * a UI upload with no `fileSize`, or a legacy pre-`fileMetadata` doc) would
 * report success while its status stayed stuck on `not_indexed`.
 *
 * Creates the row when absent (reading size/contentType straight from the
 * `_storage` system table) and links the `documentId`, but schedules NO RAG
 * upload or poll — the caller already uploaded and owns the status/poll, so
 * routing through `saveFileMetadata` here would double-index. No-op beyond
 * linking an absent `documentId` when the row already exists.
 */
export const ensureFileMetadataForDocument = internalMutation({
  args: {
    organizationId: v.string(),
    storageId: blobRefValidator,
    documentId: v.id('documents'),
    fileName: v.string(),
    contentType: v.optional(v.string()),
  },
  async handler(ctx, args) {
    const existing = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();
    if (existing) {
      if (!existing.documentId) {
        await ctx.db.patch(existing._id, { documentId: args.documentId });
      }
      return existing._id;
    }

    // `db.system.get` only knows Convex `_storage` ids; an `s3:` ref has no
    // system row, so size/contentType fall back to the passed value / defaults.
    const convexId = convexStorageId(args.storageId);
    const sys = convexId ? await ctx.db.system.get(convexId) : null;
    return await ctx.db.insert('fileMetadata', {
      organizationId: args.organizationId,
      storageId: args.storageId,
      documentId: args.documentId,
      fileName: args.fileName,
      contentType:
        args.contentType ?? sys?.contentType ?? 'application/octet-stream',
      size: sys?.size ?? 0,
    });
  },
});

/**
 * Watchdog: mark a file's RAG pipeline as failed when it has been stuck in
 * `queued` beyond `staleAfterMs`. Triggered by `checkFileRagStatuses` when
 * the RAG service returns no status row for a file — either because the
 * scheduled `uploadFileToRag` never ran, or it silently returned before
 * hitting the service. Without this, the client polls forever.
 *
 * Uses `ragQueuedAt` when present; falls back to `_creationTime` for
 * legacy rows written before that field existed.
 */
export const expireStaleRagQueue = internalMutation({
  args: {
    storageId: blobRefValidator,
    staleAfterMs: v.number(),
  },
  returns: v.null(),
  async handler(ctx, args) {
    const metadata = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();
    if (!metadata) return null;
    if (metadata.ragStatus !== 'queued') return null;

    const queuedAt = metadata.ragQueuedAt ?? metadata._creationTime;
    if (Date.now() - queuedAt < args.staleAfterMs) return null;

    await ctx.db.patch(metadata._id, {
      ragStatus: 'failed',
      ragError:
        'RAG service did not receive the upload. The indexing task may have been dropped before it ran.',
      ragProgress: undefined,
    });
    return null;
  },
});

/**
 * Patch the transcription-related fields on a fileMetadata row. Mirrors the
 * shape of `updateFileRagStatus` — partial updates, no-op when the row is
 * missing (the scheduled action may race with row deletion).
 */
export const updateFileTranscription = internalMutation({
  args: {
    storageId: blobRefValidator,
    transcriptionStatus: v.optional(
      v.union(
        v.literal('queued'),
        v.literal('running'),
        v.literal('completed'),
        v.literal('failed'),
        v.literal('skipped'),
      ),
    ),
    transcript: v.optional(v.string()),
    transcriptionError: v.optional(v.string()),
    transcriptionDurationSec: v.optional(v.number()),
    transcriptionProgress: v.optional(v.string()),
    contentHash: v.optional(v.string()),
    transcriptRagStatus: v.optional(
      v.union(
        v.literal('queued'),
        v.literal('running'),
        v.literal('completed'),
        v.literal('failed'),
      ),
    ),
    transcriptRagError: v.optional(v.string()),
  },
  async handler(ctx, args) {
    const metadata = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();
    if (!metadata) return;

    const patch: Record<string, unknown> = {};
    if (args.transcriptionStatus !== undefined) {
      patch.transcriptionStatus = args.transcriptionStatus;
    }
    if (args.transcript !== undefined) {
      patch.transcript = args.transcript;
    }
    if (args.transcriptionError !== undefined) {
      patch.transcriptionError = args.transcriptionError;
    }
    if (args.transcriptionDurationSec !== undefined) {
      patch.transcriptionDurationSec = args.transcriptionDurationSec;
    }
    if (args.transcriptionProgress !== undefined) {
      patch.transcriptionProgress = args.transcriptionProgress;
    }
    if (args.contentHash !== undefined) {
      patch.contentHash = args.contentHash;
    }
    if (args.transcriptRagStatus !== undefined) {
      patch.transcriptRagStatus = args.transcriptRagStatus;
    }
    if (args.transcriptRagError !== undefined) {
      patch.transcriptRagError = args.transcriptRagError;
    }
    await ctx.db.patch(metadata._id, patch);

    // Mirror the terminal transcription state onto the owning videoLinkJob,
    // if any. Without this, a Whisper-branch job that succeeds stays at
    // `'transcribing_handoff'` forever — the chip displays correctly via
    // the reactive projection in queries.ts:projectJob, but the row never
    // graduates to `'completed'`/`'failed'`, so the lazy GC pass (which
    // keys on those terminal statuses) never reclaims the audio blob.
    // Reverse-lookup uses the `by_storageId` index added alongside this
    // change so it's O(1), not a table scan.
    if (
      args.transcriptionStatus === 'completed' ||
      args.transcriptionStatus === 'failed' ||
      args.transcriptionStatus === 'skipped'
    ) {
      // videoLinkJobs.storageId is a blob REFERENCE sharing the exact string
      // this row carries (both are written from the same ingest), so the
      // index join works for `_storage` ids AND `s3:` refs alike.
      const linkedJob = await ctx.db
        .query('videoLinkJobs')
        .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
        .first();
      if (linkedJob && linkedJob.status === 'transcribing_handoff') {
        const nextStatus =
          args.transcriptionStatus === 'completed'
            ? ('completed' as const)
            : args.transcriptionStatus === 'skipped'
              ? ('skipped' as const)
              : ('failed' as const);
        await ctx.db.patch(linkedJob._id, {
          status: nextStatus,
          statusChangedAt: Date.now(),
          ...(nextStatus === 'failed' && {
            errorReasonCode: 'whisperFailed',
            errorMessage:
              args.transcriptionError ?? 'Whisper transcription failed',
          }),
        });
      }
    }
  },
});

export const updateFileVisionMetadata = internalMutation({
  args: {
    storageId: blobRefValidator,
    pageCount: v.optional(v.number()),
    scannedPagesDetected: v.optional(v.number()),
    visionRequired: v.optional(v.boolean()),
  },
  async handler(ctx, args) {
    const metadata = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();
    if (!metadata) return;

    const patch: Record<string, unknown> = {};
    if (args.pageCount != null) patch.pageCount = args.pageCount;
    if (args.scannedPagesDetected != null)
      patch.scannedPagesDetected = args.scannedPagesDetected;
    if (args.visionRequired != null) patch.visionRequired = args.visionRequired;

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(metadata._id, patch);
    }
  },
});

/**
 * Atomic single-flight lock for the `transcribeAudio` action. Two
 * concurrent invocations on the same storageId (e.g. a `retryTranscription`
 * double-click) used to both proceed: double Whisper bill, double `+=`
 * ledger write in `recordTranscriptionUsage`, double RAG index. Now the
 * second caller sees an active lease and short-circuits.
 *
 * Returns the active `transcriptionRunId` (string) when this caller wins
 * the race, or `null` when another invocation is in flight (caller MUST
 * return without doing any work — no compress, no Whisper, no ledger).
 *
 * Stamps `transcriptionStartedAt` so the watchdog can distinguish
 * freshly-retried runs from genuinely-stuck legacy rows. Pre-existing
 * `_creationTime`-keyed watchdog could kill a freshly-retried old row
 * within seconds of starting.
 */
export const acquireTranscriptionLock = internalMutation({
  args: {
    storageId: blobRefValidator,
    runId: v.string(),
    leaseMs: v.number(),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();
    if (!row) return null;

    const now = Date.now();
    const leaseHeld =
      typeof row.transcriptionLeaseExpiresAt === 'number' &&
      row.transcriptionLeaseExpiresAt > now &&
      row.transcriptionStatus === 'running';
    if (leaseHeld) return null;
    // Defense-in-depth (round-3 P2): a row in `completed` should not be
    // re-acquired by a late-arriving duplicate `transcribeAudio` schedule
    // — re-running Whisper would re-bill the org and re-write the
    // transcript / re-index RAG. The entry points pre-check today, but
    // the lock is the single chokepoint and is the right place to enforce.
    if (row.transcriptionStatus === 'completed') return null;

    await ctx.db.patch(row._id, {
      transcriptionStatus: 'running',
      transcriptionRunId: args.runId,
      transcriptionLeaseExpiresAt: now + args.leaseMs,
      transcriptionStartedAt: now,
      transcriptionProgress: 'starting',
    });
    return args.runId;
  },
});

/**
 * Release the single-flight lock IFF the supplied `runId` matches the
 * row's current `transcriptionRunId`. Other concurrent callers (or a
 * watchdog that broke the lock) leave the field alone.
 */
export const releaseTranscriptionLock = internalMutation({
  args: {
    storageId: blobRefValidator,
    runId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();
    if (!row || row.transcriptionRunId !== args.runId) return null;
    await ctx.db.patch(row._id, {
      transcriptionRunId: undefined,
      transcriptionLeaseExpiresAt: undefined,
    });
    return null;
  },
});

/**
 * Watchdog: sweep fileMetadata rows stuck in `transcriptionStatus: 'running'`
 * for >35 minutes. Convex hard-kills actions at the 30-min timeout without
 * running their catch blocks, so without this sweep the send-gate would stay
 * locked forever for the affected uploads. Scheduled from crons.ts.
 *
 * Keyed on `transcriptionStartedAt ?? _creationTime` (round-2 P1-10) so a
 * `retryTranscription` against an old fileMetadata row doesn't get killed
 * within seconds by the next 5-min tick. Legacy rows without the new
 * field fall back to `_creationTime`.
 */
export const recoverStuckTranscriptions = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (isE2ECronSuppressed()) return null;
    const cutoff = Date.now() - 35 * 60 * 1000;
    // Index-range chain on transcriptionStatus so the cron pays only for
    // rows currently `'running'` instead of scanning the whole table
    // every 5 minutes (round-2 M2).
    for await (const row of ctx.db
      .query('fileMetadata')
      .withIndex('by_transcriptionStatus', (q) =>
        q.eq('transcriptionStatus', 'running'),
      )) {
      const startedAt = row.transcriptionStartedAt ?? row._creationTime;
      if (startedAt < cutoff) {
        await ctx.db.patch(row._id, {
          transcriptionStatus: 'failed',
          transcriptionError: 'Transcription timed out (watchdog)',
          transcriptionRunId: undefined,
          transcriptionLeaseExpiresAt: undefined,
        });
        // Cascade the failure back to the owning videoLinkJobs row when
        // present. Without this, a videoLinkJob stuck at
        // `'transcribing_handoff'` would stay there forever: the
        // recoverStuckVideoLinkJobs sweep deliberately skips
        // `transcribing_handoff` (delegated to this sweep), and the chip
        // projection's reactive join would render the failed state
        // transiently — but the row itself never reaches a terminal
        // status, which means `cleanupCancelledVideoLink` never gets
        // called and the audio blob orphans. Reverse-lookup by storageId
        // (the `by_storageId` index; joins on the raw blob REFERENCE, so
        // `s3:`-backed audio flips terminal too) and flip in the same tick.
        const linkedJob = await ctx.db
          .query('videoLinkJobs')
          .withIndex('by_storageId', (q) => q.eq('storageId', row.storageId))
          .first();
        if (linkedJob && linkedJob.status === 'transcribing_handoff') {
          await ctx.db.patch(linkedJob._id, {
            status: 'failed',
            statusChangedAt: Date.now(),
            errorReasonCode: 'whisperFailed',
            errorMessage: 'Whisper transcription timed out (watchdog)',
          });
        }
      }
    }
    // Video-link watchdog runs on its own cron entry now (see crons.ts);
    // the previous piggy-back here let a single fileMetadata loop throw
    // disable both sweeps at once.
    return null;
  },
});

export const linkDocumentToFile = internalMutation({
  args: {
    storageId: blobRefValidator,
    documentId: v.id('documents'),
  },
  async handler(ctx, args) {
    const metadata = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();
    if (!metadata) {
      return;
    }
    const document = await ctx.db.get(args.documentId);
    const source = sourceFromProvider(document?.sourceProvider);
    await ctx.db.patch(metadata._id, {
      documentId: args.documentId,
      ...(source ? { source } : {}),
    });

    // Legacy rows that never reached RAG (failed upload, or pre-link import
    // without a scheduled job) get a second chance once the Hub link exists.
    if (
      !metadata.threadId &&
      (metadata.ragStatus === undefined ||
        metadata.ragStatus === 'failed' ||
        metadata.ragStatus === 'queued')
    ) {
      await scheduleHubDocumentRagIndexing(ctx, {
        documentId: args.documentId,
      });
    }
  },
});
