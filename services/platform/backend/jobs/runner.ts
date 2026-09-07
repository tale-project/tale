import type { JobResult, PgBoss } from 'pg-boss';

import { reportError } from '../error-reporting.ts';
import type { BackendTaskList } from './task-list.ts';

export interface WorkerOptions {
  boss: PgBoss;
  taskList: BackendTaskList;
  /** Max jobs fetched (and processed concurrently) per queue per fetch. */
  concurrency?: number;
  /**
   * When true, this worker must not start NEW work (its colour is
   * draining). Already-claimed `retryLimit: 0` jobs finish in this
   * process; a new claim is requeued and this fetch is completed so the
   * job is not lost.
   */
  shouldDefer?: () => Promise<boolean>;
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
        batchSize: concurrency,
        perJobResults: true,
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
                // Requeue first: completing a `retryLimit: 0` job without a
                // successor would drop it. `startAfter` lets the live colour
                // take it once this worker is gone.
                await options.boss.send(
                  name,
                  // pg-boss send rejects `unknown`; every task payload is a JSON object.
                  job.data as Record<string, unknown>,
                  { startAfter: 5 },
                );
                return { id: job.id, status: 'completed' };
              }
              await handler(job.data);
              return { id: job.id, status: 'completed' };
            } catch (error) {
              console.error(
                `[backend] task ${name} (job ${job.id}) failed:`,
                error,
              );
              // Queue names are a bounded vocabulary — safe as a tag.
              reportError(error, {
                tags: { 'tale.task': name },
                extra: { jobId: job.id },
              });
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
