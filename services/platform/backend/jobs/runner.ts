import type { JobResult, PgBoss } from 'pg-boss';

import { reportError } from '../error-reporting.ts';
import type { BackendTaskList } from './task-list.ts';

export interface WorkerOptions {
  boss: PgBoss;
  taskList: BackendTaskList;
  /** Max jobs fetched (and processed concurrently) per queue per fetch. */
  concurrency?: number;
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
