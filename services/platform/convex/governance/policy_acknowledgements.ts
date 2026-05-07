/**
 * Phase 12 — policy acknowledgement primitives for the
 * `data_classification_notice` (and any future) one-time-ack flows.
 *
 *   - `acknowledgePolicy(orgId, policyType, version)` — insert the
 *     latest ack row for the calling user. Idempotent on (user, org,
 *     policyType, version).
 *   - `getPolicyAcknowledgement(orgId, policyType)` — returns the
 *     calling user's most-recent ack row, or `null`. Frontend
 *     compares `policyVersion` to the live policy `version` to decide
 *     whether to fire the ack modal.
 *
 * Audit: every ack writes a `policy_acknowledged` audit row keyed to
 * the user. Compliance teams can demonstrate "user X explicitly
 * acknowledged version V at timestamp T" without trawling the
 * frontend storage layer.
 */

import { ConvexError, v } from 'convex/values';

import { dataNoticeConfigSchema } from '../../lib/shared/schemas/governance';
import { mutation, query } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

// Closed set of ackable policy types. Today only the data-classification
// notice produces an ack-modal; future ackable policies (e.g. acceptable
// use, data-residency) extend this union. Using v.string() would let any
// authenticated user pollute the policyAcknowledgements table with
// arbitrary types and write `policy_acknowledged` audit rows under
// fabricated `resourceId`.
const ackablePolicyTypeValidator = v.union(
  v.literal('data_classification_notice'),
);

export const acknowledgePolicy = mutation({
  args: {
    organizationId: v.string(),
    policyType: ackablePolicyTypeValidator,
  },
  returns: v.id('policyAcknowledgements'),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'unauthenticated',
        message: 'Sign in required.',
      });
    }
    const userId = String(authUser._id);

    // RLS: the caller must actually be a member of the org they're
    // ack-ing on behalf of. Without this, any signed-in user can write
    // `policyAcknowledgements` rows + `policy_acknowledged` audit
    // entries into ANY org's tamper-evident hash chain — permanent
    // pollution of an unrelated tenant's compliance log.
    await getOrganizationMember(ctx, args.organizationId, {
      userId,
      email: authUser.email ?? '',
    });

    // Pin policyVersion to the live policy config server-side. Trusting
    // the client-supplied version let users self-ack
    // `Number.MAX_SAFE_INTEGER` to silence the modal forever even when
    // the admin bumps the live version repeatedly.
    const livePolicy = await ctx.db
      .query('governancePolicies')
      .withIndex('by_org_policyType', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('policyType', args.policyType),
      )
      .first();
    if (!livePolicy) {
      throw new ConvexError({
        code: 'POLICY_NOT_CONFIGURED',
        message: `No active ${args.policyType} policy for this org — nothing to acknowledge.`,
      });
    }
    const parsed = dataNoticeConfigSchema.safeParse(livePolicy.config);
    if (!parsed.success) {
      throw new ConvexError({
        code: 'POLICY_CONFIG_INVALID',
        message: `Stored ${args.policyType} config does not match the expected schema.`,
      });
    }
    const policyVersion = parsed.data.version;

    // Refuse if the same user already acknowledged this exact version
    // — treat as idempotent, return existing id.
    const existing = await ctx.db
      .query('policyAcknowledgements')
      .withIndex('by_user_org_policy', (q) =>
        q
          .eq('userId', userId)
          .eq('organizationId', args.organizationId)
          .eq('policyType', args.policyType),
      )
      .order('desc')
      .first();
    if (existing && existing.policyVersion >= policyVersion) {
      return existing._id;
    }

    const id = await ctx.db.insert('policyAcknowledgements', {
      userId,
      organizationId: args.organizationId,
      policyType: args.policyType,
      policyVersion,
      acknowledgedAt: Date.now(),
    });
    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: userId,
      actorEmail: authUser.email ?? '',
      actorType: 'user',
      action: 'policy_acknowledged',
      category: 'admin',
      resourceType: 'governance_policy',
      resourceId: args.policyType,
      resourceName: args.policyType,
      status: 'success',
      newState: { policyVersion },
    });
    return id;
  },
});

export const getPolicyAcknowledgement = query({
  args: {
    organizationId: v.string(),
    policyType: ackablePolicyTypeValidator,
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) return null;
    const userId = String(authUser._id);
    // RLS — see acknowledgePolicy. Reading another org's ack rows is a
    // (small) information leak (acked-or-not + version + timestamp);
    // close the same hole here.
    try {
      await getOrganizationMember(ctx, args.organizationId, {
        userId,
        email: authUser.email ?? '',
      });
    } catch (err) {
      // Non-membership AND infrastructure errors collapse to "no row".
      // Log the unexpected variant so a backend hiccup isn't silently
      // mistaken for "user is not a member of this org".
      console.warn(
        '[getPolicyAcknowledgement] org-membership lookup failed; returning null',
        err,
      );
      return null;
    }
    const row = await ctx.db
      .query('policyAcknowledgements')
      .withIndex('by_user_org_policy', (q) =>
        q
          .eq('userId', userId)
          .eq('organizationId', args.organizationId)
          .eq('policyType', args.policyType),
      )
      .order('desc')
      .first();
    if (!row) return null;
    return {
      policyVersion: row.policyVersion,
      acknowledgedAt: row.acknowledgedAt,
    };
  },
});
