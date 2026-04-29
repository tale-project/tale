import { v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { internalMutation, internalQuery, query } from '../_generated/server';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';

export const getInstallationInternal = internalQuery({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
  },
  returns: v.union(
    v.object({
      _id: v.id('wfInstallations'),
      _creationTime: v.number(),
      organizationId: v.string(),
      workflowSlug: v.string(),
      installedAt: v.number(),
      installedBy: v.string(),
      contentHash: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args): Promise<Doc<'wfInstallations'> | null> => {
    return await ctx.db
      .query('wfInstallations')
      .withIndex('by_org_slug', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('workflowSlug', args.workflowSlug),
      )
      .first();
  },
});

export const upsertInstallation = internalMutation({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    installedBy: v.string(),
    contentHash: v.string(),
  },
  returns: v.id('wfInstallations'),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('wfInstallations')
      .withIndex('by_org_slug', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('workflowSlug', args.workflowSlug),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        installedAt: Date.now(),
        installedBy: args.installedBy,
        contentHash: args.contentHash,
      });
      return existing._id;
    }

    return await ctx.db.insert('wfInstallations', {
      organizationId: args.organizationId,
      workflowSlug: args.workflowSlug,
      installedAt: Date.now(),
      installedBy: args.installedBy,
      contentHash: args.contentHash,
    });
  },
});

export const deleteInstallation = internalMutation({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const existing = await ctx.db
      .query('wfInstallations')
      .withIndex('by_org_slug', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('workflowSlug', args.workflowSlug),
      )
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    return null;
  },
});

export const listInstalledSlugs = internalQuery({
  args: { organizationId: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, args): Promise<string[]> => {
    const slugs: string[] = [];
    for await (const row of ctx.db
      .query('wfInstallations')
      .withIndex('by_org', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      slugs.push(row.workflowSlug);
    }
    return slugs;
  },
});

export const isInstalled = query({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) return false;

    await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    const row = await ctx.db
      .query('wfInstallations')
      .withIndex('by_org_slug', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('workflowSlug', args.workflowSlug),
      )
      .first();
    return row !== null;
  },
});
