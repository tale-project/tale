import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import {
  LIGHT_SESSION_IDLE_MS,
  releaseIdleLightSessions,
} from './light-sessions.ts';

/** Real Postgres proof of the light sandboxes' idle sweep: a stale row of a
 * session id is reaped only while no newer incarnation of the same id is
 * live. A session id names every incarnation of one owner's sandbox, each its
 * own row, and the spawner and the settle both act on the id — so the failed
 * start of a few minutes ago must not take the working sandbox its retry
 * made. The spawner is injected: it records which sessions it was asked to
 * destroy and answers that each was idle. */
export async function checkLightSessionSweep(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  // A private organization scope: the sweep is platform-wide, and this
  // probe's rows must be the only light rows it can find stale.
  const orgId = `${ctx.orgId}:light:${randomUUID()}`;
  const now = Date.now();
  const minutes = (count: number) => count * 60_000;
  const working = `lt-working-${randomUUID()}`;
  const abandoned = `lt-abandoned-${randomUUID()}`;
  const retried = `lt-retried-${randomUUID()}`;
  const settled = `lt-settled-${randomUUID()}`;
  const sessionIds = [working, abandoned, retried, settled];

  const insert = (
    sessionId: string,
    status: string,
    createdAgoMin: number,
    activeAgoMin: number | null,
  ) => sql`
    INSERT INTO app.sandbox_sessions (
      org_id, session_id, status, owner_type, owner_id, created_by,
      created_at_ms, last_activity_at_ms, expires_at_ms
    ) VALUES (
      ${orgId}, ${sessionId}, ${status}, 'light', ${sessionId},
      ${ctx.userId}, ${now - minutes(createdAgoMin)},
      ${activeAgoMin === null ? null : now - minutes(activeAgoMin)},
      ${now + minutes(60)}
    )
  `;
  const statusesOf = async (sessionId: string) =>
    (
      await sql<{ status: string }[]>`
        SELECT status FROM app.sandbox_sessions
        WHERE org_id = ${orgId} AND session_id = ${sessionId}
        ORDER BY created_at_ms
      `
    ).map((row) => row.status);

  try {
    // A conversation whose first start failed ten minutes ago and whose retry
    // is working, used a minute ago: nothing about it is idle.
    await insert(working, 'failed', 10, null);
    await insert(working, 'active', 9, 1);
    // A start that failed ten minutes ago and was never retried.
    await insert(abandoned, 'failed', 10, null);
    // A failed start, then a retry that also failed and went stale.
    await insert(retried, 'failed', 12, null);
    await insert(retried, 'failed', 10, null);
    // A failed start whose retry has since been destroyed.
    await insert(settled, 'failed', 12, null);
    await insert(settled, 'destroyed', 10, 8);

    const asked: string[] = [];
    const swept = await releaseIdleLightSessions(
      sql,
      { now, idleMs: LIGHT_SESSION_IDLE_MS, batch: 500 },
      {
        destroyIfIdle: (sessionId) => {
          asked.push(sessionId);
          return Promise.resolve({ destroyed: true, busy: false });
        },
      },
    );
    const ours = asked.filter((sessionId) => sessionIds.includes(sessionId));
    const [workingAfter, abandonedAfter, retriedAfter, settledAfter] =
      await Promise.all(sessionIds.map(statusesOf));

    record(
      'light sandboxes: the idle sweep spares a working sandbox whose conversation had an older start fail, and reaps the stale ones [SBX-R26]',
      !ours.includes(working) &&
        JSON.stringify(workingAfter) === JSON.stringify(['failed', 'active']) &&
        ours.includes(abandoned) &&
        abandonedAfter.every((status) => status === 'destroyed') &&
        ours.includes(retried) &&
        retriedAfter.every((status) => status === 'destroyed') &&
        ours.includes(settled) &&
        settledAfter.every((status) => status === 'destroyed') &&
        swept >= 3,
      `asked=${JSON.stringify(ours.map((id) => id.split('-')[1]))} working=${JSON.stringify(workingAfter)} (want failed,active) abandoned=${JSON.stringify(abandonedAfter)} retried=${JSON.stringify(retriedAfter)} settled=${JSON.stringify(settledAfter)} swept=${swept}`,
    );
  } finally {
    await sql`DELETE FROM app.sandbox_sessions WHERE org_id = ${orgId}`;
  }
}
