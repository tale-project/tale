import type { GenericQueryCtx } from 'convex/server';
import { ConvexError, v } from 'convex/values';

import {
  DEFAULT_DSAR_GOVERNANCE,
  type DsarGovernanceConfig,
  dsarGovernanceConfigSchema,
} from '../../lib/shared/schemas/governance';
import { internal } from '../_generated/api';
import type { DataModel } from '../_generated/dataModel';
import { internalMutation, mutation, query } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { writeNotificationForOrgs } from '../notifications/helpers';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Loosen-grace window for weakening dsar_governance policy changes.
 * 24h matches the request-cooling-off default — every "weakening of a
 * safeguard" gets the same window every "destructive action" gets, so
 * a compromised owner can't both weaken the policy and use it the
 * weakened policy in less than a day.
 */
const POLICY_LOOSEN_GRACE_MS = 24 * HOUR_MS;

/**
 * Read the per-org `dsar_governance` policy's CURRENT effective config.
 * `pendingConfig` (a staged loosening change) does NOT take effect
 * until `applyPendingDsarPolicyChange` flips it; consumers that gate
 * on policy (e.g. `requestErasure`) only see the active config.
 *
 * Defaults: 24h cooling-off, no dual approval, 5 requests/admin/day.
 */
export async function getDsarPolicy(
  ctx: GenericQueryCtx<DataModel>,
  organizationId: string,
): Promise<DsarGovernanceConfig> {
  const row = await ctx.db
    .query('governancePolicies')
    .withIndex('by_org_policyType', (q) =>
      q
        .eq('organizationId', organizationId)
        .eq('policyType', 'dsar_governance'),
    )
    .first();

  if (!row) return DEFAULT_DSAR_GOVERNANCE;

  const parsed = dsarGovernanceConfigSchema.safeParse(row.config);
  if (!parsed.success) {
    console.warn(
      `Invalid dsar_governance config for org ${organizationId}; using defaults`,
      parsed.error,
    );
    return DEFAULT_DSAR_GOVERNANCE;
  }

  return parsed.data;
}

/**
 * Returns true when `next` is *strictly weaker* than `current` along
 * any axis — anyone editing a knob in the direction that makes erasure
 * easier or wider triggers the 24h grace window. Equal values along
 * every axis return false (no real change). Mixed (some stricter, some
 * looser) also returns true — the looser axis dominates.
 */
export function isLoosening(
  current: DsarGovernanceConfig,
  next: DsarGovernanceConfig,
): boolean {
  // Shorter cooling-off → easier to file destructive action sooner.
  if (next.coolingOffHours < current.coolingOffHours) return true;
  // Disabling the dual-approval gate.
  if (current.requireDualApproval && !next.requireDualApproval) return true;
  // Higher daily ceiling → more requests per actor.
  if (next.dailyLimitPerAdmin > current.dailyLimitPerAdmin) return true;
  return false;
}

/**
 * UI-facing read: returns the active config plus any staged pending
 * change (so the editor can render "Pending: cooling-off → 4h in 23h
 * 30m, [Cancel]"). Admin-gated; the editor itself is owner-only on the
 * write side, but everyone with `read orgSettings` can see the state.
 */
export const getDsarPolicyForUi = query({
  args: { organizationId: v.string() },
  returns: v.object({
    config: v.object({
      coolingOffHours: v.number(),
      requireDualApproval: v.boolean(),
      dailyLimitPerAdmin: v.number(),
    }),
    pending: v.union(
      v.object({
        config: v.object({
          coolingOffHours: v.number(),
          requireDualApproval: v.boolean(),
          dailyLimitPerAdmin: v.number(),
        }),
        effectiveAt: v.number(),
        proposedBy: v.string(),
        proposedByEmail: v.optional(v.string()),
        proposedByName: v.optional(v.string()),
        proposedAt: v.number(),
      }),
      v.null(),
    ),
    callerIsOwner: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });
    // Allow any org member with admin/owner role to read; only
    // owner can write (enforced separately in the write paths).
    if (member.role !== 'owner' && member.role !== 'admin') {
      throw new Error('Reading dsar_governance requires admin or owner role.');
    }

    const config = await getDsarPolicy(ctx, args.organizationId);
    const row = await ctx.db
      .query('governancePolicies')
      .withIndex('by_org_policyType', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('policyType', 'dsar_governance'),
      )
      .first();

    let pending = null as null | {
      config: DsarGovernanceConfig;
      effectiveAt: number;
      proposedBy: string;
      proposedByEmail?: string;
      proposedByName?: string;
      proposedAt: number;
    };
    if (
      row?.pendingConfig !== undefined &&
      row.pendingEffectiveAt !== undefined &&
      row.pendingProposedBy !== undefined &&
      row.pendingProposedAt !== undefined
    ) {
      const parsed = dsarGovernanceConfigSchema.safeParse(row.pendingConfig);
      if (parsed.success) {
        pending = {
          config: parsed.data,
          effectiveAt: row.pendingEffectiveAt,
          proposedBy: row.pendingProposedBy,
          proposedByEmail: row.pendingProposedByEmail,
          proposedAt: row.pendingProposedAt,
        };
      }
    }

    return {
      config,
      pending,
      callerIsOwner: member.role === 'owner',
    };
  },
});

