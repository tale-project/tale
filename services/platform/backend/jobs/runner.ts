import type { JobResult, JobWithMetadata, PgBoss } from 'pg-boss';
import type { Sql } from 'postgres';

import {
  describeDatabaseError,
  isDatabaseUnavailable,
} from '../db/unavailable.ts';
import { reportError } from '../error-reporting.ts';
import type { BackendTaskList } from './task-list.ts';
import { TASK_WORKER_BATCH_LIMITS } from './tasks.ts';

export type WorkerOptions = {
  boss: PgBoss;
  taskList: BackendTaskList;
  /** Max jobs fetched (and processed concurrently) per queue per fetch;
   * `TASK_WORKER_BATCH_LIMITS` lowers it for the queues it names. */
  concurrency?: number;
} & (
  | { shouldDefer?: undefined; sql?: undefined }
  | {
      /**
       * When true, this worker must not start NEW work (its colour is
       * draining). Already-claimed `retryLimit: 0` jobs finish in this
       * process; a new claim is handed over to the live colour
       * ({@link handOver}) so the job is not lost.
       */
      shouldDefer: () => Promise<boolean>;
      /** The app's pool: a hand-over is one transaction of it. */
      sql: Sql;
    }
);

/**
 * Hand a claimed job over to the live colour: a successor with the job's
 * own payload, singleton key and priority, due five seconds out so the
 * live colour takes it once this worker is gone. The claim is completed
 * first and both writes are ONE transaction, so a crash between them loses
 * nothing and doubles nothing, and no queue policy refuses the successor
 * for the claim itself (`exclusive` admits one queued-or-active job per
 * key). A successor its key refuses because another job with that key is
 * already queued is not needed: that job does the work (`short`, `stately`
 * collapse by key by design). A keyless job on a standard queue hands over
 * as before, keyless. The queue's own retry and expiry options apply to
 * the successor, as they applied to the job.
 */
async function handOver(
  boss: PgBoss,
  sql: Sql,
  name: string,
  job: JobWithMetadata<unknown>,
  data: object | null,
): Promise<void> {
  await sql.begin(async (tx) => {
    const db = {
      executeSql: async (text: string, values?: unknown[]) => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- pg-boss hands plain JSON-safe parameters, as `addJobInTx` passes them
        const parameters = (values ?? []) as never[];
        return { rows: [...(await tx.unsafe(text, parameters))] };
      },
    };
    await boss.complete(name, job.id, null, { db });
    await boss.send(name, data, {
      db,
      startAfter: 5,
      ...(job.singletonKey !== null ? { singletonKey: job.singletonKey } : {}),
      ...(job.priority !== 0 ? { priority: job.priority } : {}),
    });
  });
}

/**
 * Register one pg-boss worker per task queue. Jobs are fetched in batches of
 * up to `concurrency` and processed concurrently with PER-JOB resolution
 * (`perJobResults`) — one failing job retries alone, its batch-mates
 * complete. Notify-enabled queues wake in milliseconds; the polling interval
 * is only the recovery backstop.
 */
export async function startWorker(options: WorkerOptions): Promise<void> {
  const concurrency = options.concurrency ?? 5;
  for (const [name, handler] of Object.entries(options.taskList)) {
    await options.boss.work(
      name,
      {
        batchSize: Math.min(
          concurrency,
          TASK_WORKER_BATCH_LIMITS.get(name) ?? concurrency,
        ),
        perJobResults: true,
        // The hand-over re-sends a job with its own singleton key and
        // priority, which only the metadata carries.
        includeMetadata: true,
        burstWhenBatchFull: true,
        pollingIntervalSeconds: 2,
        // NOTIFY fires on INSERT, not when a delayed job's startAfter
        // passes — the fallback poll is the ONLY thing that surfaces
        // delayed self-chains (deferred-send cadence, automation polls),
        // so it must match the polling interval, not idle at 30s.
        notifyPollingIntervalSeconds: 2,
      },
      (jobs) =>
        Promise.all(
          jobs.map(async (job): Promise<JobResult> => {
            try {
              if (
                options.shouldDefer !== undefined &&
                (await options.shouldDefer())
              ) {
                // Completing a `retryLimit: 0` job without a successor
                // would drop it: the hand-over completes it and queues its
                // successor together (the batch's own completion then finds
                // it done and changes nothing).
                if (typeof job.data !== 'object') {
                  throw new Error(
                    `task ${name} (job ${job.id}) payload is not an object`,
                  );
                }
                await handOver(options.boss, options.sql, name, job, job.data);
                return { id: job.id, status: 'completed' };
              }
              // pg-boss aborts `job.signal` once the batch outlives the
              // queue's `expireInSeconds` and retries the job; a handler that
              // honours it stops instead of running beside its retry.
              await handler(job.data, { signal: job.signal });
              return { id: job.id, status: 'completed' };
            } catch (error) {
              if (isDatabaseUnavailable(error)) {
                // A database restart fails whatever was running. The failed
                // job is retried under its queue's policy once the database
                // is back (a `retryLimit: 0` lane is its watchdog's to
                // recover), so this is an operational event, not a defect.
                console.warn(
                  `[backend] task ${name} (job ${job.id}) failed, database unavailable: ${describeDatabaseError(error)}`,
                );
              } else {
                console.error(
                  `[backend] task ${name} (job ${job.id}) failed:`,
                  error,
                );
                // Queue names are a bounded vocabulary — safe as a tag.
                reportError(error, {
                  tags: { 'tale.task': name },
                  extra: { jobId: job.id },
                });
              }
              return {
                id: job.id,
                status: 'failed',
                output: {
                  message:
                    error instanceof Error ? error.message : String(error),
                },
              };
            }
          }),
        ),
    );
  }
}
