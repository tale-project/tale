import { ConvexError, v } from 'convex/values';

import { mutation } from '../_generated/server';
import { estimateTokens } from '../lib/context_management/estimate_tokens';
import { assertSelfAndOrgMember } from '../lib/rls/auth/assert_self_and_org_member';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';

const CUSTOM_INSTRUCTIONS_MAX_TOKENS = 800;

export const upsertMyPreferences = mutation({
  args: {
    organizationId: v.string(),
    customInstructions: v.string(),
    language: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const authUser = await requireAuthenticatedUser(ctx);
    await assertSelfAndOrgMember(
      ctx,
      authUser,
      authUser.userId,
      args.organizationId,
    );

    const tokens = estimateTokens(args.customInstructions);
    if (tokens > CUSTOM_INSTRUCTIONS_MAX_TOKENS) {
      throw new ConvexError({
        code: 'too_long',
        message: `Custom instructions exceed ${CUSTOM_INSTRUCTIONS_MAX_TOKENS} token budget (got ~${tokens}).`,
      });
    }

    const existing = await ctx.db
      .query('userPreferences')
      .withIndex('by_userId_organizationId', (q) =>
        q
          .eq('userId', authUser.userId)
          .eq('organizationId', args.organizationId),
      )
      .first();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        customInstructions: args.customInstructions,
        language: args.language ?? existing.language,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert('userPreferences', {
      userId: authUser.userId,
      organizationId: args.organizationId,
      customInstructions: args.customInstructions,
      enabled: true,
      language: args.language,
      updatedAt: now,
    });
  },
});

/**
 * Records the EU just-in-time consent click. Idempotent: re-recording does
 * not overwrite the original timestamp.
 */
export const recordConsent = mutation({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await requireAuthenticatedUser(ctx);
    await assertSelfAndOrgMember(
      ctx,
      authUser,
      authUser.userId,
      args.organizationId,
    );

    const now = Date.now();
    const existing = await ctx.db
      .query('userPreferences')
      .withIndex('by_userId_organizationId', (q) =>
        q
          .eq('userId', authUser.userId)
          .eq('organizationId', args.organizationId),
      )
      .first();
    if (existing) {
      if (!existing.consentedAt) {
        await ctx.db.patch(existing._id, { consentedAt: now, updatedAt: now });
      }
      return existing._id;
    }
    return await ctx.db.insert('userPreferences', {
      userId: authUser.userId,
      organizationId: args.organizationId,
      customInstructions: '',
      enabled: true,
      consentedAt: now,
      updatedAt: now,
    });
  },
});

export const setEnabled = mutation({
  args: {
    organizationId: v.string(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const authUser = await requireAuthenticatedUser(ctx);
    await assertSelfAndOrgMember(
      ctx,
      authUser,
      authUser.userId,
      args.organizationId,
    );

    const now = Date.now();
    const existing = await ctx.db
      .query('userPreferences')
      .withIndex('by_userId_organizationId', (q) =>
        q
          .eq('userId', authUser.userId)
          .eq('organizationId', args.organizationId),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        enabled: args.enabled,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert('userPreferences', {
      userId: authUser.userId,
      organizationId: args.organizationId,
      customInstructions: '',
      enabled: args.enabled,
      updatedAt: now,
    });
  },
});
