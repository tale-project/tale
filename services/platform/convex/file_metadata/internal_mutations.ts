import { v } from 'convex/values';

import {
  isRagIndexableFile,
  resolveFileType,
} from '../../lib/shared/file-types';
import { internal } from '../_generated/api';
import { internalMutation } from '../_generated/server';
import { scheduleHubDocumentRagIndexing } from '../documents/schedule_hub_document_rag_indexing';
import { isE2ECronSuppressed } from '../lib/e2e_cron_guard';
import {
  RateLimitExceededError,
  checkOrganizationRateLimit,
} from '../lib/rate_limiter/helpers';
import { sourceFromProvider } from './source_from_provider';

export const saveFileMetadata = internalMutation({
  args: {
    organizationId: v.string(),
    storageId: v.id('_storage'),
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
    /** When false, only marks the row queued — caller schedules
     *  uploadDocumentToRag after the Hub document is linked. */
    scheduleRag: v.optional(v.boolean()),
  },
  async handler(ctx, args) {
    const scheduleRag = args.scheduleRag ?? true;
    const existing = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();

    const resolvedContentType = resolveFileType(
      args.fileName,
      args.contentType,
    );
    const isAudio =
      resolvedContentType.startsWith('audio/') ||
      resolvedContentType.startsWith('video/');
    const shouldIndex =
      !isAudio && isRagIndexableFile(args.fileName, resolvedContentType);

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
        scheduleRag &&
        shouldIndex &&
        (existing.ragStatus === undefined || existing.ragStatus === 'failed');
      const needsTranscribeRetry =
        isAudio &&
        (existing.transcriptionStatus === undefined ||
          existing.transcriptionStatus === 'failed');

      if (needsRagRetry) {
        patchData.ragStatus = 'queued';
        patchData.ragError = undefined;
        patchData.ragProgress = undefined;
        patchData.ragQueuedAt = now;
      } else if (shouldIndex && !scheduleRag) {
        patchData.ragStatus = 'queued';
        patchData.ragError = undefined;
        patchData.ragProgress = undefined;
        patchData.ragQueuedAt = now;
      }

      if (needsTranscribeRetry) {
        patchData.transcriptionStatus = 'queued';
        patchData.transcriptionError = undefined;
        patchData.transcriptionProgress = undefined;
      }

      await ctx.db.patch(existing._id, patchData);

      if (needsRagRetry) {
        await ctx.scheduler.runAfter(
          0,
          internal.file_metadata.internal_actions.uploadFileToRag,
          {
            organizationId: args.organizationId,
            storageId: args.storageId,
            fileName: args.fileName,
            contentType: args.contentType,
          },
        );
      }
      if (needsTranscribeRetry) {
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
      ragStatus: shouldIndex ? 'queued' : undefined,
      ragQueuedAt: shouldIndex ? Date.now() : undefined,
      transcriptionStatus: isAudio ? 'queued' : undefined,
      ...(args.documentId !== undefined && { documentId: args.documentId }),
      ...(args.source !== undefined && { source: args.source }),
      ...(args.uploadedBy !== undefined && { uploadedBy: args.uploadedBy }),
      ...(args.threadId !== undefined && { threadId: args.threadId }),
    });

    if (shouldIndex && scheduleRag) {
      await ctx.scheduler.runAfter(
        0,
        internal.file_metadata.internal_actions.uploadFileToRag,
        {
          organizationId: args.organizationId,
          storageId: args.storageId,
          fileName: args.fileName,
          contentType: args.contentType,
        },
      );
    }

    if (isAudio) {
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

export const updateFileRagStatus = internalMutation({
  args: {
    storageId: v.id('_storage'),
    ragStatus: v.union(
      v.literal('queued'),
      v.literal('running'),
      v.literal('completed'),
      v.literal('failed'),
    ),
    ragError: v.optional(v.string()),
    ragProgress: v.optional(v.string()),
    ocrApplied: v.optional(v.boolean()),
  },
  async handler(ctx, args) {
    const metadata = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();
    if (!metadata) return;

    const isTerminal =
      args.ragStatus === 'completed' || args.ragStatus === 'failed';

    await ctx.db.patch(metadata._id, {
      ragStatus: args.ragStatus,
      ragError: args.ragStatus === 'failed' ? args.ragError : undefined,
      ragProgress: isTerminal ? undefined : args.ragProgress,
      // Stamp when re-queued so the watchdog can time it out. Clear on
      // terminal states so a later re-queue starts its own clock.
      ragQueuedAt:
        args.ragStatus === 'queued'
          ? Date.now()
          : isTerminal
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
      ...(args.ocrApplied != null && { ocrApplied: args.ocrApplied }),
    });

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
    storageId: v.id('_storage'),
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

    const sys = await ctx.db.system.get(args.storageId);
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
    storageId: v.id('_storage'),
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
    storageId: v.id('_storage'),
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
    storageId: v.id('_storage'),
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
    storageId: v.id('_storage'),
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
    storageId: v.id('_storage'),
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
        // (new `by_storageId` index) and flip in the same tick.
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
    storageId: v.id('_storage'),
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
