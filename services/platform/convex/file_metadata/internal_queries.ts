import { v } from 'convex/values';

import { components } from '../_generated/api';
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
 * Filter a list of storage ids down to ones the caller is authorized
 * to poke RAG status for. Used by the public action
 * `checkFileRagStatuses` to prevent (a) anonymous attackers from
 * flipping `ragStatus: 'failed'` on any org's files via the indirect
 * `expireStaleRagQueue` path, and (b) members of org A from poking
 * org B's RAG state.
 *
 * Authorization model: caller must be a member (per Better Auth
 * `member` table) of every distinct organizationId referenced by the
 * supplied storage ids. Storage ids whose fileMetadata has a different
 * org are silently dropped.
 */
export const filterStorageIdsByCallerOrg = internalQuery({
  args: {
    storageIds: v.array(v.id('_storage')),
    userId: v.string(),
  },
  returns: v.array(v.id('_storage')),
  async handler(ctx, args) {
    const allowed: Array<(typeof args.storageIds)[number]> = [];
    const orgMembershipCache = new Map<string, boolean>();
    for (const storageId of args.storageIds) {
      const meta = await ctx.db
        .query('fileMetadata')
        .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
        .first();
      if (!meta) continue;
      const orgId = meta.organizationId;
      let isMember = orgMembershipCache.get(orgId);
      if (isMember === undefined) {
        const result = await ctx.runQuery(
          components.betterAuth.adapter.findMany,
          {
            model: 'member',
            paginationOpts: { cursor: null, numItems: 1 },
            where: [
              { field: 'organizationId', value: orgId, operator: 'eq' },
              { field: 'userId', value: args.userId, operator: 'eq' },
            ],
          },
        );
        isMember = (result?.page?.length ?? 0) > 0;
        orgMembershipCache.set(orgId, isMember);
      }
      if (isMember) allowed.push(storageId);
    }
    return allowed;
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
