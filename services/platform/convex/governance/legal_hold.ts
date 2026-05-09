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

import { getString, isRecord } from '../../lib/utils/type-guards';
import { components } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { internalMutation, mutation } from '../_generated/server';
import type { QueryCtx, MutationCtx } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { authComponent } from '../auth';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';

/**
 * Hold target types that the **write-side** mutations (placeLegalHold,
 * bulkPlaceLegalHold) accept. Per round-2 V4 + the user-pivot in
 * commit `42de58846`: in practice only `org` (whole-tenant freeze) and
 * `userMembership` (custodian-cascade preservation) are operator-facing.
 *
 * `thread` / `document` / `execution` were modeled in the original
 * fine-grained hold design but never wired into the place-hold UI;
 * `loadActiveHolds` and `assertNotHeld` consequently never saw rows
 * of those types. This narrowing makes the dead state explicit.
 *
 * The **read-side** validator in `legal_hold_queries.ts` stays
 * permissive so admin UIs can still render any historical
 * `(legacy)` rows that pre-date this change.
 */
const HOLD_TARGET_TYPES = ['userMembership', 'org'] as const;

/**
 * Escape hatch for single-admin deployments where the maker-checker
 * release flow can't be exercised (different-admin requirement +
 * 5-minute min delay). When set, `approveLegalHoldRelease` allows
 * self-approval and emits a loud `legal_hold_release_approved_self`
 * audit subtype. Placement gates do NOT consult this — placement is
 * RBAC + audit only, matching industry practice (Microsoft Purview /
 * Google Vault / Relativity).
 */
const SINGLE_ADMIN_OK_ENV = 'TALE_LEGAL_HOLD_SINGLE_ADMIN_OK';

/**
 * `legalHolds.matterRef` is a free-text string (no schema-level FK to
 * `legalMatters` because legacy rows pre-date the table). Validate at
 * write time that the supplied ref does point at an existing matter
 * in the same org, so `closeLegalMatter`'s fan-out cannot be silently
 * orphaned by a typo.
 */
async function assertMatterRefBelongsToOrg(
  ctx: MutationCtx,
  matterRef: string,
  organizationId: string,
): Promise<void> {
  // Convex's `ctx.db.get` would throw on an invalid Id format; we
  // accept any string from the wire and degrade to a not-found error.
  let matter: Awaited<ReturnType<typeof ctx.db.get<'legalMatters'>>> | null =
    null;
  try {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- matterRef is a string from the wire; the wrapping try/catch handles a non-Id input
    matter = await ctx.db.get(matterRef as Id<'legalMatters'>);
  } catch {
    matter = null;
  }
  if (!matter || matter.organizationId !== organizationId) {
    throw new ConvexError({
      code: 'MATTER_NOT_FOUND',
      message: `matterRef does not point at an existing matter in this organization.`,
      matterRef,
    });
  }
}

const targetTypeValidator = v.union(
  ...HOLD_TARGET_TYPES.map((t) => v.literal(t)),
);

export interface ActiveHolds {
  /** True if the entire org is held (`targetType: 'org'` row active). */
  orgHeld: boolean;
  /**
   * User ids on an active custodian hold. Cascade rule: every artifact
   * whose author/owner is in this set is preserved (delete + restore
   * paths refuse via `assertNotHeld(... authorUserId)`).
   */
  userMembershipIds: Set<string>;
}

const EMPTY_HOLDS: ActiveHolds = {
  orgHeld: false,
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
    userMembershipIds: new Set<string>(),
  };

  for (const row of rows) {
    if (row.releasedAt !== undefined) continue;
    switch (row.targetType) {
      case 'org':
        result.orgHeld = true;
        break;
      case 'userMembership':
        result.userMembershipIds.add(row.targetId);
        break;
      // Legacy thread/document/execution rows (pre-User+Org pivot) are
      // intentionally ignored. The write-side validator no longer
      // accepts them, and the read-side UI tags them `(legacy)`.
    }
  }

  return result;
}

