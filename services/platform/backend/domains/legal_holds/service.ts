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

/** The 0.4 `listActiveHoldTargetIds` projection — the member-readable
 * badge read: org-wide flag + direct holds of one target type, with the
 * custodian cascade folded in for thread/document badges (entities whose
 * AUTHOR is on a userMembership hold). Nothing else leaks. */
export async function listActiveHoldTargetIds(
  db: Db,
  organizationId: string,
  targetType: string,
): Promise<{ orgHeld: boolean; targetIds: string[] }> {
  const rows = await db<{ targetType: string; targetId: string }[]>`
    SELECT target_type AS "targetType", target_id AS "targetId"
    FROM app.legal_holds
    WHERE org_id = ${organizationId} AND released_at_ms IS NULL
  `;
  let orgHeld = false;
  const ids = new Set<string>();
  const heldUserIds: string[] = [];
  for (const row of rows) {
    if (row.targetType === 'org') orgHeld = true;
    else if (row.targetType === targetType) ids.add(row.targetId);
    if (row.targetType === 'userMembership') heldUserIds.push(row.targetId);
  }
  if (
    heldUserIds.length > 0 &&
    (targetType === 'thread' || targetType === 'document')
  ) {
    if (targetType === 'thread') {
      const threads = await db<{ id: string }[]>`
        SELECT id FROM app.threads
        WHERE org_id = ${organizationId} AND user_id = ANY(${heldUserIds})
      `;
      for (const thread of threads) ids.add(thread.id);
    } else {
      const documents = await db<{ id: string }[]>`
        SELECT id FROM app.documents
        WHERE org_id = ${organizationId}
          AND created_by = ANY(${heldUserIds})
      `;
      for (const document of documents) ids.add(document.id);
    }
  }
  return { orgHeld, targetIds: [...ids] };
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
    matterRef?: string;
  },
): Promise<string> {
  await requireAdmin(sql, args.organizationId, args.actorId);
  const reason = args.reason.trim();
  if (reason.length === 0) {
    throw new LegalHoldError('REASON_REQUIRED', 'A reason is required');
  }
  return sql.begin(async (tx) => {
    const matterRef = args.matterRef?.trim() || null;
    if (matterRef !== null) {
      const matters = await tx<{ id: string }[]>`
        SELECT id FROM app.legal_matters
        WHERE id = ${matterRef} AND org_id = ${args.organizationId}
      `;
      if (matters.length === 0) {
        throw new LegalHoldError(
          'MATTER_NOT_FOUND',
          'matterRef does not point at an existing matter in this organization.',
          404,
        );
      }
    }
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
          org_id, target_type, target_id, target_label, reason, matter_ref,
          placed_by, placed_at_ms
        ) VALUES (
          ${args.organizationId}, ${args.targetType}, ${args.targetId},
          ${targetLabel}, ${reason}, ${matterRef}, ${args.actorId},
          ${Date.now()}
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
    reason?: string;
  },
): Promise<void> {
  await requireAdmin(sql, args.organizationId, args.actorId);
  await sql.begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`
      UPDATE app.legal_hold_release_requests SET
        status = 'rejected', rejected_by = ${args.actorId},
        rejected_at_ms = ${Date.now()},
        reject_reason = ${args.reason?.trim() || null}
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

export interface LegalHoldItemView {
  _id: string;
  organizationId: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  reason: string;
  matterRef?: string;
  matterName?: string;
  placedBy: string;
  placedByName: string;
  placedAt: number;
  releasedAt?: number;
  releasedBy?: string;
  releasedByName?: string;
  releaseReason?: string;
  pendingRelease: boolean;
}

/** The Legal-hold settings list (the 0.4 `listLegalHolds` item view:
 * resolved placer/releaser names + matter name; status defaults to
 * `active`). */
export async function listLegalHolds(
  sql: Sql,
  organizationId: string,
  args: { status?: 'active' | 'released' | 'all'; targetType?: string } = {},
): Promise<LegalHoldItemView[]> {
  const status = args.status ?? 'active';
  const rows = await sql<
    {
      id: string;
      targetType: string;
      targetId: string;
      targetLabel: string;
      reason: string;
      matterRef: string | null;
      matterName: string | null;
      placedBy: string;
      placedAt: number;
      releasedAt: number | null;
      releasedBy: string | null;
      releaseReason: string | null;
      pendingRelease: boolean;
    }[]
  >`
    SELECT h.id, h.target_type AS "targetType", h.target_id AS "targetId",
           h.target_label AS "targetLabel", h.reason,
           h.matter_ref AS "matterRef", m.name AS "matterName",
           h.placed_by AS "placedBy", h.placed_at_ms::float8 AS "placedAt",
           h.released_at_ms::float8 AS "releasedAt",
           h.released_by AS "releasedBy",
           h.release_reason AS "releaseReason",
           EXISTS (
             SELECT 1 FROM app.legal_hold_release_requests r
             WHERE r.hold_id = h.id AND r.status IN ('pending', 'approved')
           ) AS "pendingRelease"
    FROM app.legal_holds h
    LEFT JOIN app.legal_matters m
      ON m.id = h.matter_ref AND m.org_id = h.org_id
    WHERE h.org_id = ${organizationId}
      AND (
        ${status} = 'all'
        OR (${status} = 'active' AND h.released_at_ms IS NULL)
        OR (${status} = 'released' AND h.released_at_ms IS NOT NULL)
      )
      AND (${args.targetType ?? null}::text IS NULL
        OR h.target_type = ${args.targetType ?? null})
    ORDER BY h.placed_at_ms DESC
    LIMIT 200
  `;
  const userIds = [
    ...new Set(
      rows.flatMap((row) =>
        [row.placedBy, row.releasedBy].filter(
          (id): id is string => id !== null,
        ),
      ),
    ),
  ];
  const users =
    userIds.length === 0
      ? []
      : await sql<{ id: string; name: string | null }[]>`
          SELECT "id", "name" FROM "user" WHERE "id" = ANY(${userIds})
        `;
  const nameOf = new Map(users.map((user) => [user.id, user.name] as const));
  return rows.map((row) => {
    const view: LegalHoldItemView = {
      _id: row.id,
      organizationId,
      targetType: row.targetType,
      targetId: row.targetId,
      targetLabel: row.targetLabel,
      reason: row.reason,
      placedBy: row.placedBy,
      placedByName: nameOf.get(row.placedBy) ?? row.placedBy,
      placedAt: row.placedAt,
      pendingRelease: row.pendingRelease,
    };
    if (row.matterRef !== null) view.matterRef = row.matterRef;
    if (row.matterName !== null) view.matterName = row.matterName;
    if (row.releasedAt !== null) view.releasedAt = row.releasedAt;
    if (row.releasedBy !== null) {
      view.releasedBy = row.releasedBy;
      view.releasedByName = nameOf.get(row.releasedBy) ?? row.releasedBy;
    }
    if (row.releaseReason !== null) view.releaseReason = row.releaseReason;
    return view;
  });
}

export interface ReleaseRequestView {
  _id: string;
  organizationId: string;
  holdId: string;
  targetType?: string;
  targetId?: string;
  requestedBy: string;
  requestedByName: string;
  requestedAt: number;
  reason: string;
  status: string;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: number;
  effectiveAt?: number;
  rejectedBy?: string;
  rejectedByName?: string;
  rejectedAt?: number;
  rejectReason?: string;
}

/** The release-request rows with resolved names + hold targets (the 0.4
 * shaping, one names read + one holds read). Newest first, capped. */
export async function listReleaseRequestViews(
  sql: Sql,
  organizationId: string,
  args: {
    limit?: number;
    status?: string;
    /** Keyset: rows strictly older than (ts, id) in the DESC walk. */
    cursor?: { ts: number; id: string };
  } = {},
): Promise<ReleaseRequestView[]> {
  const limit = Math.min(Math.max(1, args.limit ?? 100), 200);
  const status = args.status ?? null;
  const cursorTs = args.cursor?.ts ?? null;
  const cursorId = args.cursor?.id ?? null;
  const rows = await sql<
    {
      id: string;
      holdId: string;
      requestedBy: string;
      requestedAt: number;
      reason: string;
      status: string;
      approvedBy: string | null;
      approvedAt: number | null;
      effectiveAt: number | null;
      rejectedBy: string | null;
      rejectedAt: number | null;
      rejectReason: string | null;
      targetType: string | null;
      targetId: string | null;
    }[]
  >`
    SELECT r.id, r.hold_id AS "holdId", r.requested_by AS "requestedBy",
           r.requested_at_ms::float8 AS "requestedAt", r.reason, r.status,
           r.approved_by AS "approvedBy",
           r.approved_at_ms::float8 AS "approvedAt",
           r.effective_at_ms::float8 AS "effectiveAt",
           r.rejected_by AS "rejectedBy",
           r.rejected_at_ms::float8 AS "rejectedAt",
           r.reject_reason AS "rejectReason",
           h.target_type AS "targetType", h.target_id AS "targetId"
    FROM app.legal_hold_release_requests r
    LEFT JOIN app.legal_holds h
      ON h.id = r.hold_id AND h.org_id = r.org_id
    WHERE r.org_id = ${organizationId}
      AND (${status}::text IS NULL OR r.status = ${status})
      AND (${cursorTs}::bigint IS NULL
        OR (r.requested_at_ms, r.id) < (${cursorTs}, ${cursorId}))
    ORDER BY r.requested_at_ms DESC, r.id DESC
    LIMIT ${limit}
  `;
  const userIds = [
    ...new Set(
      rows.flatMap((row) =>
        [row.requestedBy, row.approvedBy, row.rejectedBy].filter(
          (id): id is string => id !== null,
        ),
      ),
    ),
  ];
  const users =
    userIds.length === 0
      ? []
      : await sql<{ id: string; name: string | null }[]>`
          SELECT "id", "name" FROM "user" WHERE "id" = ANY(${userIds})
        `;
  const nameOf = new Map(users.map((user) => [user.id, user.name] as const));
  return rows.map((row) => {
    const view: ReleaseRequestView = {
      _id: row.id,
      organizationId,
      holdId: row.holdId,
      requestedBy: row.requestedBy,
      requestedByName: nameOf.get(row.requestedBy) ?? row.requestedBy,
      requestedAt: row.requestedAt,
      reason: row.reason,
      status: row.status,
    };
    if (row.targetType !== null) view.targetType = row.targetType;
    if (row.targetId !== null) view.targetId = row.targetId;
    if (row.approvedBy !== null) {
      view.approvedBy = row.approvedBy;
      view.approvedByName = nameOf.get(row.approvedBy) ?? row.approvedBy;
    }
    if (row.approvedAt !== null) view.approvedAt = row.approvedAt;
    if (row.effectiveAt !== null) view.effectiveAt = row.effectiveAt;
    if (row.rejectedBy !== null) {
      view.rejectedBy = row.rejectedBy;
      view.rejectedByName = nameOf.get(row.rejectedBy) ?? row.rejectedBy;
    }
    if (row.rejectedAt !== null) view.rejectedAt = row.rejectedAt;
    if (row.rejectReason !== null) view.rejectReason = row.rejectReason;
    return view;
  });
}

export interface HeldByTargetView {
  _id: string;
  targetType: string;
  targetId: string;
  placedAt: number;
  view: 'admin' | 'member';
  via: 'direct' | 'user_custodian' | 'org';
  hasPendingRelease: boolean;
  hasApprovedRelease: boolean;
  effectiveAt?: number;
  reason?: string;
  matterRef?: string;
  matterName?: string;
  placedBy?: string;
  placedByName?: string;
}

/** One entity's hold status (the 0.4 `getLegalHoldByTarget` cascade:
 * direct → author custodian (thread/document) → org-wide). */
export async function getLegalHoldByTarget(
  sql: Sql,
  auth: { organizationId: string; isAdmin: boolean },
  args: { targetType: string; targetId: string },
): Promise<HeldByTargetView | null> {
  const findActive = async (
    targetType: string,
    targetId: string,
  ): Promise<
    | {
        id: string;
        targetType: string;
        targetId: string;
        placedAt: number;
        reason: string;
        matterRef: string | null;
        placedBy: string;
      }
    | undefined
  > => {
    const rows = await sql<
      {
        id: string;
        targetType: string;
        targetId: string;
        placedAt: number;
        reason: string;
        matterRef: string | null;
        placedBy: string;
      }[]
    >`
      SELECT id, target_type AS "targetType", target_id AS "targetId",
             placed_at_ms::float8 AS "placedAt", reason,
             matter_ref AS "matterRef", placed_by AS "placedBy"
      FROM app.legal_holds
      WHERE org_id = ${auth.organizationId}
        AND target_type = ${targetType} AND target_id = ${targetId}
        AND released_at_ms IS NULL
      LIMIT 1
    `;
    return rows[0];
  };

  const direct = await findActive(args.targetType, args.targetId);
  let cascade: Awaited<ReturnType<typeof findActive>>;
  if (
    direct === undefined &&
    (args.targetType === 'thread' || args.targetType === 'document')
  ) {
    const authorRows =
      args.targetType === 'thread'
        ? await sql<{ authorId: string | null }[]>`
            SELECT user_id AS "authorId" FROM app.thread_metadata
            WHERE thread_id = ${args.targetId}
              AND org_id = ${auth.organizationId}
            LIMIT 1
          `
        : await sql<{ authorId: string | null }[]>`
            SELECT created_by AS "authorId" FROM app.documents
            WHERE id = ${args.targetId} AND org_id = ${auth.organizationId}
            LIMIT 1
          `;
    const authorId = authorRows[0]?.authorId ?? null;
    if (authorId !== null) {
      cascade = await findActive('userMembership', authorId);
    }
  }
  let orgWide: Awaited<ReturnType<typeof findActive>>;
  if (direct === undefined && cascade === undefined) {
    orgWide = await findActive('org', auth.organizationId);
  }
  const hold = direct ?? cascade ?? orgWide;
  if (hold === undefined) return null;
  const via: HeldByTargetView['via'] =
    direct !== undefined
      ? 'direct'
      : cascade !== undefined
        ? 'user_custodian'
        : 'org';

  const latest = await sql<{ status: string; effectiveAt: number | null }[]>`
    SELECT status, effective_at_ms::float8 AS "effectiveAt"
    FROM app.legal_hold_release_requests
    WHERE hold_id = ${hold.id}
    ORDER BY requested_at_ms DESC
    LIMIT 1
  `;
  const hasPendingRelease = latest[0]?.status === 'pending';
  const hasApprovedRelease = latest[0]?.status === 'approved';
  const effectiveAt = hasApprovedRelease
    ? (latest[0]?.effectiveAt ?? undefined)
    : undefined;

  if (!auth.isAdmin) {
    return {
      _id: hold.id,
      targetType: hold.targetType,
      targetId: hold.targetId,
      placedAt: hold.placedAt,
      view: 'member',
      via,
      hasPendingRelease,
      hasApprovedRelease,
      ...(effectiveAt !== undefined ? { effectiveAt } : {}),
    };
  }
  let matterName: string | undefined;
  if (hold.matterRef !== null) {
    const matters = await sql<{ name: string }[]>`
      SELECT name FROM app.legal_matters
      WHERE id = ${hold.matterRef} AND org_id = ${auth.organizationId}
      LIMIT 1
    `;
    matterName = matters[0]?.name;
  }
  const placers = await sql<{ name: string | null }[]>`
    SELECT "name" FROM "user" WHERE "id" = ${hold.placedBy} LIMIT 1
  `;
  return {
    _id: hold.id,
    targetType: hold.targetType,
    targetId: hold.targetId,
    placedAt: hold.placedAt,
    view: 'admin',
    via,
    hasPendingRelease,
    hasApprovedRelease,
    ...(effectiveAt !== undefined ? { effectiveAt } : {}),
    reason: hold.reason,
    ...(hold.matterRef !== null ? { matterRef: hold.matterRef } : {}),
    ...(matterName !== undefined ? { matterName } : {}),
    placedBy: hold.placedBy,
    ...(placers[0]?.name != null ? { placedByName: placers[0].name } : {}),
  };
}
