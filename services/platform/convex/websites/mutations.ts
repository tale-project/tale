import { v } from 'convex/values';

import { mutation } from '../_generated/server';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';
import * as WebsitesHelpers from './helpers';

const websiteStatusValidator = v.union(
  v.literal('idle'),
  v.literal('scanning'),
  v.literal('active'),
  v.literal('error'),
);

export const updateWebsite = mutation({
  args: {
    websiteId: v.id('websites'),
    domain: v.optional(v.string()),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    scanInterval: v.optional(v.string()),
    status: v.optional(websiteStatusValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const website = await ctx.db.get(args.websiteId);
    if (!website) {
      throw new Error('Website not found');
    }

    await getOrganizationMember(ctx, website.organizationId, {
      userId: authUser._id,
      email: authUser.email,
      name: authUser.name,
    });

    await WebsitesHelpers.updateWebsite(ctx, args);
    return null;
  },
});
