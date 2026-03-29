/**
 * Queries for agent bindings and available resources.
 *
 * Agent configuration lives in JSON files on the filesystem (see file_actions.ts).
 * This module only queries the slim binding table and resource lookups.
 */

import { v } from 'convex/values';

import { parseModelList } from '../../lib/shared/utils/model-list';
import { query } from '../_generated/server';
import { TOOL_NAMES } from '../agent_tools/tool_names';
import { getAuthUserIdentity } from '../lib/rls';

export const getBindingByAgent = query({
  args: {
    organizationId: v.string(),
    agentFileName: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;

    const binding = await ctx.db
      .query('agentBindings')
      .withIndex('by_org_agent', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentFileName', args.agentFileName),
      )
      .first();

    return binding;
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
