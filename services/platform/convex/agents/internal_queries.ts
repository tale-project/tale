/**
 * Internal queries for agent bindings.
 *
 * Only DB-level lookups belong here. Agent config is read from
 * JSON files via internal actions in file_actions.ts.
 */

import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import { routeSeedValidator, routeTuningValidator } from './schema';

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

export const listBindingsForOrg = internalQuery({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const results: Array<{
      agentSlug: string;
      teamId?: string;
      sharedWithTeamIds?: string[];
    }> = [];

    const query = ctx.db
      .query('agentBindings')
      .withIndex('by_organization', (q) =>
        q.eq('organizationId', args.organizationId),
      );

    for await (const binding of query) {
      results.push({
        agentSlug: binding.agentSlug,
        teamId: binding.teamId,
        sharedWithTeamIds: binding.sharedWithTeamIds,
      });
    }

    return results;
  },
});

/** Read-side TTL for the auto-route cache (ms). Stale entries are ignored on
 *  read and purged by a cron; correctness rests on `candidatesHash`, not this. */
const AUTO_ROUTE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Look up a cached "Auto" routing decision for an (org, roster, message) key.
 * Returns the cached decision (slug + advisory hints), or null on a miss /
 * expired entry.
 */
export const getAutoRouteCache = internalQuery({
  args: {
    organizationId: v.string(),
    candidatesHash: v.string(),
    messageKey: v.string(),
    nowMs: v.number(),
  },
  returns: v.union(
    v.object({
      agentSlug: v.string(),
      language: v.optional(v.string()),
      tuning: v.optional(routeTuningValidator),
      seed: v.optional(routeSeedValidator),
      capabilities: v.optional(v.array(v.string())),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('autoRouteCache')
      .withIndex('by_org_candidates_message', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('candidatesHash', args.candidatesHash)
          .eq('messageKey', args.messageKey),
      )
      .first();
    if (!row) return null;
    if (args.nowMs - row.createdAt > AUTO_ROUTE_CACHE_TTL_MS) return null;
    return {
      agentSlug: row.agentSlug,
      language: row.language,
      tuning: row.tuning,
      seed: row.seed,
      capabilities: row.capabilities,
    };
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
