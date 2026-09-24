import type { Sql, TransactionSql } from 'postgres';

import {
  competenceRecordStatus,
  PLATFORM_CAPABILITIES,
  PLATFORM_CAPABILITY_PREFIX,
  type PlatformCapability,
} from '../../../lib/shared/competences';
import { findOrganizationMember, isAdminRole } from '../../auth/membership.ts';
import { createAuditLog } from '../audit_logs/service.ts';

/**
 * Competence records — per-member grants an organization admin makes,
 * audits, may bound with an expiry, and revokes. Two consumers read them:
 *
 *  - REVIEW GATING. An org's `review_policy` may require named competences
 *    of a responder; these rows are the evidence, and `holdsAllCompetences`
 *    is the check the review gate runs.
 *  - PLATFORM CAPABILITIES. A slug under the reserved `tale:` namespace
 *    delegates ONE narrow platform right to a member without an admin seat
 *    (`tale:notifications.export` — the notification export door;
 *    `tale:rest.act-as` — naming an `actor` on the REST ask and review
 *    doors), checked by `holdsCapability`. The namespace is closed: only the slugs in
 *    `PLATFORM_CAPABILITIES` can be granted under it, so a typo or a
 *    look-alike never reads as a right it does not confer. Removing the
 *    membership revokes these grants (`removeMembershipCascade`), so a
 *    re-added member starts without the right.
 *
 * Three rules carry over from 0.4 verbatim:
 *
 *  - a REVOKED record is retained, never deleted: it is the audit trail
 *    behind every review it once justified;
 *  - a member holds at most one LIVE grant per competence (the partial
 *    unique index enforces it), so "who holds this right now" has exactly
 *    one answer and re-granting means revoking first;
 *  - a refusal NAMES what is missing, and an approval records WHICH grants
 *    justified it — a governed decision has to be explainable afterwards.
 */

const COMPETENCE_RESOURCE_TYPE = 'competence_record';
const COMPETENCE_SLUG_MAX = 120;
const COMPETENCE_EVIDENCE_MAX = 2000;
/** A member holds a handful of competences; the cap bounds a bad org. */
const COMPETENCE_SCAN_CAP = 200;

// The reserved namespace and its closed set live in `lib/shared` so the
// governance screen offers exactly what this register accepts.
export {
  PLATFORM_CAPABILITIES,
  PLATFORM_CAPABILITY_PREFIX,
  type PlatformCapability,
};

const KNOWN_PLATFORM_CAPABILITIES: ReadonlySet<string> = new Set(
  PLATFORM_CAPABILITIES,
);

export class CompetenceError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409;
  constructor(code: string, message: string, status: 400 | 403 | 404 | 409) {
    super(message);
    this.name = 'CompetenceError';
    this.code = code;
    this.status = status;
  }
}

export interface CompetenceRecord {
  id: string;
  userId: string;
  competence: string;
  grantedBy: string;
  grantedAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
  revokedBy: string | null;
  evidence: string | null;
}

const COLUMNS = `
  id, user_id AS "userId", competence, granted_by AS "grantedBy",
  granted_at_ms::float8 AS "grantedAt", expires_at_ms::float8 AS "expiresAt",
  revoked_at_ms::float8 AS "revokedAt", revoked_by AS "revokedBy", evidence
`;

/** Whether the record vouches for its holder RIGHT NOW. */
export function isCompetenceRecordActive(
  record: { expiresAt: number | null; revokedAt: number | null },
  now: number,
): boolean {
  return competenceRecordStatus(record, now) === 'active';
}

/**
 * Whether `userId` holds EVERY competence in `required` through unexpired,
 * unrevoked records. Returns the vouching record ids so a decision can stamp
 * WHICH grants justified it, and the missing slugs so a refusal can name
 * what is lacking. An empty `required` trivially holds.
 */
