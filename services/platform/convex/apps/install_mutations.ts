import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { internalMutation, internalQuery } from '../_generated/server';

const resourceValidator = v.object({
  domain: v.string(),
  path: v.string(),
  contentHash: v.string(),
});

const statusValidator = v.union(v.literal('active'), v.literal('broken'));

/** Upsert the install record + copied-file ledger (idempotent on reinstall). */
export const upsertAppInstallation = internalMutation({
  args: {
    organizationId: v.string(),
    appSlug: v.string(),
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
      installedAt: Date.now(),
      installedBy: args.installedBy,
      status: args.status,
      resources: args.resources,
      requiredIntegrations: args.requiredIntegrations,
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
