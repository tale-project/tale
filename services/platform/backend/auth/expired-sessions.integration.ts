/**
 * Real-Postgres proof of the expired-session reaper: only rows expired for
 * longer than the grace go, a live session and one inside the grace stay,
 * a run takes at most its batch budget, a row another transaction holds is
 * skipped rather than waited on, and the daily job deletes the same rows.
 */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import { createTaskList } from '../jobs/task-list.ts';
import {
  EXPIRED_SESSION_GRACE_MS,
  reapExpiredSessions,
} from './expired-sessions.ts';

export async function checkExpiredSessionReaper(
  sql: Sql,
  ctx: { userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const now = Date.now();
  const hour = 3_600_000;
  const prefix = `reap-${randomUUID()}`;
  const live = `${prefix}-live`;
  const inGrace = `${prefix}-in-grace`;
  const locked = `${prefix}-locked`;
  const expired = Array.from(
    { length: 5 },
    (_, index) => `${prefix}-expired-${index}`,
  );
  const insert = async (id: string, expiresAt: number): Promise<void> => {
    await sql`
      INSERT INTO "session" ("id", "userId", "token", "createdAt",
                             "updatedAt", "expiresAt")
      VALUES (${id}, ${ctx.userId}, ${`tok-${id}`},
              ${new Date(expiresAt - 7 * 24 * hour)},
              ${new Date(expiresAt - 7 * 24 * hour)},
              ${new Date(expiresAt)})
    `;
  };
  const surviving = async (): Promise<Set<string>> => {
    const rows = await sql<{ id: string }[]>`
      SELECT "id" FROM "session" WHERE "id" LIKE ${`${prefix}-%`}
    `;
    return new Set(rows.map((row) => row.id));
  };

  try {
    await insert(live, now + hour);
    // Expired an hour ago: past its expiry but inside the grace.
    await insert(inGrace, now - hour);
    for (const id of expired) {
      await insert(id, now - EXPIRED_SESSION_GRACE_MS - 24 * hour);
    }

    // A run is bounded: two batches of two take four rows even though at
    // least five are due, and say they did not drain. Other lanes' rows may
    // be due as well, so the proof is the count, not which four went.
    const bounded = await reapExpiredSessions(sql, { batch: 2, maxBatches: 2 });
    const afterBounded = await surviving();
    const dueLeft = expired.filter((id) => afterBounded.has(id)).length;
    record(
      'expired sessions: a run stops at its batch budget',
      bounded.deleted === 4 && !bounded.drained && dueLeft >= 1,
      `deleted=${bounded.deleted} (want 4), drained=${bounded.drained} (want false), dueLeft=${dueLeft} (want >= 1)`,
    );

    // The daily job drains the rest: every row expired past the grace goes,
    // the live session and the one inside the grace stay.
    const handler = createTaskList({ sql })['maintenance.expired_sessions'];
    if (handler === undefined) {
      record(
        'expired sessions: the daily job deletes only rows past the grace',
        false,
        'no maintenance.expired_sessions handler in the task list',
      );
      return;
    }
    await handler({});
    const afterJob = await surviving();
    const expiredLeft = expired.filter((id) => afterJob.has(id));
    record(
      'expired sessions: the daily job deletes only rows past the grace',
      expiredLeft.length === 0 && afterJob.has(live) && afterJob.has(inGrace),
      `expiredLeft=${expiredLeft.length} (want 0), liveKept=${afterJob.has(live)}, inGraceKept=${afterJob.has(inGrace)}`,
    );

    // A due row another transaction holds is skipped, not waited on: the
    // run finishes while the lock is still held and the row survives it.
    await insert(locked, now - EXPIRED_SESSION_GRACE_MS - 24 * hour);
    let skipped: { deleted: number; drained: boolean } | undefined;
    await sql.begin(async (tx) => {
      await tx`SELECT "id" FROM "session" WHERE "id" = ${locked} FOR UPDATE`;
      skipped = await reapExpiredSessions(sql);
    });
    const afterLocked = await surviving();
    const lockedKept = afterLocked.has(locked);
    await reapExpiredSessions(sql);
    const afterRelease = await surviving();
    record(
      'expired sessions: a row another transaction holds is skipped, then reaped',
      skipped?.drained === true &&
        lockedKept &&
        !afterRelease.has(locked) &&
        afterRelease.has(live) &&
        afterRelease.has(inGrace),
      `drainedUnderLock=${skipped?.drained}, keptWhileLocked=${lockedKept}, goneAfterRelease=${!afterRelease.has(locked)}`,
    );
  } finally {
    await sql`DELETE FROM "session" WHERE "id" LIKE ${`${prefix}-%`}`;
  }
}
