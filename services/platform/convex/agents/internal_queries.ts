/**
 * Internal queries for agent bindings.
 *
 * Only DB-level lookups belong here. Agent config is read from
 * JSON files via internal actions in file_actions.ts.
 */

import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';

export const getBindingByAgent = internalQuery({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query('agentBindings')
      .withIndex('by_org_agent', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentSlug', args.agentSlug),
      )
      .first();
  },
});

export const getAvailableIntegrations = internalQuery({
  args: {
    organizationId: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<Array<{ name: string; title: string; type: string }>> => {
    const integrations: Array<{ name: string; title: string; type: string }> =
      [];
    const credentialQuery = ctx.db
      .query('integrationCredentials')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      );

    for await (const cred of credentialQuery) {
      if (cred.status !== 'active') continue;
      integrations.push({
        name: cred.slug,
        title: cred.slug,
        type: cred.sqlConnectionConfig ? 'sql' : 'rest_api',
      });
    }

    return integrations;
  },
});
