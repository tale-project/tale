/**
 * Public mutation to delete an integration
 */

import { v } from 'convex/values';
import { mutation } from '../../_generated/server';
import { authComponent } from '../../auth';
import { getOrganizationMember } from '../../lib/rls';
import { deleteIntegration as deleteIntegrationHelper } from '../delete_integration';

export const deleteIntegration = mutation({
  args: {
    integrationId: v.id('integrations'),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Not authenticated');
    }

    const integration = await ctx.db.get(args.integrationId);
    if (!integration) {
      throw new Error('Integration not found');
    }

    await getOrganizationMember(ctx, integration.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    return await deleteIntegrationHelper(ctx, args.integrationId);
  },
});
