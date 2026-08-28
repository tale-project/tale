import type { Sql, TransactionSql } from 'postgres';

import { isAdminRole } from '../../auth/membership.ts';
import { createAuditLog } from '../audit_logs/service.ts';

/**
 * Legal holds — the 0.5 twin of `convex/governance/legal_hold*`: the
 * preservation layer every destructive path consults BEFORE deleting.
 * Placement targets after the User+Org pivot are `org` (nuclear halt) and
 * `userMembership` (custodian cascade via the row author's user id).
 * Release is maker-checker: any admin requests, a DIFFERENT admin approves
 * (5-min anti-chaining delay; `TALE_LEGAL_HOLD_SINGLE_ADMIN_OK=true` is the
 * single-admin escape), then a cooldown (default 24h,
 * `TALE_LEGAL_HOLD_RELEASE_COOLDOWN_HOURS`) before the daily effect sweep
 * actually lifts it. The 0.4 claim table is a partial-unique index here.
 */

type Db = Sql | TransactionSql;

export class LegalHoldError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409;
  constructor(
    code: string,
    message: string,
    status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = 'LegalHoldError';
    this.code = code;
    this.status = status;
  }
}

const SINGLE_ADMIN_OK_ENV = 'TALE_LEGAL_HOLD_SINGLE_ADMIN_OK';
const RELEASE_APPROVAL_MIN_DELAY_MS = 5 * 60 * 1000;

function readReleaseCooldownMs(): number {
  const raw = process.env.TALE_LEGAL_HOLD_RELEASE_COOLDOWN_HOURS;
  const hours = raw ? Number.parseInt(raw, 10) : 24;
  const safe = Number.isFinite(hours) && hours > 0 ? hours : 24;
  return safe * 60 * 60 * 1000;
}

export interface ActiveHolds {
  orgHeld: boolean;
  userMembershipIds: Set<string>;
}

/** Pre-fetch every active hold for an org — call once per cleanup run /
 * restore mutation; the sets give O(1) cascade decisions. */
export async function loadActiveHolds(
  db: Db,
  organizationId: string,
): Promise<ActiveHolds> {
  const rows = await db<{ targetType: string; targetId: string }[]>`
    SELECT target_type AS "targetType", target_id AS "targetId"
    FROM app.legal_holds
    WHERE org_id = ${organizationId} AND released_at_ms IS NULL
  `;
  const result: ActiveHolds = {
    orgHeld: false,
    userMembershipIds: new Set<string>(),
  };
  for (const row of rows) {
    if (row.targetType === 'org') result.orgHeld = true;
    else if (row.targetType === 'userMembership') {
      result.userMembershipIds.add(row.targetId);
    }
  }
  return result;
}

export type GuardedTargetType =
  | 'thread'
  | 'document'
  | 'contact'
  | 'conversation'
  | 'folder'
  | 'userMembership'
  | 'org';

/**
 * The per-mutation gate for destructive paths: throws when the org is
 * under an active hold, or when `authorUserId` is on a custodian hold.
 * `targetType`/`targetId` only shape the error copy.
 */
export async function assertNotHeld(
  db: Db,
  organizationId: string,
  targetType: GuardedTargetType,
  targetId: string,
  preloaded?: ActiveHolds,
  authorUserId?: string,
): Promise<void> {
  const holds = preloaded ?? (await loadActiveHolds(db, organizationId));
  if (holds.orgHeld) {
    throw new LegalHoldError(
      'LEGAL_HOLD_ACTIVE',
      'This organization is under an active legal hold. Release the hold before deleting.',
      409,
    );
  }
  if (authorUserId !== undefined && holds.userMembershipIds.has(authorUserId)) {
    throw new LegalHoldError(
      'LEGAL_HOLD_ACTIVE',
      `This ${targetType} is owned by a user on a custodian legal hold. Release the user-level hold before deleting.`,
      409,
    );
  }
}

