import { v } from 'convex/values';

import { mutation } from '../_generated/server';
import * as AuditLogHelpers from '../audit_logs/helpers';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';
import { deleteIntegration as deleteIntegrationHelper } from './delete_integration';

export const updateIcon = mutation({
  args: {
    integrationId: v.id('integrations'),
    iconStorageId: v.optional(v.id('_storage')),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
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
    const authUser = await authComponent.getAuthUser(ctx);
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
      {
        userId: String(authUser._id),
        email: authUser.email,
        name: authUser.name,
      },
    );

    await deleteIntegrationHelper(ctx, args.integrationId);

    await AuditLogHelpers.logSuccess(
      ctx,
      {
        organizationId: integration.organizationId,
        actor: {
          id: String(authUser._id),
          email: authUser.email,
          role: member?.role,
          type: 'user',
        },
      },
      'delete_integration',
      'integration',
      'integration',
      String(args.integrationId),
      integration.name ?? integration.title,
      {
        name: integration.name,
        title: integration.title,
        type: integration.type,
        authMethod: integration.authMethod,
      },
      undefined,
    );

    return null;
  },
});
