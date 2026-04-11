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

    const id = await ctx.db.insert('fileMetadata', {
      organizationId: args.organizationId,
      storageId: args.storageId,
      fileName: args.fileName,
      contentType: args.contentType,
      size: args.size,
      ragStatus: 'queued',
      ...(args.documentId !== undefined && { documentId: args.documentId }),
      ...(args.source !== undefined && { source: args.source }),
      ...(args.uploadedBy !== undefined && { uploadedBy: args.uploadedBy }),
    });

    await ctx.scheduler.runAfter(
      0,
      internal.file_metadata.internal_actions.uploadFileToRag,
      {
        storageId: args.storageId,
        fileName: args.fileName,
        contentType: args.contentType,
      },
    );

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
