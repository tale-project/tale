/**
 * Retry wrappers over postgres.js with exponential backoff.
 *
 * Replaces the asyncpg + stamina helpers. postgres.js manages its own
 * connection pool internally, so there is no explicit acquire/release step —
 * the retry surface is the *operation* (a query callback or a `sql.begin`
 * transaction), retried as a whole on transient connection errors. Each retry
 * runs the callback again, which transparently draws a fresh pooled connection.
 */

import type { TransactionSql } from 'postgres';

/**
 * Minimal structural contract for the part of a postgres.js `Sql` instance
 * that {@link transactWithRetry} uses. A real `Sql` satisfies this
 * structurally, so callers pass their `sql` directly; tests pass a stub.
 */
export interface TransactionRunner {
  begin<T>(callback: (tx: TransactionSql) => Promise<T>): Promise<T>;
}

/** Postgres SQLSTATE class prefixes that indicate a transient/connection fault. */
const TRANSIENT_SQLSTATE_PREFIXES = ['08', '57P', '53']; // connection, admin shutdown, insufficient resources

/** Node socket error codes that indicate a transient network fault. */
const TRANSIENT_NODE_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

export interface RetryOptions {
  /** Maximum number of attempts (including the first). */
  attempts?: number;
  /** Base delay in milliseconds for exponential backoff. */
  baseDelayMs?: number;
  /** Total wall-clock budget in milliseconds across all attempts. */
  timeoutMs?: number;
  /** Override for the transient-error classifier (primarily for tests). */
  isTransient?: (error: unknown) => boolean;
  /** Sleep function (injectable for deterministic tests). */
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Classify whether an error is a transient connection fault worth retrying.
 * Recognizes postgres.js error `code` SQLSTATEs, Node socket error codes, and
 * generic timeout errors.
 */
export function isTransientDbError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code =
    'code' in error && typeof error.code === 'string' ? error.code : '';
  if (TRANSIENT_NODE_CODES.has(code)) {
    return true;
  }
  if (TRANSIENT_SQLSTATE_PREFIXES.some((prefix) => code.startsWith(prefix))) {
    return true;
  }
  return /timed? ?out|connection (?:reset|refused|closed|terminated)/i.test(
    error.message,
  );
}

/**
 * Run `operation`, retrying the whole call on transient connection errors with
 * exponential backoff. Non-transient errors propagate immediately. Returns
 * whatever `operation` returns.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 200;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const isTransient = options.isTransient ?? isTransientDbError;
  const sleep = options.sleep ?? defaultSleep;

  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransient(error) || attempt === attempts - 1) {
        throw error;
      }
      const delay = baseDelayMs * 2 ** attempt;
      if (Date.now() + delay > deadline) {
        throw error;
      }
      console.warn(
        `[db] transient error on attempt ${attempt + 1}/${attempts}, ` +
          `retrying in ${delay}ms: ${error instanceof Error ? error.message : String(error)}`,
      );
      await sleep(delay);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('withRetry exhausted attempts');
}

/**
 * Open a transaction via `sql.begin` and execute `callback`, retrying the
 * entire transaction on transient connection errors. Each retry runs in a
 * fresh transaction on a fresh pooled connection.
 */
export function transactWithRetry<T>(
  sql: TransactionRunner,
  callback: (tx: TransactionSql) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  return withRetry(() => sql.begin(callback), {
    attempts: 3,
    timeoutMs: 120_000,
    ...options,
  });
}
