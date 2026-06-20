import { v } from 'convex/values';

import { internalMutation, internalQuery } from '../_generated/server';

/**
 * V8 helpers for the agent autoInstall provisioner (the action that walks the
 * catalog lives in `provision_defaults.ts`, `'use node'`). One
 * `agentDefaultProvisions` row per (org, agent) the provisioner has handled —
 * existence means "already auto-installed once", so an org that later disables
 * or uninstalls the agent is never re-provisioned behind its back. Mirrors
 * `workflows/provision_defaults_mutations.ts`.
 */

export const getProvision = internalQuery({
  args: { organizationId: v.string(), agentSlug: v.string() },
  returns: v.union(v.object({ contentHash: v.string() }), v.null()),
  handler: async (ctx, args): Promise<{ contentHash: string } | null> => {
    const row = await ctx.db
      .query('agentDefaultProvisions')
      .withIndex('by_org_slug', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentSlug', args.agentSlug),
      )
      .first();
    return row ? { contentHash: row.contentHash } : null;
  },
});

export const recordProvision = internalMutation({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
    contentHash: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const existing = await ctx.db
      .query('agentDefaultProvisions')
      .withIndex('by_org_slug', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentSlug', args.agentSlug),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        contentHash: args.contentHash,
        provisionedAt: Date.now(),
      });
      return null;
    }
    await ctx.db.insert('agentDefaultProvisions', {
      organizationId: args.organizationId,
      agentSlug: args.agentSlug,
      contentHash: args.contentHash,
      provisionedAt: Date.now(),
    });
    return null;
  },
});
