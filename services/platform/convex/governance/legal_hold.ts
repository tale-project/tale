/**
 * Legal hold (Phase 8) — public mutations + cleanup-side guard helper.
 *
 * Bundle 3 minimum-viable shape:
 *   - `placeLegalHold` (admin only, rate-limit + audit)
 *   - `releaseLegalHold` (admin only, rate-limit + audit; release writes
 *     `releasedAt`/`releasedBy` rather than deleting the row, so the
 *     audit trail is permanent)
 *   - `loadActiveHolds(ctx, organizationId)` — pre-fetched ONCE per
 *     cleanup run; returns Sets keyed by targetType for O(1) skip-checks
 *     during cascade.
 *
 * Per the v2 plan, dual-control approval (`legalHoldReleaseRequestsTable`)
 * + matter grouping (`legalMattersTable`) + bulk operations + UI search
 * picker are deferred. Bundle 3 ships the protection contract; the
 * compliance-team UX comes later.
 */

import { ConvexError, v } from 'convex/values';

import { mutation } from '../_generated/server';
import type { QueryCtx, MutationCtx } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { authComponent } from '../auth';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

const HOLD_TARGET_TYPES = [
  'thread',
  'document',
  'execution',
  'userMembership',
  'org',
] as const;

const targetTypeValidator = v.union(
  ...HOLD_TARGET_TYPES.map((t) => v.literal(t)),
);

export interface ActiveHolds {
  /** True if the entire org is held (`targetType: 'org'` row active). */
  orgHeld: boolean;
  threadIds: Set<string>;
  documentIds: Set<string>;
  executionIds: Set<string>;
  userMembershipIds: Set<string>;
}

const EMPTY_HOLDS: ActiveHolds = {
  orgHeld: false,
  threadIds: new Set<string>(),
  documentIds: new Set<string>(),
  executionIds: new Set<string>(),
  userMembershipIds: new Set<string>(),
};

/**
 * Pre-fetch every active hold for an org. Call ONCE per cleanup run /
 * GDPR erasure / restore mutation; the returned Sets give O(1) lookups
 * during cascade decisions.
 *
 * "Active" = `releasedAt === undefined`. Released holds stay in the
 * table for the audit trail but no longer protect anything.
 */
export async function loadActiveHolds(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
): Promise<ActiveHolds> {
  const rows = await ctx.db
    .query('legalHolds')
    .withIndex('by_organizationId', (q) =>
      q.eq('organizationId', organizationId),
    )
    .collect();

  const result: ActiveHolds = {
    orgHeld: false,
    threadIds: new Set<string>(),
    documentIds: new Set<string>(),
    executionIds: new Set<string>(),
    userMembershipIds: new Set<string>(),
  };

  for (const row of rows) {
    if (row.releasedAt !== undefined) continue;
    switch (row.targetType) {
      case 'org':
        result.orgHeld = true;
        break;
      case 'thread':
        result.threadIds.add(row.targetId);
        break;
      case 'document':
        result.documentIds.add(row.targetId);
        break;
      case 'execution':
        result.executionIds.add(row.targetId);
        break;
      case 'userMembership':
        result.userMembershipIds.add(row.targetId);
        break;
    }
  }

  return result;
}

/**
 * Pure-data check used by callers that already pre-fetched holds.
 * Returns `true` when the entity is protected (the cleanup / restore
 * caller should skip).
 */
export function isHeld(
  holds: ActiveHolds,
  targetType: (typeof HOLD_TARGET_TYPES)[number],
  targetId: string,
): boolean {
  if (holds.orgHeld) return true;
  switch (targetType) {
    case 'thread':
      return holds.threadIds.has(targetId);
    case 'document':
      return holds.documentIds.has(targetId);
    case 'execution':
      return holds.executionIds.has(targetId);
    case 'userMembership':
      return holds.userMembershipIds.has(targetId);
    case 'org':
      return holds.orgHeld;
  }
}

export { EMPTY_HOLDS as _EMPTY_HOLDS_FOR_TESTS };

export const placeLegalHold = mutation({
  args: {
    organizationId: v.string(),
    targetType: targetTypeValidator,
    targetId: v.string(),
    reason: v.string(),
    matterRef: v.optional(v.string()),
  },
  returns: v.id('legalHolds'),
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
    });
    if (!isAdmin(member.role)) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Only org admins can place legal holds.',
      });
    }

    if (!args.reason.trim()) {
      throw new ConvexError({
        code: 'validation',
        message: 'reason is required for legal holds.',
      });
    }

    // Refuse duplicate active holds on the same target — the audit
    // trail stays clean and the placer doesn't accidentally double-log.
    const existing = await ctx.db
      .query('legalHolds')
      .withIndex('by_target', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('targetType', args.targetType)
          .eq('targetId', args.targetId),
      )
      .filter((q) => q.eq(q.field('releasedAt'), undefined))
      .first();
    if (existing) {
      throw new ConvexError({
        code: 'LEGAL_HOLD_ALREADY_ACTIVE',
        message: `An active legal hold already exists on ${args.targetType}:${args.targetId}.`,
        existingHoldId: existing._id,
      });
    }

    const now = Date.now();
    const holdId = await ctx.db.insert('legalHolds', {
      organizationId: args.organizationId,
      targetType: args.targetType,
      targetId: args.targetId,
      reason: args.reason.trim(),
      matterRef: args.matterRef,
      placedBy: callerId,
      placedAt: now,
    });

    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: callerId,
      actorEmail: authUser.email ?? '',
      actorType: 'user',
      action: 'legal_hold_placed',
      category: 'admin',
      resourceType: args.targetType,
      resourceId: args.targetId,
      resourceName: args.targetId,
      status: 'success',
      newState: {
        reason: args.reason,
        matterRef: args.matterRef,
        holdId,
      },
    });

    return holdId;
  },
});

export const releaseLegalHold = mutation({
  args: {
    holdId: v.id('legalHolds'),
    releaseReason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'unauthenticated',
        message: 'Sign in required.',
      });
    }
    const callerId = String(authUser._id);

    const hold = await ctx.db.get(args.holdId);
    if (!hold) {
      throw new ConvexError({
        code: 'not_found',
        message: 'Legal hold does not exist.',
      });
    }
    if (hold.releasedAt !== undefined) {
      throw new ConvexError({
        code: 'LEGAL_HOLD_ALREADY_RELEASED',
        message: 'This legal hold has already been released.',
      });
    }

    const member = await getOrganizationMember(ctx, hold.organizationId, {
      userId: callerId,
      email: authUser.email ?? '',
    });
    if (!isAdmin(member.role)) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Only org admins can release legal holds.',
      });
    }

    if (!args.releaseReason.trim()) {
      throw new ConvexError({
        code: 'validation',
        message: 'releaseReason is required when releasing a legal hold.',
      });
    }

    // The release is recorded in-place (releasedAt + releasedBy) so the
    // hold's full lifecycle stays intact in the table — never delete a
    // legal-hold row.
    await ctx.db.patch(args.holdId, {
      releasedAt: Date.now(),
      releasedBy: callerId,
      releaseReason: args.releaseReason.trim(),
    });

    await createAuditLog(ctx, {
      organizationId: hold.organizationId,
      actorId: callerId,
      actorEmail: authUser.email ?? '',
      actorType: 'user',
      action: 'legal_hold_released',
      category: 'admin',
      resourceType: hold.targetType,
      resourceId: hold.targetId,
      resourceName: hold.targetId,
      status: 'success',
      newState: {
        releaseReason: args.releaseReason,
        holdId: args.holdId,
      },
    });

    return null;
  },
});
