import { ConvexError, v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { internalMutation, internalQuery } from '../_generated/server';

const resourceValidator = v.object({
  domain: v.string(),
  path: v.string(),
  contentHash: v.string(),
});

const statusValidator = v.union(v.literal('active'), v.literal('broken'));

/**
 * Ensure the ORG-LEVEL install record + copied-file ledger (idempotent on
 * reinstall / add-to-project). Read-then-insert/patch in one mutation → at most
 * one row per (org, appSlug). Project membership is NOT stored here — it lives in
 * `appProjectBindings` (see `bindAppToProject`).
 */
export const upsertAppInstallation = internalMutation({
  args: {
    organizationId: v.string(),
    appSlug: v.string(),
    /** Denormalized app display name (from the manifest) for the in-project tab. */
    appName: v.optional(v.string()),
    installedBy: v.string(),
    status: statusValidator,
    resources: v.array(resourceValidator),
    requiredIntegrations: v.array(v.string()),
  },
  returns: v.id('appInstallations'),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('appInstallations')
      .withIndex('by_org_slug', (q) =>
        q.eq('organizationId', args.organizationId).eq('appSlug', args.appSlug),
      )
      .first();
    const fields = {
      appName: args.appName,
      installedAt: Date.now(),
      installedBy: args.installedBy,
      status: args.status,
      resources: args.resources,
      requiredIntegrations: args.requiredIntegrations,
      // A reinstall lands here; clear any stale teardown lock so the row is live.
      uninstalling: undefined,
    };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }
    return await ctx.db.insert('appInstallations', {
      organizationId: args.organizationId,
      appSlug: args.appSlug,
      ...fields,
    });
  },
});

/**
 * Bind a `scope: 'project'` app to a project — idempotent, single-transaction
 * (the OCC serialization unit), enforcing every cross-row guarantee here rather
 * than in the calling action:
 *  - I8: the project exists and belongs to the org;
 *  - I7: the org install row exists and is not mid-uninstall;
 *  - I6: one row per (org, appSlug, project) — a re-add is a no-op.
 */
export const bindAppToProject = internalMutation({
  args: {
    organizationId: v.string(),
    appSlug: v.string(),
    projectId: v.id('projects'),
    boundBy: v.string(),
  },
  returns: v.id('appProjectBindings'),
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || project.organizationId !== args.organizationId) {
      throw new Error(
        `Cannot bind app "${args.appSlug}": target project not found in this organization.`,
      );
    }
    const org = await ctx.db
      .query('appInstallations')
      .withIndex('by_org_slug', (q) =>
        q.eq('organizationId', args.organizationId).eq('appSlug', args.appSlug),
      )
      .first();
    if (!org) {
      throw new Error(
        `Cannot bind app "${args.appSlug}": it is not installed in this organization.`,
      );
    }
    if (org.uninstalling === true) {
      throw new Error(
        `Cannot bind app "${args.appSlug}": it is being uninstalled.`,
      );
    }
    const existing = await ctx.db
      .query('appProjectBindings')
      .withIndex('by_org_slug_project', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('appSlug', args.appSlug)
          .eq('projectId', args.projectId),
      )
      .first();
    if (existing) return existing._id;
    return await ctx.db.insert('appProjectBindings', {
      organizationId: args.organizationId,
      appSlug: args.appSlug,
      projectId: args.projectId,
      boundAt: Date.now(),
      boundBy: args.boundBy,
    });
  },
});

/**
 * Remove a single project binding — the "Remove from this project" verb. Deletes
 * ONLY this junction row; never inspects the remaining count and never tears down
 * shared org resources (I3). Idempotent.
 */
