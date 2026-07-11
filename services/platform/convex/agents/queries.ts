/**
 * Queries for agent bindings and available resources.
 *
 * Agent configuration lives in JSON files on the filesystem (see file_actions.ts).
 * This module only queries the slim binding table and resource lookups.
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { action, query } from '../_generated/server';
import { TOOL_NAMES } from '../agent_tools/tool_names';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { getAuthUserIdentity, getOrganizationMember } from '../lib/rls';

export const getBindingByAgent = query({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;

    await getOrganizationMember(ctx, args.organizationId, {
      userId: authUser.userId,
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
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return false;

    // Check primary teamId via index
    const byPrimary = await ctx.db
      .query('agentBindings')
      .withIndex('by_team', (q) => q.eq('teamId', args.teamId))
      .first();

    if (byPrimary) return true;

    // Check sharedWithTeamIds (requires full org scan since no index)
    const allBindings = ctx.db.query('agentBindings');
    for await (const binding of allBindings) {
      if (binding.sharedWithTeamIds?.includes(args.teamId)) return true;
    }

    return false;
  },
});

export const listBindingsByOrg = query({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];

    await getOrganizationMember(ctx, args.organizationId, {
      userId: authUser.userId,
      email: authUser.email,
      name: authUser.name,
    });

    const results: Array<{
      agentSlug: string;
      teamId?: string;
      sharedWithTeamIds?: string[];
    }> = [];

    const bindings = ctx.db
      .query('agentBindings')
      .withIndex('by_organization', (q) =>
        q.eq('organizationId', args.organizationId),
      );

    for await (const binding of bindings) {
      results.push({
        agentSlug: binding.agentSlug,
        teamId: binding.teamId ?? undefined,
        sharedWithTeamIds: binding.sharedWithTeamIds ?? undefined,
      });
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

/**
 * Bindable integrations for the agent editor's "Bound integrations" picker.
 * An `action` (not a `query`): the catalog `description` shown alongside the
 * label lives in the org's `integration.json` files on disk, which only a
 * Node action can read (`listIntegrationsInternal`) — the active/installed
 * set itself still comes from the `integrationCredentials` table via an
 * internal query, so no secret field ever leaves this function. Mirrors the
 * same action-backed pattern as the sibling "Bound automations" picker
 * (`workflows/file_actions.ts#listWorkflows`).
 */
export const getAvailableIntegrations = action({
  args: {
    organizationId: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{
      name: string;
      title: string;
      type: string;
      description?: string;
    }>
  > => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );

    const credentials = await ctx.runQuery(
      internal.integrations.credential_queries.listInternal,
      { organizationId: args.organizationId },
    );

    const activeCredentials = credentials.filter(
      (cred) => cred.status === 'active',
    );
    if (activeCredentials.length === 0) return [];

    // Graceful when the catalog is empty or unreadable — `listIntegrationsInternal`
    // already degrades a missing directory to `[]`, so a description just stays
    // absent instead of failing the whole picker.
    const catalog = await ctx.runAction(
      internal.integrations.file_actions.listIntegrationsInternal,
      { orgSlug },
    );
    const descriptionBySlug = new Map(
      catalog.map((entry) => [entry.slug, entry.description]),
    );

    return activeCredentials.map((cred) => ({
      name: cred.slug,
      title: cred.slug,
      type: cred.sqlConnectionConfig ? 'sql' : 'rest_api',
      description: descriptionBySlug.get(cred.slug),
    }));
  },
});
