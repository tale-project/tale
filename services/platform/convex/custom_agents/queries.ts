/**
 * Queries for custom agents (single-table versioning).
 */

import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';

import { query } from '../_generated/server';
import { TOOL_NAMES } from '../agent_tools/tool_names';
import { authComponent } from '../auth';
import { getUserTeamIds } from '../lib/get_user_teams';
import { hasTeamAccess } from '../lib/team_access';

const STATUS_PRIORITY: Record<string, number> = {
  active: 0,
  draft: 1,
  archived: 2,
};

export const listCustomAgents = query({
  args: {
    organizationId: v.string(),
    filterTeamId: v.optional(v.string()),
    filterPublished: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Doc<'customAgents'>[]> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));

    if (args.filterPublished === true) {
      const agents = ctx.db
        .query('customAgents')
        .withIndex('by_org_active_status', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('isActive', true)
            .eq('status', 'active'),
        );

      const results: Doc<'customAgents'>[] = [];
      for await (const agent of agents) {
        if (!hasTeamAccess(agent, userTeamIds)) continue;
        if (
          args.filterTeamId &&
          agent.teamId &&
          agent.teamId !== args.filterTeamId &&
          !agent.sharedWithTeamIds?.includes(args.filterTeamId)
        ) {
          continue;
        }
        results.push(agent);
      }
      return results;
    }

    const agents = ctx.db
      .query('customAgents')
      .withIndex('by_org_active_status', (q) =>
        q.eq('organizationId', args.organizationId).eq('isActive', true),
      );

    const bestByRoot = new Map<string, Doc<'customAgents'>>();
    for await (const agent of agents) {
      if (!hasTeamAccess(agent, userTeamIds)) continue;
      if (
        args.filterTeamId &&
        agent.teamId &&
        agent.teamId !== args.filterTeamId &&
        !agent.sharedWithTeamIds?.includes(args.filterTeamId)
      ) {
        continue;
      }

      const rootId = agent.rootVersionId ?? agent._id;
      const existing = bestByRoot.get(rootId);
      if (
        !existing ||
        (STATUS_PRIORITY[agent.status] ?? 99) <
          (STATUS_PRIORITY[existing.status] ?? 99)
      ) {
        bestByRoot.set(rootId, agent);
      }
    }

    return [...bestByRoot.values()];
  },
});

export const getCustomAgent = query({
  args: {
    customAgentId: v.id('customAgents'),
  },
  handler: async (ctx, args): Promise<Doc<'customAgents'> | null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    // customAgentId is the rootVersionId; find the draft record
    const draftQuery = ctx.db
      .query('customAgents')
      .withIndex('by_root_status', (q) =>
        q.eq('rootVersionId', args.customAgentId).eq('status', 'draft'),
      );

    let draft = null;
    for await (const record of draftQuery) {
      draft = record;
      break;
    }

    if (!draft || !draft.isActive) return null;

    const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));
    if (!hasTeamAccess(draft, userTeamIds)) return null;

    return draft;
  },
});

export const getCustomAgentByVersion = query({
  args: {
    customAgentId: v.id('customAgents'),
    versionNumber: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Doc<'customAgents'> | null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const rootAgent = await ctx.db.get(args.customAgentId);
    if (!rootAgent || !rootAgent.isActive) return null;

    const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));
    if (!hasTeamAccess(rootAgent, userTeamIds)) return null;

    if (args.versionNumber !== undefined) {
      const versions = ctx.db
        .query('customAgents')
        .withIndex('by_root', (q) => q.eq('rootVersionId', args.customAgentId));
      for await (const version of versions) {
        if (version.versionNumber === args.versionNumber) return version;
      }
      return null;
    }

    // No versionNumber: prefer draft -> active -> latest archived
    const allVersions = ctx.db
      .query('customAgents')
      .withIndex('by_root', (q) => q.eq('rootVersionId', args.customAgentId))
      .order('desc');

    let bestFallback: typeof rootAgent | null = null;
    for await (const version of allVersions) {
      if (version.status === 'draft') return version;
      if (version.status === 'active') return version;
      if (!bestFallback) bestFallback = version;
    }
    return bestFallback;
  },
});

export const getCustomAgentVersions = query({
  args: {
    customAgentId: v.id('customAgents'),
  },
  handler: async (ctx, args): Promise<Doc<'customAgents'>[]> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const rootAgent = await ctx.db.get(args.customAgentId);
    if (!rootAgent || !rootAgent.isActive) return [];

    const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));
    if (!hasTeamAccess(rootAgent, userTeamIds)) return [];

    const versions = ctx.db
      .query('customAgents')
      .withIndex('by_root', (q) => q.eq('rootVersionId', args.customAgentId))
      .order('desc');

    const results: Doc<'customAgents'>[] = [];
    for await (const version of versions) {
      results.push(version);
    }

    return results;
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
    if (!authUser) throw new Error('Unauthenticated');

    const integrations: Array<{ name: string; title: string; type: string }> =
      [];
    const integrationQuery = ctx.db
      .query('integrations')
      .withIndex('by_organizationId_and_status', (q) =>
        q.eq('organizationId', args.organizationId).eq('status', 'active'),
      );

    for await (const integration of integrationQuery) {
      integrations.push({
        name: integration.name,
        title: integration.title,
        type: integration.type ?? 'rest_api',
      });
    }

    return integrations;
  },
});

export const getModelPresets = query({
  args: {},
  handler: async (): Promise<{
    fast: string | null;
    standard: string | null;
    advanced: string | null;
  }> => {
    return {
      fast: process.env.OPENAI_FAST_MODEL ?? null,
      standard: process.env.OPENAI_MODEL ?? null,
      advanced: process.env.OPENAI_CODING_MODEL ?? null,
    };
  },
});
