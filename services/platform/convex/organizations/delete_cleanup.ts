/**
 * Client-facing mutation to log the deletion of an organization and
 * trigger per-org filesystem cleanup. Invoked by the UI right before
 * `authClient.organization.delete()` so the audit entry lands while the
 * membership still exists and the filesystem cleanup can schedule itself
 * without racing.
 */

import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import { mutation } from '../_generated/server';
import { logSuccess } from '../audit_logs/helpers';
import { assertNotHeld } from '../governance/legal_hold_guard';
import { cascadeOnOrgDeleted } from '../lib/cascades/personalization_cascade';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { resolveOrgSlug } from './resolve_org_slug';

export const prepareOrganizationDeletion = mutation({
  args: {
    organizationId: v.string(),
  },
  returns: v.object({
    orgSlug: v.string(),
  }),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({ code: 'UNAUTHENTICATED' });
    }

    // Only owners can delete. getOrganizationMember throws if the user
    // isn't a member of the org at all.
    const member = await getOrganizationMember(ctx, args.organizationId);
    if (member.role !== 'owner') {
      throw new ConvexError({
        code: 'FORBIDDEN',
        message: 'Only owners can delete organizations',
        userMessage: 'Only owners can delete organizations.',
      });
    }

    const slug = await resolveOrgSlug(ctx, args.organizationId);
    if (slug === 'default') {
      throw new ConvexError({
        code: 'DEFAULT_ORG_PROTECTED',
        message: 'The default organization cannot be deleted',
        userMessage: 'The default organization cannot be deleted.',
      });
    }

    // Round-2 V4 P0-10: cascadeOnOrgDeleted hard-deletes userPreferences
    // (+ videoLink blobs) org-wide. Without this gate, an owner could wipe
    // a hold-held org's PII directly — FRCP 37(e) spoliation. assertNotHeld
    // refuses with `LEGAL_HOLD_ACTIVE` (orgHeld + any active userMembership
    // cascade implicitly fires too — passing the actor's id as authorUserId).
    await assertNotHeld(
      ctx,
      args.organizationId,
      'org',
      args.organizationId,
      undefined,
      authUser.userId,
    );

    await logSuccess(ctx, {
      auditCtx: {
        organizationId: args.organizationId,
        actor: {
          id: authUser.userId,
          email: authUser.email,
          role: member.role,
          type: 'user',
        },
      },
      action: 'organization_deleted',
      category: 'auth',
      resourceType: 'organization',
      resourceId: args.organizationId,
      metadata: { slug },
    });

    // Personalization cascade: schedule a bounded, self-rescheduling drain
    // that erases prefs + videoLink blobs scoped to this org across every
    // member. Scheduling (rather than deleting inline)
    // keeps this mutation within the per-mutation write budget on a large org;
    // the schedule is transactional with this mutation (rolled back if it
    // throws) and safe to run before/after Better Auth deletes the org row —
    // these tables key on organizationId and are independent of Better Auth
    // state.
    await cascadeOnOrgDeleted(ctx, args.organizationId);

    // Schedule filesystem cleanup. Runs after Better Auth deletes the
    // org row; safe even if that deletion fails because the scheduled
    // action just reconciles filesystem state with the slug it was given.
    await ctx.scheduler.runAfter(
      0,
      internal.organizations.scaffold.cleanupOrgFilesystem,
      { orgSlug: slug },
    );

    return { orgSlug: slug };
  },
});
