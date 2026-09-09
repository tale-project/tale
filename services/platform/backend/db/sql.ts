import postgres from 'postgres';
import type { JSONValue, Sql } from 'postgres';

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
 * plus pg-boss's own pool of the same size, and a managed Postgres can cap
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

export function createSql(databaseUrl: string): Sql {
  const { url, ssl } = resolvePostgresConnection(databaseUrl);
  return postgres(url, {
    max: appPoolMax(),
    ssl,
    idle_timeout: 30,
    connect_timeout: 10,
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
