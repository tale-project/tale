import { createHash } from 'node:crypto';

import { z } from 'zod';

import { AUTOMATION_LEDGER_QUERY } from './automation-floor';
import { AUTOMATION_PROTOCOL_MIGRATION } from './automation-model';

export const LEGACY_CUTOVER_LEDGER_SHA256 =
  '1fda736a1123667df24f63c3d78f2e0048491ebc4b8482293f6046ac3253e324';
export const AUTOMATION_CUTOVER_ISOLATION = 'isolation level read committed';
export const AUTOMATION_CUTOVER_SESSION_SQL = `SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
SET LOCAL idle_in_transaction_session_timeout = '10s';`;
// An existing uncommitted writer refuses acquisition. After acquisition,
// READ COMMITTED sees all committed runs while SHARE excludes new admissions.
export const AUTOMATION_CUTOVER_LOCK_SQL =
  'LOCK TABLE app.automation_runs IN SHARE MODE NOWAIT;';
export const AUTOMATION_CUTOVER_CENSUS_SQL = `SELECT json_build_object(
  'safeTable', EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'app' AND c.relname = 'automation_runs' AND c.relkind = 'r' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity),
  'unfinished', EXISTS (SELECT 1 FROM app.automation_runs WHERE status NOT IN ('success', 'failed', 'cancelled') OR status IS NULL),
  'owned', EXISTS (SELECT 1 FROM pg_catalog.pg_locks WHERE pid = pg_backend_pid()
    AND relation = 'app.automation_runs'::regclass AND mode = 'ShareLock' AND granted));`;
export const AUTOMATION_CUTOVER_PROBE_SQL = `SELECT json_build_object('owned', EXISTS (
  SELECT 1 FROM pg_catalog.pg_locks WHERE pid = pg_backend_pid()
    AND relation = 'app.automation_runs'::regclass AND mode = 'ShareLock' AND granted));`;

/** The CLI psql transport and the required backend integration use these same
 * source-owned statements; no user value becomes executable SQL. */
export const AUTOMATION_CUTOVER_ACQUIRE_SQL = `BEGIN ${AUTOMATION_CUTOVER_ISOLATION};
${AUTOMATION_CUTOVER_SESSION_SQL}
${AUTOMATION_CUTOVER_LOCK_SQL}
${AUTOMATION_LEDGER_QUERY.slice(0, -1)}
\\gexec
${AUTOMATION_CUTOVER_CENSUS_SQL}`;

/** A workspace deployment asks the held census's question before it changes
 * anything: in a read-only transaction and without the lock, so neither a busy
 * writer nor this read waits on the other. The held census still decides. */
export const AUTOMATION_CUTOVER_READINESS_SQL = `BEGIN ${AUTOMATION_CUTOVER_ISOLATION}, READ ONLY;
${AUTOMATION_CUTOVER_SESSION_SQL}
${AUTOMATION_CUTOVER_CENSUS_SQL}
ROLLBACK;`;

/** Whether unfinished runs exist; throws when the census is unreadable. */
export function legacyCutoverBusy(raw: string): boolean {
  return z
    .strictObject({
      safeTable: z.literal(true),
      unfinished: z.boolean(),
      owned: z.boolean(),
    })
    .parse(JSON.parse(raw.trim())).unfinished;
}

/** v0.5.77's ledger is every application migration numbered below 0154; the
 * protocol-2 runtime adds 0154 onwards, 0163 among them. */
const FIRST_PROTOCOL_TWO_MIGRATION = '0154';

/** How a ledger without 0163 stands against the supported legacy runtime:
 * exactly v0.5.77's; v0.5.77's plus only newer migrations, which only a
 * protocol-2 boot cut short before 0163 committed can leave; or neither. */
export type LegacyLedgerShape = 'legacy' | 'continued' | 'unsupported';

export function legacyLedgerShape(ids: readonly string[]): LegacyLedgerShape {
  const legacy = ids.filter((id) => id < FIRST_PROTOCOL_TWO_MIGRATION);
  if (
    createHash('sha256').update(JSON.stringify(legacy)).digest('hex') !==
    LEGACY_CUTOVER_LEDGER_SHA256
  )
    return 'unsupported';
  return legacy.length === ids.length ? 'legacy' : 'continued';
}

/** Which ledgers a held census accepts: managed apply's exact v0.5.77 one,
 * or, for a workspace, also v0.5.77's continued by a first protocol-2 boot that
 * was cut before 0163 committed. Either way no protocol-2 writer has run. */
export type CensusLedger = 'legacy' | 'legacy-or-continued';

export function emptyLegacyCutoverCensus(
  raw: string,
  accept: CensusLedger = 'legacy',
): boolean {
  try {
    const lines = raw.trim().split('\n');
    if (lines.length !== 2) return false;
    const ledger = z
      .strictObject({
        schema: z.enum(['public', 'tale']),
        ids: z.array(z.string()).max(2048),
      })
      .parse(JSON.parse(lines[0]));
    z.strictObject({
      safeTable: z.literal(true),
      unfinished: z.literal(false),
      owned: z.literal(true),
    }).parse(JSON.parse(lines[1]));
    if (accept === 'legacy-or-continued')
      return (
        legacyLedgerShape(ledger.ids) !== 'unsupported' &&
        !ledger.ids.includes(AUTOMATION_PROTOCOL_MIGRATION)
      );
    return (
      createHash('sha256').update(JSON.stringify(ledger.ids)).digest('hex') ===
      LEGACY_CUTOVER_LEDGER_SHA256
    );
  } catch {
    return false;
  }
}

export function cutoverLockOwned(raw: string): boolean {
  try {
    return z.strictObject({ owned: z.literal(true) }).parse(JSON.parse(raw))
      .owned;
  } catch {
    return false;
  }
}
