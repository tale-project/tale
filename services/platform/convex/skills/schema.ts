import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Per-(organizationId, slug) exclusion lock for `uploadSkillBundle`.
 *
 * `uploadSkillBundle` does a stage-then-rename swap on disk; two concurrent
 * `force: true` uploads to the same slug would race past the existence
 * check and last-writer-wins, silently destroying one bundle. The action
 * inserts a claim row (uniqueness enforced via the `by_org_slug` index +
 * pre-insert lookup that expires stale claims) before the rename pair and
 * deletes the row in `finally` alongside the storage-blob cleanup.
 *
 * `expiresAt` lets a crashed action's stale claim be reclaimed lazily on
 * the next upload attempt for the same slug — no cron sweep needed.
 */
export const skillUploadClaimTable = defineTable({
  organizationId: v.string(),
  slug: v.string(),
  claimedAt: v.number(),
  expiresAt: v.number(),
}).index('by_org_slug', ['organizationId', 'slug']);

/**
 * Binds an `_storage` blob to the org + user that requested its upload URL.
 *
 * Without this, `uploadSkillBundle` would call `ctx.storage.get(storageId)`
 * on a client-supplied id with no ownership verification — letting a
 * caller in org A point the server at org B's pending blob (read it,
 * persist it as a skill in org A, or trigger its deletion). Mirrors the
 * `file_metadata.by_storageId` + `organizationId` check pattern used by
 * the document upload path.
 *
 * Written by `generateSkillUploadUrl` at presign time, looked up by
 * `uploadSkillBundle`, deleted in the same `finally` block as the storage
 * blob.
 */
export const skillUploadIntentTable = defineTable({
  storageId: v.id('_storage'),
  organizationId: v.string(),
  userId: v.string(),
  createdAt: v.number(),
}).index('by_storageId', ['storageId']);
