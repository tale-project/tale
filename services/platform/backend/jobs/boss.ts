import { PgBoss } from 'pg-boss';

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
  const boss = new PgBoss({
    connectionString: databaseUrl,
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