/** Placement-time label snapshot + same-org assertion for the target. */
async function resolveAndAssertTarget(
  db: Db,
  organizationId: string,
  targetType: 'org' | 'userMembership',
  targetId: string,
): Promise<string> {
  if (targetType === 'org') {
    if (targetId !== organizationId) {
      throw new LegalHoldError(
        'CROSS_ORG_TARGET',
        'An org hold must target the placing organization itself',
        403,
      );
    }
    const rows = await db<{ name: string | null }[]>`
      SELECT "name" FROM "organization" WHERE "id" = ${targetId} LIMIT 1
    `;
    return rows[0]?.name ?? targetId;
  }
  const members = await db<{ email: string | null }[]>`
    SELECT u."email" FROM "member" m
    LEFT JOIN "user" u ON u."id" = m."userId"
    WHERE m."organizationId" = ${organizationId}
      AND m."userId" = ${targetId}
    LIMIT 1
  `;
  if (members.length === 0) {
    throw new LegalHoldError(
      'TARGET_NOT_FOUND',
      'The user is not a member of this organization',
      404,
    );
  }
  return members[0]?.email ?? targetId;
}

async function requireAdmin(
  db: Db,
  organizationId: string,
  userId: string,
): Promise<void> {
  const rows = await db<{ role: string }[]>`
    SELECT "role" FROM "member"
    WHERE "organizationId" = ${organizationId} AND "userId" = ${userId}
    LIMIT 1
  `;
  if (rows[0] === undefined || !isAdminRole(rows[0].role)) {
    throw new LegalHoldError(
      'FORBIDDEN',
      'Only org admins manage legal holds',
      403,
    );
  }
}

export async function placeLegalHold(
  sql: Sql,
  args: {
    organizationId: string;
    actorId: string;
    actorEmail?: string;
    targetType: 'org' | 'userMembership';
    targetId: string;
    reason: string;
  },
): Promise<string> {
  await requireAdmin(sql, args.organizationId, args.actorId);
  const reason = args.reason.trim();
  if (reason.length === 0) {
    throw new LegalHoldError('REASON_REQUIRED', 'A reason is required');
  }
  return sql.begin(async (tx) => {
    const targetLabel = await resolveAndAssertTarget(
      tx,
      args.organizationId,
      args.targetType,
      args.targetId,
    );
    let holdId: string;
    try {
      const rows = await tx<{ id: string }[]>`
        INSERT INTO app.legal_holds (
          org_id, target_type, target_id, target_label, reason, placed_by,
          placed_at_ms
        ) VALUES (
          ${args.organizationId}, ${args.targetType}, ${args.targetId},
          ${targetLabel}, ${reason}, ${args.actorId}, ${Date.now()}
        ) RETURNING id
      `;
      holdId = rows[0]?.id ?? '';
    } catch (error) {
      // The partial-unique index IS the one-active-hold-per-target claim.
      if (
        error !== null &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === '23505'
      ) {
        throw new LegalHoldError(
          'LEGAL_HOLD_ALREADY_ACTIVE',
          'An active hold already exists for this target',
          409,
        );
      }
      throw error;
    }
    await createAuditLog(tx, {
      organizationId: args.organizationId,
      actorId: args.actorId,
      ...(args.actorEmail !== undefined ? { actorEmail: args.actorEmail } : {}),
      actorType: 'user',
      action: 'legal_hold_placed',
      category: 'admin',
      resourceType: args.targetType,
      resourceId: args.targetId,
      resourceName: targetLabel,
      status: 'success',
      newState: { reason, holdId },
    });
    return holdId;
  });
}

export async function requestLegalHoldRelease(
  sql: Sql,
  args: {
    organizationId: string;
    actorId: string;
    actorEmail?: string;
    holdId: string;
    reason: string;
  },
): Promise<string> {
  await requireAdmin(sql, args.organizationId, args.actorId);
  return sql.begin(async (tx) => {
    const holds = await tx<{ releasedAt: number | null }[]>`
      SELECT released_at_ms::float8 AS "releasedAt" FROM app.legal_holds
      WHERE id = ${args.holdId} AND org_id = ${args.organizationId}
      FOR UPDATE
    `;
    if (holds.length === 0) {
      throw new LegalHoldError('HOLD_NOT_FOUND', 'Hold not found', 404);
    }
    if (holds[0]?.releasedAt !== null) {
      throw new LegalHoldError(
        'LEGAL_HOLD_ALREADY_RELEASED',
        'This hold is already released',
        409,
      );
    }
    const outstanding = await tx<{ id: string }[]>`
      SELECT id FROM app.legal_hold_release_requests
      WHERE hold_id = ${args.holdId} AND status IN ('pending', 'approved')
      LIMIT 1
    `;
    if (outstanding.length > 0) {
      throw new LegalHoldError(
        'LEGAL_HOLD_RELEASE_ALREADY_PENDING',
        'A release request is already pending for this hold. Approve or reject it first.',
        409,
      );
    }
    const rows = await tx<{ id: string }[]>`
      INSERT INTO app.legal_hold_release_requests (
        org_id, hold_id, requested_by, requested_at_ms, reason, status
      ) VALUES (
        ${args.organizationId}, ${args.holdId}, ${args.actorId},
        ${Date.now()}, ${args.reason.trim()}, 'pending'
      ) RETURNING id
    `;
    const requestId = rows[0]?.id ?? '';
    await createAuditLog(tx, {
      organizationId: args.organizationId,
      actorId: args.actorId,
      ...(args.actorEmail !== undefined ? { actorEmail: args.actorEmail } : {}),
      actorType: 'user',
      action: 'legal_hold_release_requested',
      category: 'admin',
      resourceType: 'legal_hold',
      resourceId: args.holdId,
      resourceName: args.holdId,
      status: 'success',
      newState: { requestId, reason: args.reason },
    });
    return requestId;
  });
}

