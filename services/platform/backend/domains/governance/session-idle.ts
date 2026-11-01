import {
  parseSessionIdleTimeoutMinutes,
  resolveEffectiveIdleMinutes,
  SESSION_REFRESH_SECONDS_OUTSIDE_IDLE_WINDOW,
  sessionIdleWindowSeconds,
  type SessionRefreshShape,
  sessionRefreshShape,
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
 *
 * Two refresh cadences (#5164). With `SESSION_IDLE_TIMEOUT_MINUTES` unset, a
 * session under no idle window is refreshed every five minutes and one under
 * a window every minute (`auth/session-refresh.ts`), and a row tells which by
 * its own columns: Better Auth writes `"expiresAt" - "updatedAt"` as
 * `expiresIn` at every refresh, and the session hooks write it `advance`
 * lower under a window. A five-minute row may have served requests up to
 * five minutes past its `"updatedAt"`. So when a window comes into force for
 * one — an org turns its policy on, a user joins or is enabled again — the
 * sweep stamps it before it judges it: `"updatedAt"` becomes
 * `least(now, "updatedAt" + 5 minutes)`, never earlier than its last request,
 * and `"expiresAt"` comes down so that the row is refreshed every minute from
 * then on. A five-minute row the stamp did not reach (its cap, a lock) is
 * judged as if stamped. A session in use is never revoked; one already idle
 * goes at most five minutes late, once.
 *
 * With the variable set, every session is under its window and refreshed
 * every minute, and no row is of the five-minute kind; but a row written
 * before it was set, or under a laxer value, would not be refreshed for days.
 * {@link clampSessionsToIdleWindow} brings each such row under the window,
 * with the same stamp, at boot (`db/migrate.ts`) and before every sweep.
 */

/** Bound per run so one sweep cannot hold the table for a whole tick. */
const MAX_REVOCATIONS_PER_RUN = 500;

/**
 * Stamps per run. A five-minute row the cap leaves is judged as if stamped,
 * and the next run stamps it.
 */
const MAX_STAMPS_PER_RUN = 500;

/** Rows one clamp statement rewrites, so none holds the table for long. */
const SESSION_CLAMP_BATCH = 1_000;

/**
 * Slack, in seconds, around the lifetimes a refresh writes: Better Auth
 * takes `"expiresAt"` and `"updatedAt"` from two readings of the clock.
 */
const CLOCK_SLACK_SECONDS = 1;

/**
 * Better Auth's lifetime for a "don't remember me" sign-in: a day from
 * creation, never refreshed. The clamp leaves a row of that shape as it is.
 */
const DONT_REMEMBER_ME_SECONDS = 24 * 60 * 60;

export interface IdleSweepResult {
  orgsWithWindow: number;
  revoked: number;
  /** Five-minute rows stamped as a window came into force for them. */
  stamped: number;
  /** Rows brought under `SESSION_IDLE_TIMEOUT_MINUTES` before the sweep. */
  clamped: number;
}

/**
 * The five-minute rows of a window, by their own columns: last refreshed
 * outside every window and touched no earlier than `since`, five minutes
 * before the window's cutoff. Empty when the advance is zero.
 */
export interface FiveMinuteRows {
  since: Date;
  /** Bounds, in seconds, on `"expiresAt" - "updatedAt"`. */
  above: number;
  atMost: number;
}

/** Exported for the plan check (`session-idle.integration.ts`). */
export function fiveMinuteRows(
  shape: SessionRefreshShape,
  idleBefore: Date,
): FiveMinuteRows {
  return {
    since: new Date(idleBefore.getTime() - shape.updateAge * 1000),
    above: shape.expiresIn - shape.advance + CLOCK_SLACK_SECONDS,
    atMost: shape.expiresIn + CLOCK_SLACK_SECONDS,
  };
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
  // First, so that no row written under an earlier setting of the variable
  // is judged by an `"updatedAt"` its sessions no longer move.
  const clamped = await clampSessionsToIdleWindow(sql, { now });
  if (clamped > 0) {
    console.info(
      `[session-idle] brought ${clamped} session(s) under SESSION_IDLE_TIMEOUT_MINUTES`,
    );
  }
  const envMinutes = parseSessionIdleTimeoutMinutes();
  const shape = sessionRefreshShape();
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
  if (orgsWithWindow === 0) {
    return { orgsWithWindow: 0, revoked: 0, stamped: 0, clamped };
  }

  let revoked = 0;
  let stamped = 0;
  const strictestFirst = [...orgsByWindow].toSorted(([a], [b]) => a - b);
  for (const [minutes, organizationIds] of strictestFirst) {
    const limit = MAX_REVOCATIONS_PER_RUN - revoked;
    if (limit <= 0) break;
    const idleBefore = new Date(now - minutes * 60_000 - cacheLagMs);
    const fiveMinute = fiveMinuteRows(shape, idleBefore);
    const stampLimit = MAX_STAMPS_PER_RUN - stamped;
    if (shape.advance > 0 && stampLimit > 0) {
      const rows = await idleWindowStamp(sql, {
        organizationIds,
        idleBefore,
        now: new Date(now),
        limit: stampLimit,
        fiveMinute,
        shape,
      });
      stamped += rows.length;
    }
    const sessions = await idleSessionRevocation(sql, {
      organizationIds,
      idleBefore,
      now: new Date(now),
      limit,
      fiveMinute,
    });
    revoked += sessions.length;
    await auditRevocations(sql, sessions);
  }
  if (stamped > 0) {
    console.info(
      `[session-idle] stamped ${stamped} session(s) an idle window came into force for`,
    );
  }
  if (revoked > 0) {
    console.info(
      `[session-idle] revoked ${revoked} idle session(s) across ${orgsWithWindow} org window(s)`,
    );
  }
  return { orgsWithWindow, revoked, stamped, clamped };
}

/**
 * Stamp at most `limit` five-minute rows of one window that the window would
 * revoke by their `"updatedAt"` alone, though their sessions may have served
 * a request since its cutoff: live, touched within five minutes before
 * `idleBefore`, their user a member, not disabled, of one of
 * `organizationIds`. Each gets `"updatedAt"` = `least(now, "updatedAt" +
 * 5 minutes)`, which no request it served without a refresh came after, and
 * an `"expiresAt"` that makes it a one-minute row from then on. Locked and
 * checked again as the revocation's rows are. Exported for the plan check
 * (`session-idle.integration.ts`).
 */
export function idleWindowStamp(
  sql: Sql,
  pass: {
    organizationIds: string[];
    idleBefore: Date;
    now: Date;
    limit: number;
    fiveMinute: FiveMinuteRows;
    shape: SessionRefreshShape;
  },
): PendingQuery<{ id: string }[]> {
  const { fiveMinute, shape } = pass;
  return sql<{ id: string }[]>`
    WITH "band" AS MATERIALIZED (
      SELECT s."id" FROM "session" s
      WHERE s."updatedAt" >= ${fiveMinute.since}
        AND s."updatedAt" < ${pass.idleBefore}
        AND s."expiresAt" > ${pass.now}
        AND s."expiresAt" - s."updatedAt" > make_interval(secs => ${fiveMinute.above})
        AND s."expiresAt" - s."updatedAt" <= make_interval(secs => ${fiveMinute.atMost})
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
    UPDATE "session" s SET
      "updatedAt" = least(
        ${pass.now}, s."updatedAt" + make_interval(secs => ${shape.updateAge})
      ),
      "expiresAt" = least(
        s."expiresAt",
        least(
          ${pass.now}, s."updatedAt" + make_interval(secs => ${shape.updateAge})
        ) + make_interval(secs => ${shape.expiresIn - shape.advance})
      )
    FROM "band" b
    WHERE s."id" = b."id"
    RETURNING s."id"
  `;
}

/**
 * Revoke at most `limit` sessions of one window, least recently used first:
 * live ones untouched since before `idleBefore` whose user is a member, not
 * disabled, of one of `organizationIds` — a five-minute row only once
 * `"updatedAt"` + 5 minutes is before `idleBefore` too. Each comes back with
 * the lowest of those orgs the user is a member of. Exported for the plan
 * check (`session-idle.integration.ts`).
 */
export function idleSessionRevocation(
  sql: Sql,
  pass: {
    organizationIds: string[];
    idleBefore: Date;
    now: Date;
    limit: number;
    fiveMinute: FiveMinuteRows;
  },
): PendingQuery<RevokedSession[]> {
  const { fiveMinute } = pass;
  // The rows are locked as they are taken and deleted in the same statement:
  // one another transaction holds (a refresh, a sign-out) is skipped for the
  // next run rather than waited on, and a row refreshed since the scan read
  // it is checked again under the lock and stays.
  return sql<RevokedSession[]>`
    WITH "idle" AS MATERIALIZED (
      SELECT s."id" FROM "session" s
      WHERE s."updatedAt" < ${pass.idleBefore}
        AND s."expiresAt" > ${pass.now}
        AND NOT (
          s."updatedAt" >= ${fiveMinute.since}
          AND s."expiresAt" - s."updatedAt" > make_interval(secs => ${fiveMinute.above})
          AND s."expiresAt" - s."updatedAt" <= make_interval(secs => ${fiveMinute.atMost})
        )
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
 * Bring under `SESSION_IDLE_TIMEOUT_MINUTES` every live session written
 * under an earlier setting of it — unset, or laxer — and return how many
 * were rewritten. Such a row's `"expiresAt"` lies more than the window
 * ahead, so Better Auth would neither refresh it nor move its `"updatedAt"`
 * for days: the sweep would revoke it in use, and it would outlive the
 * window. Each gets the sweep's stamp, `"updatedAt"` = `least(now,
 * "updatedAt" + 5 minutes)` — no earlier than its last request under any
 * setting, five minutes being the longest refresh — and an `"expiresAt"` no
 * more than the window past it, which Better Auth refreshes at the next
 * request a minute on. A row refreshed after `now` (by a request while the
 * clamp runs, or a replica still on the earlier setting) keeps its
 * `"updatedAt"`: the stamp never moves one back.
 *
 * A row shaped as Better Auth's "don't remember me" sign-in, a day from its
 * creation, is left as it is: Better Auth never refreshes one, so an earlier
 * expiry would sign it out in use.
 *
 * Batches of {@link SESSION_CLAMP_BATCH} rows down `session_expiresAt_idx`
 * (`db/boot-indexes.ts`), until one comes back short. No statement while the
 * variable is unset. Runs at boot (`db/migrate.ts`) and before every sweep,
 * which also catches the rows a replica still on the earlier setting writes
 * during a rolling restart. `expiresIn` stands in for the variable's window,
 * in seconds (the integration test's).
 */
export async function clampSessionsToIdleWindow(
  sql: Sql,
  options: { now?: number; expiresIn?: number; batch?: number } = {},
): Promise<number> {
  const expiresIn =
    options.expiresIn ??
    (parseSessionIdleTimeoutMinutes() === null
      ? null
      : sessionIdleWindowSeconds().expiresIn);
  if (expiresIn === null) return 0;
  const now = new Date(options.now ?? Date.now());
  const batch = options.batch ?? SESSION_CLAMP_BATCH;
  const above = new Date(
    now.getTime() + (expiresIn + CLOCK_SLACK_SECONDS) * 1000,
  );
  let from = above;
  let clamped = 0;
  for (;;) {
    const rows = await sessionClampBatch(sql, {
      now,
      expiresIn,
      above,
      from,
      batch,
    });
    clamped += rows.length;
    if (rows.length < batch) break;
    // On from the latest expiry this batch took: a row it skipped (another
    // transaction's lock, the "don't remember me" shape) is not read again.
    from = new Date(
      rows.reduce(
        (latest, row) => Math.max(latest, row.expiresAt.getTime()),
        from.getTime(),
      ),
    );
  }
  return clamped;
}

/**
 * One batch of {@link clampSessionsToIdleWindow}: at most `batch` live rows
 * expiring after `above` (the window, and a second's slack, past `now`), from
 * `from` on, in expiry order. Each comes back with the expiry it had.
 * Exported for the plan check (`session-idle.integration.ts`).
 */
export function sessionClampBatch(
  sql: Sql,
  pass: {
    now: Date;
    expiresIn: number;
    above: Date;
    from: Date;
    batch: number;
  },
): PendingQuery<{ expiresAt: Date }[]> {
  return sql<{ expiresAt: Date }[]>`
    WITH "unbounded" AS MATERIALIZED (
      SELECT "id", "expiresAt" FROM "session"
      WHERE "expiresAt" > ${pass.above}
        AND "expiresAt" >= ${pass.from}
        AND "expiresAt" - "createdAt" NOT BETWEEN
          make_interval(secs => ${DONT_REMEMBER_ME_SECONDS - CLOCK_SLACK_SECONDS})
          AND make_interval(secs => ${DONT_REMEMBER_ME_SECONDS + CLOCK_SLACK_SECONDS})
      ORDER BY "expiresAt"
      LIMIT ${pass.batch}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "session" s SET
      "updatedAt" = greatest(
        s."updatedAt",
        least(
          ${pass.now},
          s."updatedAt" + make_interval(secs => ${SESSION_REFRESH_SECONDS_OUTSIDE_IDLE_WINDOW})
        )
      ),
      "expiresAt" = least(
        s."expiresAt",
        greatest(
          s."updatedAt",
          least(
            ${pass.now},
            s."updatedAt" + make_interval(secs => ${SESSION_REFRESH_SECONDS_OUTSIDE_IDLE_WINDOW})
          )
        ) + make_interval(secs => ${pass.expiresIn})
      )
    FROM "unbounded" u
    WHERE s."id" = u."id"
    RETURNING u."expiresAt"
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
