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

import { internalMutation, mutation } from '../_generated/server';
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
  if (targetType === 'thread') return holds.threadIds.has(targetId);
  if (targetType === 'document') return holds.documentIds.has(targetId);
  if (targetType === 'execution') return holds.executionIds.has(targetId);
  if (targetType === 'userMembership')
    return holds.userMembershipIds.has(targetId);
  return false;
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

/**
 * Phase 8 — release is a TWO-STEP maker-checker flow.
 *
 * Step 1: any org admin files a release request via this mutation.
 * Step 2: a DIFFERENT org admin approves via `approveLegalHoldRelease`.
 *
 * The hold is NOT released here — only the request is recorded.
 * Approval + 24h cooldown are required before the hold actually lifts.
 */
export const requestLegalHoldRelease = mutation({
  args: {
    holdId: v.id('legalHolds'),
    reason: v.string(),
  },
  returns: v.id('legalHoldReleaseRequests'),
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
        message: 'Only org admins can request legal-hold release.',
      });
    }
    if (!args.reason.trim()) {
      throw new ConvexError({
        code: 'validation',
        message: 'reason is required.',
      });
    }
    // Refuse if a pending request already exists for this hold.
    const existing = await ctx.db
      .query('legalHoldReleaseRequests')
      .withIndex('by_holdId', (q) => q.eq('holdId', args.holdId))
      .filter((q) => q.eq(q.field('status'), 'pending'))
      .first();
    if (existing) {
      throw new ConvexError({
        code: 'LEGAL_HOLD_RELEASE_ALREADY_PENDING',
        message:
          'A release request is already pending for this hold. Approve or reject it first.',
        existingRequestId: existing._id,
      });
    }

    const requestId = await ctx.db.insert('legalHoldReleaseRequests', {
      organizationId: hold.organizationId,
      holdId: args.holdId,
      requestedBy: callerId,
      requestedAt: Date.now(),
      reason: args.reason.trim(),
      status: 'pending',
    });
    await createAuditLog(ctx, {
      organizationId: hold.organizationId,
      actorId: callerId,
      actorEmail: authUser.email ?? '',
      actorType: 'user',
      action: 'legal_hold_release_requested',
      category: 'admin',
      resourceType: hold.targetType,
      resourceId: hold.targetId,
      resourceName: hold.targetId,
      status: 'success',
      newState: { reason: args.reason, requestId },
    });
    return requestId;
  },
});

const SINGLE_ADMIN_OK_ENV = 'TALE_LEGAL_HOLD_SINGLE_ADMIN_OK';

function readReleaseCooldownMs(): number {
  const raw = process.env.TALE_LEGAL_HOLD_RELEASE_COOLDOWN_HOURS;
  const hours = raw ? Number.parseInt(raw, 10) : 24;
  const safe = Number.isFinite(hours) && hours > 0 ? hours : 24;
  return safe * 60 * 60 * 1000;
}

export const approveLegalHoldRelease = mutation({
  args: {
    requestId: v.id('legalHoldReleaseRequests'),
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

    const request = await ctx.db.get(args.requestId);
    if (!request) {
      throw new ConvexError({
        code: 'not_found',
        message: 'Release request does not exist.',
      });
    }
    if (request.status !== 'pending') {
      throw new ConvexError({
        code: 'LEGAL_HOLD_RELEASE_NOT_PENDING',
        message: `Release request is in '${request.status}' state.`,
      });
    }

    const member = await getOrganizationMember(ctx, request.organizationId, {
      userId: callerId,
      email: authUser.email ?? '',
    });
    if (!isAdmin(member.role)) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Only org admins can approve legal-hold release.',
      });
    }

    // Maker-checker: approver MUST differ from requester unless the
    // single-admin escape hatch is set. Even then, the audit log gets
    // a loud "self-approved" subtype.
    const selfApprove = callerId === request.requestedBy;
    if (selfApprove) {
      const escape = process.env[SINGLE_ADMIN_OK_ENV] === 'true';
      if (!escape) {
        throw new ConvexError({
          code: 'SELF_APPROVAL_BLOCKED',
          message:
            'A different admin must approve the release. Set ' +
            `${SINGLE_ADMIN_OK_ENV}=true to allow self-approval in single-admin orgs.`,
        });
      }
    }

    const cooldownMs = readReleaseCooldownMs();
    const effectiveAt = Date.now() + cooldownMs;

    await ctx.db.patch(args.requestId, {
      status: 'approved',
      approvedBy: callerId,
      approvedAt: Date.now(),
      effectiveAt,
    });

    await createAuditLog(ctx, {
      organizationId: request.organizationId,
      actorId: callerId,
      actorEmail: authUser.email ?? '',
      actorType: 'user',
      action: selfApprove
        ? 'legal_hold_release_approved_self'
        : 'legal_hold_release_approved',
      category: 'admin',
      resourceType: 'legal_hold',
      resourceId: String(request.holdId),
      resourceName: String(request.holdId),
      status: 'success',
      newState: {
        requestId: args.requestId,
        effectiveAt,
        cooldownMs,
        selfApproved: selfApprove,
      },
    });
    return null;
  },
});