export async function approveLegalHoldRelease(
  sql: Sql,
  args: {
    organizationId: string;
    actorId: string;
    actorEmail?: string;
    requestId: string;
  },
): Promise<{ effectiveAt: number }> {
  await requireAdmin(sql, args.organizationId, args.actorId);
  return sql.begin(async (tx) => {
    const requests = await tx<
      { requestedBy: string; requestedAt: number; status: string }[]
    >`
      SELECT requested_by AS "requestedBy",
             requested_at_ms::float8 AS "requestedAt", status
      FROM app.legal_hold_release_requests
      WHERE id = ${args.requestId} AND org_id = ${args.organizationId}
      FOR UPDATE
    `;
    const request = requests[0];
    if (!request) {
      throw new LegalHoldError('REQUEST_NOT_FOUND', 'Request not found', 404);
    }
    if (request.status !== 'pending') {
      throw new LegalHoldError(
        'REQUEST_NOT_PENDING',
        'This request was already decided',
        409,
      );
    }
    const selfApprove = args.actorId === request.requestedBy;
    if (selfApprove) {
      if (process.env[SINGLE_ADMIN_OK_ENV] !== 'true') {
        throw new LegalHoldError(
          'SELF_APPROVAL_BLOCKED',
          `A different admin must approve the release. Set ${SINGLE_ADMIN_OK_ENV}=true to allow self-approval in single-admin orgs.`,
          403,
        );
      }
    } else {
      // The min delay defeats the chained-call attack (one admin requests
      // and approves in the same automation flow).
      const elapsed = Date.now() - request.requestedAt;
      if (elapsed < RELEASE_APPROVAL_MIN_DELAY_MS) {
        throw new LegalHoldError(
          'APPROVAL_TOO_SOON',
          `Approval requires at least ${RELEASE_APPROVAL_MIN_DELAY_MS / 60_000} min after the request.`,
          409,
        );
      }
      // Re-check the requester is STILL an admin — a demoted requester
      // must not retroactively gate a destructive change.
      const requester = await tx<{ role: string }[]>`
        SELECT "role" FROM "member"
        WHERE "organizationId" = ${args.organizationId}
          AND "userId" = ${request.requestedBy}
        LIMIT 1
      `;
      if (requester[0] === undefined || !isAdminRole(requester[0].role)) {
        throw new LegalHoldError(
          'REQUESTER_NO_LONGER_ADMIN',
          'The original requester is no longer an admin of this org. Reject this request and have a current admin file a fresh one.',
          409,
        );
      }
    }
    const effectiveAt = Date.now() + readReleaseCooldownMs();
    await tx`
      UPDATE app.legal_hold_release_requests SET
        status = 'approved', approved_by = ${args.actorId},
        approved_at_ms = ${Date.now()}, effective_at_ms = ${effectiveAt}
      WHERE id = ${args.requestId}
    `;
    await createAuditLog(tx, {
      organizationId: args.organizationId,
      actorId: args.actorId,
      ...(args.actorEmail !== undefined ? { actorEmail: args.actorEmail } : {}),
      actorType: 'user',
      action: selfApprove
        ? 'legal_hold_release_self_approved'
        : 'legal_hold_release_approved',
      category: 'admin',
      resourceType: 'legal_hold_release_request',
      resourceId: args.requestId,
      resourceName: args.requestId,
      status: 'success',
      newState: { effectiveAt },
    });
    return { effectiveAt };
  });
}

