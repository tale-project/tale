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

import type { ReservedSql, TransactionSql } from 'postgres';

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
  /**
   * Reserve one connection (postgres.js `sql.reserve`). Optional: a runner
   * without it retries queued failures like plain ones.
   */
  reserve?(): Promise<ReservedSql>;
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
 * Retry queues.
 *
 * A retry re-collides whenever the row it lost on is written again before the
 * retry reaches it, because a SERIALIZABLE snapshot is fixed at the
 * transaction's FIRST statement — an advisory lock taken inside the
 * transaction is therefore acquired after the snapshot and cannot protect a
 * hot row (the audit chain head, bumped by every audited write of an org).
 * Under a burst the five attempts all lose and the caller sees a 40001.
 *
 * A callback that knows which resource it lost on marks the failure with a
 * queue key ({@link markRetryQueueKey}). The next attempt then reserves one
 * connection, takes a SESSION-level advisory lock on the key BEFORE opening
 * the transaction, and commits and unlocks on that same connection: its
 * snapshot post-dates the writer it lost to, and other appenders that take
 * the transaction-level lock on the same key inside their own transaction
 * queue behind it instead of bumping the row underneath it.
 *
 * Marks nest. A callback wrapped in another queue (a task comment inside a
 * task's queue, whose audit write sits inside the org's chain-head queue)
 * marks inner-first, and each outer mark is PREPENDED, so the list reads in
 * the callback's own acquisition order — task, then chain head. The queued
 * retry takes the session locks in exactly that order and unlocks in
 * reverse; every first attempt takes its transaction-level locks in the same
 * order, so a queued retry and a first attempt never hold the two keys in
 * opposite orders. A retry queued on the outer key alone would drop the
 * inner one and lose there again.
 */

const RETRY_QUEUE_KEY = Symbol.for('tale.db.retryQueueKey');

/**
 * Advisory-lock class shared by every retry queue: the session lock the
 * queued retry holds and the `pg_advisory_xact_lock(class, hashtext(key))`
 * a first attempt takes inside its transaction both live here, so they
 * conflict with each other and with nothing else (the migration runner and
 * the sandbox/skill locks use the one-argument bigint form).
 */
export const RETRY_QUEUE_LOCK_CLASS = 72_085_002;

/**
 * Mark a serialization failure so the retry queues on `key` (see the retry
 * queues note). An outer mark is prepended to the keys an inner callback
 * already put on the error; a key already present is not added twice.
 * Returns the same error for `throw markRetryQueueKey(e, k)`.
 */
export function markRetryQueueKey<E>(error: E, key: string): E {
  if (isSerializationFailure(error)) {
    const keys = retryQueueKeysOf(error);
    if (!keys.includes(key)) {
      Object.defineProperty(error, RETRY_QUEUE_KEY, {
        value: [key, ...keys],
        enumerable: false,
        configurable: true,
      });
    }
  }
  return error;
}

/**
 * The queue keys a failure was marked with, outermost first (the order the
 * queued retry locks them in); empty when unmarked.
 */
export function retryQueueKeysOf(error: unknown): readonly string[] {
  if (error === null || typeof error !== 'object') {
    return [];
  }
  const keys: unknown = Reflect.get(error, RETRY_QUEUE_KEY);
  return Array.isArray(keys) &&
    keys.every((key): key is string => typeof key === 'string')
    ? keys
    : [];
}

/** The outermost queue key a failure was marked with, if any. */
export function retryQueueKeyOf(error: unknown): string | undefined {
  return retryQueueKeysOf(error)[0];
}

/** Postgres accepts unquoted savepoint names of this shape only. */
const SAVEPOINT_NAME = /^[a-z_][a-z0-9_]*$/i;

/**
 * The `TransactionSql` surface over a reserved connection whose transaction
 * was opened by hand (postgres.js's `begin` cannot run on a reserved
 * connection). Savepoints follow postgres.js's own shape: a nested callback
 * that throws rolls back to its savepoint and rethrows.
 */
