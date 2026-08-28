import type { PgBoss } from 'pg-boss';
import type { Sql, TransactionSql } from 'postgres';

import type { TaskIdentifier, TaskPayloads } from './tasks.ts';

export interface EnqueueOptions {
  /** Deferred execution ("runAfter"): absolute instant the job may run. */
  startAfter?: Date;
  /**
   * Dedup key: at most one job with this key sits in the queue's created
   * state (a duplicate send is dropped — pg-boss `singletonKey`).
   */
  singletonKey?: string;
  priority?: number;
}

let bossInstance: PgBoss | null = null;

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
): Promise<void> {
  await requireBoss().send(identifier, payload, {
    db: {
      executeSql: async (text, values) => {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- pg-boss hands plain JSON-safe parameters; postgres.js's ParameterOrJSON generic can't be named for a passthrough adapter
        const parameters = (values ?? []) as never[];
        const rows = await tx.unsafe(text, parameters);
        return { rows: [...rows] };
      },
    },
    ...(options.startAfter !== undefined
      ? { startAfter: options.startAfter }
      : {}),
    ...(options.singletonKey !== undefined
      ? { singletonKey: options.singletonKey }
      : {}),
    ...(options.priority !== undefined ? { priority: options.priority } : {}),
  });
}