/**
 * Pure-data check used by callers that already pre-fetched holds.
 * Returns `true` when the entity is protected (the cleanup / restore
 * caller should skip).
 *
 * After the hold-type narrowing (commit-2 of the data-protection bundle)
 * only `org` and `userMembership` are valid placement targets. The
 * `userMembership` branch is the custodian cascade — match against the
 * row's author/owner user id rather than a "row's targetId" concept.
 */
export function isHeld(
  holds: ActiveHolds,
  targetType: (typeof HOLD_TARGET_TYPES)[number],
  targetId: string,
): boolean {
  if (holds.orgHeld) return true;
  if (targetType === 'userMembership')
    return holds.userMembershipIds.has(targetId);
  return false;
}

export { EMPTY_HOLDS as _EMPTY_HOLDS_FOR_TESTS };

/**
 * Resolve `targetId` against its underlying table to (a) assert the
 * row's `organizationId` matches the placer's org and (b) return a
 * human-readable label for the snapshot stored on the hold row.
 *
 * Both responsibilities share the same DB read so the write path stays
 * single-pass — admin UIs avoid an N+1 join across heterogeneous entity
 * tables on every list query.
 *
 * Cross-org gate rationale: without (a), an admin in org A can plant a
 * `legalHolds` row pointing at an org B thread / doc. The row is inert
 * against cleanup (which runs per-org) but shows as "active" in the
 * placer's UI and confuses forensics (round-2 v20 / M9).
 *
 * Label rules per type — falls back to `targetId` when the natural
 * label field is empty:
 *   - org            → organizations.name (Better Auth)
 *   - userMembership → users.email (Better Auth)
 *
 * `thread`/`document`/`execution` placement was deprecated by the
 * User+Org pivot (commit `42de58846`); the write-side validator no
 * longer accepts them, so the per-type lookups for those have been
 * removed.
 */
