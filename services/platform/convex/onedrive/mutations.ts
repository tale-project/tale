import { ConvexError, v } from 'convex/values';

import { mutation } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

/**
 * Stop a OneDrive sync without touching the already-imported documents.
 * The sync workflow skips inactive configs, so the folder simply stops
 * receiving updates; re-running "Sync import" on the same folder
 * reactivates the config.
 */
export const cancelSyncConfig = mutation({
  args: {
    configId: v.id('onedriveSyncConfigs'),
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

    const config = await ctx.db.get(args.configId);
    if (!config) {
      throw new ConvexError({
        code: 'SYNC_CONFIG_NOT_FOUND',
        message: 'Sync config not found',
      });
    }

    await getOrganizationMember(ctx, config.organizationId, authUser);

    await ctx.db.patch(args.configId, { status: 'inactive' });
    return null;
  },
});
