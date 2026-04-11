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
      uploadedBy: userId,
      ...(args.documentId !== undefined && { documentId: args.documentId }),
      ...(args.source !== undefined && { source: args.source }),
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
