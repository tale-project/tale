/**
 * V8 mutations supporting the package-upload action's zip lane:
 *
 *   1. `generateAutomationUploadUrl` — authenticated presign mutation, gated on
 *      the developer-settings capability (the same gate as the upload itself).
 *   2. `recordAutomationUploadIntent` — bind `storageId → (orgId, userId)` after
 *      the client POSTs the blob, BEFORE invoking the action. Without this row
 *      the action would have to trust a client-supplied storageId (read/delete
 *      of arbitrary blobs across organizations).
 *   3. `verifyAutomationUploadIntent` / `deleteAutomationUploadIntent` —
 *      internal; the action verifies the row matches its org before reading the
 *      blob and deletes it (single-use) in its `finally`.
 *
 * Unlike the original bundle upload this lane has no per-(org, slug) claim
 * lock: the automation itself is saved through a transactional Convex mutation
 * (`storeSave`), so there is no on-disk staging swap to guard. Skill fan-out
 * writes are per-file atomic with SKILL.md written last, matching the posture
 * of every other skills-domain write.
 *
 * Lives in its own file because `upload_action.ts` is `'use node'` and cannot
 * host V8 mutations.
 */

import { ConvexError, v } from 'convex/values';

import { internalMutation, mutation } from '../_generated/server';
import { requireOrgAdminOrDeveloper } from '../lib/auth/require_org_admin_or_developer';
import { toPublicUrl } from '../lib/helpers/public_storage_url';

/** An intent this old belongs to a crashed upload — sweepable. */
const UPLOAD_INTENT_TTL_MS = 60 * 60 * 1000;

export const generateAutomationUploadUrl = mutation({
  args: { organizationId: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    const url = await ctx.storage.generateUploadUrl();
    return toPublicUrl(url);
  },
});

export const recordAutomationUploadIntent = mutation({
  args: {
    organizationId: v.string(),
    storageId: v.id('_storage'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);

    // Replace any prior intent for the same blob — the client might re-POST
    // after a network blip. `by_storageId` is single-column so this is a
    // constant-time op.
    const existing = await ctx.db
      .query('automationUploadIntents')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();
    if (existing) {
      if (existing.organizationId !== args.organizationId) {
        // Another org already claimed this storageId — refuse rather than
        // silently re-bind the blob across tenants.
        throw new ConvexError({
          code: 'STORAGE_INTENT_CONFLICT',
          message: 'Storage blob already bound to a different organization',
        });
      }
      await ctx.db.patch(existing._id, {
        userId: auth.userId,
        createdAt: Date.now(),
      });
      return null;
    }
    await ctx.db.insert('automationUploadIntents', {
      storageId: args.storageId,
      organizationId: args.organizationId,
      userId: auth.userId,
      createdAt: Date.now(),
    });

    // Lazy sweep: a crashed action never reaches its `finally`, so orphaned
    // intents (and their blobs) are collected on the next upload instead of
    // by a cron. The table only ever holds in-flight uploads, so the full
    // scan is a handful of rows.
    const cutoff = Date.now() - UPLOAD_INTENT_TTL_MS;
    const rows = await ctx.db.query('automationUploadIntents').collect();
    for (const row of rows) {
      if (row.createdAt >= cutoff) continue;
      await ctx.db.delete(row._id);
      await ctx.storage.delete(row.storageId).catch((err: unknown) => {
        console.warn('automation upload blob sweep failed', err);
      });
    }
    return null;
  },
});

/**
 * Verify an `automationUploadIntents` row matches the supplied org. Does NOT
 * delete — deletion lives in `deleteAutomationUploadIntent` and is called from
 * the action's `finally` alongside `ctx.storage.delete`. The split prevents a
 * hijacker from draining a victim's intents by guessing storageIds.
 */
export const verifyAutomationUploadIntent = internalMutation({
  args: {
    organizationId: v.string(),
    storageId: v.id('_storage'),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const intent = await ctx.db
      .query('automationUploadIntents')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();
    if (!intent) return false;
    return intent.organizationId === args.organizationId;
  },
});

export const deleteAutomationUploadIntent = internalMutation({
  args: { storageId: v.id('_storage') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const intent = await ctx.db
      .query('automationUploadIntents')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();
    if (intent) await ctx.db.delete(intent._id);
    return null;
  },
});