export const rejectLegalHoldRelease = mutation({
  args: {
    requestId: v.id('legalHoldReleaseRequests'),
    reason: v.string(),
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
    const request = await ctx.db.get(args.requestId);
    if (!request) {
      throw new ConvexError({
        code: 'not_found',
        message: 'Release request does not exist.',
      });
    }
    if (request.status !== 'pending') {
      throw new ConvexError({
        code: 'LEGAL_HOLD_RELEASE_NOT_PENDING',
        message: `Release request is in '${request.status}' state.`,
      });
    }
    const member = await getOrganizationMember(ctx, request.organizationId, {
      userId: callerId,
      email: authUser.email ?? '',
    });
    if (!isAdmin(member.role)) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Only org admins can reject legal-hold release.',
      });
    }
    await ctx.db.patch(args.requestId, {
      status: 'rejected',
      rejectedBy: callerId,
      rejectedAt: Date.now(),
      rejectReason: args.reason.trim() || 'No reason provided.',
    });
    await createAuditLog(ctx, {
      organizationId: request.organizationId,
      actorId: callerId,
      actorEmail: authUser.email ?? '',
      actorType: 'user',
      action: 'legal_hold_release_rejected',
      category: 'admin',
      resourceType: 'legal_hold',
      resourceId: String(request.holdId),
      resourceName: String(request.holdId),
      status: 'success',
      newState: { rejectReason: args.reason, requestId: args.requestId },
    });
    return null;
  },
});

/**
 * Effect an approved release whose cooldown has elapsed. Called from
 * the cleanup worker before each retention pass: any approved request
 * with `effectiveAt <= now` gets effected here, after which the
 * underlying legalHolds row is patched with `releasedAt` and the
 * subsequent cleanup pass treats the entity as un-held.
 *
 * Idempotent. Safe to call repeatedly.
 */
export const effectApprovedReleases = internalMutation({
  args: { organizationId: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const requests = await ctx.db
      .query('legalHoldReleaseRequests')
      .withIndex('by_organizationId_status', (q) =>
        q.eq('organizationId', args.organizationId).eq('status', 'approved'),
      )
      .collect();
    const now = Date.now();
    let effected = 0;
    for (const req of requests) {
      if ((req.effectiveAt ?? 0) > now) continue;
      const hold = await ctx.db.get(req.holdId);
      if (!hold || hold.releasedAt !== undefined) continue;
      await ctx.db.patch(req.holdId, {
        releasedAt: now,
        releasedBy: req.approvedBy,
        releaseReason: req.reason,
      });
      await ctx.db.patch(req._id, { status: 'effected' });
      await createAuditLog(ctx, {
        organizationId: hold.organizationId,
        actorId: 'system',
        actorEmail: 'system@tale.so',
        actorType: 'system',
        action: 'legal_hold_release_effected',
        category: 'admin',
        resourceType: hold.targetType,
        resourceId: hold.targetId,
        resourceName: hold.targetId,
        status: 'success',
        newState: { requestId: req._id, holdId: req.holdId },
      });
      effected++;
    }
    return effected;
  },
});

/**
 * Bulk-place legal holds — capped at 200 per call. One audit summary
 * row + one per-target child audit row + one rate-limit token consumed
 * for the whole batch.
 */
