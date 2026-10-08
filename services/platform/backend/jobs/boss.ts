import { PgBoss } from 'pg-boss';
import type { Sql } from 'postgres';

import { appPoolMax } from '../db/sql.ts';
import { resolvePostgresConnection } from '../db/ssl.ts';
import {
  describeDatabaseError,
  isDatabaseUnavailable,
} from '../db/unavailable.ts';
import { physicalTaskQueue, TASK_QUEUE_OPTIONS } from './tasks.ts';

/**
 * pg-boss lifecycle — the 0.5 job engine (one queue per task identifier).
 *
 * `useListenNotify` + per-queue `notify: true` gives millisecond wake-ups on
 * job creation over a dedicated LISTEN connection, with polling kept as the
 * at-least-once recovery backstop — a lost notification delays a job, it
 * never loses one. `start()` installs/migrates the `pgboss` schema itself
 * (advisory-lock guarded), so concurrently booting containers are safe; the
 * api role starts with `supervise: false` so maintenance runs on workers.
 */
export function createBoss(
  databaseUrl: string,
  options: { supervise: boolean },
): PgBoss {
  // pg-boss hands its whole config to `new pg.Pool`, and node-postgres lets a
  // connection string's `sslmode` override an `ssl` option — so it gets the
  // URL with the TLS parameters stripped plus the resolved options, exactly
  // like every other connection this process opens (see `db/ssl.ts`).
  const { url, ssl } = resolvePostgresConnection(databaseUrl);
  const boss = new PgBoss({
    connectionString: url,
    ssl,
    // A second pool of the same size as the app's — see `appPoolMax` for why
    // that arithmetic is the operator's to control against an external
    // database.
    max: appPoolMax(),
    application_name: 'tale-backend',
    useListenNotify: true,
    supervise: options.supervise,
  });
  logErrors(boss);
  boss.on('warning', (warning) => {
    console.warn('[backend] pg-boss warning:', warning);
  });
  return boss;
}

/**
 * Log pg-boss's `error` event. pg-boss emits every failure of its own
 * database work — each queue's worker polls every two seconds, beside the
 * queue cache, the cron clock and the LISTEN connection — so a database
 * restart fails them all, again and again: hundreds of full error dumps in a
 * 20 s restart, burying every other line. An unavailable database
 * (`db/unavailable.ts`) is therefore one warn line per outage: the first
 * failure logs it, the rest stay quiet until a poll succeeds again, and that
 * re-arms the line for the next outage. Any other error is logged in full.
 */
function logErrors(boss: PgBoss): void {
  /** When the running outage was logged; `null` before the first one. */
  let loggedAt: number | null = null;
  boss.on('error', (error) => {
    const failure = withoutWorkerSuffix(error);
    // Everything pg-boss emits comes from its own node-postgres pool, so a
    // bare socket error is the database's.
    if (!isDatabaseUnavailable(failure, { fromDatabase: true })) {
      console.error('[backend] pg-boss error:', error);
      return;
    }
    if (loggedAt !== null && !polledSince(boss, loggedAt)) return;
    loggedAt = Date.now();
    console.warn(
      `[backend] pg-boss: database unavailable, polls fail quietly until one succeeds: ${describeDatabaseError(failure)}`,
    );
  });
}

/**
 * Whether a pg-boss worker has fetched from the database since `since`.
 * Every role has one: the cron clock's own worker counts, and it runs
 * wherever pg-boss starts.
 */
function polledSince(boss: PgBoss, since: number): boolean {
  return boss
    .getWipData({ includeInternal: true })
    .some(
      (worker) => worker.lastFetchedOn !== null && worker.lastFetchedOn > since,
    );
}

/**
 * The failure behind a pg-boss worker's error. The worker appends
 * ` (Queue: <name>, Worker: <id>)` to the message and re-emits a plain copy
 * of the error's fields with `queue` and `worker` beside them — which hides
 * node-postgres's code-less `Connection terminated unexpectedly`, known by
 * its exact message, from the classifier.
 */
function withoutWorkerSuffix(error: unknown): unknown {
  if (error === null || typeof error !== 'object') return error;
  const message: unknown = Reflect.get(error, 'message');
  const queue: unknown = Reflect.get(error, 'queue');
  const worker: unknown = Reflect.get(error, 'worker');
  if (
    typeof message !== 'string' ||
    typeof queue !== 'string' ||
    typeof worker !== 'string'
  ) {
    return error;
  }
  const suffix = ` (Queue: ${queue}, Worker: ${worker})`;
  return message.endsWith(suffix)
    ? { ...error, message: message.slice(0, -suffix.length) }
    : error;
}

/**
 * Ensure every task queue exists with its declared options. Runs on every
 * boot (api sends, workers consume — both need the queues); racing creators
 * are tolerated, pg-boss updates options idempotently via createQueue's
 * upsert semantics or throws on a lost unique race, which the retry absorbs.
 */
export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const [name, queueOptions] of Object.entries(TASK_QUEUE_OPTIONS)) {
    const queue = physicalTaskQueue(name);
    try {
      await boss.createQueue(queue, { notify: true, ...queueOptions });
    } catch (error) {
      // A concurrent boot may have won the create; verify before surfacing.
      const existing = await boss.getQueue(queue);
      if (!existing) {
        throw error;
      }
    }
  }
}

/**
 * `createQueue` inserts a missing queue; it does not change `policy` on
 * one that already exists, and `updateQueue` refuses a policy change.
 * Existing deployments therefore keep `standard` on `org.scaffold` even
 * though `TASK_QUEUE_OPTIONS` says `short`. Align the row pg-boss owns —
 * do not add an app migration for its schema.
 */
export async function alignQueuePolicies(sql: Sql): Promise<void> {
  try {
    await sql`
      UPDATE pgboss.queue
      SET policy = 'short'
      WHERE name = 'org.scaffold'
        AND policy IS DISTINCT FROM 'short'
    `;
  } catch (error) {
    console.warn('[backend] could not align org.scaffold queue policy:', error);
  }
}
