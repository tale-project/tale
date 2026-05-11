import { v } from 'convex/values';

import { query } from '../_generated/server';
import { authComponent } from '../auth';
import { getOrganization as getOrganizationHelper } from './get_organization';
import { hasAnyOrganization as hasAnyOrganizationHelper } from './has_any_organization';

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

/**
 * Whether the instance has any organization at all.
 *
 * The dashboard uses this to gate the auto-create of the seeded `default`
 * org: when the instance has zero orgs, the first authenticated user
 * triggers the seed; otherwise they are routed to the create-organization
 * form so they create their own non-`default` org.
 *
 * Auth-gated to avoid leaking instance provisioning state to anonymous
 * probes — unlike `hasAnyUsers` which is intentionally public for the
 * sign-up onboarding flow.
 */
export const instanceHasAnyOrganization = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx): Promise<boolean> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }
    return await hasAnyOrganizationHelper(ctx);
  },
});
