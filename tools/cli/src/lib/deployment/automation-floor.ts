import { z } from 'zod';

import {
  AUTOMATION_PROTOCOL_MIGRATION,
  type AutomationWriterProtocol,
} from './automation-model';
import { applicationLedgerSchema } from './migration-model';

// Discover one actual ledger, never a caller-selected search_path or a guessed
// public schema. format(%I) quotes catalog identifiers; the only emitted command
// is this fixed read-only SELECT. A shadow ledger makes the census ambiguous.
export const AUTOMATION_LEDGER_QUERY = `WITH ledgers AS (
  SELECT c.oid, n.nspname, c.relname,
    c.relkind = 'r' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
    AND (SELECT count(*) = 2 AND bool_and(
      (a.attname = 'name' AND a.atttypid = 'text'::regtype AND a.attnotnull) OR
      (a.attname = 'applied_at' AND a.atttypid = 'timestamptz'::regtype AND a.attnotnull))
      FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attname = 'name'
      WHERE i.indrelid = c.oid AND i.indisprimary AND i.indisvalid AND i.indnkeyatts = 1 AND i.indkey[0] = a.attnum)
    AS valid
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = 'app_migrations' AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
)
SELECT CASE WHEN count(*) = 1 AND bool_and(valid) THEN
  format('SELECT json_build_object(''schema'', %L, ''ids'', coalesce(json_agg(name ORDER BY name COLLATE "C"), ''[]''::json)) FROM (SELECT name FROM %I.%I ORDER BY name COLLATE "C" LIMIT 2049) inventory;',
    min(nspname), min(nspname), min(relname))
  ELSE 'SELECT ''null''::json;' END FROM ledgers;`;

export const AUTOMATION_FLOOR_SQL = `BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
SET LOCAL idle_in_transaction_session_timeout = '8s';
${AUTOMATION_LEDGER_QUERY.slice(0, -1)}
\\gexec
ROLLBACK;`;

/** Validate the exact source-generated SELECT before a native driver executes it.
 * The psql transport uses the same catalog command through its own \gexec. */
export function checkedAutomationLedgerQuery(value: unknown): string {
  if (value === "SELECT 'null'::json;") return value;
  const command = z.string().max(2048).parse(value);
  const schema =
    /^SELECT json_build_object\('schema', '([a-z_][a-z0-9_]{0,62})',/.exec(
      command,
    )?.[1];
  if (!schema) throw new Error('Unsupported automation ledger query');
  // These names need no SQL quoting under PostgreSQL format(%I); no input can
  // add syntax. The generated statement must match in full, not just a prefix.
  const expected = `SELECT json_build_object('schema', '${schema}', 'ids', coalesce(json_agg(name ORDER BY name COLLATE "C"), '[]'::json)) FROM (SELECT name FROM ${schema}.app_migrations ORDER BY name COLLATE "C" LIMIT 2049) inventory;`;
  if (command !== expected)
    throw new Error('Unsupported automation ledger query');
  return command;
}

export function automationFloor(raw: string): AutomationWriterProtocol {
  const observed = z
    .strictObject({
      schema: z.string().min(1).max(63),
      ids: applicationLedgerSchema.shape.ids,
    })
    .parse(JSON.parse(raw));
  return observed.ids.includes(AUTOMATION_PROTOCOL_MIGRATION) ? 2 : 1;
}
