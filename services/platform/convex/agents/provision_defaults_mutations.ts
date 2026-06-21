import { v } from 'convex/values';

import {
  type QueryCtx,
  internalMutation,
  internalQuery,
} from '../_generated/server';

/**
 * V8 helpers for the agent autoInstall provisioner (the action that walks the
 * catalog lives in `provision_defaults.ts`, `'use node'`). One
 * `agentDefaultProvisions` row per (org, agent) the provisioner has handled —
 * existence means "already auto-installed once", so an org that later disables
 * or uninstalls the agent is never re-provisioned behind its back. Mirrors
 * `workflows/provision_defaults_mutations.ts`.
 */

/**
 * Has the autoInstall provisioner ever swept this org? `agentDefaultProvisions`
 * is append-only and survives agent uninstall/disable, so its presence is the
 * durable "org has been provisioned" signal — unlike `agentInstallations` count,
 * which an org can legitimately drain to zero. The agent-liveness gate anchors
 * its fail-open on THIS (fall open only for a never-provisioned org), and the
 * sweep writes a sentinel row so even a zero-autoInstall catalog flips it true.
 * V8 helper (shared by the gate query); `hasAnyProvisionQuery` wraps it for
 * action callers.
 */
export async function hasAnyProvision(
  ctx: QueryCtx,
  organizationId: string,
): Promise<boolean> {
  const row = await ctx.db
    .query('agentDefaultProvisions')
    .withIndex('by_org_slug', (q) => q.eq('organizationId', organizationId))
    .first();
  return row !== null;
}

export const hasAnyProvisionQuery = internalQuery({
  args: { organizationId: v.string() },
  returns: v.boolean(),
  handler: (ctx, args): Promise<boolean> =>
    hasAnyProvision(ctx, args.organizationId),
});

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
