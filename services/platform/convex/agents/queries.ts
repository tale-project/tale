/**
 * Queries for agent bindings and available resources.
 *
 * Agent configuration lives in JSON files on the filesystem (see file_actions.ts).
 * This module only queries the slim binding table and resource lookups.
 */

import { v } from 'convex/values';

import { query } from '../_generated/server';
import { TOOL_NAMES } from '../agent_tools/tool_names';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';

export const getBindingByAgent = query({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) return null;

    await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    const binding = await ctx.db
      .query('agentBindings')
      .withIndex('by_org_agent', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentSlug', args.agentSlug),
      )
      .first();

    return binding;
  },
});

export const hasBindingsByTeam = query({
  args: {
    teamId: v.string(),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) return false;

    const binding = await ctx.db
      .query('agentBindings')
      .withIndex('by_team', (q) => q.eq('teamId', args.teamId))
      .first();

    return binding !== null;
  },
});

export const getAvailableTools = query({
  args: {},
  handler: async (): Promise<Array<{ name: string; available: boolean }>> => {
    return TOOL_NAMES.map((name) => ({
      name,
      available: true,
    }));
  },
});

export const getAvailableIntegrations = query({
  args: {
    organizationId: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<Array<{ name: string; title: string; type: string }>> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) return [];

    await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

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
