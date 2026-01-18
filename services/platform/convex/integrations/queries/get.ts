/**
 * Public query to get a single integration by ID
 */

import { v } from 'convex/values';
import { query } from '../../_generated/server';
import { authComponent } from '../../auth';
import { getOrganizationMember } from '../../lib/rls';
import { getIntegration } from '../get_integration';

export const get = query({
  args: {
    integrationId: v.id('integrations'),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return null;
    }

    const integration = await getIntegration(ctx, args.integrationId);
    if (!integration) {
      return null;
    }

    // Verify user has access to this organization
    try {
      await getOrganizationMember(ctx, integration.organizationId, {
        userId: String(authUser._id),
        email: authUser.email,
        name: authUser.name,
      });
    } catch {
      return null;
    }

    return integration;
  },
});
