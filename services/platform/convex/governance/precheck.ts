import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';

// `loadGuardrailsSnapshot`/`sanitizeMessage`
// (`convex/governance/sanitize.ts`) moved with the config-loading/PII group.
// `precheckInput` has a LIVE caller — the chat composer
// (`app/features/chat/hooks/use-send-message.ts`) calls it on every send when
// input guardrails are active — so per the stub policy this throws rather
// than silently returning `{ blocked: false }` (a false "checked, nothing
// found" signal indistinguishable from a real pass). The caller already
// fails open on a thrown precheck error (a pre-existing resilience path,
// logged via `console.warn`, falls through to send) — chat sending itself is
// separately offline, so this only changes what shows up in that log.

/**
 * Pre-send guardrails check for user input.
 *
 * Offline. See file header. Auth + membership are still
 * enforced before the error (no AI dependency); the `GUARDRAILS_DISABLED`
 * operator escape hatch is also preserved as an explicit opt-out that's
 * independent of whether the AI backend is up.
 */
export const precheckInput = action({
  args: {
    organizationId: v.string(),
    text: v.string(),
  },
  returns: v.object({
    blocked: v.boolean(),
    code: v.optional(
      v.union(v.literal('pii.blocked'), v.literal('chat_filter.blocked')),
    ),
    categoryIds: v.optional(v.array(v.string())),
    categoryLabels: v.optional(v.array(v.string())),
    maskedText: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    blocked: boolean;
    code?: 'pii.blocked' | 'chat_filter.blocked';
    categoryIds?: string[];
    categoryLabels?: string[];
    maskedText?: string;
  }> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new ConvexError({ code: 'UNAUTHENTICATED' });

    await ctx.runQuery(
      internal.governance.internal_mutations.requireOrganizationMemberInternal,
      {
        organizationId: args.organizationId,
        userId: authUser.userId,
        email: authUser.email,
        name: authUser.name,
      },
    );

    if (process.env.GUARDRAILS_DISABLED === '1') {
      return { blocked: false };
    }

    throw new ConvexError(
      'Guardrails precheck is offline while the platform AI backend is rewritten.',
    );
  },
});
