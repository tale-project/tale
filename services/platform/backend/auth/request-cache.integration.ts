/**
 * Real-Postgres proof of the per-process auth cache (`request-cache.ts`):
 * the triggers boot installs write the invalidation log for exactly the
 * changes a cached copy must not outlive; a repeat request is answered from
 * memory; a role change, a disabled seat and a deleted session reach the
 * next request within a second; and a session whose sliding refresh falls
 * due still goes to Better Auth, which writes it.
 *
 * The cache is started here, against the harness's own server, and stopped
 * before the lane returns: every other lane runs without it, so none that
 * proves an immediate refusal has to allow for the cache's second.
 */
import { setTimeout as sleep } from 'node:timers/promises';

import { sessionIdleWindowSeconds } from '@tale/shared/utils/session-idle';
import type { Sql } from 'postgres';

import {
  AUTH_INVALIDATION_TRIGGERS,
  presentAuthInvalidationTriggers,
} from '../db/auth-invalidation-triggers.ts';
import {
  startAuthRequestCache,
  stopAuthRequestCache,
} from './request-cache.ts';

/** How fast this lane's cache reads the log; production reads every 200 ms. */
const LANE_POLL_MS = 50;
/** The promise the lane holds the cache to. */
const WITHIN_MS = 1_000;

interface LogRow {
  kind: string;
  subjectId: string;
}

/** Poll `probe` until it holds or `ms` pass; how long it took, or null. */
async function heldWithin(
  ms: number,
  probe: () => Promise<boolean>,
): Promise<number | null> {
  const started = performance.now();
  for (;;) {
    if (await probe()) return Math.round(performance.now() - started);
    if (performance.now() - started > ms) return null;
    await sleep(20);
  }
}

