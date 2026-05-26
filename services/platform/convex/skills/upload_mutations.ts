/**
 * V8 mutations supporting the `uploadSkillBundle` action:
 *
 *   1. `generateSkillUploadUrl` — authenticated presign mutation. Enforces
 *      developer-settings capability per `requireOrgAdminOrDeveloper`.
 *   2. `recordSkillUploadIntent` — bind `storageId → (orgId, userId)` after
 *      the client POSTs the blob, BEFORE invoking the action. Without this
 *      row the action would have to trust a client-supplied storageId
 *      (read/delete of arbitrary blobs across orgs).
 *   3. `consumeSkillUploadIntent` — internal, called from the action.
 *      Verifies the row matches the caller's org and deletes it (storageId
 *      is single-use).
 *   4. `claimSkillUploadSlot` / `releaseSkillUploadSlot` — internal
 *      per-(orgId, slug) exclusion lock. Stale claims (crashed action) are
 *      reclaimed lazily on the next attempt for the same slug.
 *
 * Lives in its own file because `file_actions.ts` is `'use node'` and
 * can't host V8 mutations.
 */

import { ConvexError, v } from 'convex/values';

import {
  RESERVED_SKILL_NAMES,
  SKILL_NAME_REGEX,
} from '../../lib/shared/schemas/skills';
import { internalMutation, mutation } from '../_generated/server';
import { requireOrgAdminOrDeveloper } from '../lib/auth/require_org_admin_or_developer';
import { toPublicUrl } from '../lib/helpers/public_storage_url';

// Inline slug validation — `file_utils.ts:validateSkillSlug` is the same
// shape but lives in a `'use node'` module, so this V8 mutation can't
// import it without dragging the Node runtime into V8.
function isValidSkillSlug(slug: string): boolean {
  return SKILL_NAME_REGEX.test(slug) && !RESERVED_SKILL_NAMES.has(slug);
}

const SKILL_UPLOAD_CLAIM_TTL_MS = 35 * 60 * 1000; // action timeout (30min) + 5min buffer

export const generateSkillUploadUrl = mutation({
  args: { organizationId: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    const url = await ctx.storage.generateUploadUrl();
    return toPublicUrl(url);
  },
});

export const recordSkillUploadIntent = mutation({
  args: {
    organizationId: v.string(),
    storageId: v.id('_storage'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);

    // Replace any prior intent for the same blob — the client might re-POST
    // after a network blip. The `by_storageId` index is single-column so
    // this is a constant-time op.
    const existing = await ctx.db
      .query('skillUploadIntents')
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
    await ctx.db.insert('skillUploadIntents', {
      storageId: args.storageId,
      organizationId: auth.orgId,
      userId: auth.userId,
      createdAt: Date.now(),
    });
    return null;
  },
});

/**
 * Verify a `skillUploadIntents` row matches the supplied org. Does NOT
 * delete — deletion lives in `deleteSkillUploadIntent` and is called from
 * the action's `finally` alongside `ctx.storage.delete`. This split
 * prevents a hijacker from draining a victim's intents by repeatedly
 * calling with guessed storageIds.
 */
export const verifySkillUploadIntent = internalMutation({
  args: {
    organizationId: v.string(),
    storageId: v.id('_storage'),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const intent = await ctx.db
      .query('skillUploadIntents')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();
    if (!intent) return false;
    return intent.organizationId === args.organizationId;
  },
});

export const deleteSkillUploadIntent = internalMutation({
  args: { storageId: v.id('_storage') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const intent = await ctx.db
      .query('skillUploadIntents')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first();
    if (intent) await ctx.db.delete(intent._id);
    return null;
  },
});

export const claimSkillUploadSlot = internalMutation({
  args: {
    organizationId: v.string(),
    slug: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!isValidSkillSlug(args.slug)) {
      throw new ConvexError({
        code: 'INVALID_SLUG',
        message: `Invalid skill slug: ${args.slug}`,
      });
    }
    const now = Date.now();
    const existing = await ctx.db
      .query('skillUploadClaims')
      .withIndex('by_org_slug', (q) =>
        q.eq('organizationId', args.organizationId).eq('slug', args.slug),
      )
      .first();
    if (existing) {
      if (existing.expiresAt > now) {
        throw new ConvexError({
          code: 'LOCK_HELD',
          message:
            'Another upload to this skill is already in progress. Try again in a moment.',
        });
      }
      // Stale claim from a crashed action — reclaim by deleting and
      // re-inserting so `claimedAt` reflects the current attempt.
      await ctx.db.delete(existing._id);
    }
    await ctx.db.insert('skillUploadClaims', {
      organizationId: args.organizationId,
      slug: args.slug,
      claimedAt: now,
      expiresAt: now + SKILL_UPLOAD_CLAIM_TTL_MS,
    });
    return null;
  },
});

export const releaseSkillUploadSlot = internalMutation({
  args: {
    organizationId: v.string(),
    slug: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('skillUploadClaims')
      .withIndex('by_org_slug', (q) =>
        q.eq('organizationId', args.organizationId).eq('slug', args.slug),
      )
      .first();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});