export async function rejectLegalHoldRelease(
  sql: Sql,
  args: {
    organizationId: string;
    actorId: string;
    actorEmail?: string;
    requestId: string;
  },
): Promise<void> {
  await requireAdmin(sql, args.organizationId, args.actorId);
  await sql.begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`
      UPDATE app.legal_hold_release_requests SET
        status = 'rejected', rejected_by = ${args.actorId},
        rejected_at_ms = ${Date.now()}
      WHERE id = ${args.requestId} AND org_id = ${args.organizationId}
        AND status = 'pending'
      RETURNING id
    `;
    if (rows.length === 0) {
      throw new LegalHoldError(
        'REQUEST_NOT_PENDING',
        'Request not found or already decided',
        409,
      );
    }
    await createAuditLog(tx, {
      organizationId: args.organizationId,
      actorId: args.actorId,
      ...(args.actorEmail !== undefined ? { actorEmail: args.actorEmail } : {}),
      actorType: 'user',
      action: 'legal_hold_release_rejected',
      category: 'admin',
      resourceType: 'legal_hold_release_request',
      resourceId: args.requestId,
      resourceName: args.requestId,
      status: 'success',
    });
  });
}

/** The daily effect sweep: approved requests past their cooldown release
 * their hold (audited as the system actor). Cross-org by design. */
export async function effectApprovedReleases(sql: Sql): Promise<number> {
  const due = await sql<
    {
      id: string;
      organizationId: string;
      holdId: string;
      approvedBy: string | null;
      reason: string;
    }[]
  >`
    SELECT r.id, r.org_id AS "organizationId", r.hold_id AS "holdId",
           r.approved_by AS "approvedBy", r.reason
    FROM app.legal_hold_release_requests r
    JOIN app.legal_holds h ON h.id = r.hold_id
    WHERE r.status = 'approved' AND r.effective_at_ms <= ${Date.now()}
      AND h.released_at_ms IS NULL
    LIMIT 100
  `;
  let effected = 0;
  for (const request of due) {
    await sql.begin(async (tx) => {
      const released = await tx<{ targetType: string; targetId: string }[]>`
        UPDATE app.legal_holds SET
          released_at_ms = ${Date.now()},
          released_by = ${request.approvedBy},
          release_reason = ${request.reason}
        WHERE id = ${request.holdId} AND released_at_ms IS NULL
        RETURNING target_type AS "targetType", target_id AS "targetId"
      `;
      if (released.length === 0) return;
      await tx`
        UPDATE app.legal_hold_release_requests SET status = 'effected'
        WHERE id = ${request.id}
      `;
      await createAuditLog(tx, {
        organizationId: request.organizationId,
        actorId: 'system',
        actorType: 'system',
        action: 'legal_hold_release_effected',
        category: 'admin',
        resourceType: released[0]?.targetType ?? 'legal_hold',
        resourceId: released[0]?.targetId ?? request.holdId,
        resourceName: request.holdId,
        status: 'success',
        newState: { requestId: request.id, holdId: request.holdId },
      });
      effected += 1;
    });
  }
  return effected;
}

export interface LegalHoldRow {
  id: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  reason: string;
  placedBy: string;
  placedAt: number;
  releasedAt: number | null;
  pendingRelease: boolean;
}

export async function listLegalHolds(
  sql: Sql,
  organizationId: string,
): Promise<LegalHoldRow[]> {
  return sql<LegalHoldRow[]>`
    SELECT h.id, h.target_type AS "targetType", h.target_id AS "targetId",
           h.target_label AS "targetLabel", h.reason,
           h.placed_by AS "placedBy", h.placed_at_ms::float8 AS "placedAt",
           h.released_at_ms::float8 AS "releasedAt",
           EXISTS (
             SELECT 1 FROM app.legal_hold_release_requests r
             WHERE r.hold_id = h.id AND r.status IN ('pending', 'approved')
           ) AS "pendingRelease"
    FROM app.legal_holds h
    WHERE h.org_id = ${organizationId}
    ORDER BY h.placed_at_ms DESC
    LIMIT 200
  `;
}
