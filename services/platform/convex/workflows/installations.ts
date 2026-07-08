import { v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { internalMutation, internalQuery, query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

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
      automationSlug: v.optional(v.string()),
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

// Raw upsert, callable directly with a mutation `ctx` (e.g. the OneDrive sync
// provisioner) as well as through the `upsertInstallation` internalMutation
// wrapper below — the two must not drift, so the logic lives here once.
export async function upsertInstallationImpl(
  ctx: MutationCtx,
  args: {
    organizationId: string;
    workflowSlug: string;
    installedBy: string;
    contentHash: string;
    // Owning automation slug when this is an automation workflow; omitted for
    // global workflows.
    automationSlug?: string;
  },
): Promise<Id<'wfInstallations'>> {
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
      ...(args.automationSlug !== undefined
        ? { automationSlug: args.automationSlug }
        : {}),
    });
    return existing._id;
  }

  return await ctx.db.insert('wfInstallations', {
    organizationId: args.organizationId,
    workflowSlug: args.workflowSlug,
    installedAt: Date.now(),
    installedBy: args.installedBy,
    contentHash: args.contentHash,
    ...(args.automationSlug !== undefined
      ? { automationSlug: args.automationSlug }
      : {}),
  });
}

export const upsertInstallation = internalMutation({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    installedBy: v.string(),
    contentHash: v.string(),
    // Owning app slug when this is an app workflow; omitted for global workflows.
    automationSlug: v.optional(v.string()),
  },
  returns: v.id('wfInstallations'),
  handler: async (ctx, args) => upsertInstallationImpl(ctx, args),
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
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return false;

    await getOrganizationMember(ctx, args.organizationId, authUser);

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