export const unbindAppFromProject = internalMutation({
  args: {
    organizationId: v.string(),
    appSlug: v.string(),
    projectId: v.id('projects'),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const existing = await ctx.db
      .query('appProjectBindings')
      .withIndex('by_org_slug_project', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('appSlug', args.appSlug)
          .eq('projectId', args.projectId),
      )
      .first();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});

/**
 * Guard + lock for full uninstall (I1/I7). Refuses with `APP_HAS_BOUND_PROJECTS`
 * (naming the projects) while any binding remains — the mirror of the
 * project-delete guard — so a project still using the app never has its shared
 * resources removed. At 0 bindings it sets the `uninstalling` lock so a racing
 * `bindAppToProject` is refused, then the action runs the filesystem teardown and
 * finally deletes the row (clearing the lock).
 */
export const beginUninstall = internalMutation({
  args: { organizationId: v.string(), appSlug: v.string() },
  returns: v.union(
    v.object({ ok: v.literal(true) }),
    v.object({ ok: v.literal(false), notInstalled: v.literal(true) }),
  ),
  handler: async (ctx, args) => {
    const org = await ctx.db
      .query('appInstallations')
      .withIndex('by_org_slug', (q) =>
        q.eq('organizationId', args.organizationId).eq('appSlug', args.appSlug),
      )
      .first();
    if (!org) return { ok: false as const, notInstalled: true as const };
    const boundProjectNames: string[] = [];
    for await (const binding of ctx.db
      .query('appProjectBindings')
      .withIndex('by_org_slug_project', (q) =>
        q.eq('organizationId', args.organizationId).eq('appSlug', args.appSlug),
      )) {
      const project = await ctx.db.get(binding.projectId);
      boundProjectNames.push(project?.name ?? String(binding.projectId));
    }
    if (boundProjectNames.length > 0) {
      throw new ConvexError({
        code: 'APP_HAS_BOUND_PROJECTS',
        projects: boundProjectNames,
      });
    }
    await ctx.db.patch(org._id, { uninstalling: true });
    return { ok: true as const };
  },
});

export const getAppInstallationInternal = internalQuery({
  args: { organizationId: v.string(), appSlug: v.string() },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args): Promise<Doc<'appInstallations'> | null> => {
    return await ctx.db
      .query('appInstallations')
      .withIndex('by_org_slug', (q) =>
        q.eq('organizationId', args.organizationId).eq('appSlug', args.appSlug),
      )
      .first();
  },
});

export const setAppInstallStatus = internalMutation({
  args: {
    organizationId: v.string(),
    appSlug: v.string(),
    status: statusValidator,
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const row = await ctx.db
      .query('appInstallations')
      .withIndex('by_org_slug', (q) =>
        q.eq('organizationId', args.organizationId).eq('appSlug', args.appSlug),
      )
      .first();
    if (row && row.status !== args.status) {
      await ctx.db.patch(row._id, { status: args.status });
    }
    return null;
  },
});

export const deleteAppInstallation = internalMutation({
  args: { organizationId: v.string(), appSlug: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const row = await ctx.db
      .query('appInstallations')
      .withIndex('by_org_slug', (q) =>
        q.eq('organizationId', args.organizationId).eq('appSlug', args.appSlug),
      )
      .first();
    if (row) await ctx.db.delete(row._id);
    return null;
  },
});

/**
 * Reverse a workflow's registration: delete its install record + every event
 * subscription + schedule for (org, slug). wfInstallations has no cascade, so
 * the trigger rows must be removed explicitly (mirrors the install loop).
 */
export const deregisterWorkflow = internalMutation({
  args: { organizationId: v.string(), workflowSlug: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const install = await ctx.db
      .query('wfInstallations')
      .withIndex('by_org_slug', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('workflowSlug', args.workflowSlug),
      )
      .first();
    if (install) await ctx.db.delete(install._id);

    for await (const sub of ctx.db
      .query('wfEventSubscriptions')
      .withIndex('by_workflowSlug', (q) =>
        q.eq('workflowSlug', args.workflowSlug),
      )) {
      if (sub.organizationId === args.organizationId)
        await ctx.db.delete(sub._id);
    }
    for await (const sched of ctx.db
      .query('wfSchedules')
      .withIndex('by_workflowSlug', (q) =>
        q.eq('workflowSlug', args.workflowSlug),
      )) {
      if (sched.organizationId === args.organizationId) {
        await ctx.db.delete(sched._id);
      }
    }
    return null;
  },
});
