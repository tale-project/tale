/**
 * Record that a user signed in to (activated) an organization for the
 * current session.
 *
 * Invoked by the client right after `authClient.organization.setActive()`
 * succeeds. Does two things:
 *   1. Writes an auditable `signed_in_to_organization` log entry — the
 *      compliance "moment of tenant access".
 *   2. Persists `user.lastActiveOrganizationId` on the user record so the
 *      preference survives logout/login. Better Auth's
 *      `session.activeOrganizationId` only lives for the current session and
 *      gets reset to null when the session is destroyed on logout.
 *
 * Mutation name reflects the historical "switch" origin; the four invocation
 * paths it actually serves are: initial dashboard load (auto-select after
 * login), explicit org switcher, deep-link route guard, and post-org-creation.
 * The audit action name (`signed_in_to_organization`) describes the
 * user-facing semantic; the mutation name describes the state-machine call.
 *
 * Without dedup the same user re-activating the same org during a session
 * would spam the audit log. We skip the audit write if the same user already
 * has an entry for the same org within DEDUP_WINDOW_MS. The check OR-matches
 * the legacy `entered_organization` action name so dedup keeps working
 * across the rename for any old rows in the window.
 */

import { v } from 'convex/values';

import { components } from '../_generated/api';
import { mutation } from '../_generated/server';
import { logSuccess } from '../audit_logs/helpers';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

const DEDUP_WINDOW_MS = 30 * 60 * 1000;

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

    const actorId = String(authUser._id);
    const cutoff = Date.now() - DEDUP_WINDOW_MS;
    let hasRecentEntry = false;
    for await (const entry of ctx.db
      .query('auditLogs')
      .withIndex('by_org_category_timestamp', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('category', 'auth')
          .gte('timestamp', cutoff),
      )
      .order('desc')) {
      if (
        entry.actorId === actorId &&
        // TODO: drop `entered_organization` branch after demo data purge.
        (entry.action === 'signed_in_to_organization' ||
          entry.action === 'entered_organization')
      ) {
        hasRecentEntry = true;
        break;
      }
    }

    if (!hasRecentEntry) {
      await logSuccess(ctx, {
        auditCtx: {
          organizationId: args.organizationId,
          actor: {
            id: actorId,
            email: authUser.email,
            role: member.role,
            type: 'user',
          },
        },
        action: 'signed_in_to_organization',
        category: 'auth',
        resourceType: 'organization',
        resourceId: args.organizationId,
      });
    }

    // Persist the preference so next login lands here again.
    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'user' as const,
        where: [{ field: '_id', value: String(authUser._id), operator: 'eq' }],
        update: { lastActiveOrganizationId: args.organizationId },
      },
      paginationOpts: { cursor: null, numItems: 1 },
    });

    return null;
  },
});
