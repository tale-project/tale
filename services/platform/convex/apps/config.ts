import { v } from 'convex/values';

import { mutation, query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { jsonRecordValidator } from '../lib/validators/json';

/**
 * Per-install config for an app — the values an operator supplied for the app's
 * declared `requires.config` keys (e.g. a GitHub `owner`/`repo`). Org+app scoped
 * (one target per org install). Read by the app's views through the `$config:`
 * binding token so a repo-agnostic app points at the operator's OWN repo with no
 * hardcoded target. Empty object until configured.
 */
export const getAppConfig = query({
  args: { organizationId: v.string(), appSlug: v.string() },
  returns: jsonRecordValidator,
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return {};
    await getOrganizationMember(ctx, args.organizationId, authUser);
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
 * github owner/repo). Stores them on the org install row AND syncs them into the
 * `variables` of every schedule the app's workflows declared — so a scheduled
 * workflow (e.g. the issue-desk reconcile) targets the configured repo instead of
 * a hardcoded default. The app's workflow slugs come from the install resource
 * ledger, so no manifest/FS read is needed.
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
    await ctx.db.patch(row._id, { config: args.config });

    // Push the values into the app's scheduled-workflow variables. The schedule
    // is created at install with only the workflow's static defaults; merging
    // config in (config wins) is what lets the org-level reconcile schedule
    // target the configured repo.
    const workflowSlugs = row.resources
      .filter((r) => r.domain === 'workflows')
      .map((r) => r.path.replace(/\.json$/, ''));
    for (const workflowSlug of workflowSlugs) {
      for await (const sched of ctx.db
        .query('wfSchedules')
        .withIndex('by_workflowSlug', (q) =>
          q.eq('workflowSlug', workflowSlug),
        )) {
        if (sched.organizationId !== args.organizationId) continue;
        await ctx.db.patch(sched._id, {
          variables: { ...sched.variables, ...args.config },
        });
      }
    }
    return null;
  },
});
