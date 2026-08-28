/**
 * Serializable-transaction wrapper with retry on serialization failures.
 *
 * The 0.5 Postgres backend runs its Convex-mutation-shaped handlers at
 * SERIALIZABLE so the OCC guarantees the Convex runtime used to provide
 * survive the port. Postgres reports conflicts as SQLSTATE 40001
 * (serialization_failure) and 40P01 (deadlock_detected); both mean "rerun the
 * whole transaction".
 *
 * Contract for callbacks: pure apart from their database writes — no fetch,
 * no timers, no external side effects — because the callback re-executes on
 * every retry. Side effects belong in jobs enqueued transactionally from
 * within the same transaction (see services/backend `addJobInTx`).
 */

import type { TransactionSql } from 'postgres';

import { isTransientDbError, withRetry, type RetryOptions } from './retry.ts';

/**
 * Minimal structural contract for the options-taking `begin` overload of a
 * postgres.js `Sql` instance. A real `Sql` satisfies this structurally;
 * tests pass a stub.
 */
export interface SerializableTransactionRunner {
  begin<T>(
    options: string,
    callback: (tx: TransactionSql) => Promise<T>,
  ): Promise<T>;
}

const SERIALIZATION_SQLSTATES = new Set(['40001', '40P01']);

/** True for errors that mean "rerun the whole transaction" (40001/40P01). */
export function isSerializationFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    SERIALIZATION_SQLSTATES.has(error.code)
  );
}

/**
 * Sleep with ±50% jitter. Two transactions that aborted each other retry on
 * the same exponential schedule; without jitter they re-collide in lockstep.
 */
function jitteredSleep(ms: number): Promise<void> {
  const jittered = ms * (0.5 + Math.random());
  return new Promise((resolve) => setTimeout(resolve, jittered));
}

/**
 * Open a SERIALIZABLE transaction and execute `callback`, retrying the entire
 * transaction on serialization failures (40001/40P01) and on transient
 * connection faults. Each retry runs in a fresh transaction.
 */
export function transactSerializable<T>(
  sql: SerializableTransactionRunner,
  callback: (tx: TransactionSql) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  return withRetry(() => sql.begin('isolation level serializable', callback), {
    attempts: 5,
    baseDelayMs: 20,
    timeoutMs: 30_000,
    isTransient: (error) =>
      isSerializationFailure(error) || isTransientDbError(error),
    sleep: jitteredSleep,
    ...options,
  });
}
