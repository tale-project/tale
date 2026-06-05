import { v } from 'convex/values';

import { mutation } from '../_generated/server';
import * as AuditLogHelpers from '../audit_logs/helpers';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { deleteIntegration as deleteIntegrationHelper } from './delete_integration';

export const updateIcon = mutation({
  args: {
    integrationId: v.id('integrations'),
    iconStorageId: v.optional(v.id('_storage')),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const integration = await ctx.db.get(args.integrationId);
    if (!integration) {
      throw new Error('Integration not found');
    }

    await getOrganizationMember(ctx, integration.organizationId, authUser);

    if (integration.iconStorageId) {
      await ctx.storage.delete(integration.iconStorageId);
    }

    await ctx.db.patch(args.integrationId, {
      iconStorageId: args.iconStorageId,
    });

    return null;
  },
});

export const deleteIntegration = mutation({
  args: {
    integrationId: v.id('integrations'),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const integration = await ctx.db.get(args.integrationId);
    if (!integration) {
      throw new Error('Integration not found');
    }

    const member = await getOrganizationMember(
      ctx,
      integration.organizationId,
      authUser,
    );

    await deleteIntegrationHelper(ctx, args.integrationId);

    await AuditLogHelpers.logSuccess(ctx, {
      auditCtx: {
        organizationId: integration.organizationId,
        actor: {
          id: authUser.userId,
          email: authUser.email,
          role: member?.role,
          type: 'user',
        },
      },
      action: 'delete_integration',
      category: 'integration',
      resourceType: 'integration',
      resourceId: String(args.integrationId),
      resourceName: integration.name ?? integration.title,
      previousState: {
        name: integration.name,
        title: integration.title,
        type: integration.type,
        authMethod: integration.authMethod,
      },
    });

    return null;
  },
});
