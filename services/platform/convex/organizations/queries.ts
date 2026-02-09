import { v } from 'convex/values';

import { query } from '../_generated/server';
import { getOrganization as getOrganizationHelper } from './get_organization';

export const getOrganization = query({
  args: { id: v.string() },
  returns: v.union(
    v.object({
      _id: v.string(),
      _creationTime: v.number(),
      name: v.string(),
      slug: v.optional(v.string()),
      logo: v.optional(v.union(v.string(), v.null())),
      createdAt: v.number(),
      metadata: v.optional(v.any()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    return await getOrganizationHelper(ctx, args.id);
  },
});
