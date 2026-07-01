import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import {
  type MutationCtx,
  internalQuery,
  mutation,
  query,
} from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { jsonRecordValidator } from '../lib/validators/json';
import { appWorkflowSlugs } from './app_workflow_slugs';

/**
 * Merge `config` into the `variables` of the app's schedules for the given
 * project scope (config wins). `projectId === undefined` targets the org-level
 * schedules; a concrete id targets exactly that project's schedules, so setting
 * project A's config never touches project B's reconcile run.
 */
async function syncScheduleVariables(
  ctx: MutationCtx,
  organizationId: string,
  workflowSlugs: string[],
  projectId: Id<'projects'> | undefined,
  config: Record<string, unknown>,
): Promise<void> {
  for (const workflowSlug of workflowSlugs) {
    for await (const sched of ctx.db
      .query('wfSchedules')
      .withIndex('by_workflowSlug', (q) =>
        q.eq('workflowSlug', workflowSlug),
      )) {
      if (sched.organizationId !== organizationId) continue;
      if (sched.projectId !== projectId) continue;
      await ctx.db.patch(sched._id, {
        variables: { ...sched.variables, ...config },
      });
    }
  }
}

/**
 * Per-install config for an app — the values an operator supplied for the app's
 * declared `requires.config` keys (e.g. a GitHub `owner`/`repo`). Read by the
 * app's views through the `$config:` binding token so a repo-agnostic app points
 * at the operator's OWN repo with no hardcoded target. Empty object until
 * configured.
 *
 * Scope: pass `projectId` for a `scope: 'project'` app to read THAT project's
 * config (each bound project owns its own values, so two projects never pollute
 * each other). Falls back to the org-level install config as the pre-migration
 * default until the migration folds it into the binding. Omit `projectId` for
 * org-scoped apps to read the org-level config.
 */
export const getAppConfig = query({
  args: {
    organizationId: v.string(),
    appSlug: v.string(),
    projectId: v.optional(v.id('projects')),
  },
  returns: jsonRecordValidator,
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return {};
    await getOrganizationMember(ctx, args.organizationId, authUser);
    if (args.projectId) {
      const projectId = args.projectId;
      const binding = await ctx.db
        .query('appProjectBindings')
        .withIndex('by_org_slug_project', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('appSlug', args.appSlug)
            .eq('projectId', projectId),
        )
        .first();
      // Per-project config is authoritative for a bound project; fall through to
      // the org-level install config only as the pre-migration default.
      if (binding?.config) return binding.config;
    }
    const row = await ctx.db
      .query('appInstallations')
      .withIndex('by_org_slug', (q) =>
        q.eq('organizationId', args.organizationId).eq('appSlug', args.appSlug),
      )
      .first();
    return row?.config ?? {};
  },
});

/**
 * Auth-free per-project config read for the trigger path (e.g. starting an app's
 * task workflow injects it as `input.appConfig`). Mirrors `getAppConfig`'s
 * project resolution — binding config, falling back to the org install config —
 * without the membership check, since the caller has already authorized the run.
 * Returns `{}` when the app isn't installed/bound, so a `{{input.appConfig.x}}`
 * reference is a safe no-op.
 */
export const getProjectAppConfigInternal = internalQuery({
  args: {
    organizationId: v.string(),
    appSlug: v.string(),
    projectId: v.id('projects'),
  },
  returns: jsonRecordValidator,
  handler: async (ctx, args) => {
    const binding = await ctx.db
      .query('appProjectBindings')
      .withIndex('by_org_slug_project', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('appSlug', args.appSlug)
          .eq('projectId', args.projectId),
      )
      .first();
    if (binding?.config) return binding.config;
    const row = await ctx.db
      .query('appInstallations')
      .withIndex('by_org_slug', (q) =>
        q.eq('organizationId', args.organizationId).eq('appSlug', args.appSlug),
      )
      .first();
    return row?.config ?? {};
  },
});

/**
 * Set an installed app's per-install config (the `requires.config` values, e.g.
 * github owner/repo). Syncs them into the `variables` of the app's schedules so a
 * scheduled workflow (e.g. the issue-desk reconcile) targets the configured repo
 * instead of a hardcoded default. The app's workflow slugs come from the
 * authoritative `wfInstallations` ownership ledger (`appWorkflowSlugs`), NOT the
 * `appInstallations.resources` file ledger — that records only fan-out domains
 * (integrations) and never workflows, so it would sync nothing.
 *
 * Scope: pass `projectId` for a `scope: 'project'` app to write THAT project's
 * config onto its binding and sync only that project's schedules — config never
 * leaks across projects. Omit it for org-scoped apps to write the org-level
 * install config and sync the org-level schedules (the legacy path).
 *
 * First-party authors (see function_bindings security posture): values are
 * shape-checked to scalars here; the install wizard validates keys/types against
 * the manifest's `requires.config`.
 */
export const setAppConfig = mutation({
  args: {
    organizationId: v.string(),
    appSlug: v.string(),
    config: jsonRecordValidator,
    projectId: v.optional(v.id('projects')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Not authenticated');
    await getOrganizationMember(ctx, args.organizationId, authUser);

    // Config values are scalars (string/number/boolean) — reject structured
    // values that the form can't produce and the `$config:` token can't render.
    for (const [key, value] of Object.entries(args.config)) {
      const t = typeof value;
      if (t !== 'string' && t !== 'number' && t !== 'boolean') {
        throw new Error(
          `Config value for "${key}" must be a string, number, or boolean`,
        );
      }
    }

    const row = await ctx.db
      .query('appInstallations')
      .withIndex('by_org_slug', (q) =>
        q.eq('organizationId', args.organizationId).eq('appSlug', args.appSlug),
      )
      .first();
    if (!row) {
      throw new Error(
        `App "${args.appSlug}" is not installed in this organization`,
      );
    }
    const workflowSlugs = await appWorkflowSlugs(
      ctx,
      args.organizationId,
      args.appSlug,
    );

    if (args.projectId) {
      // Project-scoped: the binding owns the config; only this project's
      // schedules are re-synced.
      const projectId = args.projectId;
      const binding = await ctx.db
        .query('appProjectBindings')
        .withIndex('by_org_slug_project', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('appSlug', args.appSlug)
            .eq('projectId', projectId),
        )
        .first();
      if (!binding) {
        throw new Error(
          `App "${args.appSlug}" is not bound to the target project`,
        );
      }
      await ctx.db.patch(binding._id, { config: args.config });
      await syncScheduleVariables(
        ctx,
        args.organizationId,
        workflowSlugs,
        projectId,
        args.config,
      );
      return null;
    }

    // Org-scoped: config lives on the install row; the org-level schedules
    // (projectId undefined) are re-synced.
    await ctx.db.patch(row._id, { config: args.config });
    await syncScheduleVariables(
      ctx,
      args.organizationId,
      workflowSlugs,
      undefined,
      args.config,
    );
    return null;
  },
});
