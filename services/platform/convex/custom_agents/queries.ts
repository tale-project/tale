/**
 * Queries for custom agents.
 */

import { v } from 'convex/values';
import { query } from '../_generated/server';
import { authComponent } from '../auth';
import { getUserTeamIds } from '../lib/get_user_teams';
import { hasTeamAccess } from '../lib/team_access';
import { TOOL_NAMES, TOOL_REGISTRY_MAP } from '../agent_tools/tool_registry';

export const listCustomAgents = query({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));

    const agents = ctx.db
      .query('customAgents')
      .withIndex('by_organization_active', (q) =>
        q.eq('organizationId', args.organizationId).eq('isActive', true),
      );

    const results = [];
    for await (const agent of agents) {
      if (hasTeamAccess(agent, userTeamIds)) {
        results.push(agent);
      }
    }

    return results;
  },
});

export const getCustomAgent = query({
  args: {
    customAgentId: v.id('customAgents'),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const agent = await ctx.db.get(args.customAgentId);
    if (!agent || !agent.isActive) return null;

    const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));
    if (!hasTeamAccess(agent, userTeamIds)) return null;

    return agent;
  },
});

export const getCustomAgentVersions = query({
  args: {
    customAgentId: v.id('customAgents'),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const agent = await ctx.db.get(args.customAgentId);
    if (!agent || !agent.isActive) return [];

    const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));
    if (!hasTeamAccess(agent, userTeamIds)) return [];

    const versions = ctx.db
      .query('customAgentVersions')
      .withIndex('by_agent', (q) => q.eq('customAgentId', args.customAgentId))
      .order('desc');

    const results = [];
    for await (const version of versions) {
      results.push(version);
    }

    return results;
  },
});

export const getAvailableTools = query({
  args: {},
  handler: async () => {
    return TOOL_NAMES.map((name) => ({
      name,
      available: name in TOOL_REGISTRY_MAP,
    }));
  },
});