export async function holdsAllCompetences(
  sql: Sql | TransactionSql,
  organizationId: string,
  userId: string,
  required: readonly string[],
): Promise<{ holdsAll: boolean; heldRecordIds: string[]; missing: string[] }> {
  if (required.length === 0) {
    return { holdsAll: true, heldRecordIds: [], missing: [] };
  }
  const now = Date.now();
  const rows = await sql<
    { id: string; competence: string; expiresAt: number | null }[]
  >`
    SELECT id, competence, expires_at_ms::float8 AS "expiresAt"
    FROM app.competence_records
    WHERE org_id = ${organizationId} AND user_id = ${userId}
      AND revoked_at_ms IS NULL
    LIMIT ${COMPETENCE_SCAN_CAP}
  `;
  const activeBySlug = new Map<string, string>();
  for (const row of rows) {
    if (
      isCompetenceRecordActive(
        { expiresAt: row.expiresAt, revokedAt: null },
        now,
      )
    ) {
      activeBySlug.set(row.competence, row.id);
    }
  }
  const heldRecordIds: string[] = [];
  const missing: string[] = [];
  for (const slug of new Set(required)) {
    const id = activeBySlug.get(slug);
    if (id === undefined) missing.push(slug);
    else heldRecordIds.push(id);
  }
  return { holdsAll: missing.length === 0, heldRecordIds, missing };
}

/**
 * Whether `userId` holds the platform `capability` in `organizationId` at
 * `now`: its one unrevoked grant (the partial unique index allows no second)
 * has not expired. Scoped by organization — a grant in another tenant
 * confers nothing here — and blind to role: the door decides whether a role
 * already carries the right.
 */
export async function holdsCapability(
  sql: Sql | TransactionSql,
  organizationId: string,
  userId: string,
  capability: PlatformCapability,
  now: number,
): Promise<boolean> {
  const rows = await sql<
    { expiresAt: number | null; revokedAt: number | null }[]
  >`
    SELECT expires_at_ms::float8 AS "expiresAt",
           revoked_at_ms::float8 AS "revokedAt"
    FROM app.competence_records
    WHERE org_id = ${organizationId} AND user_id = ${userId}
      AND competence = ${capability} AND revoked_at_ms IS NULL
    LIMIT 1
  `;
  const record = rows[0];
  return record !== undefined && isCompetenceRecordActive(record, now);
}

interface AdminActor {
  userId: string;
  email?: string;
  role: string;
}

/** A refused privileged write, audited (the legal-hold posture: a denied
 * privileged attempt is evidence too). Best effort: a failed audit is
 * logged and never turns the refusal into a 500. */
async function auditDeniedWrite(
  sql: Sql,
  organizationId: string,
  actor: AdminActor,
  deniedAction: string,
  resource: { resourceId?: string; resourceName?: string },
  reason: string,
): Promise<void> {
  await sql
    .begin((tx) =>
      createAuditLog(tx, {
        organizationId,
        actorId: actor.userId,
        ...(actor.email !== undefined ? { actorEmail: actor.email } : {}),
        actorType: 'user',
        action: deniedAction,
        category: 'security',
        resourceType: COMPETENCE_RESOURCE_TYPE,
        ...(resource.resourceId !== undefined
          ? { resourceId: resource.resourceId }
          : {}),
        ...(resource.resourceName !== undefined
          ? { resourceName: resource.resourceName }
          : {}),
        status: 'failure',
        errorMessage: reason,
      }),
    )
    .catch((error: unknown) => {
      console.warn('[competence] denied-write audit failed:', error);
    });
}

/** Admin-only writes, with the refusal itself audited. */
async function requireAdminForWrite(
  sql: Sql,
  organizationId: string,
  actor: AdminActor,
  deniedAction: string,
  resource: { resourceId?: string; resourceName?: string },
): Promise<void> {
  if (isAdminRole(actor.role)) return;
  await auditDeniedWrite(
    sql,
    organizationId,
    actor,
    deniedAction,
    resource,
    'admin role required',
  );
  throw new CompetenceError(
    'COMPETENCE_FORBIDDEN',
    'Only organization admins may grant or revoke competences.',
    403,
  );
}

