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

    const isAudio = args.contentType.startsWith('audio/');

    const id = await ctx.db.insert('fileMetadata', {
      organizationId: args.organizationId,
      storageId: args.storageId,
      fileName: args.fileName,
      contentType: args.contentType,
      size: args.size,
      ragStatus: isAudio ? undefined : 'queued',
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

    await ctx.db.patch(metadata._id, {
      ragStatus: args.ragStatus,
      ragError: args.ragStatus === 'failed' ? args.ragError : undefined,
      ragProgress:
        args.ragStatus === 'completed' || args.ragStatus === 'failed'
          ? undefined
          : args.ragProgress,
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
    for await (const row of ctx.db.query('fileMetadata')) {
      if (row.transcriptionStatus === 'running' && row._creationTime < cutoff) {
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
