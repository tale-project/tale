/**
 * Public query to list integrations for an organization
 */

import { v } from 'convex/values';
import { query } from '../../_generated/server';
import { authComponent } from '../../auth';
import { getOrganizationMember } from '../../lib/rls';
import { listIntegrations } from '../list_integrations';

export const list = query({
  args: {
    organizationId: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return [];
    }

    // Verify user has access to this organization
    try {
      await getOrganizationMember(ctx, args.organizationId, {
        userId: String(authUser._id),
        email: authUser.email,
        name: authUser.name,
      });
    } catch {
      return [];
    }

    return await listIntegrations(ctx, args);
  },
});
