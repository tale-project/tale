import { v } from 'convex/values';

import { internalMutation, internalQuery } from '../_generated/server';

/**
 * V8 helpers for the integration→agents/workflows cascade (the orchestrating
 * action is `cascade.ts`, `'use node'`). When an integration is disconnected,
 * its bundled agents + workflows are disabled; on reconnect, only what the
 * cascade disabled is restored (a user's explicit disable is never resurrected).
 */

/** Agent slugs installed BY this integration (provenance `bundledBy === slug`). */
export const listBundledAgentSlugs = internalQuery({
  args: { organizationId: v.string(), integrationSlug: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, args): Promise<string[]> => {
    const slugs: string[] = [];
    for await (const row of ctx.db
      .query('agentInstallations')
      .withIndex('by_org_bundledBy', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('bundledBy', args.integrationSlug),
      )) {
      slugs.push(row.agentSlug);
    }
    return slugs;
  },
});

/** Workflow slugs installed BY this integration (`installedBy === 'integration:<slug>'`). */
export const listIntegrationWorkflowSlugs = internalQuery({
  args: { organizationId: v.string(), integrationSlug: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, args): Promise<string[]> => {
    const marker = `integration:${args.integrationSlug}`;
    const slugs: string[] = [];
    for await (const row of ctx.db
      .query('wfInstallations')
      .withIndex('by_org', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      if (row.installedBy === marker) slugs.push(row.workflowSlug);
    }
    return slugs;
  },
});

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
