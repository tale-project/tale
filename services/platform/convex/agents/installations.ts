import { ConvexError, v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import {
  type QueryCtx,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { hasAnyProvision } from './provision_defaults_mutations';

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
  appSlug: v.optional(v.string()),
});

type InstallState = {
  agentSlug: string;
  enabled: boolean;
  installedBy: string;
  bundledBy?: string;
  disabledReason?: 'integration_disabled' | 'user';
  appSlug?: string;
};

/** Project a stored row to the wire shape, omitting absent optional fields. */
function toInstallState(row: Doc<'agentInstallations'>): InstallState {
  return {
    agentSlug: row.agentSlug,
    enabled: row.enabled,
    installedBy: row.installedBy,
    ...(row.bundledBy !== undefined ? { bundledBy: row.bundledBy } : {}),
    ...(row.disabledReason !== undefined
      ? { disabledReason: row.disabledReason }
      : {}),
    ...(row.appSlug !== undefined ? { appSlug: row.appSlug } : {}),
  };
}

/** The single (org, agent) install row, or null — the shared point-lookup. */
function findInstallation(
  ctx: QueryCtx,
  organizationId: string,
  agentSlug: string,
): Promise<Doc<'agentInstallations'> | null> {
  return ctx.db
    .query('agentInstallations')
    .withIndex('by_org_slug', (q) =>
      q.eq('organizationId', organizationId).eq('agentSlug', agentSlug),
    )
    .first();
}

async function listInstallStatesForOrg(
  ctx: QueryCtx,
  organizationId: string,
): Promise<InstallState[]> {
  const states: InstallState[] = [];
  for await (const row of ctx.db
    .query('agentInstallations')
    .withIndex('by_organization', (q) =>
      q.eq('organizationId', organizationId),
    )) {
    states.push(toInstallState(row));
  }
  return states;
}

/**
 * The org's install states plus whether it has ever been provisioned — the
 * roster gate's single query. `provisioned` anchors the fail-open: a
 * never-provisioned org (no `agentDefaultProvisions` rows) returns the full
 * catalog; once provisioned, the gate is authoritative. Bundled into one query
 * so the cached Auto-routing path stays a single indexed read.
 */
export const listInstallStatesInternal = internalQuery({
  args: { organizationId: v.string() },
  returns: v.object({
    states: v.array(installStateValidator),
    provisioned: v.boolean(),
  }),
  handler: async (ctx, args) => ({
    states: await listInstallStatesForOrg(ctx, args.organizationId),
    provisioned: await hasAnyProvision(ctx, args.organizationId),
  }),
});

/**
 * Run-admission gate: is this agent allowed to RUN for the org? An agent is
 * live IFF it has an enabled `agentInstallations` row — no fallback. An agent
 * with no row (or a disabled row) is simply not installed for this org. Every
 * org is provisioned at create (the autoInstall sweep installs the default
 * agents), so there is no "never-provisioned → everything live" fail-open: a
 * row-less org has no live agents until something is installed. Called at
 * task/discussion run admission so a disabled or uninstalled agent can never
 * execute. The system router is read from disk on the classify path (never
 * gated here), so it needs no install row.
 */
export const isAgentLiveInternal = internalQuery({
  args: { organizationId: v.string(), agentSlug: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const row = await findInstallation(
      ctx,
      args.organizationId,
      args.agentSlug,
    );
    return row?.enabled ?? false;
  },
});

export const getInstallationInternal = internalQuery({
  args: { organizationId: v.string(), agentSlug: v.string() },
  // `v.any()` already admits null; the handler's typed return is the contract.
  returns: v.any(),
  handler: (ctx, args): Promise<Doc<'agentInstallations'> | null> =>
    findInstallation(ctx, args.organizationId, args.agentSlug),
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
    // Owning app slug when this is an app agent; omitted for global agents.
    appSlug: v.optional(v.string()),
  },
  returns: v.id('agentInstallations'),
  handler: async (ctx, args) => {
    const existing = await findInstallation(
      ctx,
      args.organizationId,
      args.agentSlug,
    );

    if (existing) {
      await ctx.db.patch(existing._id, {
        installedAt: Date.now(),
        installedBy: args.installedBy,
        contentHash: args.contentHash,
        ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
        ...(args.bundledBy !== undefined ? { bundledBy: args.bundledBy } : {}),
        ...(args.appSlug !== undefined ? { appSlug: args.appSlug } : {}),
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
      ...(args.appSlug !== undefined ? { appSlug: args.appSlug } : {}),
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
    const existing = await findInstallation(
      ctx,
      args.organizationId,
      args.agentSlug,
    );
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
    const existing = await findInstallation(
      ctx,
      args.organizationId,
      args.agentSlug,
    );
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
    return await listInstallStatesForOrg(ctx, args.organizationId);
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

/**
 * A cascade-owned (integration-bundled) row resists user mutations: disabling
 * or uninstalling it fights the connect/disconnect cascade, so we require an
 * explicit `force`. Throws when the guard trips.
 */
function assertNotCascadeOwned(
  row: Doc<'agentInstallations'>,
  force: boolean | undefined,
): void {
  if (row.bundledBy && !force) {
    throw new ConvexError({
      code: 'cascade_owned',
      message:
        'This agent was installed by an integration. Disconnect that integration, or pass force to override.',
    });
  }
}

/**
 * An app-owned row is managed by its app and must not be individually removed
 * from the global roster — that would orphan the app. Removal happens only via
 * app uninstall. Hard guard (no force escape). Throws when it trips.
 */
function assertNotAppOwned(row: Doc<'agentInstallations'>): void {
  if (row.appSlug) {
    throw new ConvexError({
      code: 'app_owned',
      message: `This agent belongs to app "${row.appSlug}". Uninstall the app to remove it.`,
    });
  }
}

/** Install (or re-enable) a catalog agent for the org. Admin-gated. */
export const installCatalogAgent = mutation({
  args: { organizationId: v.string(), agentSlug: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await assertCanManageRoster(ctx, args.organizationId);
    const existing = await findInstallation(
      ctx,
      args.organizationId,
      args.agentSlug,
    );
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
    const existing = await findInstallation(
      ctx,
      args.organizationId,
      args.agentSlug,
    );
    if (!existing) return null;
    // Disabling an integration-bundled agent fights the cascade; require force.
    // Disabling an app-owned agent silently breaks its app; require force too.
    if (!args.enabled) {
      assertNotCascadeOwned(existing, args.force);
      if (existing.appSlug && !args.force) {
        throw new ConvexError({
          code: 'app_owned',
          message: `This agent belongs to app "${existing.appSlug}"; disabling it would break the app. Pass force to override.`,
        });
      }
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
    const existing = await findInstallation(
      ctx,
      args.organizationId,
      args.agentSlug,
    );
    if (!existing) return null;
    assertNotCascadeOwned(existing, args.force);
    assertNotAppOwned(existing);
    await ctx.db.delete(existing._id);
    return null;
  },
});