/**
 * Owner-only write path for `dsar_governance`. Routes loosening
 * changes through the 24h grace window; tightening applies
 * immediately. Always notifies all admins of the org.
 *
 * The generic `governance.mutations.upsertPolicy` refuses
 * `dsar_governance` and tells callers to use this mutation
 * instead — keeps the looseness-detection + grace logic in one place.
 */
export const proposeDsarPolicy = mutation({
  args: {
    organizationId: v.string(),
    config: v.object({
      coolingOffHours: v.number(),
      requireDualApproval: v.boolean(),
      dailyLimitPerAdmin: v.number(),
    }),
  },
  returns: v.object({
    applied: v.boolean(),
    effectiveAt: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'unauthenticated',
        message: 'Sign in required.',
      });
    }
    const callerId = String(authUser._id);

    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: callerId,
      email: authUser.email ?? '',
      name: authUser.name,
    });
    // B: owner-only. Admin can READ but not WRITE the DSAR governance
    // policy. Limits the surface from "any compromised admin" to
    // "the single owner account".
    if (member.role !== 'owner') {
      throw new ConvexError({
        code: 'forbidden',
        message:
          'Only the org owner can change the DSAR governance policy. Admins can read it.',
      });
    }

    const parsed = dsarGovernanceConfigSchema.safeParse(args.config);
    if (!parsed.success) {
      throw new ConvexError({
        code: 'validation',
        message: `Invalid DSAR governance configuration: ${parsed.error.message}`,
      });
    }
    const next = parsed.data;
    const current = await getDsarPolicy(ctx, args.organizationId);

    // Find existing row (or null) so we can patch in place.
    const row = await ctx.db
      .query('governancePolicies')
      .withIndex('by_org_policyType', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('policyType', 'dsar_governance'),
      )
      .first();

    const now = Date.now();

    // If a pending change is already staged, refuse — the operator
    // must cancel the existing pending change first. Avoids stacking
    // races and keeps the audit trail linear.
    if (row?.pendingConfig !== undefined) {
      throw new ConvexError({
        code: 'pendingChangeExists',
        message:
          'A pending DSAR policy change is already staged. Cancel it before proposing a new one.',
      });
    }

    const loosening = isLoosening(current, next);

    if (!loosening) {
      // Tightening (or no change along loosening axes) — apply now.
      const patch = {
        config: next,
        updatedBy: callerId,
        updatedAt: now,
      } as const;
      if (row) {
        await ctx.db.patch(row._id, patch);
      } else {
        await ctx.db.insert('governancePolicies', {
          organizationId: args.organizationId,
          policyType: 'dsar_governance',
          ...patch,
        });
      }
      await createAuditLog(ctx, {
        organizationId: args.organizationId,
        actorId: callerId,
        actorEmail: authUser.email ?? '',
        actorType: 'user',
        action: 'dsar_governance_policy_tightened',
        category: 'admin',
        resourceType: 'organization',
        resourceId: args.organizationId,
        status: 'success',
        previousState: { config: current },
        newState: { config: next },
      });
      await writeNotificationForOrgs(ctx, {
        organizationIds: [args.organizationId],
        category: 'security',
        severity: 'info',
        titleKey: 'dsarPolicyTightened',
        bodyKey: 'dsarPolicyTightenedBody',
        params: { proposedBy: callerId },
      });
      return { applied: true };
    }

    // Loosening — stage as pending; schedule deferred apply.
    const effectiveAt = now + POLICY_LOOSEN_GRACE_MS;
    const scheduledJobId = await ctx.scheduler.runAfter(
      POLICY_LOOSEN_GRACE_MS,
      internal.governance.dsar_policy.applyPendingDsarPolicyChange,
      { organizationId: args.organizationId },
    );
    const patch = {
      pendingConfig: next,
      pendingEffectiveAt: effectiveAt,
      pendingProposedBy: callerId,
      pendingProposedByEmail: authUser.email ?? undefined,
      pendingProposedAt: now,
      pendingScheduledJobId: scheduledJobId,
    } as const;
    if (row) {
      await ctx.db.patch(row._id, patch);
    } else {
      // First-time setup: row didn't exist. Insert with current
      // (default) config + pending fields.
      await ctx.db.insert('governancePolicies', {
        organizationId: args.organizationId,
        policyType: 'dsar_governance',
        config: current,
        ...patch,
      });
    }
    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: callerId,
      actorEmail: authUser.email ?? '',
      actorType: 'user',
      action: 'dsar_governance_policy_loosen_proposed',
      category: 'admin',
      resourceType: 'organization',
      resourceId: args.organizationId,
      status: 'success',
      previousState: { config: current },
      newState: { config: next, effectiveAt },
    });
    await writeNotificationForOrgs(ctx, {
      organizationIds: [args.organizationId],
      category: 'security',
      severity: 'warning',
      titleKey: 'dsarPolicyLoosenProposed',
      bodyKey: 'dsarPolicyLoosenProposedBody',
      params: { proposedBy: callerId, effectiveAt },
    });
    return { applied: false, effectiveAt };
  },
});

