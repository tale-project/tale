/**
 * Queries for custom agents (single-table versioning).
 */

import { v } from 'convex/values';

import { query } from '../_generated/server';
import { TOOL_NAMES } from '../agent_tools/tool_names';
import { authComponent } from '../auth';
import { getUserTeamIds } from '../lib/get_user_teams';
import { hasTeamAccess } from '../lib/team_access';

export const listCustomAgents = query({
  args: {
    organizationId: v.string(),
    filterTeamId: v.optional(v.string()),
    filterPublished: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));

    const status = args.filterPublished === true ? 'active' : 'draft';
    const agents = ctx.db
      .query('customAgents')
      .withIndex('by_org_active_status', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('isActive', true)
          .eq('status', status),
      );

    const results = [];
    for await (const agent of agents) {
      if (!hasTeamAccess(agent, userTeamIds)) continue;

      if (args.filterTeamId && agent.teamId) {
        if (
          agent.teamId !== args.filterTeamId &&
          !agent.sharedWithTeamIds?.includes(args.filterTeamId)
        ) {
          continue;
        }
      }

      results.push(agent);
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

    // customAgentId is the rootVersionId; find the draft record
    const draftQuery = ctx.db
      .query('customAgents')
      .withIndex('by_root_status', (q) =>
        q.eq('rootVersionId', args.customAgentId).eq('status', 'draft'),
      );

    let draft = null;
    for await (const v of draftQuery) {
      draft = v;
      break;
    }

    if (!draft || !draft.isActive) return null;

    const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));
    if (!hasTeamAccess(draft, userTeamIds)) return null;

    return draft;
  },
});

export const getCustomAgentVersions = query({
  args: {
    customAgentId: v.id('customAgents'),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    // Verify access via the draft record
    const draftQuery = ctx.db
      .query('customAgents')
      .withIndex('by_root_status', (q) =>
        q.eq('rootVersionId', args.customAgentId).eq('status', 'draft'),
      );

    let draft = null;
    for await (const v of draftQuery) {
      draft = v;
      break;
    }

    if (!draft || !draft.isActive) return [];

    const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));
    if (!hasTeamAccess(draft, userTeamIds)) return [];

    const versions = ctx.db
      .query('customAgents')
      .withIndex('by_root', (q) => q.eq('rootVersionId', args.customAgentId))
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
      available: true,
    }));
  },
});

export const getAvailableIntegrations = query({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
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
  handler: async () => {
    return {
      fast: process.env.OPENAI_FAST_MODEL ?? null,
      standard: process.env.OPENAI_MODEL ?? null,
      advanced: process.env.OPENAI_CODING_MODEL ?? null,
      vision: process.env.OPENAI_VISION_MODEL ?? null,
    };
  },
});
