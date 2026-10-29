/**
 * Real-Postgres proof that no pg-boss cron tick runs while the harness's
 * lanes do. The harness starts pg-boss with its clock off (`startBoss` with
 * `schedule: false`): every schedule production registers is registered here
 * too, and none of them ticks. A lane that needs a recurring job's work
 * drives it — the liveness sweep over the run it seeded, the transcription
 * watchdog over the rows it counts, the RAG sweep over the rows it holds —
 * and a tick beside it made the lane's outcome hang on the host's minute
 * boundary: `watchdog.rag_indexing` once failed the row the RAG lock check
 * held, before the check read it back (#4113).
 *
 * pg-boss stamps each cron pass on `version.cron_on`, and forwards every tick
 * a pass finds due through its `__pgboss__send-it` queue, so the two read
 * back what a clock did, whichever process ran it. pg-boss's tables are
 * internal; these reads are pinned to v12 like the harness's own.
 */
import type { Sql } from 'postgres';

import type { RecordCheck } from '../integration-lane-helpers.ts';

/** pg-boss's cron clock as one reading found it. */
export interface CronClock {
  /** The database's time at the reading. */
  readAt: string;
  /** When a cron pass last ran, or null if none ever has. */
  lastPass: string | null;
}

/** pg-boss's clock now: the reading the end of the run is held to. */
export async function readCronClock(sql: Sql): Promise<CronClock> {
  const [clock] = await sql<CronClock[]>`
    SELECT now()::text AS "readAt",
           (SELECT max(cron_on)::text FROM pgboss.version) AS "lastPass"
  `;
  if (clock === undefined) throw new Error('reading pg-boss’s clock: no row');
  return clock;
}

/**
 * Fails when a cron pass ran, or a tick was forwarded, since `boot`: a lane
 * may then have leaned on that tick, or been raced by it.
 */
export async function checkNoCronTick(
  sql: Sql,
  boot: CronClock,
  record: RecordCheck,
): Promise<void> {
  const [now] = await sql<{ lastPass: string | null; forwarded: string }[]>`
    SELECT
      (SELECT max(cron_on)::text FROM pgboss.version) AS "lastPass",
      (SELECT coalesce(
                string_agg(DISTINCT data->>'name', ', ' ORDER BY data->>'name'),
                '')
         FROM pgboss.job
        WHERE name = '__pgboss__send-it'
          AND created_on >= ${boot.readAt}::timestamptz) AS forwarded
  `;
  const lastPass = now === undefined ? 'unread' : now.lastPass;
  const forwarded = now === undefined ? 'unread' : now.forwarded;
  record(
    'harness: pg-boss ran no cron pass and forwarded no scheduled tick while the lanes ran',
    lastPass === boot.lastPass && forwarded === '',
    `last cron pass=${lastPass ?? 'never'} (want ${boot.lastPass ?? 'never'}, as at boot), ticks forwarded since boot=${forwarded === '' ? 'none' : forwarded} (want none) — pg-boss runs here with schedule: false, and a lane drives a recurring job's work itself`,
  );
}
