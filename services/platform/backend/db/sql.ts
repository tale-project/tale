import postgres from 'postgres';
import type { JSONValue, Parameter, Sql, TransactionSql } from 'postgres';

import { resolvePostgresConnection } from './ssl.ts';

/**
 * Recast a JSON-shaped value for postgres.js's `sql.json()`, whose JSONValue
 * type demands an index signature plain interfaces don't carry. Callers pass
 * values that are JSON-serializable by construction (task payloads, jsonb
 * columns); postgres.js then serializes them exactly once. Never pass class
 * instances, functions, or cyclic structures.
 */
export function toJson(value: unknown): JSONValue {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON-shaped by the caller's contract (see doc comment)
  return value as JSONValue;
}

/**
 * Any JSON value bound as ONE json/jsonb parameter, or SQL NULL for
 * `undefined` and `null`. Serialized here, so the passthrough serializer below
 * sends it verbatim — a bare string becomes a JSON string, where
 * `sql.json(string)` would read the string itself as JSON text.
 */
export function jsonParam(
  sql: Sql | TransactionSql,
  value: unknown,
): Parameter | null {
  return value === undefined || value === null
    ? null
    : sql.json(toJson(JSON.stringify(value)));
}

/**
 * A LIKE pattern matching `token` literally anywhere in the value: `%`, `_`
 * and `\` (the default escape) are LIKE metacharacters, so they are escaped
 * and never widen the match.
 */
export function likeContains(token: string): string {
  return `%${token.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/**
 * A Postgres unique-index violation (SQLSTATE 23505) — the error a writer
 * that lets the database arbitrate a race (a partial unique index instead of
 * a check-then-insert) catches to land on the winner's row.
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === '23505'
  );
}

/**
 * Per-process postgres.js instance. API handlers run through
 * `transactSerializable` from `@tale/shared/db/serializable`; pg-boss
 * manages its own internal pool, so this pool serves only the app's reads,
 * transactions, and the SSE outbox polling.
 */
/**
 * json/jsonb parameter serialization, aligned with node-postgres semantics:
 * a STRING passes through verbatim (it is already serialized JSON), anything
 * else is stringified exactly once. postgres.js's default serializer
 * stringifies unconditionally, which DOUBLE-encodes the pre-stringified
 * parameters pg-boss binds against `$n::json` placeholders (the prepared
 * statement reports the json OID back, so the client serializer runs) —
 * the failure reads as `cannot call json_to_recordset on a scalar`.
 *
 * House rule this creates: never pass a plain string through `sql.json()`
 * intending a JSON string VALUE — pass objects/arrays (every current caller
 * routes Records through `toJson`).
 */
const jsonPassthrough = {
  serialize: (value: unknown): string =>
    typeof value === 'string' ? value : JSON.stringify(value),
  parse: (raw: string): unknown => JSON.parse(raw),
};

/**
 * How many connections ONE process opens to the application database.
 *
 * The budget matters once the database is external: a replica costs this pool
 * plus pg-boss's own pool of the same size. Sandbox lifecycle lock holders
 * may each open one temporary data connection (at most this pool's size),
 * so the peak is three times the configured size. A managed Postgres can cap
 * `max_connections` far below what a handful of replicas would then ask for
 * (Azure's smallest Flexible Server allows 50). Tunable so the arithmetic is
 * the operator's to do rather than the code's to assume.
 */
export function appPoolMax(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.DATABASE_POOL_MAX;
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 10;
}

/**
 * How many connections ONE process opens for Better Auth's own pool — the
 * pool every session lookup on every authenticated request goes through.
 * Five is enough for a quiet deployment; a replica serving thousands of
 * requests a second queues on it, so the size is the operator's to raise
 * (and to count against `max_connections` beside `DATABASE_POOL_MAX`).
 */
export function authPoolMax(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.AUTH_DATABASE_POOL_MAX;
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 5;
}

/**
 * The longest a pool waits to reconnect a connection the database dropped.
 *
 * postgres.js's own backoff climbs to twenty seconds, and its retry count is
 * the POOL's, not the connection's: every one of a pool's connections that
 * fails to reconnect raises it. A restart of a few seconds took twenty
 * connections through a handful of refused attempts each, which put the pool
 * at its ceiling, so each then waited up to twenty seconds past the moment the
 * database answered again. The event stream measured it: one process saw its
 * database back after 3 s, a sibling after 20 s, and every request in between
 * answered a 503 the database no longer deserved.
 *
 * Two seconds still spreads a pool's reconnects (the jitter below) so a
 * restarted database is not hit by every replica at the same instant.
 */
const MAX_RECONNECT_BACKOFF_SECONDS = 2;

/**
 * postgres.js's default backoff — `3 ** retries` hundredths of a second,
 * jittered between half and all of it — with the ceiling above in place of its
 * twenty seconds. Seconds, as the option takes them.
 */
export function reconnectBackoffSeconds(retries: number): number {
  return (
    (0.5 + Math.random() / 2) *
    Math.min(3 ** retries / 100, MAX_RECONNECT_BACKOFF_SECONDS)
  );
}

export function createSql(databaseUrl: string): Sql {
  const { url, ssl } = resolvePostgresConnection(databaseUrl);
  return postgres(url, {
    max: appPoolMax(),
    ssl,
    idle_timeout: 30,
    connect_timeout: 10,
    backoff: reconnectBackoffSeconds,
    types: {
      json: { to: 114, from: [114], ...jsonPassthrough },
      jsonb: { to: 3802, from: [3802], ...jsonPassthrough },
    },
    // Idempotent bootstrap DDL emits "already exists, skipping" notices on
    // every boot; the default handler dumps them as error-looking objects.
    onnotice: (notice) => {
      console.log(`[backend] pg notice: ${notice.message}`);
    },
  });
}
