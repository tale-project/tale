import { ConvexError, v } from 'convex/values';

import { mutation, type MutationCtx } from '../_generated/server';
import { assertSelfAndOrgMember } from '../lib/rls/auth/assert_self_and_org_member';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';

// `lib/context_management/estimate_tokens.ts` and
// `user_memories/constants.ts` moved with the chat/agent-memory domain.
// Single caller (this file), so inlined rather than re-created as modules.

/**
 * Local re-approximation of `estimateTokens`'s plain-Latin path
 * (from the retired `lib/context_management/estimate_tokens.ts`),
 * without the CJK refinement (the full impl weighs CJK vs Latin runs
 * differently). This is a soft length guard on a
 * settings field, not a chat-context token budget, so a flat
 * `ceil(chars / 4)` estimate is an equivalent-enough simplification.
 */
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// Copied from the retired `user_memories/constants.ts`.
// Same as ILLEGAL_CONTENT_RE but allows LF (0x0a). For multi-line fields like
// customInstructions; callers must normalize CRLF / lone CR → LF before
// testing (lone CR is still rejected by the \x00-\x09 / \x0b-\x1f range).
const CUSTOM_INSTRUCTIONS_ILLEGAL_RE = /[<>`\x00-\x09\x0b-\x1f\x7f]/;
const CUSTOM_INSTRUCTIONS_MAX_CHARS = 5000;
const CUSTOM_INSTRUCTIONS_MAX_TOKENS = 800;

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

async function patchMyPreferences(
  ctx: MutationCtx,
  authUserId: string,
  organizationId: string,
  patch: {
    customInstructionsEnabled?: boolean;
    memoriesEnabled?: boolean;
    onboardingCompleted?: boolean;
    chatModelId?: string;
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
    return patchMyPreferences(ctx, authUser.userId, args.organizationId, {
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
    return patchMyPreferences(ctx, authUser.userId, args.organizationId, {
      memoriesEnabled: args.enabled,
    });
  },
});

export const setOnboardingCompleted = mutation({
  args: {
    organizationId: v.string(),
    completed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const authUser = await requireAuthenticatedUser(ctx);
    await assertSelfAndOrgMember(
      ctx,
      authUser,
      authUser.userId,
      args.organizationId,
    );
    return patchMyPreferences(ctx, authUser.userId, args.organizationId, {
      onboardingCompleted: args.completed,
    });
  },
});

/** A model id is provider-namespaced ("deepseek-chat",
 * "anthropic/claude-fable-5"); bound and printable, never free prose. */
const CHAT_MODEL_ID_RE = /^[\x21-\x7e]{1,200}$/;

/**
 * Remember the composer's model pick for this user and org. Set on an
 * EXPLICIT pick only — the composer's own default seeding never writes, so
 * the row always reflects a choice the user actually made.
 */
export const setChatModel = mutation({
  args: {
    organizationId: v.string(),
    modelId: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await requireAuthenticatedUser(ctx);
    await assertSelfAndOrgMember(
      ctx,
      authUser,
      authUser.userId,
      args.organizationId,
    );
    if (!CHAT_MODEL_ID_RE.test(args.modelId)) {
      throw new ConvexError({
        code: 'invalid_model_id',
        message: 'Model ids are short printable identifiers.',
      });
    }
    return patchMyPreferences(ctx, authUser.userId, args.organizationId, {
      chatModelId: args.modelId,
    });
  },
});
