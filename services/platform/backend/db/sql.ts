import postgres from 'postgres';
import type { JSONValue, Sql } from 'postgres';

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

export function createSql(databaseUrl: string): Sql {
  return postgres(databaseUrl, {
    max: 10,
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
