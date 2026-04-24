import { v } from 'convex/values';

import { extractExtension } from '../../lib/shared/file-types';
import { internal } from '../_generated/api';
import { mutation } from '../_generated/server';
import { authComponent } from '../auth';
import { checkUploadPolicy } from '../governance/upload_enforcement';
import {
  RateLimitExceededError,
  checkOrganizationRateLimit,
} from '../lib/rate_limiter/helpers';

export const saveFileMetadata = mutation({
  args: {
    organizationId: v.string(),
    storageId: v.id('_storage'),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
    documentId: v.optional(v.id('documents')),
    source: v.optional(v.union(v.literal('user'), v.literal('agent'))),
  },
  async handler(ctx, args) {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const userId = String(authUser._id);
    const ext = extractExtension(args.fileName);
    const check = await checkUploadPolicy(
      ctx,
      args.organizationId,
      userId,
      ext,
      args.contentType,
      args.size,
    );
    if (!check.allowed) {
      throw new Error(check.reason ?? 'Upload rejected by organization policy');
    }

    // Audio AND video files go through the transcription pipeline (ffmpeg
    // strips video via `-vn`, transcribes the audio track).
    const isAudio =
      args.contentType.startsWith('audio/') ||
      args.contentType.startsWith('video/');

    const now = Date.now();

    const existing = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();

    if (existing) {
      const patchData: Record<string, unknown> = {
        fileName: args.fileName,
        contentType: args.contentType,
        size: args.size,
        uploadedBy: userId,
      };
      if (args.documentId !== undefined) {
        patchData.documentId = args.documentId;
      }
      if (args.source !== undefined) {
        patchData.source = args.source;
      }

      // If the prior pipeline didn't reach a terminal state (failed /
      // undefined for the non-audio RAG path, or for the audio
      // transcription path), reset and re-schedule. Without this, a row
      // left at `queued` by a silently-dropped scheduled action would
      // stay stuck forever.
      const needsRagRetry =
        !isAudio &&
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
      // RAG runs on the primary upload for non-audio; audio's transcript
      // is indexed to RAG separately after transcription succeeds.
      ragStatus: isAudio ? undefined : 'queued',
      ragQueuedAt: isAudio ? undefined : now,
      transcriptionStatus: isAudio ? 'queued' : undefined,
      uploadedBy: userId,
      ...(args.documentId !== undefined && { documentId: args.documentId }),
      ...(args.source !== undefined && { source: args.source }),
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

/**
 * Mark a stuck transcription as user-skipped. Unblocks the chat send-gate when
 * the audio is taking too long (client shows a Skip button after 60s of
 * `running`). Same downstream effect as `failed` — the message sends with a
 * "could not be transcribed" marker.
 */
export const skipTranscription = mutation({
  args: {
    storageId: v.id('_storage'),
    organizationId: v.string(),
  },
  async handler(ctx, args) {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const metadata = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();
    if (!metadata) throw new Error('File not found');
    if (metadata.organizationId !== args.organizationId) {
      throw new Error('Not authorized');
    }

    await ctx.db.patch(metadata._id, {
      transcriptionStatus: 'skipped',
      transcriptionError: 'User skipped transcription',
    });
  },
});

/**
 * Retry a failed transcription. Resets status to `queued` and re-schedules
 * the `transcribeAudio` action. The action itself classifies errors as
 * retryable vs permanent — this endpoint just resets the counter.
 */
export const retryTranscription = mutation({
  args: {
    storageId: v.id('_storage'),
    organizationId: v.string(),
  },
  async handler(ctx, args) {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const metadata = await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();
    if (!metadata) throw new Error('File not found');
    if (metadata.organizationId !== args.organizationId) {
      throw new Error('Not authorized');
    }

    await ctx.db.patch(metadata._id, {
      transcriptionStatus: 'queued',
      transcriptionError: undefined,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.file_metadata.transcribe_audio.transcribeAudio,
      {
        storageId: args.storageId,
        fileName: metadata.fileName,
        contentType: metadata.contentType,
        organizationId: args.organizationId,
      },
    );
  },
});
