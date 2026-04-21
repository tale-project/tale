import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { authComponent } from '../auth';
import { loadGuardrailsSnapshot, sanitizeMessage } from './sanitize';

/**
 * Pre-send guardrails check for user input.
 *
 * Runs the full `sanitizeMessage` input-direction pipeline BUT with
 * moderation_provider stripped from the snapshot — moderation is HTTP-
 * expensive and always runs again on the real send path, so doing it
 * twice per message would double provider cost for no gain.
 *
 * Reusing `sanitizeMessage` means chat_filter + PII event writing
 * (`chatFilterEvents` + `auditLogs` on block) stays in exactly one place.
 * Previously this was a separate query that re-implemented the logic
 * without writing events, so mask/block outcomes never showed up in
 * Recent Events once the client started pre-masking based on the
 * precheck response.
 *
 * Returns:
 *  - `{ blocked: false }` on pass
 *  - `{ blocked: false, maskedText, categoryLabels }` on mask
 *    (client substitutes text before sending; server's real-send
 *    sanitize is idempotent on already-masked text so it won't
 *    double-write the event)
 *  - `{ blocked: true, code, categoryIds, categoryLabels }` on block
 *    (client aborts send; the single event written here IS the
 *    authoritative audit record)
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
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    await ctx.runQuery(
      internal.governance.internal_mutations.requireOrganizationMemberInternal,
      {
        organizationId: args.organizationId,
        userId: String(authUser._id),
        email: authUser.email,
        name: authUser.name,
      },
    );

    if (process.env.GUARDRAILS_DISABLED === '1') {
      return { blocked: false };
    }

    const fullSnapshot = await loadGuardrailsSnapshot(ctx, args.organizationId);
    // Strip moderation so sanitizeMessage doesn't fire the HTTP call. It
    // will run on the real send path — duplicating here would double
    // provider cost and produce two audit rows per message.
    const snapshot = { ...fullSnapshot, moderation: null };

    try {
      const result = await sanitizeMessage(ctx, args.text, 'input', snapshot, {
        organizationId: args.organizationId,
        orgSlug: 'default',
        threadId: 'precheck',
        actorId: String(authUser._id),
        actorEmail: authUser.email,
        actorType: 'user',
      });
      if (result.text !== args.text) {
        return {
          blocked: false,
          maskedText: result.text,
        };
      }
      return { blocked: false };
    } catch (err) {
      if (err instanceof ConvexError) {
        const data = err.data as
          | {
              code?: string;
              categoryIds?: string[];
              categoryLabels?: string[];
            }
          | undefined;
        if (
          data?.code === 'pii.blocked' ||
          data?.code === 'chat_filter.blocked'
        ) {
          return {
            blocked: true,
            code: data.code,
            categoryIds: data.categoryIds,
            categoryLabels: data.categoryLabels,
          };
        }
      }
      throw err;
    }
  },
});
