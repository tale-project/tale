import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Whether the database is unavailable — restarting, failing over, a host
 * that is down — as opposed to a statement that failed against a healthy
 * connection.
 *
 * Managed upgrades recreate `db` on every release and on-prem hosts
 * restart, so this is an operational event, not a defect: a request answers
 * a retryable 503 (`error-reporting.ts`), the `/events` stream backs off
 * (`realtime/sse.ts`), a job fails for pg-boss to retry (`jobs/runner.ts`),
 * pg-boss's failing polls log one line per outage (`jobs/boss.ts`), and none
 * of them reports an error.
 *
 * Deliberately narrower than its two neighbours. `isTransientDbError`
 * (`@tale/shared/db/retry`) decides whether to rerun an operation in place
 * and also retries resource exhaustion (53xxx); `isConnectionFailure`
 * (`core/knowledge/pool.ts`) judges reachability and counts rejected
 * credentials (28xxx) and a missing database (3D000). Those need an operator,
 * not a retry, so they stay out of this one and keep being reported.
 */

/** admin_shutdown, crash_shutdown, cannot_connect_now: the server is going
 * away, or not taking connections yet. */
const UNAVAILABLE_SQLSTATES: ReadonlySet<string> = new Set([
  '57P01',
  '57P02',
  '57P03',
]);

/** postgres.js's own connection-lifecycle codes. */
const POSTGRES_JS_CODES: ReadonlySet<string> = new Set([
  'CONNECT_TIMEOUT',
  'CONNECTION_CLOSED',
  'CONNECTION_ENDED',
  'CONNECTION_DESTROYED',
]);

/** node-postgres raises its closed-socket and connect-timeout errors — the
 * counterparts of postgres.js's `CONNECTION_CLOSED` and `CONNECT_TIMEOUT` —
 * with no code at all. */
const NODE_POSTGRES_MESSAGES: ReadonlySet<string> = new Set([
  'Connection terminated unexpectedly',
  'Connection terminated due to connection timeout',
]);

/** Socket errors on the way to the server. Any client raises these — the
 * object store's, a model provider's, the sandbox's — so they count only
 * for an error that came from a database client. */
const SOCKET_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ETIMEDOUT',
]);

/** How far down a `cause` chain the classifier looks. */
const MAX_CAUSE_DEPTH = 5;

export interface DatabaseErrorOrigin {
  /**
   * The caller knows the error came from a database client, so a bare
   * socket error counts. Better Auth's pool is node-postgres, whose socket
   * errors carry no mark of where they came from; the key lookup and the
   * session read touch nothing else.
   */
  fromDatabase?: boolean;
}

/**
 * Whether `error` — or an error in its `cause` chain — says the database is
 * unavailable: SQLSTATE 57P01/57P02/57P03 or class 08 (either driver), one
 * of postgres.js's connection-lifecycle codes, node-postgres's closed-socket
 * or connect-timeout error, or a refused, reset, unresolved or timed-out
 * socket on a database client's query.
 */
export function isDatabaseUnavailable(
  error: unknown,
  origin: DatabaseErrorOrigin = {},
): boolean {
  let current = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (current === null || typeof current !== 'object') return false;
    if (signalsUnavailability(current, origin.fromDatabase === true)) {
      return true;
    }
    current = Reflect.get(current, 'cause');
  }
  return false;
}

function signalsUnavailability(error: object, fromDatabase: boolean): boolean {
  const code: unknown = Reflect.get(error, 'code');
  if (typeof code === 'string') {
    if (UNAVAILABLE_SQLSTATES.has(code)) return true;
    // SQLSTATE class 08, connection_exception: 08000, 08006, 08001, …
    if (code.length === 5 && code.startsWith('08')) return true;
    if (POSTGRES_JS_CODES.has(code)) return true;
    if (SOCKET_CODES.has(code))
      return fromDatabase || stampedByPostgresJs(error);
  }
  const message: unknown = Reflect.get(error, 'message');
  return typeof message === 'string' && NODE_POSTGRES_MESSAGES.has(message);
}

/** postgres.js stamps every error it rejects a query with — a refused
 * connection included — with the statement's `query` and `parameters`
 * (`queryError`), before the statement text even exists. */
function stampedByPostgresJs(error: object): boolean {
  return Object.hasOwn(error, 'query') && Object.hasOwn(error, 'parameters');
}

/** One line for a log: the code, when the message does not already name
 * it, then the message. Reads any object that carries a message — pg-boss
 * re-emits an error as a plain copy of its fields (`jobs/boss.ts`). */
export function describeDatabaseError(error: unknown): string {
  if (error === null || typeof error !== 'object') return String(error);
  const rawMessage: unknown = Reflect.get(error, 'message');
  const message = typeof rawMessage === 'string' ? rawMessage : '';
  const code: unknown = Reflect.get(error, 'code');
  if (typeof code !== 'string' || message.includes(code)) return message;
  return message === '' ? code : `${code} ${message}`;
}

/**
 * A database error a library logged and replaced — Better Auth's session
 * read catches its adapter's error, logs it, and throws a bare
 * `INTERNAL_SERVER_ERROR` with no cause in its place. The error handlers only
 * ever see the replacement, so every session-gated request would read a
 * database restart as a defect. The library's logger notes the original here
 * (`auth/auth.ts`), in a slot that lives as long as the request.
 */
const swallowed = new AsyncLocalStorage<{ error?: unknown }>();

/** Run `next` — the rest of a request — with a slot for a database error
 * a library swallows on the way (`app.ts` wraps every request in it). */
export function runWithSwallowedDatabaseErrors<T>(
  next: () => Promise<T>,
): Promise<T> {
  return swallowed.run({}, next);
}

/** Note `error` when it says the database is unavailable. The first note
 * wins; outside a request this does nothing. */
export function noteSwallowedDatabaseError(error: unknown): void {
  const slot = swallowed.getStore();
  if (slot === undefined || slot.error !== undefined) return;
  if (isDatabaseUnavailable(error, { fromDatabase: true })) slot.error = error;
}

/**
 * The database error behind `error`, or `undefined` when the database is not
 * why the request failed: `error` itself when it says the database is
 * unavailable, else — when `error` is a library's cause-less 500 — the
 * database error noted while this request ran.
 */
export function databaseUnavailableCause(
  error: unknown,
  origin: DatabaseErrorOrigin = {},
): unknown {
  if (isDatabaseUnavailable(error, origin)) return error;
  return isBareServerError(error) ? swallowed.getStore()?.error : undefined;
}

/** Better Auth's `APIError` for a 500 it raised in place of the real
 * error. */
function isBareServerError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  return (
    Reflect.get(error, 'statusCode') === 500 ||
    Reflect.get(error, 'status') === 'INTERNAL_SERVER_ERROR'
  );
}
