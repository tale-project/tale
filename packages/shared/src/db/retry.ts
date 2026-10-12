/**
 * Retry wrappers over postgres.js with exponential backoff.
 *
 * Replaces the asyncpg + stamina helpers. postgres.js manages its own
 * connection pool internally, so there is no explicit acquire/release step —
 * the retry surface is the *operation* (a query callback or a `sql.begin`
 * transaction), retried as a whole on transient connection errors. Each retry
 * runs the callback again, which transparently draws a fresh pooled connection.
 */

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
  /**
   * Maximum number of attempts (including the first). `Infinity` leaves
   * `timeoutMs` alone to end the retries.
   */
  attempts?: number;
  /** Base delay in milliseconds for exponential backoff. */
  baseDelayMs?: number;
  /**
   * Ceiling for one backoff delay, in milliseconds: the delay stops doubling
   * there, so a long budget keeps retrying at that interval instead of
   * sleeping through most of it. Unbounded by default.
   */
  maxDelayMs?: number;
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
 * Where in the application a failed database call was made: the first frame
 * of the error's stack that is neither a dependency nor this package's own
 * retry plumbing, as `path/to/file.ts:line`, or `undefined` when the stack
 * names none. postgres.js builds a statement's error with the stack of the
 * place that wrote the statement, so a retry warning can say WHICH write is
 * losing — the log line used to read the same for every one of them.
 *
 * Read only when a retry is about to be logged, never on a call that works.
 */
export function callSiteOf(error: unknown): string | undefined {
  if (!(error instanceof Error) || typeof error.stack !== 'string') {
    return undefined;
  }
  for (const line of error.stack.split('\n').slice(1)) {
    if (line.includes('node_modules') || line.includes('node:internal')) {
      continue;
    }
    const frame = /(?:file:\/\/)?([^\s()]+\.[cm]?[jt]sx?):(\d+):\d+\)?$/.exec(
      line.trim(),
    );
    if (frame === null) continue;
    const [, file = '', row = ''] = frame;
    // This package's own plumbing (`withRetry`, `transactSerializable`) is
    // in every stack and names nothing.
    if (/\/packages\/shared\/src\/db\/(?:retry|serializable)\.ts$/.test(file)) {
      continue;
    }
    // Relative to the service: `domains/chat/store.ts:655`.
    const short = file.replace(
      /^.*\/(?:services\/[^/]+|packages\/[^/]+(?:\/src)?|tools\/[^/]+)\//,
      '',
    );
    return `${short.replace(/^backend\//, '')}:${row}`;
  }
  return undefined;
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
  const maxDelayMs = options.maxDelayMs ?? Number.POSITIVE_INFINITY;
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
      const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      if (Date.now() + delay > deadline) {
        throw error;
      }
      const of = Number.isFinite(attempts) ? `/${attempts}` : '';
      const site = callSiteOf(error);
      console.warn(
        `[db] transient error on attempt ${attempt + 1}${of}, ` +
          `retrying in ${delay}ms${site === undefined ? '' : ` (${site})`}: ${error instanceof Error ? error.message : String(error)}`,
      );
      await sleep(delay);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('withRetry exhausted attempts');
}
