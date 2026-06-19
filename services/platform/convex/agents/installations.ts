import { ConvexError, v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from '../_generated/server';
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

/**
 * Run-admission gate: is this agent allowed to RUN for the org? Mirrors the
 * roster gate's fallback — an org with zero install rows is un-provisioned and
 * everything is live; once any row exists, an agent is live only when it has an
 * enabled row. Called at task/discussion run admission so a disabled or
 * uninstalled agent can never execute, regardless of trigger (assignment,
 * @mention, workflow). The system router is never run on tasks, so it's not
 * special-cased here.
 */
export const isAgentLiveInternal = internalQuery({
  args: { organizationId: v.string(), agentSlug: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const row = await ctx.db
      .query('agentInstallations')
      .withIndex('by_org_slug', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentSlug', args.agentSlug),
      )
      .first();
    if (row) return row.enabled;
    // No row for THIS agent → live only if the org has no install rows at all
    // (un-provisioned legacy org); otherwise it's simply not installed.
    const anyRow = await ctx.db
      .query('agentInstallations')
      .withIndex('by_organization', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .first();
    return anyRow === null;
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

/**
 * Admin gate for the catalog write mutations below. `member`/`disabled`/no-role
 * cannot manage the roster; admin/owner/developer can. Mirrors the role check in
 * `projects/mutations.ts`.
 */
async function assertCanManageRoster(
  ctx: Parameters<typeof getOrganizationMember>[0],
  organizationId: string,
): Promise<void> {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) throw new ConvexError({ code: 'forbidden' });
  const member = await getOrganizationMember(ctx, organizationId, authUser);
  const role = member?.role;
  if (role === 'member' || role === 'disabled' || !role) {
    throw new ConvexError({
      code: 'forbidden',
      message: 'Managing the agent roster requires administrator permissions.',
    });
  }
}

/** Install (or re-enable) a catalog agent for the org. Admin-gated. */
export const installCatalogAgent = mutation({
  args: { organizationId: v.string(), agentSlug: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await assertCanManageRoster(ctx, args.organizationId);
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
        enabled: true,
        disabledReason: undefined,
      });
      return null;
    }
    await ctx.db.insert('agentInstallations', {
      organizationId: args.organizationId,
      agentSlug: args.agentSlug,
      installedAt: Date.now(),
      installedBy: 'user',
      // Manual installs carry no file-content baseline (see the agent_write tool).
      contentHash: 'manual',
      enabled: true,
    });
    return null;
  },
});

/** Enable/disable an installed agent. Admin-gated; refuses cascade-owned rows. */
export const setAgentEnabled = mutation({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
    enabled: v.boolean(),
    force: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await assertCanManageRoster(ctx, args.organizationId);
    const existing = await ctx.db
      .query('agentInstallations')
      .withIndex('by_org_slug', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentSlug', args.agentSlug),
      )
      .first();
    if (!existing) return null;
    // Disabling an integration-bundled agent fights the cascade; require force.
    if (!args.enabled && existing.bundledBy && !args.force) {
      throw new ConvexError({
        code: 'cascade_owned',
        message:
          'This agent was installed by an integration. Disconnect that integration, or pass force to override.',
      });
    }
    await ctx.db.patch(existing._id, {
      enabled: args.enabled,
      disabledReason: args.enabled ? undefined : 'user',
    });
    return null;
  },
});

/** Uninstall an agent. Admin-gated; refuses cascade-owned rows without force. */
export const uninstallAgent = mutation({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
    force: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await assertCanManageRoster(ctx, args.organizationId);
    const existing = await ctx.db
      .query('agentInstallations')
      .withIndex('by_org_slug', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentSlug', args.agentSlug),
      )
      .first();
    if (!existing) return null;
    if (existing.bundledBy && !args.force) {
      throw new ConvexError({
        code: 'cascade_owned',
        message:
          'This agent was installed by an integration. Disconnect that integration, or pass force to override.',
      });
    }
    await ctx.db.delete(existing._id);
    return null;
  },
});
