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

import { mutation, query } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { authComponent } from '../auth';

export const acknowledgePolicy = mutation({
  args: {
    organizationId: v.string(),
    policyType: v.string(),
    policyVersion: v.number(),
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
    if (existing && existing.policyVersion === args.policyVersion) {
      return existing._id;
    }

    const id = await ctx.db.insert('policyAcknowledgements', {
      userId,
      organizationId: args.organizationId,
      policyType: args.policyType,
      policyVersion: args.policyVersion,
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
      newState: { policyVersion: args.policyVersion },
    });
    return id;
  },
});

export const getPolicyAcknowledgement = query({
  args: {
    organizationId: v.string(),
    policyType: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) return null;
    const userId = String(authUser._id);
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
