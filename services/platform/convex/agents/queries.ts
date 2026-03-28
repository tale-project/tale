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

export const getAvailableWorkflows = query({
  args: {
    organizationId: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<Array<{ id: string; name: string; description?: string }>> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];

    const seen = new Map<
      string,
      { id: string; name: string; description?: string; versionNumber: number }
    >();

    const workflowQuery = ctx.db
      .query('wfDefinitions')
      .withIndex('by_org_status', (q) =>
        q.eq('organizationId', args.organizationId).eq('status', 'active'),
      );

    for await (const wf of workflowQuery) {
      const rootId = String(wf.rootVersionId ?? wf._id);
      const existing = seen.get(rootId);
      if (!existing || wf.versionNumber > existing.versionNumber) {
        seen.set(rootId, {
          id: rootId,
          name: wf.name,
          description: wf.description,
          versionNumber: wf.versionNumber,
        });
      }
    }

    return Array.from(seen.values()).map(
      ({ versionNumber: _, ...rest }) => rest,
    );
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
