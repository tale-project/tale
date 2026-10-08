import type { JobResult, JobWithMetadata, PgBoss } from 'pg-boss';
import type { Sql } from 'postgres';

import {
  describeDatabaseError,
  isDatabaseUnavailable,
} from '../db/unavailable.ts';
import { reportError } from '../error-reporting.ts';
import { traceBackendTask, traceWorkerPhase } from '../tracing.ts';
import { bossDbInTx } from './enqueue.ts';
import type { BackendTaskList } from './task-list.ts';
import {
  physicalTaskQueue,
  queueGroupConcurrency,
  slotQueueSlots,
  TASK_WORKER_BATCH_LIMITS,
  TASK_WORKER_IDLE_POLL_SECONDS,
  TASK_WORKER_SLOT_QUEUES,
} from './tasks.ts';

export type WorkerOptions = {
  boss: PgBoss;
  taskList: BackendTaskList;
  /** Max jobs fetched (and processed concurrently) per queue per fetch;
   * `TASK_WORKER_BATCH_LIMITS` lowers it for the queues it names, and a
   * queue in `TASK_WORKER_SLOT_QUEUES` runs as many one-job slots instead
   * (`slotQueueSlots`). */
  concurrency?: number;
  /** One-job slots of the agent start queues (AGENT_START_SLOTS). */
  agentStartSlots?: number | undefined;
  /** One-job slots of the agent drive queues (AGENT_DRIVE_SLOTS). */
  agentDriveSlots?: number | undefined;
  /** Automation steps one organization runs at once across every worker
   * (AUTOMATION_ORG_CONCURRENCY); 0 or unset, no limit. */
  automationOrgConcurrency?: number | undefined;
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
 * The queue policies whose unique index admits one QUEUED job per key: a
 * successor refused there collapses into the job already queued under its
 * key, which does the work (`TaskQueueOptions.policy` in `tasks.ts`).
 */
const COLLAPSING_POLICIES: ReadonlySet<string> = new Set(['short', 'stately']);

/** How a hand-over ended: its successor queued; collapsed into the job
 * already queued under its key; or none, because the claim had already
 * ended. */
type HandOverOutcome = 'handed_over' | 'collapsed' | 'claim_ended';

/**
 * How many claims the hand-over's completion of ONE job ended. pg-boss
 * completes active jobs only and answers `{ jobs, requested, affected }`
 * (typed as an empty interface): 1 is this worker's claim, ended here; 0 a
 * claim that was no longer active — cancelled, completed or failed, or
 * expired back to its queue, while this worker held it. Anything else
 * confirms nothing, and throws.
 */
function claimsEnded(answer: unknown): 0 | 1 {
  if (typeof answer === 'object' && answer !== null && 'affected' in answer) {
    const { affected } = answer;
    if (affected === 0 || affected === 1) return affected;
  }
  throw new Error(
    `the completion confirmed no claim: ${answer === undefined ? 'undefined' : JSON.stringify(answer)}`,
  );
}

/**
 * Hand a claimed job over to the live colour: a successor with the job's
 * own payload, singleton key and priority, due five seconds out so the
 * live colour takes it once this worker is gone. The claim is completed
 * first and both writes are ONE transaction (`bossDbInTx`), so a crash
 * between them loses nothing and doubles nothing, and no queue policy
 * refuses the successor for the claim itself (`exclusive` admits one
 * queued-or-active job per key).
 *
 * The successor is sent only once the completion confirms that this
 * worker's claim ended here. A claim that ended meanwhile — cancelled, or
 * completed elsewhere — gets none: its work is withdrawn or done, and a
 * successor would bring it back. A successor refused on a `short` or
 * `stately` queue is not needed: the job already queued under its key does
 * the work. Any other refusal, or a completion that confirms nothing,
 * throws inside the transaction: it rolls back, and the claim takes
 * pg-boss's failure path under its queue's retry policy rather than ending
 * without a successor. A keyless job on a standard queue hands over as
 * before. The queue's own retry and expiry options apply to the successor,
 * as they applied to the job, and the job's own heartbeat travels with it:
 * a queue created before its heartbeat was declared has none to lend
 * (`TaskQueueOptions.heartbeatSeconds`). So does its group, or the
 * successor would run outside its organization's limit (`TASK_JOB_GROUP`).
 */
async function handOver(
  boss: PgBoss,
  sql: Sql,
  name: string,
  job: JobWithMetadata<unknown>,
  data: object | null,
): Promise<HandOverOutcome> {
  return sql.begin(async (tx): Promise<HandOverOutcome> => {
    const db = bossDbInTx(tx);
    if (claimsEnded(await boss.complete(name, job.id, null, { db })) === 0) {
      return 'claim_ended';
    }
    const successor = await boss.send(name, data, {
      db,
      startAfter: 5,
      ...(job.singletonKey !== null ? { singletonKey: job.singletonKey } : {}),
      ...(job.priority !== 0 ? { priority: job.priority } : {}),
      ...(typeof job.heartbeatSeconds === 'number'
        ? { heartbeatSeconds: job.heartbeatSeconds }
        : {}),
      ...(typeof job.groupId === 'string'
        ? {
            group: {
              id: job.groupId,
              ...(typeof job.groupTier === 'string'
                ? { tier: job.groupTier }
                : {}),
            },
          }
        : {}),
    });
    if (successor !== null) return 'handed_over';
    // pg-boss's own record of the queue, read on this path only.
    const policy = (await boss.getQueue(name))?.policy;
    if (policy !== undefined && COLLAPSING_POLICIES.has(policy)) {
      return 'collapsed';
    }
    throw new Error(
      `the hand-over queued no successor on queue ${name} (policy ${policy ?? 'unknown'})`,
    );
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
    const queue = physicalTaskQueue(name);
    const pollSeconds = TASK_WORKER_IDLE_POLL_SECONDS.get(name) ?? 2;
    const groupConcurrency = queueGroupConcurrency(name, {
      automationOrgConcurrency: options.automationOrgConcurrency,
    });
    await options.boss.work(
      queue,
      {
        ...(TASK_WORKER_SLOT_QUEUES.has(name)
          ? {
              batchSize: 1,
              localConcurrency: slotQueueSlots(name, {
                concurrency,
                agentStartSlots: options.agentStartSlots,
                agentDriveSlots: options.agentDriveSlots,
              }),
            }
          : {
              batchSize: Math.min(
                concurrency,
                TASK_WORKER_BATCH_LIMITS.get(name) ?? concurrency,
              ),
            }),
        // Counted in the database across every worker: a fetch skips a job
        // whose group already has this many active, and takes the next
        // group's. Each fetch counts for itself, so slots fetching in the
        // same instant can each take one past the limit. A job without a
        // group is never held back.
        ...(groupConcurrency !== undefined ? { groupConcurrency } : {}),
        perJobResults: true,
        // The hand-over re-sends a job with its own singleton key and
        // priority, which only the metadata carries.
        includeMetadata: true,
        burstWhenBatchFull: true,
        pollingIntervalSeconds: pollSeconds,
        // NOTIFY fires on INSERT, not when a delayed job's startAfter
        // passes — the fallback poll is the ONLY thing that surfaces
        // delayed self-chains (deferred-send cadence, automation polls),
        // so it must match the polling interval, not idle at 30s.
        notifyPollingIntervalSeconds: pollSeconds,
      },
      (jobs) =>
        Promise.all(
          jobs.map((job): Promise<JobResult> =>
            traceBackendTask(name, async (span): Promise<JobResult> => {
              try {
                if (
                  options.shouldDefer !== undefined &&
                  (await traceWorkerPhase('check_drain', () =>
                    options.shouldDefer?.(),
                  ))
                ) {
                  // Completing a `retryLimit: 0` job without a successor
                  // would drop it: the hand-over completes it and queues its
                  // successor together (the batch's own completion then finds
                  // it done and changes nothing — as it does a claim that had
                  // already ended, since pg-boss completes active jobs only).
                  if (typeof job.data !== 'object') {
                    throw new Error(
                      `task ${name} (job ${job.id}) payload is not an object`,
                    );
                  }
                  const sql = options.sql;
                  const data = job.data;
                  const outcome = await traceWorkerPhase('handover', () =>
                    handOver(options.boss, sql, queue, job, data),
                  );
                  if (outcome === 'claim_ended') {
                    console.log(
                      `[backend] task ${name} (job ${job.id}) not handed over: the claim was no longer active (cancelled, completed or expired)`,
                    );
                  }
                  return { id: job.id, status: 'completed' };
                }
                // pg-boss aborts `job.signal` once the batch outlives the
                // queue's `expireInSeconds` and retries the job; a handler that
                // honours it stops instead of running beside its retry.
                const result = await traceWorkerPhase('handler', () =>
                  handler(job.data, { signal: job.signal, jobId: job.id }),
                );
                return {
                  id: job.id,
                  status: 'completed',
                  // An expired/shutting-down attempt must not certify a
                  // successful scan, even if its handler ignored the signal.
                  // pg-boss also fences the stored completion to active jobs.
                  ...(result !== undefined && !job.signal.aborted
                    ? { output: result.output }
                    : {}),
                };
              } catch (error) {
                span?.setStatus({ code: 2, message: 'internal_error' });
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
        ),
    );
  }
}
