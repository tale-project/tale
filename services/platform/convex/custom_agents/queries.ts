/**
 * Queries for custom agents (single-table versioning).
 */

import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';

import { parseModelList } from '../../lib/shared/utils/model-list';
import { query } from '../_generated/server';
import { TOOL_NAMES } from '../agent_tools/tool_names';
import { getUserTeamIds } from '../lib/get_user_teams';
import { DEFAULT_COUNT_CAP } from '../lib/helpers/count_items_in_org';
import { STATUS_PRIORITY } from '../lib/helpers/status_priority';
import { getAuthUserIdentity } from '../lib/rls';
import { hasTeamAccess } from '../lib/team_access';
import { listCustomAgentsPaginated as listCustomAgentsPaginatedHelper } from './list_custom_agents_paginated';

export const approxCountCustomAgents = query({
  args: {
    organizationId: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return 0;

    const userTeamIds = await getUserTeamIds(ctx, authUser.userId);

    const agents = ctx.db
      .query('customAgents')
      .withIndex('by_organization', (q) =>
        q.eq('organizationId', args.organizationId),
      );

    const seenRoots = new Set<string>();
    for await (const agent of agents) {
      if (!hasTeamAccess(agent, userTeamIds)) continue;

      const rootId = agent.rootVersionId ?? agent._id;
      seenRoots.add(rootId);
      if (seenRoots.size >= DEFAULT_COUNT_CAP) break;
    }

    return seenRoots.size;
  },
});

export const listCustomAgentsPaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    return await listCustomAgentsPaginatedHelper(ctx, args);
  },
});

export const listCustomAgents = query({
  args: {
    organizationId: v.string(),
    filterTeamId: v.optional(v.string()),
    filterPublished: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Doc<'customAgents'>[]> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];

    const userTeamIds = await getUserTeamIds(ctx, authUser.userId);

    if (args.filterPublished === true) {
      const agents = ctx.db
        .query('customAgents')
        .withIndex('by_org_status', (q) =>
          q.eq('organizationId', args.organizationId).eq('status', 'active'),
        );

      const results: Doc<'customAgents'>[] = [];
      for await (const agent of agents) {
        if (agent.visibleInChat === false) continue;
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
      .withIndex('by_organization', (q) =>
        q.eq('organizationId', args.organizationId),
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
        (STATUS_PRIORITY[agent.status] ?? 0) >
          (STATUS_PRIORITY[existing.status] ?? 0)
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
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;

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

    if (!draft) return null;

    const userTeamIds = await getUserTeamIds(ctx, authUser.userId);
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
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;

    const rootAgent = await ctx.db.get(args.customAgentId);
    if (!rootAgent) return null;

    const userTeamIds = await getUserTeamIds(ctx, authUser.userId);
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
    // Concurrent targeted lookups via by_root_status index
    const rootId = args.customAgentId;
    const [draft, active, archived] = await Promise.all([
      ctx.db
        .query('customAgents')
        .withIndex('by_root_status', (q) =>
          q.eq('rootVersionId', rootId).eq('status', 'draft'),
        )
        .first(),
      ctx.db
        .query('customAgents')
        .withIndex('by_root_status', (q) =>
          q.eq('rootVersionId', rootId).eq('status', 'active'),
        )
        .first(),
      ctx.db
        .query('customAgents')
        .withIndex('by_root_status', (q) =>
          q.eq('rootVersionId', rootId).eq('status', 'archived'),
        )
        .order('desc')
        .first(),
    ]);

    return draft ?? active ?? archived ?? null;
  },
});

export const getCustomAgentVersions = query({
  args: {
    customAgentId: v.id('customAgents'),
  },
  handler: async (ctx, args): Promise<Doc<'customAgents'>[]> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];

    const rootAgent = await ctx.db.get(args.customAgentId);
    if (!rootAgent) return [];

    const userTeamIds = await getUserTeamIds(ctx, authUser.userId);
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
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];

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
    fast: string[];
    standard: string[];
    advanced: string[];
  }> => {
    return {
      fast: parseModelList(process.env.OPENAI_FAST_MODEL),
      standard: parseModelList(process.env.OPENAI_MODEL),
      advanced: parseModelList(process.env.OPENAI_CODING_MODEL),
    };
  },
});
