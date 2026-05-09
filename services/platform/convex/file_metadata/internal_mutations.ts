import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalMutation } from '../_generated/server';
import {
  RateLimitExceededError,
  checkOrganizationRateLimit,
} from '../lib/rate_limiter/helpers';

export const saveFileMetadata = internalMutation({
  args: {
    organizationId: v.string(),
    storageId: v.id('_storage'),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
    documentId: v.optional(v.id('documents')),
    source: v.optional(v.union(v.literal('user'), v.literal('agent'))),
    uploadedBy: v.optional(v.string()),
  },
  async handler(ctx, args) {
    const existing = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();

    if (existing) {
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
      await ctx.db.patch(existing._id, patchData);
      return existing._id;
    }

    // Audio AND video files go through the transcription pipeline (ffmpeg
    // strips video via `-vn`, transcribes the audio track).
    const isAudio =
      args.contentType.startsWith('audio/') ||
      args.contentType.startsWith('video/');

    const id = await ctx.db.insert('fileMetadata', {
      organizationId: args.organizationId,
      storageId: args.storageId,
      fileName: args.fileName,
      contentType: args.contentType,
      size: args.size,
      ragStatus: isAudio ? undefined : 'queued',
      ragQueuedAt: isAudio ? undefined : Date.now(),
      transcriptionStatus: isAudio ? 'queued' : undefined,
      ...(args.documentId !== undefined && { documentId: args.documentId }),
      ...(args.source !== undefined && { source: args.source }),
      ...(args.uploadedBy !== undefined && { uploadedBy: args.uploadedBy }),
    });

    if (!isAudio) {
      await ctx.scheduler.runAfter(
        0,
        internal.file_metadata.internal_actions.uploadFileToRag,
        {
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
 * Watchdog: sweep fileMetadata rows stuck in `transcriptionStatus: 'running'`
 * for >35 minutes. Convex hard-kills actions at the 30-min timeout without
 * running their catch blocks, so without this sweep the send-gate would stay
 * locked forever for the affected uploads. Scheduled from crons.ts.
 */
export const recoverStuckTranscriptions = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - 35 * 60 * 1000;
    // Index-range chain on transcriptionStatus so the cron pays only for
    // rows currently `'running'` instead of scanning the whole table
    // every 5 minutes (round-2 M2).
    for await (const row of ctx.db
      .query('fileMetadata')
      .withIndex('by_transcriptionStatus', (q) =>
        q.eq('transcriptionStatus', 'running'),
      )) {
      if (row._creationTime < cutoff) {
        await ctx.db.patch(row._id, {
          transcriptionStatus: 'failed',
          transcriptionError: 'Transcription timed out (watchdog)',
        });
      }
    }
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
    if (metadata) {
      await ctx.db.patch(metadata._id, { documentId: args.documentId });
    }
  },
});
