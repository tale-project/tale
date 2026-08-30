import type { GenericQueryCtx } from 'convex/server';
import { v } from 'convex/values';

import { AppError } from '../../lib/shared/errors/app-error';
import {
  DEFAULT_DSAR_GOVERNANCE,
  type DsarGovernanceConfig,
  dsarGovernanceConfigSchema,
} from '../../lib/shared/schemas/governance';
import { internal } from '../_generated/api';
import type { DataModel } from '../_generated/dataModel';
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { readConfigCacheRow } from '../lib/config_cache/read';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { writeNotificationForOrgs } from '../notifications/helpers';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Loosen-grace window for weakening dsar_governance policy changes.
 * 24h matches the request-cooling-off default — every "weakening of a
 * safeguard" gets the same window every "destructive action" gets, so
 * a compromised owner can't both weaken the policy and use the weakened
 * policy in less than a day.
 */
const POLICY_LOOSEN_GRACE_MS = 24 * HOUR_MS;

/**
 * Read the per-org `dsar_governance` policy's CURRENT effective config from
 * the file-derived `configCache`. A staged loosening change lives in
 * `dsarPolicyPendingChanges` and does NOT take effect until
 * `applyPendingDsarPolicyChange` flips the file; consumers that gate on policy
 * (e.g. `requestErasure`) only see the active config.
 *
 * Defaults: 24h cooling-off, no dual approval, 5 requests/admin/day.
 */
export async function getDsarPolicy(
  ctx: GenericQueryCtx<DataModel>,
  organizationId: string,
): Promise<DsarGovernanceConfig> {
  const row = await readConfigCacheRow(
    ctx.db,
    organizationId,
    'governance',
    'dsar_governance',
  );

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
 * Internal: the active config + any staged pending loosening change. Lets the
 * V8 actions (which can't read the filesystem and shouldn't duplicate the
 * cache/pending lookups) make their tighten-vs-loosen / apply decisions.
 */
export const readDsarStateInternal = internalQuery({
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
      }),
      v.null(),
    ),
  }),
  handler: async (ctx, args) => {
    const config = await getDsarPolicy(ctx, args.organizationId);
    const pendingRow = await ctx.db
      .query('dsarPolicyPendingChanges')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .first();
    let pending: { config: DsarGovernanceConfig; effectiveAt: number } | null =
      null;
    if (pendingRow) {
      const parsed = dsarGovernanceConfigSchema.safeParse(
        pendingRow.pendingConfig,
      );
      if (parsed.success) {
        pending = { config: parsed.data, effectiveAt: pendingRow.effectiveAt };
      }
    }
    return { config, pending };
  },
});

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
        proposedAt: v.number(),
      }),
      v.null(),
    ),
    callerIsOwner: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser)
      throw new AppError({
        code: 'UNAUTHENTICATED',
        message: 'Unauthenticated',
      });
    const member = await getOrganizationMember(
      ctx,
      args.organizationId,
      authUser,
    );
    if (member.role !== 'owner' && member.role !== 'admin') {
      throw new AppError({
        code: 'FORBIDDEN',
        message: 'Reading dsar_governance requires admin or owner role.',
      });
    }

    const config = await getDsarPolicy(ctx, args.organizationId);
    const pendingRow = await ctx.db
      .query('dsarPolicyPendingChanges')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .first();

    let pending = null as null | {
      config: DsarGovernanceConfig;
      effectiveAt: number;
      proposedBy: string;
      proposedByEmail?: string;
      proposedAt: number;
    };
    if (pendingRow) {
      const parsed = dsarGovernanceConfigSchema.safeParse(
        pendingRow.pendingConfig,
      );
      if (parsed.success) {
        pending = {
          config: parsed.data,
          effectiveAt: pendingRow.effectiveAt,
          proposedBy: pendingRow.proposedBy,
          proposedByEmail: pendingRow.proposedByEmail,
          proposedAt: pendingRow.proposedAt,
        };
      }
    }

    return { config, pending, callerIsOwner: member.role === 'owner' };
  },
});

/**
 * Owner-only write path for `dsar_governance`. Files are the source of truth,
 * so this is a Convex action: tightening writes the policy file immediately;
 * loosening stages the change in `dsarPolicyPendingChanges` and schedules a
 * deferred file write 24h out. Always notifies all admins of the org.
 */