async function resolveAndAssertTarget(
  ctx: MutationCtx,
  targetType: (typeof HOLD_TARGET_TYPES)[number],
  targetId: string,
  organizationId: string,
): Promise<{ label: string }> {
  if (targetType === 'org') {
    if (targetId !== organizationId) {
      throw new ConvexError({
        code: 'TARGET_ORG_MISMATCH',
        message: `org-scoped hold targetId must equal organizationId.`,
      });
    }
    const orgRes = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'organization',
      where: [{ field: '_id', value: organizationId, operator: 'eq' }],
    });
    const orgName = isRecord(orgRes) ? getString(orgRes, 'name') : undefined;
    return { label: orgName?.trim() || targetId };
  }
  if (targetType === 'userMembership') {
    // Validate via the Better Auth `member` table — the userId must have
    // an active membership in this organization. Without this, a hold
    // could be planted on an arbitrary userId and silently never match
    // any cleanup gate. See `audit_logs/internal_queries.ts:118` for
    // the same lookup pattern.
    const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'member',
      paginationOpts: { cursor: null, numItems: 1 },
      where: [
        { field: 'organizationId', value: organizationId, operator: 'eq' },
        { field: 'userId', value: targetId, operator: 'eq' },
      ],
    });
    if (!result?.page?.length) {
      throw new ConvexError({
        code: 'TARGET_NOT_IN_ORG',
        message: `user ${targetId} is not a member of this organization.`,
        targetType,
        targetId,
      });
    }
    // Resolve the user's email for the label snapshot. A best-effort
    // lookup — if the user row is missing or has no email (shouldn't
    // happen for an active membership, but Better Auth's adapter
    // doesn't enforce relational integrity at the schema layer), the
    // label degrades to the raw userId rather than throwing.
    const userRes = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'user',
      where: [{ field: '_id', value: targetId, operator: 'eq' }],
    });
    const email = isRecord(userRes) ? getString(userRes, 'email') : undefined;
    return { label: email?.trim() || targetId };
  }
  // Exhaustive — TS narrows to never; runtime fallback for forward-compat.
  return { label: targetId };
}

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
      // Round-2 / M13: emit a `denied` audit row before throwing so
      // attempted privilege escalations are visible to operators
      // through the audit dashboard, not just inferred from a 4xx.
      await createAuditLog(ctx, {
        organizationId: args.organizationId,
        actorId: callerId,
        actorEmail: authUser.email ?? '',
        actorType: 'user',
        action: 'legal_hold_place_denied',
        category: 'admin',
        resourceType: args.targetType,
        resourceId: args.targetId,
        status: 'denied',
        errorMessage: 'caller is not an org admin',
        metadata: { role: member.role },
      });
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

    // `targetType: 'org'` is the nuclear "halt all retention" hold.
    // Placement is admin-gated + audited; dual-control on placement is
    // not industry-standard (Microsoft Purview, Google Vault, Relativity
    // all gate on RBAC alone) because over-protection is recoverable
    // while under-protection is the real compliance risk. The dangerous
    // direction — release — keeps its dual-control flow below.

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

    // FK gate: matterRef is stored as `String(matter._id)`. Reject any
    // ref that does not resolve to an existing matter in the same org
    // — `closeLegalMatter`'s fan-out depends on the index match, so a
    // typo silently orphans the hold from its matter.
    if (args.matterRef !== undefined) {
      await assertMatterRefBelongsToOrg(
        ctx,
        args.matterRef,
        args.organizationId,
      );
    }

    // Cross-org gate + label snapshot: resolve `targetId` to verify it
    // belongs to the placing org and capture a human-readable label
    // (email / title / slug) frozen at write time. See the helper for
    // the cross-org rationale and per-type label rules.
    const { label: targetLabel } = await resolveAndAssertTarget(
      ctx,
      args.targetType,
      args.targetId,
      args.organizationId,
    );

    const now = Date.now();
    const holdId = await ctx.db.insert('legalHolds', {
      organizationId: args.organizationId,
      targetType: args.targetType,
      targetId: args.targetId,
      targetLabel,
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
    organizationId: v.string(),
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
    // Authorize BEFORE reading the hold row. The previous order let any
    // authenticated user fetch any hold's metadata (reason, targetType,
    // targetId, organizationId) by passing a guessed holdId, then learned
    // from the resulting error whether the id existed. Membership-first
    // means the caller must declare and belong to the org before any
    // read of the hold record happens.
    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: callerId,
      email: authUser.email ?? '',
    });
    if (!isAdmin(member.role)) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Only org admins can request legal-hold release.',
      });
    }
    const hold = await ctx.db.get(args.holdId);
    if (!hold || hold.organizationId !== args.organizationId) {
      // Treat cross-org as "not found" so existence does not leak across
      // tenant boundaries.
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
    if (!args.reason.trim()) {
      throw new ConvexError({
        code: 'validation',
        message: 'reason is required.',
      });
    }
    // Refuse if a pending OR approved-cooldown-pending request already
    // exists for this hold. Approved-but-not-effected requests are still
    // outstanding state — letting a second pending request file in
    // parallel produces a confusing dual-request UI and muddies the
    // audit trail. Mirror `closeLegalMatter`'s same filter.
    const existing = await ctx.db
      .query('legalHoldReleaseRequests')
      .withIndex('by_holdId', (q) => q.eq('holdId', args.holdId))
      .filter((q) =>
        q.or(
          q.eq(q.field('status'), 'pending'),
          q.eq(q.field('status'), 'approved'),
        ),
      )
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

/**
 * Minimum elapsed time between a release request and its approval.
 * Defeats the chained-call attack where one admin requests AND a
 * second admin instantly approves (e.g. social-engineering an admin
 * into double-clicking). 5-min default is short enough not to bother
 * legitimate workflows, long enough to interrupt automation.
 */
const RELEASE_APPROVAL_MIN_DELAY_MS = 5 * 60 * 1000;

function readReleaseCooldownMs(): number {
  const raw = process.env.TALE_LEGAL_HOLD_RELEASE_COOLDOWN_HOURS;
  const hours = raw ? Number.parseInt(raw, 10) : 24;
  const safe = Number.isFinite(hours) && hours > 0 ? hours : 24;
  return safe * 60 * 60 * 1000;
}

export const approveLegalHoldRelease = mutation({
  args: {
    organizationId: v.string(),
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

    // Authorize before reading the request row — caller must declare
    // and belong to the org first, so request metadata never leaks
    // across tenants on a guessed requestId.
    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: callerId,
      email: authUser.email ?? '',
    });
    if (!isAdmin(member.role)) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Only org admins can approve legal-hold release.',
      });
    }

    const request = await ctx.db.get(args.requestId);
    if (!request || request.organizationId !== args.organizationId) {
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

    // Min delay defeats the chained-call attack (one admin requests +
    // approves in the same automation flow). Skip for self-approve
    // since the escape hatch above already opted out of dual control;
    // adding a delay there only obstructs legitimate single-admin
    // operators without a real security benefit.
    if (!selfApprove) {
      const elapsed = Date.now() - request.requestedAt;
      if (elapsed < RELEASE_APPROVAL_MIN_DELAY_MS) {
        const remainingMs = RELEASE_APPROVAL_MIN_DELAY_MS - elapsed;
        throw new ConvexError({
          code: 'APPROVAL_TOO_SOON',
          message: `Approval requires at least ${RELEASE_APPROVAL_MIN_DELAY_MS / 1000 / 60} min after the request. Try again in ${Math.ceil(remainingMs / 1000)}s.`,
          remainingMs,
        });
      }

      // Re-check the requester is still an org admin at approval time.
      // A demoted/removed requester whose request lingered loses the
      // ability to retroactively gate a destructive change.
      try {
        const requesterMember = await getOrganizationMember(
          ctx,
          request.organizationId,
          { userId: request.requestedBy, email: '' },
        );
        if (!isAdmin(requesterMember.role)) {
          throw new ConvexError({
            code: 'REQUESTER_NO_LONGER_ADMIN',
            message:
              'The original requester is no longer an admin of this org. ' +
              'Reject this request and have a current admin file a fresh one.',
          });
        }
      } catch (err) {
        if (err instanceof ConvexError) throw err;
        // Membership lookup failed (caller removed entirely) — same
        // treatment as demoted.
        throw new ConvexError({
          code: 'REQUESTER_NO_LONGER_ADMIN',
          message:
            'The original requester is no longer a member of this org. ' +
            'Reject this request and have a current admin file a fresh one.',
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
    organizationId: v.string(),
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
    // Authorize before reading the request — same rationale as
    // `approveLegalHoldRelease`.
    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId: callerId,
      email: authUser.email ?? '',
    });
    if (!isAdmin(member.role)) {
      throw new ConvexError({
        code: 'forbidden',
        message: 'Only org admins can reject legal-hold release.',
      });
    }
    const request = await ctx.db.get(args.requestId);
    if (!request || request.organizationId !== args.organizationId) {
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
      if (h.matterRef !== undefined) {
        try {
          await assertMatterRefBelongsToOrg(
            ctx,
            h.matterRef,
            args.organizationId,
          );
        } catch (err) {
          skipped.push({
            targetType: h.targetType,
            targetId: h.targetId,
            reason:
              err instanceof ConvexError
                ? 'matterRef not found in this organization'
                : 'matterRef validation failed',
          });
          continue;
        }
      }
      let targetLabel: string;
      try {
        ({ label: targetLabel } = await resolveAndAssertTarget(
          ctx,
          h.targetType,
          h.targetId,
          args.organizationId,
        ));
      } catch (err) {
        skipped.push({
          targetType: h.targetType,
          targetId: h.targetId,
          reason:
            err instanceof ConvexError
              ? `target not in this organization`
              : 'target validation failed',
        });
        continue;
      }
      const holdId = await ctx.db.insert('legalHolds', {
        organizationId: args.organizationId,
        targetType: h.targetType,
        targetId: h.targetId,
        targetLabel,
        reason: h.reason.trim(),
        matterRef: h.matterRef,
        placedBy: callerId,
        placedAt: now,
      });
      // Per-target audit row matching the single-place pattern. Without
      // these, the bulk path leaves no per-hold record in the chain — only
      // the summary row below — so a regulator asking "who placed this
      // hold?" can only see "someone bulk-placed N at time T".
      await createAuditLog(ctx, {
        organizationId: args.organizationId,
        actorId: callerId,
        actorEmail: authUser.email ?? '',
        actorType: 'user',
        action: 'legal_hold_placed',
        category: 'admin',
        resourceType: h.targetType,
        resourceId: h.targetId,
        resourceName: h.targetId,
        status: 'success',
        newState: {
          reason: h.reason.trim(),
          matterRef: h.matterRef,
          holdId,
          via: 'bulk',
        },
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
      const newName = args.name.trim();
      await ctx.db.patch(args.matterId, {
        name: newName,
        caseNumber: args.caseNumber,
        description: args.description,
      });
      // Audit the rename / case-number change so a regulator review
      // can reconstruct who changed what about the matter, not just
      // who created it. Only fields editable here are reported.
      await createAuditLog(ctx, {
        organizationId: args.organizationId,
        actorId: callerId,
        actorEmail: authUser.email ?? '',
        actorType: 'user',
        action: 'legal_matter_updated',
        category: 'admin',
        resourceType: 'legal_matter',
        resourceId: String(args.matterId),
        resourceName: newName,
        status: 'success',
        previousState: {
          name: existing.name,
          caseNumber: existing.caseNumber,
          description: existing.description,
        },
        newState: {
          name: newName,
          caseNumber: args.caseNumber,
          description: args.description,
        },
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
    /** Reason recorded on every fanned-out release request. */
    releaseReason: v.optional(v.string()),
  },
  returns: v.object({
    /** Number of release requests filed for linked active holds. */
    releaseRequestsFiled: v.number(),
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
      return { releaseRequestsFiled: 0 };
    }

    // Fan out: every active hold linked to this matter gets a pending
    // release request. Approval still requires a second admin via
    // approveLegalHoldRelease (matter-close does NOT auto-release —
    // dual-control survives). Skips holds that already have a pending
    // or approved request. Uses by_organizationId_matterRef so the
    // lookup is indexed.
    const linkedHolds = await ctx.db
      .query('legalHolds')
      .withIndex('by_organizationId_matterRef', (q) =>
        q
          .eq('organizationId', matter.organizationId)
          .eq('matterRef', String(args.matterId)),
      )
      .collect();
    const reason =
      args.releaseReason?.trim() || `matter closed: ${matter.name}`;
    const now = Date.now();
    let releaseRequestsFiled = 0;
    for (const hold of linkedHolds) {
      if (hold.releasedAt !== undefined) continue;
      const existingReq = await ctx.db
        .query('legalHoldReleaseRequests')
        .withIndex('by_holdId', (q) => q.eq('holdId', hold._id))
        .filter((q) =>
          q.or(
            q.eq(q.field('status'), 'pending'),
            q.eq(q.field('status'), 'approved'),
          ),
        )
        .first();
      if (existingReq) continue;
      await ctx.db.insert('legalHoldReleaseRequests', {
        organizationId: matter.organizationId,
        holdId: hold._id,
        requestedBy: callerId,
        requestedAt: now,
        reason,
        status: 'pending',
      });
      releaseRequestsFiled++;
    }

    await ctx.db.patch(args.matterId, {
      status: 'closed',
      closedAt: now,
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
      newState: {
        linkedHolds: linkedHolds.length,
        releaseRequestsFiled,
      },
    });
    return { releaseRequestsFiled };
  },
});
