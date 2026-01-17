/**
 * Integration Get By Name Query
 *
 * Public query to get an integration by organization and name.
 */

import { v } from 'convex/values';
import { query } from '../../_generated/server';
import { authComponent } from '../../auth';
import { getOrganizationMember } from '../../lib/rls';
import { getIntegrationByName } from '../get_integration_by_name';
import { integrationDocValidator } from '../validators';

/**
 * Get an integration by organization and name.
 */
export const getByName = query({
  args: {
    organizationId: v.string(),
    name: v.string(),
  },
  returns: v.union(integrationDocValidator, v.null()),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return null;
    }

    // Verify user has access to this organization
    try {
      await getOrganizationMember(ctx, args.organizationId, {
        userId: authUser.userId,
        email: authUser.email,
        name: authUser.name,
      });
    } catch {
      return null;
    }

    return await getIntegrationByName(ctx, args);
  },
});
