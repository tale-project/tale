import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';

export const getByStorageId = internalQuery({
  args: {
    storageId: v.id('_storage'),
  },
  async handler(ctx, args) {
    return await ctx.db
      .query('fileMetadata')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();
  },
});

/**
 * Read the SHA-256 checksum computed by Convex on upload. Exists because
 * `ctx.db.system.get(...)` is not available in actions — actions call this
 * internal query instead.
 */
export const getStorageSha256 = internalQuery({
  args: {
    storageId: v.id('_storage'),
  },
  async handler(ctx, args) {
    const meta = await ctx.db.system.get(args.storageId);
    return meta?.sha256 ?? null;
  },
});

/**
 * Find a prior completed audio transcription with identical content (same
 * SHA-256 hash) within the same org. Used by `transcribeAudio` to short-
 * circuit duplicate uploads: user drags the same `meeting.mp3` twice, we
 * only transcribe once. Returns the source row (without embedding the full
 * transcript again in the args — caller reads `.transcript` from the result).
 */
export const findCachedTranscript = internalQuery({
  args: {
    organizationId: v.string(),
    contentHash: v.string(),
    excludeStorageId: v.id('_storage'),
  },
  async handler(ctx, args) {
    for await (const row of ctx.db
      .query('fileMetadata')
      .withIndex('by_org_contentHash', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('contentHash', args.contentHash),
      )) {
      if (
        row.storageId !== args.excludeStorageId &&
        row.transcriptionStatus === 'completed' &&
        typeof row.transcript === 'string' &&
        row.transcript.length > 0
      ) {
        return row;
      }
    }
    return null;
  },
});
