/**
 * Record that a user entered (selected) an organization.
 *
 * Invoked by the client right after `authClient.organization.setActive()`
 * succeeds. This is the auditable "moment of tenant selection" required for
 * compliance — without it, multi-org users can switch tenants silently.
 */

import { v } from 'convex/values';

import { mutation } from '../_generated/server';
import { logSuccess } from '../audit_logs/helpers';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

export const recordOrgSwitch = mutation({
  args: {
    organizationId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    // getOrganizationMember resolves the authenticated user internally via
    // the JWT identity; it throws if the user isn't a member, so a malicious
    // client cannot spam audit logs for tenants they don't belong to.
    const member = await getOrganizationMember(ctx, args.organizationId);

    await logSuccess(ctx, {
      auditCtx: {
        organizationId: args.organizationId,
        actor: {
          id: String(authUser._id),
          email: authUser.email,
          role: member.role,
          type: 'user',
        },
      },
      action: 'entered_organization',
      category: 'auth',
      resourceType: 'organization',
      resourceId: args.organizationId,
    });

    return null;
  },
});