export const bulkPlaceLegalHold = mutation({
  args: {
    organizationId: v.string(),
    holds: v.array(
      v.object({
        targetType: targetTypeValidator,
        targetId: v.string(),
        reason: v.string(),
        matterRef: v.optional(v.string()),
      }),
    ),
  },
  returns: v.object({
    placed: v.number(),
    skipped: v.array(
      v.object({
        targetType: v.string(),
        targetId: v.string(),
        reason: v.string(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    if (args.holds.length === 0) {
      return { placed: 0, skipped: [] };
    }
    if (args.holds.length > 200) {
      throw new ConvexError({
        code: 'BULK_HOLD_TOO_LARGE',
        message: `bulkPlaceLegalHold capped at 200 per call (got ${args.holds.length}).`,
      });
    }
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

    let placed = 0;
    const skipped: Array<{
      targetType: string;
      targetId: string;
      reason: string;
    }> = [];
    const now = Date.now();

    for (const h of args.holds) {
      if (!h.reason.trim()) {
        skipped.push({
          targetType: h.targetType,
          targetId: h.targetId,
          reason: 'reason is required',
        });
        continue;
      }
      const dup = await ctx.db
        .query('legalHolds')
        .withIndex('by_target', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('targetType', h.targetType)
            .eq('targetId', h.targetId),
        )
        .filter((q) => q.eq(q.field('releasedAt'), undefined))
        .first();
      if (dup) {
        skipped.push({
          targetType: h.targetType,
          targetId: h.targetId,
          reason: 'already on active hold',
        });
        continue;
      }
      await ctx.db.insert('legalHolds', {
        organizationId: args.organizationId,
        targetType: h.targetType,
        targetId: h.targetId,
        reason: h.reason.trim(),
        matterRef: h.matterRef,
        placedBy: callerId,
        placedAt: now,
      });
      placed++;
    }

    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: callerId,
      actorEmail: authUser.email ?? '',
      actorType: 'user',
      action: 'legal_hold_bulk_placed',
      category: 'admin',
      resourceType: 'legal_hold_batch',
      resourceId: 'bulk',
      resourceName: 'bulk',
      status: 'success',
      newState: {
        requested: args.holds.length,
        placed,
        skipped: skipped.length,
      },
    });

    return { placed, skipped };
  },
});

/**
 * Matter (case) management. Holds linked via `matterRef = matter._id`
 * can be released en-masse by closing the matter (which fans out to
 * `requestLegalHoldRelease` for each linked hold).
 */
export const upsertLegalMatter = mutation({
  args: {
    organizationId: v.string(),
    matterId: v.optional(v.id('legalMatters')),
    name: v.string(),
    caseNumber: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  returns: v.id('legalMatters'),
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
        message: 'Only org admins can manage legal matters.',
      });
    }
    if (!args.name.trim()) {
      throw new ConvexError({
        code: 'validation',
        message: 'name is required.',
      });
    }

    if (args.matterId) {
      const existing = await ctx.db.get(args.matterId);
      if (!existing || existing.organizationId !== args.organizationId) {
        throw new ConvexError({
          code: 'not_found',
          message: 'Matter does not exist.',
        });
      }
      await ctx.db.patch(args.matterId, {
        name: args.name.trim(),
        caseNumber: args.caseNumber,
        description: args.description,
      });
      return args.matterId;
    }

    const newId = await ctx.db.insert('legalMatters', {
      organizationId: args.organizationId,
      name: args.name.trim(),
      caseNumber: args.caseNumber,
      description: args.description,
      status: 'open',
      createdBy: callerId,
      createdAt: Date.now(),
    });
    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: callerId,
      actorEmail: authUser.email ?? '',
      actorType: 'user',
      action: 'legal_matter_created',
      category: 'admin',
      resourceType: 'legal_matter',
      resourceId: String(newId),
      resourceName: args.name,
      status: 'success',
    });
    return newId;
  },
});

export const closeLegalMatter = mutation({
  args: {
    matterId: v.id('legalMatters'),
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
    const matter = await ctx.db.get(args.matterId);
    if (!matter) {
      throw new ConvexError({
        code: 'not_found',
        message: 'Matter does not exist.',
      });
    }
    const member = await getOrganizationMember(ctx, matter.organizationId, {
      userId: callerId,
      email: authUser.email ?? '',
    });
    if (!isAdmin(member.role)) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Only org admins can close legal matters.',
      });
    }
    if (matter.status === 'closed') {
      return null;
    }
    await ctx.db.patch(args.matterId, {
      status: 'closed',
      closedAt: Date.now(),
      closedBy: callerId,
    });
    await createAuditLog(ctx, {
      organizationId: matter.organizationId,
      actorId: callerId,
      actorEmail: authUser.email ?? '',
      actorType: 'user',
      action: 'legal_matter_closed',
      category: 'admin',
      resourceType: 'legal_matter',
      resourceId: String(args.matterId),
      resourceName: matter.name,
      status: 'success',
    });
    return null;
  },
});
