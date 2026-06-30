import { ConvexError, v } from 'convex/values';

import { mutation } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import * as WebsitesHelpers from './helpers';
import { websiteStatusValidator } from './validators';

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
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'UNAUTHENTICATED',
        message: 'Unauthenticated',
      });
    }

    const website = await ctx.db.get(args.websiteId);
    if (!website) {
      throw new ConvexError({
        code: 'WEBSITE_NOT_FOUND',
        message: 'Website not found',
      });
    }

    await getOrganizationMember(ctx, website.organizationId, authUser);

    await WebsitesHelpers.updateWebsite(ctx, args);
    return null;
  },
});
