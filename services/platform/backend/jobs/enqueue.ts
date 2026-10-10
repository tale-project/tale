import type { Db, PgBoss } from 'pg-boss';
import type { Sql, TransactionSql } from 'postgres';

import {
  physicalTaskQueue,
  TASK_JOB_GROUP,
  TASK_QUEUE_OPTIONS,
  type TaskIdentifier,
  type TaskPayloads,
} from './tasks.ts';

export interface EnqueueOptions {
  /** Deferred execution ("runAfter"): absolute instant the job may run. */
  startAfter?: Date;
  /**
   * Dedup key: at most one job with this key sits in the queue's created
   * state (a duplicate send is dropped — pg-boss `singletonKey`).
   */
  singletonKey?: string;
  /**
   * Fetch order within a queue: pg-boss orders `priority DESC, created_on`,
   * so a higher number is taken first and work of equal priority stays fair
   * oldest-first. Omitted = 0.
   */
  priority?: number;
  /**
   * The group the job counts against where its queue limits jobs per group
   * (pg-boss `group`). Omitted, the queue's own {@link TASK_JOB_GROUP} rule
   * derives it from the payload.
   */
  group?: string;
}

let bossInstance: PgBoss | null = null;

/**
 * Indexing a file somebody is watching outranks indexing a backlog.
 *
 * `rag.index_file` is one queue for every source: a person's upload, a
 * OneDrive sync, a crawl, a video link, an emailed attachment. A background
 * source that mints rows faster than they drain used to put every interactive
 * upload behind it — on 0.4 by holding a shared per-org cap of 3, and here by
 * simply being ahead in a FIFO queue. Neither is a bug in the source; the
 * queue was just undifferentiated.
 *
 * One level is enough. pg-boss keeps `created_on` as the tiebreak, so
 * interactive work is still fair among itself, and the backlog still drains
 * whenever no one is waiting — no reserved slot, no second file queue, no
 * starving the sources.
 *
 * Inbound email bodies are the one source with a queue of their own
 * (`rag.index_message`), so a mailbox's first sync never stands in front of
 * a file in `rag.index_file`. That order holds at the queue only: past it,
 * every indexing batch — file, email or crawl — waits for the
 * organization's embedding limiter (`maxConcurrentRequests`) in arrival
 * order, and only a search query goes ahead there. A lower limiter priority
 * for email would starve it behind a long sync until its jobs gave up, and
 * nothing re-queues a message the way a file's retry does.
 */
export const PRIORITY_INTERACTIVE = 10;

/**
 * Install the process-wide pg-boss instance the enqueue façade sends
 * through. Called once from main.ts (and the integration harness) before
 * any `addJobInTx`.
 */
export function setEnqueueBoss(boss: PgBoss): void {
  bossInstance = boss;
}

function requireBoss(): PgBoss {
  if (!bossInstance) {
    throw new Error(
      'pg-boss is not initialized — setEnqueueBoss() must run at boot before any enqueue',
    );
  }
  return bossInstance;
}

/**
 * pg-boss's `db` option over postgres.js: pg-boss runs its statements on
 * the caller's connection, so a send or a completion commits or rolls back
 * with the caller's own writes. The one adapter for every pg-boss call that
 * rides a transaction — `addJobInTx` and the draining worker's hand-over
 * (`runner.ts`).
 */
export function bossDbInTx(tx: TransactionSql | Sql): Db {
  return {
    executeSql: async (text, values) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- pg-boss hands plain JSON-safe parameters; postgres.js's ParameterOrJSON generic can't be named for a passthrough adapter
      const parameters = (values ?? []) as never[];
      const rows = await tx.unsafe(text, parameters);
      return { rows: [...rows] };
    },
  };
}

/**
 * Enqueue a job INSIDE the caller's transaction.
 *
 * This is the replacement for Convex's transactional scheduler
 * (`ctx.scheduler.runAfter`): pass the SAME `tx` that writes the state
 * change, so a rolled-back transaction enqueues nothing and a committed one
 * enqueues exactly once — pg-boss's `send({ db })` rides the transaction via
 * an adapter over postgres.js. NOTIFY fires on commit, so the worker cannot
 * see the job before the state it belongs to. Delivery downstream is
 * at-least-once — handlers must be idempotent (see `tasks.ts`).
 */
export async function addJobInTx<TName extends TaskIdentifier>(
  tx: TransactionSql | Sql,
  identifier: TName,
  payload: TaskPayloads[TName],
  options: EnqueueOptions = {},
): Promise<string | null> {
  // Per job, not only on the queue: a queue created before its heartbeat
  // was declared keeps none (`createQueue` inserts, it never updates).
  const heartbeatSeconds = TASK_QUEUE_OPTIONS[identifier].heartbeatSeconds;
  // Derived here, not at each call site, so no enqueue of a grouped queue
  // can leave it out and slip past its group's limit.
  const group = options.group ?? TASK_JOB_GROUP[identifier]?.(payload);
  return requireBoss().send(physicalTaskQueue(identifier), payload, {
    db: bossDbInTx(tx),
    ...(options.startAfter !== undefined
      ? { startAfter: options.startAfter }
      : {}),
    ...(options.singletonKey !== undefined
      ? { singletonKey: options.singletonKey }
      : {}),
    ...(options.priority !== undefined ? { priority: options.priority } : {}),
    ...(heartbeatSeconds !== undefined ? { heartbeatSeconds } : {}),
    ...(group !== undefined && group !== '' ? { group: { id: group } } : {}),
  });
}
