import { ConvexError, v } from 'convex/values';

import { mutation, type MutationCtx } from '../_generated/server';
import { estimateTokens } from '../lib/context_management/estimate_tokens';
import { assertSelfAndOrgMember } from '../lib/rls/auth/assert_self_and_org_member';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';
import {
  CUSTOM_INSTRUCTIONS_ILLEGAL_RE,
  CUSTOM_INSTRUCTIONS_MAX_CHARS,
  CUSTOM_INSTRUCTIONS_MAX_TOKENS,
} from '../user_memories/constants';

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

    // Canonicalize line endings before any length / regex check, so a
    // Windows paste doesn't silently fail and stored content is always LF.
    const normalized = args.customInstructions
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');

    if (normalized.length > CUSTOM_INSTRUCTIONS_MAX_CHARS) {
      throw new ConvexError({
        code: 'too_long',
        message: `Custom instructions exceed ${CUSTOM_INSTRUCTIONS_MAX_CHARS} characters.`,
      });
    }
    if (
      normalized.length > 0 &&
      CUSTOM_INSTRUCTIONS_ILLEGAL_RE.test(normalized)
    ) {
      throw new ConvexError({
        code: 'invalid',
        message:
          'Custom instructions contain disallowed characters (angle ' +
          'brackets, backticks, or control characters).',
      });
    }
    const tokens = estimateTokens(normalized);
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
        customInstructions: normalized,
        updatedAt: now,
      });
      return existing._id;
    }
    // Leave both `*Enabled` flags undefined: writing custom instructions
    // without explicitly toggling means the user is still following the
    // org defaults. `setCustomInstructionsEnabled` / `setMemoriesEnabled`
    // are the only paths that record an explicit user opt-in/out.
    return await ctx.db.insert('userPreferences', {
      userId: authUser.userId,
      organizationId: args.organizationId,
      customInstructions: normalized,
      updatedAt: now,
    });
  },
});

async function setFeatureEnabled(
  ctx: MutationCtx,
  authUserId: string,
  organizationId: string,
  patch: {
    customInstructionsEnabled?: boolean;
    memoriesEnabled?: boolean;
  },
) {
  const now = Date.now();
  const existing = await ctx.db
    .query('userPreferences')
    .withIndex('by_userId_organizationId', (q) =>
      q.eq('userId', authUserId).eq('organizationId', organizationId),
    )
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, { ...patch, updatedAt: now });
    return existing._id;
  }
  return await ctx.db.insert('userPreferences', {
    userId: authUserId,
    organizationId,
    customInstructions: '',
    ...patch,
    updatedAt: now,
  });
}

export const setCustomInstructionsEnabled = mutation({
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
    return setFeatureEnabled(ctx, authUser.userId, args.organizationId, {
      customInstructionsEnabled: args.enabled,
    });
  },
});

export const setMemoriesEnabled = mutation({
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
    return setFeatureEnabled(ctx, authUser.userId, args.organizationId, {
      memoriesEnabled: args.enabled,
    });
  },
});