export async function checkAuthRequestCache(
  sql: Sql,
  base: string,
  ctx: { orgId: string },
  // A plain member of the organization, signed in with a password.
  member: { cookie: string; userId: string; memberId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const present = await presentAuthInvalidationTriggers(sql);
  record(
    'auth cache: boot installed the invalidation triggers on session, user and member',
    AUTH_INVALIDATION_TRIGGERS.every((name) => present.has(name)),
    `present=${[...present].sort().join(',')} (want ${[...AUTH_INVALIDATION_TRIGGERS].sort().join(',')})`,
  );

  const sessions = await sql<{ id: string }[]>`
    SELECT id FROM "session" WHERE "userId" = ${member.userId}
  `;
  const sessionId = sessions[0]?.id ?? '';
  const since = async (): Promise<string> => {
    const rows = await sql<{ max: string | null }[]>`
      SELECT max(id)::text AS max FROM app_realtime.auth_invalidations
    `;
    return rows[0]?.max ?? '0';
  };
  const logAfter = async (cursor: string): Promise<LogRow[]> =>
    sql<LogRow[]>`
      SELECT kind, subject_id AS "subjectId"
      FROM app_realtime.auth_invalidations
      WHERE id > ${cursor}::bigint
      ORDER BY id
    `;

  // What reaches the log: a sliding refresh and the delete of an expired
  // session write nothing; any other change to the session, the user or a
  // membership writes one row naming it.
  const start = await since();
  await sql`
    UPDATE "session"
    SET "expiresAt" = "expiresAt" + interval '1 second', "updatedAt" = now()
    WHERE id = ${sessionId}
  `;
  const afterRefresh = await logAfter(start);
  const expiredId = `itest-expired-${member.userId}`;
  await sql`
    INSERT INTO "session" (id, token, "userId", "expiresAt", "createdAt",
                           "updatedAt")
    VALUES (${expiredId}, ${`${expiredId}-token`}, ${member.userId},
            now() - interval '1 minute', now(), now())
  `;
  await sql`DELETE FROM "session" WHERE id = ${expiredId}`;
  const afterExpired = await logAfter(start);
  await sql`
    UPDATE "session" SET "ipAddress" = '203.0.113.7' WHERE id = ${sessionId}
  `;
  await sql`UPDATE "user" SET name = name WHERE id = ${member.userId}`;
  await sql`
    UPDATE "member" SET role = role WHERE id = ${member.memberId}
  `;
  const written = await logAfter(start);
  record(
    'auth cache: the log names each change a cached copy must not outlive, and neither a refresh nor an expired session',
    afterRefresh.length === 0 &&
      afterExpired.length === 0 &&
      JSON.stringify(written) ===
        JSON.stringify([
          { kind: 'session', subjectId: sessionId },
          { kind: 'user', subjectId: member.userId },
          { kind: 'member', subjectId: member.userId },
        ]),
    `refresh=${afterRefresh.length} expired=${afterExpired.length} (want 0, 0) written=${JSON.stringify(written)} (want session, user, member)`,
  );

  // The session's sliding refresh falls due two seconds from now: an
  // expiry-only write, which the log ignores.
  const config = sessionIdleWindowSeconds();
  await sql`
    UPDATE "session"
    SET "expiresAt" = now() + make_interval(
      secs => ${config.expiresIn - config.updateAge + 2})
    WHERE id = ${sessionId}
  `;
  const before = await sql<{ updatedAt: Date }[]>`
    SELECT "updatedAt" FROM "session" WHERE id = ${sessionId}
  `;

  const cache = startAuthRequestCache(
    sql,
    { sessionConfig: config, pollMs: LANE_POLL_MS },
    {},
  );
  try {
    if (cache === null) throw new Error('itest: the auth cache did not start');
    const serving = await heldWithin(5_000, async () =>
      Promise.resolve(cache.stats().serving),
    );
    const projects = async (): Promise<number> =>
      (
        await fetch(
          `${base}/api/app/projects?orgId=${encodeURIComponent(ctx.orgId)}`,
          { headers: { cookie: member.cookie } },
        )
      ).status;
    const adminRead = async (): Promise<number> =>
      (
        await fetch(
          `${base}/api/app/audit-logs?orgId=${encodeURIComponent(ctx.orgId)}`,
          { headers: { cookie: member.cookie } },
        )
      ).status;

    const first = await projects();
    const hitsBefore = cache.stats();
    const second = await projects();
    const hitsAfter = cache.stats();
    record(
      'auth cache: a repeat request is answered from memory — the session and the memberships',
      serving !== null &&
        first === 200 &&
        second === 200 &&
        hitsAfter.sessionHits > hitsBefore.sessionHits &&
        hitsAfter.membershipHits > hitsBefore.membershipHits,
      `serving after ${serving} ms, statuses=${first}/${second} (want 200/200), session hits ${hitsBefore.sessionHits}→${hitsAfter.sessionHits}, membership hits ${hitsBefore.membershipHits}→${hitsAfter.membershipHits} (want both up)`,
    );

    // A role change and a disabled seat, written straight to the table.
    const refusedBefore = await adminRead();
    await sql`UPDATE "member" SET role = 'admin' WHERE id = ${member.memberId}`;
    const promoted = await heldWithin(
      WITHIN_MS,
      async () => (await adminRead()) === 200,
    );
    await sql`UPDATE "member" SET role = 'member' WHERE id = ${member.memberId}`;
    const demoted = await heldWithin(
      WITHIN_MS,
      async () => (await adminRead()) === 403,
    );
    await sql`
      UPDATE "member" SET role = 'disabled' WHERE id = ${member.memberId}
    `;
    const disabled = await heldWithin(
      WITHIN_MS,
      async () => (await projects()) === 403,
    );
    await sql`UPDATE "member" SET role = 'member' WHERE id = ${member.memberId}`;
    const restored = await heldWithin(
      WITHIN_MS,
      async () => (await projects()) === 200,
    );
    record(
      'auth cache: a role change and a disabled seat reach the next request within a second',
      refusedBefore === 403 &&
        promoted !== null &&
        demoted !== null &&
        disabled !== null &&
        restored !== null,
      `admin-only read before=${refusedBefore} (want 403); promoted→200 in ${promoted} ms, demoted→403 in ${demoted} ms, disabled→403 in ${disabled} ms, restored→200 in ${restored} ms (want each ≤ ${WITHIN_MS})`,
    );

    // The refresh: once due, the request goes to Better Auth, which slides
    // the session — a write the log leaves out.
    const cursor = await since();
    await sleep(2_500);
    const refreshed = await projects();
    const after = await sql<{ updatedAt: Date }[]>`
      SELECT "updatedAt" FROM "session" WHERE id = ${sessionId}
    `;
    const refreshLog = (await logAfter(cursor)).filter(
      (row) => row.kind === 'session',
    );
    const slid =
      before[0] !== undefined &&
      after[0] !== undefined &&
      after[0].updatedAt.getTime() > before[0].updatedAt.getTime();
    record(
      'auth cache: a session whose refresh falls due goes to Better Auth, which slides it',
      refreshed === 200 && slid && refreshLog.length === 0,
      `status=${refreshed} (want 200), updatedAt ${before[0]?.updatedAt.toISOString()}→${after[0]?.updatedAt.toISOString()} (want later), session rows in the log=${refreshLog.length} (want 0)`,
    );

    // Last: the session itself goes.
    await projects();
    await sql`DELETE FROM "session" WHERE id = ${sessionId}`;
    const refused = await heldWithin(
      WITHIN_MS,
      async () => (await projects()) === 401,
    );
    record(
      'auth cache: a session deleted in the database is refused within a second',
      refused !== null,
      `401 after ${refused} ms (want ≤ ${WITHIN_MS})`,
    );
  } finally {
    await stopAuthRequestCache();
  }
}
