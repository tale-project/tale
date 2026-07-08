/**
 * V8 mutations supporting the `uploadAutomationBundle` action (the private automation upload
 * path). Mirrors `skills/upload_mutations.ts`:
 *
 *   1. `generateAutomationUploadUrl` — authenticated presign mutation, gated on the
 *      developer-settings capability (same gate as automation install).
 *   2. `recordAutomationUploadIntent` — bind `storageId → (orgId, userId)` after the
 *      client POSTs the blob, BEFORE invoking the action. Without this row the
 *      action would have to trust a client-supplied storageId (read/delete of
 *      arbitrary blobs across orgs).
 *   3. `verifyAutomationUploadIntent` / `deleteAutomationUploadIntent` — internal; the action
 *      verifies the row matches its org before reading the blob and deletes it
 *      (single-use) in its `finally`.
 *   4. `claimAutomationUploadSlot` / `releaseAutomationUploadSlot` — internal per-(orgId, slug)
 *      exclusion lock. Stale claims (crashed action) are reclaimed lazily.
 *
 * Lives in its own file because `upload_actions.ts` is `'use node'` and can't
 * host V8 mutations.
 */

import { ConvexError, v } from 'convex/values';

import { isValidAutomationSlug } from '../../lib/shared/schemas/automations';
import { internalMutation, mutation } from '../_generated/server';
import { requireOrgAdminOrDeveloper } from '../lib/auth/require_org_admin_or_developer';
import { toPublicUrl } from '../lib/helpers/public_storage_url';

const AUTOMATION_UPLOAD_CLAIM_TTL_MS = 35 * 60 * 1000; // action timeout (30min) + 5min buffer

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
        // Another org already claimed this storageId — refuse so we don't
        // accidentally re-bind the blob across tenants.
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
      organizationId: auth.orgId,
      userId: auth.userId,
      createdAt: Date.now(),
    });
    return null;
  },
});

/**
 * Verify an `automationUploadIntents` row matches the supplied org. Does NOT delete —
 * deletion lives in `deleteAutomationUploadIntent` and is called from the action's
 * `finally` alongside `ctx.storage.delete`. The split prevents a hijacker from
 * draining a victim's intents by guessing storageIds.
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

export const claimAutomationUploadSlot = internalMutation({
  args: {
    organizationId: v.string(),
    slug: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!isValidAutomationSlug(args.slug)) {
      throw new ConvexError({
        code: 'INVALID_SLUG',
        message: `Invalid automation slug: ${args.slug}`,
      });
    }
    const now = Date.now();
    const existing = await ctx.db
      .query('automationUploadClaims')
      .withIndex('by_org_slug', (q) =>
        q.eq('organizationId', args.organizationId).eq('slug', args.slug),
      )
      .first();
    if (existing) {
      if (existing.expiresAt > now) {
        throw new ConvexError({
          code: 'LOCK_HELD',
          message:
            'Another upload to this automation is already in progress. Try again in a moment.',
        });
      }
      // Stale claim from a crashed action — reclaim by deleting and
      // re-inserting so `claimedAt` reflects the current attempt.
      await ctx.db.delete(existing._id);
    }
    await ctx.db.insert('automationUploadClaims', {
      organizationId: args.organizationId,
      slug: args.slug,
      claimedAt: now,
      expiresAt: now + AUTOMATION_UPLOAD_CLAIM_TTL_MS,
    });
    return null;
  },
});

export const releaseAutomationUploadSlot = internalMutation({
  args: {
    organizationId: v.string(),
    slug: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('automationUploadClaims')
      .withIndex('by_org_slug', (q) =>
        q.eq('organizationId', args.organizationId).eq('slug', args.slug),
      )
      .first();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});