export async function grantCompetence(
  sql: Sql,
  args: {
    organizationId: string;
    actor: AdminActor;
    userId: string;
    competence: string;
    expiresAt?: number;
    evidence?: string;
  },
): Promise<{ recordId: string }> {
  const competence = args.competence.trim();
  await requireAdminForWrite(
    sql,
    args.organizationId,
    args.actor,
    'competence_grant_denied',
    { resourceName: competence },
  );
  if (competence.length === 0 || competence.length > COMPETENCE_SLUG_MAX) {
    throw new CompetenceError(
      'COMPETENCE_INVALID',
      `competence must be 1..${COMPETENCE_SLUG_MAX} characters`,
      400,
    );
  }
  // The reserved namespace is closed: an unknown `tale:` slug would read as a
  // platform right it cannot confer, so the grant is refused — and audited
  // the way a denied grant is — before anything is written.
  if (
    competence.toLowerCase().startsWith(PLATFORM_CAPABILITY_PREFIX) &&
    !KNOWN_PLATFORM_CAPABILITIES.has(competence)
  ) {
    await auditDeniedWrite(
      sql,
      args.organizationId,
      args.actor,
      'competence_grant_denied',
      { resourceName: competence },
      'unknown platform capability',
    );
    throw new CompetenceError(
      'COMPETENCE_CAPABILITY_UNKNOWN',
      `"${competence}" is not a platform capability — the "${PLATFORM_CAPABILITY_PREFIX}" namespace is reserved for: ${PLATFORM_CAPABILITIES.join(', ')}`,
      400,
    );
  }
  if (args.userId.trim().length === 0) {
    throw new CompetenceError(
      'COMPETENCE_USER_REQUIRED',
      'the grant must name the member who holds the competence',
      400,
    );
  }
  const now = Date.now();
  if (args.expiresAt !== undefined && args.expiresAt <= now) {
    throw new CompetenceError(
      'COMPETENCE_EXPIRY_IN_PAST',
      'expiresAt must be in the future (or absent for no expiry)',
      400,
    );
  }
  const evidence = args.evidence?.trim();
  if (evidence !== undefined && evidence.length > COMPETENCE_EVIDENCE_MAX) {
    throw new CompetenceError(
      'COMPETENCE_EVIDENCE_TOO_LONG',
      `evidence must be at most ${COMPETENCE_EVIDENCE_MAX} characters`,
      400,
    );
  }

  return sql.begin(async (tx) => {
    // The register is the org's qualification ledger: a grant to someone who
    // is not a member is fail-safe (`holdsAllCompetences` scopes by org and
    // user) but pollutes it, and it reads as a qualification that is not one.
    if (
      (await findOrganizationMember(tx, args.organizationId, args.userId)) ===
      null
    ) {
      throw new CompetenceError(
        'COMPETENCE_USER_NOT_MEMBER',
        'the named user is not a member of this organization',
        400,
      );
    }
    // An EXPIRED live row still occupies the partial-unique slot; retire it
    // so a re-grant after expiry is an ordinary act rather than a refusal
    // the admin cannot resolve (0.4 refused only on an ACTIVE duplicate).
    await tx`
      UPDATE app.competence_records
      SET revoked_at_ms = ${now}, revoked_by = 'system'
      WHERE org_id = ${args.organizationId} AND user_id = ${args.userId}
        AND competence = ${competence} AND revoked_at_ms IS NULL
        AND expires_at_ms IS NOT NULL AND expires_at_ms <= ${now}
    `;
    const inserted = await tx<{ id: string }[]>`
      INSERT INTO app.competence_records (
        org_id, user_id, competence, granted_by, granted_at_ms,
        expires_at_ms, evidence
      ) VALUES (
        ${args.organizationId}, ${args.userId}, ${competence},
        ${args.actor.userId}, ${now}, ${args.expiresAt ?? null},
        ${evidence !== undefined && evidence !== '' ? evidence : null}
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    const recordId = inserted[0]?.id;
    if (recordId === undefined) {
      throw new CompetenceError(
        'COMPETENCE_ALREADY_GRANTED',
        'this member already holds an active grant of this competence — revoke it first to re-grant',
        409,
      );
    }
    await createAuditLog(tx, {
      organizationId: args.organizationId,
      actorId: args.actor.userId,
      ...(args.actor.email !== undefined
        ? { actorEmail: args.actor.email }
        : {}),
      actorType: 'user',
      action: 'competence_granted',
      category: 'security',
      resourceType: COMPETENCE_RESOURCE_TYPE,
      resourceId: recordId,
      resourceName: competence,
      status: 'success',
      newState: {
        userId: args.userId,
        competence,
        grantedBy: args.actor.userId,
        ...(args.expiresAt !== undefined ? { expiresAt: args.expiresAt } : {}),
      },
    });
    return { recordId };
  });
}

export async function revokeCompetence(
  sql: Sql,
  args: { organizationId: string; actor: AdminActor; recordId: string },
): Promise<void> {
  await requireAdminForWrite(
    sql,
    args.organizationId,
    args.actor,
    'competence_revoke_denied',
    { resourceId: args.recordId },
  );
  const now = Date.now();
  await sql.begin(async (tx) => {
    const rows = await tx<
      { competence: string; userId: string; revokedAt: number | null }[]
    >`
      SELECT competence, user_id AS "userId",
             revoked_at_ms::float8 AS "revokedAt"
      FROM app.competence_records
      WHERE id = ${args.recordId} AND org_id = ${args.organizationId}
      FOR UPDATE
    `;
    const record = rows[0];
    if (record === undefined) {
      throw new CompetenceError(
        'COMPETENCE_NOT_FOUND',
        'no such competence record in this organization',
        404,
      );
    }
    if (record.revokedAt !== null) {
      throw new CompetenceError(
        'COMPETENCE_ALREADY_REVOKED',
        'this competence record is already revoked',
        409,
      );
    }
    await tx`
      UPDATE app.competence_records
      SET revoked_at_ms = ${now}, revoked_by = ${args.actor.userId}
      WHERE id = ${args.recordId}
    `;
    await createAuditLog(tx, {
      organizationId: args.organizationId,
      actorId: args.actor.userId,
      ...(args.actor.email !== undefined
        ? { actorEmail: args.actor.email }
        : {}),
      actorType: 'user',
      action: 'competence_revoked',
      category: 'security',
      resourceType: COMPETENCE_RESOURCE_TYPE,
      resourceId: args.recordId,
      resourceName: record.competence,
      status: 'success',
      newState: { userId: record.userId, revokedBy: args.actor.userId },
    });
  });
}

/** The newest revoked records an org-wide listing carries. */
const ORG_HISTORY_CAP = 1000;

/**
 * Every LIVE record (unrevoked: active, or past its expiry until a re-grant
 * retires it) plus the newest `historyCap` revoked ones, newest first. Live
 * rows are bounded — one per member and competence, the partial unique
 * index — so an admin can always see, and revoke, everything that may still
 * vouch; only the audit history is capped. A plain newest-first LIMIT let a
 * long history push an old grant that still vouches off the list.
 */
function listRegister(
  sql: Sql,
  organizationId: string,
  historyCap: number,
  userId?: string,
): Promise<CompetenceRecord[]> {
  const member = userId === undefined ? sql`TRUE` : sql`user_id = ${userId}`;
  return sql<CompetenceRecord[]>`
    SELECT * FROM (
      SELECT ${sql.unsafe(COLUMNS)} FROM app.competence_records
      WHERE org_id = ${organizationId} AND ${member}
        AND revoked_at_ms IS NULL
      UNION ALL
      (
        SELECT ${sql.unsafe(COLUMNS)} FROM app.competence_records
        WHERE org_id = ${organizationId} AND ${member}
          AND revoked_at_ms IS NOT NULL
        ORDER BY granted_at_ms DESC
        LIMIT ${historyCap}
      )
    ) AS register
    ORDER BY "grantedAt" DESC
  `;
}

/** The org's register — every live grant, and its revoked ones as the
 * evidence trail (the newest {@link ORG_HISTORY_CAP}). */
export async function listOrgCompetences(
  sql: Sql,
  organizationId: string,
): Promise<CompetenceRecord[]> {
  return listRegister(sql, organizationId, ORG_HISTORY_CAP);
}

/** One member's records — every live grant, and the newest revoked ones. */
export async function listUserCompetences(
  sql: Sql,
  organizationId: string,
  userId: string,
): Promise<CompetenceRecord[]> {
  return listRegister(sql, organizationId, COMPETENCE_SCAN_CAP, userId);
}
