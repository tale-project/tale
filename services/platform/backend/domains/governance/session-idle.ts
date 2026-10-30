import {
  parseSessionIdleTimeoutMinutes,
  resolveEffectiveIdleMinutes,
} from '@tale/shared/utils/session-idle';
import type { PendingQuery, Sql } from 'postgres';

import { sessionCookieCacheSeconds } from '../../auth/session-cache.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import type { CreateAuditLogArgs } from '../audit_logs/types.ts';

/**
 * Idle-session revocation — the 0.5 twin of 0.4's `revokeIdleSessions` cron.
 *
 * The control: an org may declare that a session untouched for N minutes is
 * revoked, and this is what makes that true. Two rules carry over verbatim:
 *
 *  - a user in several orgs gets the STRICTEST window of any of them, and
 *    the audit row is attributed to the org whose window decided it (of
 *    orgs sharing that window, the one with the lowest id);
 *  - an ALREADY-EXPIRED session is left alone — Better Auth's own expiry and
 *    the reaper (`auth/expired-sessions.ts`) have it, and revoking it again
 *    would write a misleading control event.
 *
 * Rule 5: 0.4 paged the Better Auth adapter org by org, folded a per-user
 * minimum in memory, then deleted session rows one at a time because that
 * was the only way to walk a component table. Here the orgs are grouped by
 * window and each window is one statement, strictest first: a session idle
 * past a stricter window is gone before a laxer one's statement runs, so each
 * goes with its strictest window, as the fold had it. The statement joins
 * the window's members by user, which leaves the planner both ways in: from
 * the members when the window's orgs are small, or down the least recently
 * used sessions on `session_updatedAt_expiresAt_idx` (`db/boot-indexes.ts`)
 * when they hold most users. One statement for every window would compare
 * `"updatedAt"` with each org's own cutoff inside the join, which leaves only
 * the second.
 */

/** Bound per run so one sweep cannot hold the table for a whole tick. */
const MAX_REVOCATIONS_PER_RUN = 500;

export interface IdleSweepResult {
  orgsWithWindow: number;
  revoked: number;
}

/** A revoked session, and the org whose window revoked it. */
interface RevokedSession {
  id: string;
  userId: string;
  organizationId: string;
}

export async function revokeIdleSessions(
  sql: Sql,
  options: { now?: number } = {},
): Promise<IdleSweepResult> {
  const now = options.now ?? Date.now();
  const envMinutes = parseSessionIdleTimeoutMinutes();
  // With the session cookie cache on, a request answered from the cookie
  // does not slide the row's `updatedAt`: an active session's stamp can lag
  // by up to the cache's length, so the window is widened by exactly that
  // (zero when the cache is off) instead of revoking a session in use.
  const cacheLagMs = sessionCookieCacheSeconds() * 1000;

  const orgs = await sql<{ id: string }[]>`
    SELECT "id" FROM "organization" ORDER BY "id"
  `;
  // Per-org effective window: the policy file's minutes when enabled, else
  // the deployment-wide env floor when one is set. Orgs sharing a window
  // share its statement.
  const orgsByWindow = new Map<number, string[]>();
  let orgsWithWindow = 0;
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
    if (minutes === null || minutes <= 0) continue;
    orgsWithWindow += 1;
    const sharing = orgsByWindow.get(minutes);
    if (sharing) sharing.push(org.id);
    else orgsByWindow.set(minutes, [org.id]);
  }
  if (orgsWithWindow === 0) return { orgsWithWindow: 0, revoked: 0 };

  let revoked = 0;
  const strictestFirst = [...orgsByWindow].toSorted(([a], [b]) => a - b);
  for (const [minutes, organizationIds] of strictestFirst) {
    const limit = MAX_REVOCATIONS_PER_RUN - revoked;
    if (limit <= 0) break;
    const sessions = await idleSessionRevocation(sql, {
      organizationIds,
      idleBefore: new Date(now - minutes * 60_000 - cacheLagMs),
      now: new Date(now),
      limit,
    });
    revoked += sessions.length;
    await auditRevocations(sql, sessions);
  }
  if (revoked > 0) {
    console.info(
      `[session-idle] revoked ${revoked} idle session(s) across ${orgsWithWindow} org window(s)`,
    );
  }
  return { orgsWithWindow, revoked };
}

/**
 * Revoke at most `limit` sessions of one window, least recently used first:
 * live ones untouched since before `idleBefore` whose user is a member, not
 * disabled, of one of `organizationIds`. Each comes back with the lowest of
 * those orgs the user is a member of. Exported for the plan check
 * (`session-idle.integration.ts`).
 */
export function idleSessionRevocation(
  sql: Sql,
  pass: {
    organizationIds: string[];
    idleBefore: Date;
    now: Date;
    limit: number;
  },
): PendingQuery<RevokedSession[]> {
  // The rows are locked as they are taken and deleted in the same statement:
  // one another transaction holds (a refresh, a sign-out) is skipped for the
  // next run rather than waited on, and a row refreshed since the scan read
  // it is checked again under the lock and stays.
  return sql<RevokedSession[]>`
    WITH "idle" AS MATERIALIZED (
      SELECT s."id" FROM "session" s
      WHERE s."updatedAt" < ${pass.idleBefore}
        AND s."expiresAt" > ${pass.now}
        AND EXISTS (
          SELECT 1 FROM "member" m
          WHERE m."userId" = s."userId"
            AND m."organizationId" = ANY(${pass.organizationIds})
            AND lower(m."role") <> 'disabled'
        )
      ORDER BY s."updatedAt"
      LIMIT ${pass.limit}
      FOR UPDATE OF s SKIP LOCKED
    )
    DELETE FROM "session" s USING "idle" i
    WHERE s."id" = i."id"
    RETURNING s."id", s."userId", (
      SELECT min(m."organizationId") FROM "member" m
      WHERE m."userId" = s."userId"
        AND m."organizationId" = ANY(${pass.organizationIds})
        AND lower(m."role") <> 'disabled'
    ) AS "organizationId"
  `;
}

/**
 * One audit row per revoked session — the control is evidenced per event,
 * not per sweep (the 0.4 decision) — a window's rows in one transaction.
 * Should that fail, each row is written in a transaction of its own, so a
 * bad row cannot take the others with it. The sessions are gone either way:
 * the revocation does not wait on its evidence.
 */
async function auditRevocations(
  sql: Sql,
  sessions: readonly RevokedSession[],
): Promise<void> {
  if (sessions.length === 0) return;
  try {
    await sql.begin(async (tx) => {
      for (const session of sessions) {
        await createAuditLog(tx, revocationAudit(session));
      }
    });
  } catch (error) {
    console.warn(
      '[session-idle] audit batch failed, writing it row by row:',
      error,
    );
    for (const session of sessions) {
      await sql
        .begin((tx) => createAuditLog(tx, revocationAudit(session)))
        .catch((rowError: unknown) => {
          console.warn('[session-idle] audit write failed:', rowError);
        });
    }
  }
}

function revocationAudit(session: RevokedSession): CreateAuditLogArgs {
  return {
    organizationId: session.organizationId,
    actorId: 'system',
    actorType: 'system',
    action: 'session.idle_revoked',
    category: 'security',
    resourceType: 'session',
    resourceId: session.id,
    status: 'success',
    newState: { userId: session.userId },
  };
}
