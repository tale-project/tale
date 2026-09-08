import { PgBoss } from 'pg-boss';
import type { Sql } from 'postgres';

import { appPoolMax } from '../db/sql.ts';
import { resolvePostgresConnection } from '../db/ssl.ts';
import { TASK_QUEUE_OPTIONS } from './tasks.ts';

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
  boss.on('error', (error) => {
    console.error('[backend] pg-boss error:', error);
  });
  boss.on('warning', (warning) => {
    console.warn('[backend] pg-boss warning:', warning);
  });
  return boss;
}

/**
 * Ensure every task queue exists with its declared options. Runs on every
 * boot (api sends, workers consume — both need the queues); racing creators
 * are tolerated, pg-boss updates options idempotently via createQueue's
 * upsert semantics or throws on a lost unique race, which the retry absorbs.
 */
export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const [name, queueOptions] of Object.entries(TASK_QUEUE_OPTIONS)) {
    try {
      await boss.createQueue(name, { notify: true, ...queueOptions });
    } catch (error) {
      // A concurrent boot may have won the create; verify before surfacing.
      const existing = await boss.getQueue(name);
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
