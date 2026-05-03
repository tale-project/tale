import { ConvexError, v } from 'convex/values';

import { mutation } from '../_generated/server';
import { estimateTokens } from '../lib/context_management/estimate_tokens';
import { assertSelfAndOrgMember } from '../lib/rls/auth/assert_self_and_org_member';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';
import { CUSTOM_INSTRUCTIONS_MAX_TOKENS } from '../user_memories/constants';

export const upsertMyPreferences = mutation({
  args: {
    organizationId: v.string(),
    customInstructions: v.string(),
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
        updatedAt: now,
      });
      return existing._id;
    }
    // Default-OFF: writing custom instructions without explicitly toggling
    // enabled stores the text but leaves personalization disabled. User
    // must call `setEnabled({enabled: true})` to activate.
    return await ctx.db.insert('userPreferences', {
      userId: authUser.userId,
      organizationId: args.organizationId,
      customInstructions: args.customInstructions,
      enabled: false,
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
