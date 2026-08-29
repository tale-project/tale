import type { Sql } from 'postgres';

import { shouldRevokeIdleSession } from '../../../convex/governance/session_idle_enforcement.ts';
import {
  parseSessionIdleTimeoutMinutes,
  resolveEffectiveIdleMinutes,
} from '../../../lib/shared/session-idle.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { createAuditLog } from '../audit_logs/service.ts';

/**
 * Idle-session revocation — the 0.5 twin of 0.4's `revokeIdleSessions` cron.
 *
 * The control: an org may declare that a session untouched for N minutes is
 * revoked, and this is what makes that true. Two rules carry over verbatim
 * (both via the REUSED pure helpers):
 *
 *  - a user in several orgs gets the STRICTEST window of any of them, and
 *    the audit row is attributed to the org whose window decided it;
 *  - an ALREADY-EXPIRED session is left alone — Better Auth's own expiry has
 *    it, and revoking it again would write a misleading control event.
 *
 * Rule 5: 0.4 paged the Better Auth adapter org by org, folded a per-user
 * minimum in memory, then deleted session rows one at a time because that
 * was the only way to walk a component table. Here the fold is a join and
 * the deletion is one statement per org window — same semantics, no ballet.
 */

/** Bound per run so one sweep cannot hold the table for a whole tick. */
const MAX_REVOCATIONS_PER_RUN = 500;

export interface IdleSweepResult {
  orgsWithWindow: number;
  revoked: number;
}

export async function revokeIdleSessions(
  sql: Sql,
  options: { now?: number } = {},
): Promise<IdleSweepResult> {
  const now = options.now ?? Date.now();
  const envMinutes = parseSessionIdleTimeoutMinutes();

  const orgs = await sql<{ id: string }[]>`
    SELECT "id" FROM "organization" ORDER BY "id"
  `;
  // Per-org effective window: the policy file's minutes when enabled, else
  // the deployment-wide env floor when one is set.
  const windows = new Map<string, number>();
  for (const org of orgs) {
    const policy = await readGovernancePolicyForOrg(
      sql,
      org.id,
      'session_idle_timeout',
    );
    // The env floor and the org policy combine through the SHARED resolver,
    // so the sweep can never disagree with the login path about what the
    // effective window is.
    const minutes = resolveEffectiveIdleMinutes({ policy, envMinutes });
    if (minutes !== null && minutes > 0) windows.set(org.id, minutes);
  }
  if (windows.size === 0) return { orgsWithWindow: 0, revoked: 0 };

  // Fold memberships into the per-user STRICTEST window, remembering which
  // org's policy decided it (that org owns the audit row).
  const members = await sql<{ userId: string; organizationId: string }[]>`
    SELECT "userId", "organizationId" FROM "member"
    WHERE "organizationId" = ANY(${[...windows.keys()]})
      AND lower("role") <> 'disabled'
  `;
  const perUser = new Map<
    string,
    { minutes: number; organizationId: string }
  >();
  for (const member of members) {
    const minutes = windows.get(member.organizationId);
    if (minutes === undefined) continue;
    const existing = perUser.get(member.userId);
    if (!existing || minutes < existing.minutes) {
      perUser.set(member.userId, {
        minutes,
        organizationId: member.organizationId,
      });
    }
  }
  if (perUser.size === 0) {
    return { orgsWithWindow: windows.size, revoked: 0 };
  }

  const sessions = await sql<
    { id: string; userId: string; updatedAt: Date; expiresAt: Date }[]
  >`
    SELECT "id", "userId", "updatedAt", "expiresAt" FROM "session"
    WHERE "userId" = ANY(${[...perUser.keys()]})
    ORDER BY "updatedAt"
    LIMIT ${MAX_REVOCATIONS_PER_RUN * 4}
  `;

  const doomed: { id: string; userId: string; organizationId: string }[] = [];
  for (const session of sessions) {
    if (doomed.length >= MAX_REVOCATIONS_PER_RUN) break;
    const window = perUser.get(session.userId);
    if (window === undefined) continue;
    if (
      shouldRevokeIdleSession({
        updatedAt: session.updatedAt.getTime(),
        expiresAt: session.expiresAt.getTime(),
        windowMs: window.minutes * 60_000,
        now,
      })
    ) {
      doomed.push({
        id: session.id,
        userId: session.userId,
        organizationId: window.organizationId,
      });
    }
  }
  if (doomed.length === 0) {
    return { orgsWithWindow: windows.size, revoked: 0 };
  }

  await sql`
    DELETE FROM "session" WHERE "id" = ANY(${doomed.map((row) => row.id)})
  `;
  // One audit row per revoked session — the control is evidenced per event,
  // not per sweep (the 0.4 decision). Each in its own transaction so a bad
  // row cannot roll back the others.
  for (const row of doomed) {
    await sql
      .begin((tx) =>
        createAuditLog(tx, {
          organizationId: row.organizationId,
          actorId: 'system',
          actorType: 'system',
          action: 'session.idle_revoked',
          category: 'security',
          resourceType: 'session',
          resourceId: row.id,
          status: 'success',
          newState: { userId: row.userId },
        }),
      )
      .catch((error: unknown) => {
        console.warn('[session-idle] audit write failed:', error);
      });
  }
  console.info(
    `[session-idle] revoked ${doomed.length} idle session(s) across ${windows.size} org window(s)`,
  );
  return { orgsWithWindow: windows.size, revoked: doomed.length };
}