/**
 * Any org admin (not only owner) can cancel a pending loosening
 * change. The threat model is "someone weakening the safeguard" — the
 * intervention should NOT itself require owner privileges, otherwise a
 * compromised owner could quietly lower the bar with no admin recourse.
 */
export const cancelPendingDsarPolicyChange = mutation({
  args: { organizationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'unauthenticated',
        message: 'Sign in required.',
      });
    }
    const callerId = String(authUser._id);

    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: callerId,
      email: authUser.email ?? '',
      name: authUser.name,
    });
    if (member.role !== 'owner' && member.role !== 'admin') {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Only org admins or the owner can cancel a pending change.',
      });
    }

    const row = await ctx.db
      .query('governancePolicies')
      .withIndex('by_org_policyType', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('policyType', 'dsar_governance'),
      )
      .first();

    if (!row || row.pendingConfig === undefined) {
      throw new ConvexError({
        code: 'not_found',
        message: 'No pending DSAR policy change to cancel.',
      });
    }

    const previousPending = {
      config: row.pendingConfig,
      effectiveAt: row.pendingEffectiveAt,
      proposedBy: row.pendingProposedBy,
    };

    if (row.pendingScheduledJobId) {
      await ctx.scheduler.cancel(row.pendingScheduledJobId);
    }
    await ctx.db.patch(row._id, {
      pendingConfig: undefined,
      pendingEffectiveAt: undefined,
      pendingProposedBy: undefined,
      pendingProposedByEmail: undefined,
      pendingProposedAt: undefined,
      pendingScheduledJobId: undefined,
    });

    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: callerId,
      actorEmail: authUser.email ?? '',
      actorType: 'user',
      action: 'dsar_governance_policy_loosen_cancelled',
      category: 'admin',
      resourceType: 'organization',
      resourceId: args.organizationId,
      status: 'success',
      previousState: previousPending,
      newState: { cancelledBy: callerId },
    });
    await writeNotificationForOrgs(ctx, {
      organizationIds: [args.organizationId],
      category: 'security',
      severity: 'info',
      titleKey: 'dsarPolicyLoosenCancelled',
      bodyKey: 'dsarPolicyLoosenCancelledBody',
      params: { cancelledBy: callerId },
    });
    return null;
  },
});

/**
 * Internal mutation invoked by the scheduler when the loosen-grace
 * window elapses. Idempotent: if `pendingConfig` is no longer set
 * (cancelled, or already applied), return null without writing.
 */
export const applyPendingDsarPolicyChange = internalMutation({
  args: { organizationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const row = await ctx.db
      .query('governancePolicies')
      .withIndex('by_org_policyType', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('policyType', 'dsar_governance'),
      )
      .first();
    if (!row || row.pendingConfig === undefined) return null;
    // Defense in depth: refuse to apply if `pendingEffectiveAt` is
    // somehow still in the future (e.g. clock skew at the scheduler
    // layer; should not happen but free safety check).
    if (
      row.pendingEffectiveAt !== undefined &&
      row.pendingEffectiveAt > Date.now()
    ) {
      return null;
    }

    const previous = row.config;
    const next = row.pendingConfig;
    await ctx.db.patch(row._id, {
      config: next,
      updatedBy: row.pendingProposedBy,
      updatedAt: Date.now(),
      pendingConfig: undefined,
      pendingEffectiveAt: undefined,
      pendingProposedBy: undefined,
      pendingProposedByEmail: undefined,
      pendingProposedAt: undefined,
      pendingScheduledJobId: undefined,
    });

    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: row.pendingProposedBy ?? 'system',
      actorType: 'system',
      action: 'dsar_governance_policy_loosen_applied',
      category: 'admin',
      resourceType: 'organization',
      resourceId: args.organizationId,
      status: 'success',
      previousState: { config: previous },
      newState: { config: next },
    });
    await writeNotificationForOrgs(ctx, {
      organizationIds: [args.organizationId],
      category: 'security',
      severity: 'warning',
      titleKey: 'dsarPolicyLoosenApplied',
      bodyKey: 'dsarPolicyLoosenAppliedBody',
      params: { proposedBy: row.pendingProposedBy ?? 'system' },
    });
    return null;
  },
});