export const proposeDsarPolicy = action({
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
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new AppError({
        code: 'unauthenticated',
        message: 'Sign in required.',
      });
    }
    const callerId = authUser.userId;

    // B: owner-only. Admin can READ but not WRITE the DSAR governance policy.
    const member = await ctx.runQuery(
      internal.governance.internal_queries.verifyOrgMember,
      {
        organizationId: args.organizationId,
        userId: callerId,
        email: authUser.email ?? '',
        name: authUser.name,
      },
    );
    if (member.role !== 'owner') {
      throw new AppError({
        code: 'forbidden',
        message:
          'Only the org owner can change the DSAR governance policy. Admins can read it.',
      });
    }

    const parsed = dsarGovernanceConfigSchema.safeParse(args.config);
    if (!parsed.success) {
      throw new AppError({
        code: 'validation',
        message: `Invalid DSAR governance configuration: ${parsed.error.message}`,
      });
    }
    const next = parsed.data;

    const state = await ctx.runQuery(
      internal.governance.dsar_policy.readDsarStateInternal,
      { organizationId: args.organizationId },
    );
    if (state.pending) {
      throw new AppError({
        code: 'pendingChangeExists',
        message:
          'A pending DSAR policy change is already staged. Cancel it before proposing a new one.',
      });
    }

    if (!isLoosening(state.config, next)) {
      // Tightening (or no change along loosening axes) — write the file now.
      await ctx.runAction(
        internal.governance.file_actions.persistGovernancePolicyFile,
        {
          organizationId: args.organizationId,
          policyType: 'dsar_governance',
          config: next,
        },
      );
      await ctx.runMutation(internal.governance.dsar_policy.recordDsarTighten, {
        organizationId: args.organizationId,
        previousConfig: state.config,
        nextConfig: next,
        actorId: callerId,
        actorEmail: authUser.email ?? undefined,
      });
      return { applied: true };
    }

    // Loosening — stage as pending; schedule the deferred file write.
    const effectiveAt = Date.now() + POLICY_LOOSEN_GRACE_MS;
    const scheduledJobId = await ctx.scheduler.runAfter(
      POLICY_LOOSEN_GRACE_MS,
      internal.governance.dsar_policy.applyPendingDsarPolicyChange,
      { organizationId: args.organizationId },
    );
    await ctx.runMutation(internal.governance.dsar_policy.stageDsarLoosen, {
      organizationId: args.organizationId,
      pendingConfig: next,
      effectiveAt,
      proposedBy: callerId,
      proposedByEmail: authUser.email ?? undefined,
      proposedAt: Date.now(),
      scheduledJobId,
      previousConfig: state.config,
    });
    return { applied: false, effectiveAt };
  },
});

/** Audit + notify for an immediate (tightening) DSAR policy change. */
export const recordDsarTighten = internalMutation({
  args: {
    organizationId: v.string(),
    previousConfig: v.any(),
    nextConfig: v.any(),
    actorId: v.string(),
    actorEmail: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: args.actorId,
      actorEmail: args.actorEmail,
      actorType: 'user',
      action: 'dsar_governance_policy_tightened',
      category: 'admin',
      resourceType: 'organization',
      resourceId: args.organizationId,
      status: 'success',
      previousState: { config: args.previousConfig },
      newState: { config: args.nextConfig },
    });
    await writeNotificationForOrgs(ctx, {
      organizationIds: [args.organizationId],
      category: 'security',
      severity: 'info',
      titleKey: 'dsarPolicyTightened',
      bodyKey: 'dsarPolicyTightenedBody',
      params: { proposedBy: args.actorId },
      link: { kind: 'dsar' },
    });
    return null;
  },
});

/** Stage a loosening change + audit + notify. */
export const stageDsarLoosen = internalMutation({
  args: {
    organizationId: v.string(),
    pendingConfig: v.any(),
    effectiveAt: v.number(),
    proposedBy: v.string(),
    proposedByEmail: v.optional(v.string()),
    proposedAt: v.number(),
    scheduledJobId: v.optional(v.id('_scheduled_functions')),
    previousConfig: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert('dsarPolicyPendingChanges', {
      organizationId: args.organizationId,
      pendingConfig: args.pendingConfig,
      effectiveAt: args.effectiveAt,
      proposedBy: args.proposedBy,
      proposedByEmail: args.proposedByEmail,
      proposedAt: args.proposedAt,
      scheduledJobId: args.scheduledJobId,
    });
    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: args.proposedBy,
      actorEmail: args.proposedByEmail,
      actorType: 'user',
      action: 'dsar_governance_policy_loosen_proposed',
      category: 'admin',
      resourceType: 'organization',
      resourceId: args.organizationId,
      status: 'success',
      previousState: { config: args.previousConfig },
      newState: { config: args.pendingConfig, effectiveAt: args.effectiveAt },
    });
    await writeNotificationForOrgs(ctx, {
      organizationIds: [args.organizationId],
      category: 'security',
      severity: 'warning',
      titleKey: 'dsarPolicyLoosenProposed',
      bodyKey: 'dsarPolicyLoosenProposedBody',
      params: { proposedBy: args.proposedBy, effectiveAt: args.effectiveAt },
      link: { kind: 'dsar' },
    });
    return null;
  },
});