function transactionOver(reserved: ReservedSql): TransactionSql {
  let savepoints = 0;
  const tx = Object.assign(reserved, {
    savepoint: async <T>(
      nameOrCallback: string | ((sql: TransactionSql) => T | Promise<T>),
      maybeCallback?: (sql: TransactionSql) => T | Promise<T>,
    ): Promise<T> => {
      const callback =
        typeof nameOrCallback === 'function' ? nameOrCallback : maybeCallback;
      if (callback === undefined) {
        throw new Error('savepoint needs a callback');
      }
      const suffix = typeof nameOrCallback === 'string' ? nameOrCallback : '';
      if (suffix !== '' && !SAVEPOINT_NAME.test(suffix)) {
        throw new Error(`invalid savepoint name ${JSON.stringify(suffix)}`);
      }
      const name = `s${savepoints++}${suffix === '' ? '' : `_${suffix}`}`;
      await reserved.unsafe(`SAVEPOINT ${name}`);
      try {
        const result = await callback(tx);
        await reserved.unsafe(`RELEASE SAVEPOINT ${name}`);
        return result;
      } catch (error) {
        await reserved.unsafe(`ROLLBACK TO SAVEPOINT ${name}`);
        throw error;
      }
    },
    prepare: (): Promise<never> =>
      Promise.reject(
        new Error('PREPARE TRANSACTION is not supported on a queued retry'),
      ),
  });
  return tx;
}

/**
 * One serializable attempt queued on `keys`: session advisory locks in that
 * order → BEGIN → callback → COMMIT → unlocks in reverse, all on one
 * reserved connection. A key that cannot be locked releases the ones
 * already held before the connection goes back to the pool — a session
 * lock outlives the reservation, and a pooled connection still holding one
 * would block that key for everyone until the connection dies.
 */
async function beginQueued<T>(
  reserve: () => Promise<ReservedSql>,
  keys: readonly string[],
  callback: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  const reserved = await reserve();
  try {
    const locked: string[] = [];
    try {
      for (const key of keys) {
        await reserved`
          SELECT pg_advisory_lock(${RETRY_QUEUE_LOCK_CLASS}, hashtext(${key}))
        `;
        locked.push(key);
      }
      await reserved.unsafe('BEGIN ISOLATION LEVEL SERIALIZABLE');
      let result: T;
      try {
        result = await callback(transactionOver(reserved));
      } catch (error) {
        await reserved.unsafe('ROLLBACK').catch((rollbackError: unknown) => {
          console.warn(
            `[db] rollback of a queued retry failed: ${String(rollbackError)}`,
          );
        });
        throw error;
      }
      // COMMIT on a transaction a swallowed statement error already aborted
      // answers ROLLBACK without raising — surface that, never report success.
      const commit = await reserved.unsafe('COMMIT');
      if (commit.command !== 'COMMIT') {
        throw new Error(
          `queued retry did not commit (server answered ${commit.command})`,
        );
      }
      return result;
    } finally {
      for (const key of locked.reverse()) {
        await reserved`
          SELECT pg_advisory_unlock(${RETRY_QUEUE_LOCK_CLASS}, hashtext(${key}))
        `.catch((unlockError: unknown) => {
          // The lock is session-scoped: it dies with the connection anyway.
          console.warn(
            `[db] advisory unlock after a queued retry failed: ${String(unlockError)}`,
          );
        });
      }
    }
  } finally {
    reserved.release();
  }
}

/** True when every key in `keys` is already in `of`. */
function isSubsetOf(
  keys: readonly string[],
  of: readonly string[] | undefined,
): boolean {
  return of !== undefined && keys.every((key) => of.includes(key));
}

/**
 * Open a SERIALIZABLE transaction and execute `callback`, retrying the entire
 * transaction on serialization failures (40001/40P01) and on transient
 * connection faults. Each retry runs in a fresh transaction; a retry after a
 * failure marked with queue keys runs queued on those keys (see above).
 */
export function transactSerializable<T>(
  sql: SerializableTransactionRunner,
  callback: (tx: TransactionSql) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  let queueKeys: readonly string[] | undefined;
  const reserve = sql.reserve?.bind(sql);
  const attempt = (): Promise<T> =>
    queueKeys !== undefined && reserve !== undefined
      ? beginQueued(reserve, queueKeys, callback)
      : sql.begin('isolation level serializable', callback);
  const isTransient =
    options.isTransient ??
    ((error: unknown) =>
      isSerializationFailure(error) || isTransientDbError(error));
  return withRetry(attempt, {
    attempts: 5,
    baseDelayMs: 20,
    timeoutMs: 30_000,
    sleep: jitteredSleep,
    ...options,
    isTransient: (error) => {
      // A queued attempt that loses to a writer outside its inner queues is
      // re-marked with fewer keys than it held; the held list is a superset
      // in the same acquisition order, so keep it — dropping a key is how a
      // retry loses at that resource again.
      const keys = retryQueueKeysOf(error);
      if (keys.length > 0 && !isSubsetOf(keys, queueKeys)) {
        queueKeys = keys;
      }
      return isTransient(error);
    },
  });
}
