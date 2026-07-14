import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';

/**
 * V8 helper for the integration→agents cascade (the orchestrating action is
 * `cascade.ts`, `'use node'`). When an integration is disconnected, agents
 * that hard-require it are disabled; on reconnect, only what the cascade
 * disabled is restored (a user's explicit disable is never resurrected).
 */

/** Re-enable an agent ONLY if it was cascade-disabled (never a user disable). */
export const reEnableIfCascadeDisabled = internalMutation({
  args: { organizationId: v.string(), agentSlug: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const row = await ctx.db
      .query('agentInstallations')
      .withIndex('by_org_slug', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentSlug', args.agentSlug),
      )
      .first();
    if (row && !row.enabled && row.disabledReason === 'integration_disabled') {
      await ctx.db.patch(row._id, { enabled: true, disabledReason: undefined });
    }
    return null;
  },
});
