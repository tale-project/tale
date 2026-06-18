import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { internalMutation, internalQuery, query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

/**
 * Agent install + enable runtime-state. The agent JSON file is the source of
 * truth for CONFIG; these rows gate whether an agent is LIVE for an org (the
 * `agentInstallations` table). Mirrors `workflows/installations.ts`.
 *
 * INSTALLED = a row exists; ENABLED = `row.enabled !== false`. The roster gate
 * (`listInstalledAgentsForOrg`) reads `listInstallStatesInternal` and keeps an
 * agent only when it is installed && enabled (router/mention/organigram).
 */

const installStateValidator = v.object({
  agentSlug: v.string(),
  enabled: v.boolean(),
  installedBy: v.string(),
  bundledBy: v.optional(v.string()),
  disabledReason: v.optional(
    v.union(v.literal('integration_disabled'), v.literal('user')),
  ),
});

/** All install states for an org — the gate's single query (one indexed read). */
export const listInstallStatesInternal = internalQuery({
  args: { organizationId: v.string() },
  returns: v.array(installStateValidator),
  handler: async (ctx, args) => {
    const states: Array<{
      agentSlug: string;
      enabled: boolean;
      installedBy: string;
      bundledBy?: string;
      disabledReason?: 'integration_disabled' | 'user';
    }> = [];
    for await (const row of ctx.db
      .query('agentInstallations')
      .withIndex('by_organization', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      states.push({
        agentSlug: row.agentSlug,
        enabled: row.enabled,
        installedBy: row.installedBy,
        ...(row.bundledBy !== undefined ? { bundledBy: row.bundledBy } : {}),
        ...(row.disabledReason !== undefined
          ? { disabledReason: row.disabledReason }
          : {}),
      });
    }
    return states;
  },
});

export const getInstallationInternal = internalQuery({
  args: { organizationId: v.string(), agentSlug: v.string() },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args): Promise<Doc<'agentInstallations'> | null> => {
    return await ctx.db
      .query('agentInstallations')
      .withIndex('by_org_slug', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentSlug', args.agentSlug),
      )
      .first();
  },
});

/**
 * Install (or re-install) an agent for an org. `enabled` defaults to true.
 * `bundledBy` records the integration whose connection installed it (cascade
 * key). Re-installing an existing row updates provenance + re-enables only when
 * explicitly asked.
 */
export const upsertInstallation = internalMutation({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
    installedBy: v.string(),
    contentHash: v.string(),
    enabled: v.optional(v.boolean()),
    bundledBy: v.optional(v.string()),
  },
  returns: v.id('agentInstallations'),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('agentInstallations')
      .withIndex('by_org_slug', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentSlug', args.agentSlug),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        installedAt: Date.now(),
        installedBy: args.installedBy,
        contentHash: args.contentHash,
        ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
        ...(args.bundledBy !== undefined ? { bundledBy: args.bundledBy } : {}),
      });
      return existing._id;
    }

    return await ctx.db.insert('agentInstallations', {
      organizationId: args.organizationId,
      agentSlug: args.agentSlug,
      installedAt: Date.now(),
      installedBy: args.installedBy,
      contentHash: args.contentHash,
      enabled: args.enabled ?? true,
      ...(args.bundledBy !== undefined ? { bundledBy: args.bundledBy } : {}),
    });
  },
});

/** Enable/disable an installed agent; records WHY a disabled row is off. */
export const setEnabled = internalMutation({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
    enabled: v.boolean(),
    disabledReason: v.optional(
      v.union(v.literal('integration_disabled'), v.literal('user')),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const existing = await ctx.db
      .query('agentInstallations')
      .withIndex('by_org_slug', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentSlug', args.agentSlug),
      )
      .first();
    if (!existing) return null;
    await ctx.db.patch(existing._id, {
      enabled: args.enabled,
      // Clear the reason when re-enabling; set it when disabling.
      disabledReason: args.enabled ? undefined : args.disabledReason,
    });
    return null;
  },
});

export const deleteInstallation = internalMutation({
  args: { organizationId: v.string(), agentSlug: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const existing = await ctx.db
      .query('agentInstallations')
      .withIndex('by_org_slug', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentSlug', args.agentSlug),
      )
      .first();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});

/** Public, RLS-gated install-state list for the agent catalog UI. */
export const listInstallStates = query({
  args: { organizationId: v.string() },
  returns: v.array(installStateValidator),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];
    await getOrganizationMember(ctx, args.organizationId, authUser);
    const states: Array<{
      agentSlug: string;
      enabled: boolean;
      installedBy: string;
      bundledBy?: string;
      disabledReason?: 'integration_disabled' | 'user';
    }> = [];
    for await (const row of ctx.db
      .query('agentInstallations')
      .withIndex('by_organization', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      states.push({
        agentSlug: row.agentSlug,
        enabled: row.enabled,
        installedBy: row.installedBy,
        ...(row.bundledBy !== undefined ? { bundledBy: row.bundledBy } : {}),
        ...(row.disabledReason !== undefined
          ? { disabledReason: row.disabledReason }
          : {}),
      });
    }
    return states;
  },
});
