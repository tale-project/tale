import { v } from 'convex/values';

import { query } from '../_generated/server';
import { authComponent } from '../auth';
import { getAuthUserIdentity } from '../lib/rls';

export const getUserStorageUsage = query({
  args: {
    organizationId: v.string(),
  },
  returns: v.object({ totalBytes: v.number() }),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) return { totalBytes: 0 };

    let totalBytes = 0;
    for await (const meta of ctx.db
      .query('fileMetadata')
      .withIndex('by_org_user', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('uploadedBy', String(authUser._id)),
      )) {
      totalBytes += meta.size;
    }
    return { totalBytes };
  },
});

export const getByDocumentId = query({
  args: {
    organizationId: v.string(),
    documentId: v.string(),
  },
  returns: v.union(
    v.object({
      pageCount: v.optional(v.number()),
      scannedPagesDetected: v.optional(v.number()),
      visionRequired: v.optional(v.boolean()),
      ocrApplied: v.optional(v.boolean()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;

    const meta = await ctx.db
      .query('fileMetadata')
      .withIndex('by_organizationId_and_documentId', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('documentId', args.documentId),
      )
      .first();
    if (!meta) return null;

    return {
      pageCount: meta.pageCount,
      scannedPagesDetected: meta.scannedPagesDetected,
      visionRequired: meta.visionRequired,
      ocrApplied: meta.ocrApplied,
    };
  },
});

export const getByStorageIds = query({
  args: {
    storageIds: v.array(v.id('_storage')),
  },
  returns: v.array(
    v.object({
      storageId: v.id('_storage'),
      documentId: v.optional(v.id('documents')),
      fileName: v.string(),
      contentType: v.string(),
      size: v.number(),
      ragStatus: v.optional(
        v.union(
          v.literal('queued'),
          v.literal('running'),
          v.literal('completed'),
          v.literal('failed'),
        ),
      ),
      ragError: v.optional(v.string()),
      ragProgress: v.optional(v.string()),
      pageCount: v.optional(v.number()),
      scannedPagesDetected: v.optional(v.number()),
      visionRequired: v.optional(v.boolean()),
    }),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];

    const results = await Promise.all(
      args.storageIds.slice(0, 20).map(async (storageId) => {
        const meta = await ctx.db
          .query('fileMetadata')
          .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
          .first();
        if (!meta) return null;
        return {
          storageId: meta.storageId,
          documentId: meta.documentId,
          fileName: meta.fileName,
          contentType: meta.contentType,
          size: meta.size,
          ragStatus: meta.ragStatus,
          ragError: meta.ragError,
          ragProgress: meta.ragProgress,
          pageCount: meta.pageCount,
          scannedPagesDetected: meta.scannedPagesDetected,
          visionRequired: meta.visionRequired,
        };
      }),
    );

    return results.filter((r) => r !== null);
  },
});