/**
 * Any org admin (not only owner) can cancel a pending loosening change. The
 * threat model is "someone weakening the safeguard" — the intervention should
 * NOT itself require owner privileges. No file write (the live config never
 * changed), so this stays a mutation.
 */
export const cancelPendingDsarPolicyChange = mutation({
  args: { organizationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new AppError({
        code: 'unauthenticated',
        message: 'Sign in required.',
      });
    }
    const callerId = authUser.userId;
    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: callerId,
      email: authUser.email ?? '',
      name: authUser.name,
    });
    if (member.role !== 'owner' && !isAdmin(member.role)) {
      throw new AppError({
        code: 'forbidden',
        message: 'Only org admins or the owner can cancel a pending change.',
      });
    }

    const pending = await ctx.db
      .query('dsarPolicyPendingChanges')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .first();
    if (!pending) {
      throw new AppError({
        code: 'not_found',
        message: 'No pending DSAR policy change to cancel.',
      });
    }

    if (pending.scheduledJobId) {
      await ctx.scheduler.cancel(pending.scheduledJobId);
    }
    await ctx.db.delete(pending._id);

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
      previousState: {
        config: pending.pendingConfig,
        effectiveAt: pending.effectiveAt,
        proposedBy: pending.proposedBy,
      },
      newState: { cancelledBy: callerId },
    });
    await writeNotificationForOrgs(ctx, {
      organizationIds: [args.organizationId],
      category: 'security',
      severity: 'info',
      titleKey: 'dsarPolicyLoosenCancelled',
      bodyKey: 'dsarPolicyLoosenCancelledBody',
      params: { cancelledBy: callerId },
      link: { kind: 'dsar' },
    });
    return null;
  },
});

/**
 * Scheduler-invoked when the loosen-grace window elapses. Writes the staged
 * config to the policy file (source of truth) + re-syncs the cache, then
 * deletes the pending row + audits. Idempotent: a missing or not-yet-due
 * pending row is a no-op (cancelled, already applied, or clock skew).
 */
export const applyPendingDsarPolicyChange = internalAction({
  args: { organizationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const state = await ctx.runQuery(
      internal.governance.dsar_policy.readDsarStateInternal,
      { organizationId: args.organizationId },
    );
    if (!state.pending) return null;
    if (state.pending.effectiveAt > Date.now()) return null;

    await ctx.runAction(
      internal.governance.file_actions.persistGovernancePolicyFile,
      {
        organizationId: args.organizationId,
        policyType: 'dsar_governance',
        config: state.pending.config,
      },
    );
    await ctx.runMutation(internal.governance.dsar_policy.finalizeDsarApply, {
      organizationId: args.organizationId,
      previousConfig: state.config,
      appliedConfig: state.pending.config,
    });
    return null;
  },
});

/** Delete the applied pending row + audit + notify. */
export const finalizeDsarApply = internalMutation({
  args: {
    organizationId: v.string(),
    previousConfig: v.any(),
    appliedConfig: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const pending = await ctx.db
      .query('dsarPolicyPendingChanges')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .first();
    const proposedBy = pending?.proposedBy ?? 'system';
    if (pending) await ctx.db.delete(pending._id);

    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: proposedBy,
      actorType: 'system',
      action: 'dsar_governance_policy_loosen_applied',
      category: 'admin',
      resourceType: 'organization',
      resourceId: args.organizationId,
      status: 'success',
      previousState: { config: args.previousConfig },
      newState: { config: args.appliedConfig },
    });
    await writeNotificationForOrgs(ctx, {
      organizationIds: [args.organizationId],
      category: 'security',
      severity: 'warning',
      titleKey: 'dsarPolicyLoosenApplied',
      bodyKey: 'dsarPolicyLoosenAppliedBody',
      params: { proposedBy },
      link: { kind: 'dsar' },
    });
    return null;
  },
});
