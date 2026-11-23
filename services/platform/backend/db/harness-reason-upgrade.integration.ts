/**
 * Real Postgres proof of migration 0241 on a database that is not fresh
 * (tale-project/tale#4942). The suite migrates an empty database; a
 * deployment applies 0241 to one at 0240, whose ops name a reason 0240
 * admits and whose runs have no reason column, while the previous image
 * keeps writing both tables. A database of this check's own is brought to
 * 0240 the way the boot does, holds rows written with the previous image's
 * own statements, and takes 0241 as the boot applies it, in its own
 * transaction: it reads and rewrites neither table (both checks go in NOT
 * VALID), the previous image's writes still land, a rule nobody wrote is
 * still refused, and a second run of the file changes nothing.
 */
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

import type { Sql, TransactionSql } from 'postgres';

import {
  dropOwnedDatabase,
  errorText,
  ownedDatabaseAdmin,
  type RecordCheck,
} from '../integration-lane-helpers.ts';
import { applyMigrationFileInTx, isMigrationFile } from './migrate.ts';

const migrationRoot = new URL('./migrations/', import.meta.url);
const TABLES = ['sandbox_session_ops', 'project_agent_runs'] as const;
/** The reasons 0240 admits, which the previous image writes on an op. */
const PREVIOUS_REASONS = [
  'pinned',
  'default',
  'subscription_bound',
  'policy',
] as const;
const ORG = 'org-upgrade-0241';
const PROJECT = 'prj-upgrade-0241';
const AGENT = 'agt-upgrade-0241';

interface TableReading {
  scans: number;
  rowsWritten: number;
  file: number;
}

/** What this transaction has done to the two tables so far: the scans it
 * started on each (sequential and through an index), the rows it wrote, and
 * the file each table lives in, which a rewrite replaces. */
async function readTables(
  tx: TransactionSql,
): Promise<Record<string, TableReading>> {
  const rows = await tx<
    { table: string; scans: number; written: number; file: number }[]
  >`
    SELECT s.relname AS table,
           (s.seq_scan + coalesce(s.idx_scan, 0))::int AS scans,
           (s.n_tup_ins + s.n_tup_upd + s.n_tup_del)::int AS written,
           c.relfilenode::int AS file
    FROM pg_stat_xact_user_tables s
    JOIN pg_class c ON c.oid = s.relid
    WHERE s.schemaname = 'app' AND s.relname = ANY(${[...TABLES]})
  `;
  return Object.fromEntries(
    rows.map((row) => [
      row.table,
      { scans: row.scans, rowsWritten: row.written, file: row.file },
    ]),
  );
}

/** The two checks and the run's column, as a reader of the catalog sees
 * them. */
async function readShape(sql: Sql | TransactionSql): Promise<string> {
  const checks = await sql<{ name: string; def: string; valid: boolean }[]>`
    SELECT conname AS name, pg_get_constraintdef(oid) AS def,
           convalidated AS valid
    FROM pg_constraint
    WHERE conname IN (
      'sandbox_session_ops_harness_reason_known',
      'project_agent_runs_harness_reason_known'
    )
    ORDER BY conname
  `;
  const columns = await sql<
    { table: string; type: string; nullable: string; fallback: string | null }[]
  >`
    SELECT table_name AS table, data_type AS type, is_nullable AS nullable,
           column_default AS fallback
    FROM information_schema.columns
    WHERE table_schema = 'app' AND table_name = ANY(${[...TABLES]})
      AND column_name = 'harness_reason'
    ORDER BY table_name
  `;
  return JSON.stringify({ checks, columns });
}

/** Every row of the two tables, digested, so that a run that changed one
 * shows. */
async function digestRows(sql: Sql): Promise<string> {
  const rows = await sql<{ ops: string; runs: string }[]>`
    SELECT
      (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.session_id, t.exec_id), ''))
       FROM app.sandbox_session_ops t) AS ops,
      (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), ''))
       FROM app.project_agent_runs t) AS runs
  `;
  return `${rows[0]?.ops ?? ''}/${rows[0]?.runs ?? ''}`;
}

/** An op as the release before 0240 opens it, naming no reason at all. */
async function writeOpBefore0240(
  sql: Sql | TransactionSql,
  execId: string,
): Promise<void> {
  const now = Date.now();
  await sql`
    INSERT INTO app.sandbox_session_ops (
      org_id, session_id, thread_id, exec_id, kind, status,
      progress_text, live_timeline, agent_session_id, exit_code,
      agent_result_status, user_id, model_ref, vision_model_ref,
      harness, agent_slug, deadline_ms, heartbeat_at_ms,
      last_event_at_ms, last_seq, minted_key_id, spent_cents,
      budget_cents, spend_settled_at_ms, started_at_ms, finished_at_ms
    ) VALUES (
      ${ORG}, 'ses-upgrade-0241', ${null}, ${execId}, 'task-agent',
      'running', ${null}, ${null}, ${null}, ${null}, ${null},
      'user-upgrade-0241', 'anthropic/claude-sonnet-4-6', ${null},
      'claude-code', ${null}, ${now + 600_000}, ${now}, ${null}, ${null},
      ${null}, ${null}, 100, ${null}, ${now}, ${null}
    )
    ON CONFLICT (session_id, exec_id) DO UPDATE SET
      harness = coalesce(EXCLUDED.harness, app.sandbox_session_ops.harness)
  `;
}

/** An op as the previous image opens it (`upsertSessionOp` before 0241):
 * the conflict update is the previous image's for the two columns it
 * carries. */
async function writePreviousOp(
  sql: Sql | TransactionSql,
  execId: string,
  reason: string | null,
): Promise<void> {
  const now = Date.now();
  await sql`
    INSERT INTO app.sandbox_session_ops (
      org_id, session_id, thread_id, exec_id, kind, status,
      progress_text, live_timeline, agent_session_id, exit_code,
      agent_result_status, user_id, model_ref, vision_model_ref,
      harness, harness_reason, agent_slug, deadline_ms,
      heartbeat_at_ms, last_event_at_ms, last_seq, minted_key_id,
      spent_cents, budget_cents, spend_settled_at_ms, started_at_ms,
      finished_at_ms
    ) VALUES (
      ${ORG}, 'ses-upgrade-0241', ${null}, ${execId}, 'task-agent',
      'running', ${null}, ${null}, ${null}, ${null}, ${null},
      'user-upgrade-0241', 'anthropic/claude-sonnet-4-6', ${null},
      'claude-code', ${reason}, ${null}, ${now + 600_000}, ${now}, ${null},
      ${null}, ${null}, ${null}, 100, ${null}, ${now}, ${null}
    )
    ON CONFLICT (session_id, exec_id) DO UPDATE SET
      harness = coalesce(EXCLUDED.harness, app.sandbox_session_ops.harness),
      harness_reason = coalesce(EXCLUDED.harness_reason,
        app.sandbox_session_ops.harness_reason)
  `;
}

/** A run as the previous image kicks it (`kickAgentRun` before 0241, the
 * same columns as the release before): no reason. */
async function writePreviousRun(
  sql: Sql | TransactionSql,
  taskId: string,
  status: 'queued' | 'settled',
): Promise<string | null> {
  const now = Date.now();
  const rows = await sql<{ id: string }[]>`
    INSERT INTO app.project_agent_runs (
      org_id, project_id, task_id, agent_id, exec_id, session_id, status,
      harness, engine, handoff, model, model_provider, trigger, feedback,
      mention_source, auto_retry_attempt, started_by, started_at_ms,
      deadline_at_ms, updated_at_ms, started_via, started_via_run_id,
      started_via_node_id, started_via_automation, started_via_agent_id,
      in_place, in_place_retry_status, in_place_retry_activity_id,
      api_key_id, wake_admitted_seq, review_batch_id, agent_project_id
    ) VALUES (
      ${ORG}, ${PROJECT}, ${taskId}, ${AGENT}, ${`exec-${randomUUID()}`},
      'ses-upgrade-0241', ${status}, 'claude-code', 'harness', ${null},
      'claude-sonnet-4-6', 'anthropic', 'manual', ${null}, ${null}, ${null},
      'user:user-upgrade-0241', ${now}, ${now + 3_600_000}, ${now}, ${null},
      ${null}, ${null}, ${null}, ${null}, false, ${null}, ${null}, ${null},
      ${null}::bigint, ${null},
      (SELECT project_id FROM app.project_agents
       WHERE id = ${AGENT} AND org_id = ${ORG})
    )
    ON CONFLICT (task_id) WHERE status IN ('queued', 'running') DO NOTHING
    RETURNING id
  `;
  return rows[0]?.id ?? null;
}

/** The parents a run needs, and the rows the previous image left: an op of
 * each reason it writes and one with none, and runs, live and settled. */
async function plantPreviousRows(sql: Sql): Promise<void> {
  const now = Date.now();
  await sql`
    INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms, updated_at_ms)
    VALUES (${PROJECT}, ${ORG}, 'Upgrade 0241', 'user-upgrade-0241', ${now}, ${now})
  `;
  await sql`
    INSERT INTO app.project_agents (
      id, org_id, project_id, name, harness, model, created_by,
      created_at_ms, updated_at_ms
    ) VALUES (
      ${AGENT}, ${ORG}, ${PROJECT}, 'Upgrade agent', 'claude-code',
      'claude-sonnet-4-6', 'user-upgrade-0241', ${now}, ${now}
    )
  `;
  await sql`
    INSERT INTO app.tasks (
      id, org_id, project_id, title, status, rank, created_by,
      created_by_type, created_at_ms, updated_at_ms
    )
    SELECT 'tsk-upgrade-0241-' || g, ${ORG}, ${PROJECT}, 'Task ' || g, 'todo',
           lpad(g::text, 4, '0'), 'user-upgrade-0241', 'user', ${now}, ${now}
    FROM generate_series(1, 3) AS g
  `;
  for (const [index, reason] of [...PREVIOUS_REASONS, null].entries())
    await writePreviousOp(sql, `exec-planted-${index}`, reason);
  await writePreviousRun(sql, 'tsk-upgrade-0241-1', 'settled');
  await writePreviousRun(sql, 'tsk-upgrade-0241-1', 'settled');
  await writePreviousRun(sql, 'tsk-upgrade-0241-2', 'queued');
}

/** Apply 0241 as the boot does, in a transaction of its own, and what it
 * did to the two tables meanwhile. */
async function apply0241(
  sql: Sql,
  file: string,
  ddl: string,
  ledger: boolean,
): Promise<{ scans: number; rowsWritten: number; rewritten: string[] }> {
  return sql.begin(async (tx) => {
    const before = await readTables(tx);
    await tx.unsafe(ddl);
    const after = await readTables(tx);
    if (ledger) await tx`INSERT INTO app_migrations (name) VALUES (${file})`;
    let scans = 0;
    let rowsWritten = 0;
    const rewritten: string[] = [];
    for (const table of TABLES) {
      const was = before[table];
      const is = after[table];
      if (was === undefined || is === undefined) {
        rewritten.push(`${table} unread`);
        continue;
      }
      scans += is.scans - was.scans;
      rowsWritten += is.rowsWritten - was.rowsWritten;
      if (is.file !== was.file) rewritten.push(table);
    }
    return { scans, rowsWritten, rewritten };
  });
}

/** The code of SQLSTATE an attempt ended with, or `landed`. */
async function attempt(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return 'landed';
  } catch (error) {
    return error instanceof Error && 'code' in error
      ? String(error.code)
      : errorText(error);
  }
}

export async function checkHarnessReasonUpgrade(
  databaseUrl: string,
  record: RecordCheck,
): Promise<void> {
  const admin = ownedDatabaseAdmin(databaseUrl);
  const name = `itest_upgrade_0241_${randomUUID().replaceAll('-', '')}`;
  const target = new URL(databaseUrl);
  target.pathname = `/${name}`;
  let owned = false;
  let sql: Sql | undefined;
  const cleanupFailures: unknown[] = [];
  try {
    await admin`CREATE DATABASE ${admin(name)}`;
    owned = true;
    await admin`ALTER DATABASE ${admin(name)} SET search_path TO tale, public`;
    const fixture = ownedDatabaseAdmin(target.toString());
    sql = fixture;
    await fixture.begin(async (tx) => {
      await tx`CREATE SCHEMA tale`;
      await tx`CREATE TABLE app_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    });
    const files = (await readdir(migrationRoot)).filter(isMigrationFile).sort();
    const file = files.find((entry) => entry.startsWith('0241_'));
    if (file === undefined) throw new Error('migration 0241 is not in place');
    for (const previous of files.filter((entry) => entry < file)) {
      await fixture.begin(async (tx) => {
        await applyMigrationFileInTx(tx, previous);
        await tx`INSERT INTO app_migrations (name) VALUES (${previous})`;
      });
    }
    await plantPreviousRows(fixture);
    const ddl = await readFile(new URL(file, migrationRoot), 'utf8');

    const first = await apply0241(fixture, file, ddl, true);
    const shape = await readShape(fixture);
    const planted = await fixture<{ reasons: string; runReasons: number }[]>`
      SELECT
        (SELECT string_agg(coalesce(harness_reason, 'none'), ',' ORDER BY exec_id)
         FROM app.sandbox_session_ops) AS reasons,
        (SELECT count(*)::int FROM app.project_agent_runs
         WHERE harness_reason IS NOT NULL) AS "runReasons"
    `;
    // The reading would see a scan: validating the op check reads every
    // row, in a savepoint undone at once.
    const control = await fixture
      .begin(async (tx) => {
        const before = await readTables(tx);
        await tx`ALTER TABLE app.sandbox_session_ops VALIDATE CONSTRAINT sandbox_session_ops_harness_reason_known`;
        const after = await readTables(tx);
        throw new ControlReading(
          (after.sandbox_session_ops?.scans ?? 0) -
            (before.sandbox_session_ops?.scans ?? 0),
        );
      })
      .then(
        () => -1,
        (error: unknown) => {
          if (error instanceof ControlReading) return error.scans;
          throw error;
        },
      );
    const notValid =
      shape.includes('"valid":false') && !shape.includes('"valid":true');
    record(
      'migration 0241 applies to a database at 0240 holding the previous image’s rows, reading and rewriting neither table',
      first.scans === 0 &&
        first.rowsWritten === 0 &&
        first.rewritten.length === 0 &&
        notValid &&
        shape.includes('"nullable":"YES","fallback":null') &&
        planted[0]?.reasons ===
          'pinned,default,subscription_bound,policy,none' &&
        planted[0]?.runReasons === 0 &&
        control > 0,
      `scans=${first.scans} rows written=${first.rowsWritten} rewritten=${first.rewritten.join(',') || 'none'} (want 0/0/none), shape=${shape}, op reasons=${planted[0]?.reasons ?? 'ERR'}, runs with a reason=${String(planted[0]?.runReasons)} (want 0), a validation counts ${control} scan(s) (want > 0)`,
    );

    // The previous image keeps writing while the new one runs.
    const opens: string[] = [];
    for (const [index, reason] of [...PREVIOUS_REASONS, null].entries())
      opens.push(
        await attempt(() =>
          writePreviousOp(fixture, `exec-after-${index}`, reason),
        ),
      );
    const previous = {
      opens,
      opensUnnamed: await attempt(() =>
        writeOpBefore0240(fixture, 'exec-after-unnamed'),
      ),
      reopens: await attempt(() =>
        writePreviousOp(fixture, 'exec-planted-0', null),
      ),
      kicks: await attempt(async () => {
        const id = await writePreviousRun(
          fixture,
          'tsk-upgrade-0241-3',
          'queued',
        );
        if (id === null) throw new Error('the run was not kicked');
        await fixture`
          UPDATE app.project_agent_runs
          SET status = 'settled', updated_at_ms = ${Date.now()}
          WHERE id = ${id}
        `;
      }),
    };
    const kept = await fixture<{ reason: string | null }[]>`
      SELECT harness_reason AS reason FROM app.sandbox_session_ops
      WHERE exec_id = 'exec-planted-0'
    `;
    const modelBound = await attempt(
      () => fixture`
        INSERT INTO app.sandbox_session_ops (
          org_id, session_id, exec_id, kind, status, harness, harness_reason,
          started_at_ms
        ) VALUES (
          ${ORG}, 'ses-upgrade-0241', 'exec-model-bound', 'task-agent',
          'running', 'codex', 'model_bound', ${Date.now()}
        )
      `,
    );
    const unknownOp = await attempt(
      () => fixture`
        UPDATE app.sandbox_session_ops SET harness_reason = 'a-rule-nobody-wrote'
        WHERE exec_id = 'exec-planted-1'
      `,
    );
    const unknownRun = await attempt(
      () => fixture`
        UPDATE app.project_agent_runs SET harness_reason = 'a-rule-nobody-wrote'
        WHERE task_id = 'tsk-upgrade-0241-1'
      `,
    );
    record(
      'the previous image’s writes land on the shape 0241 leaves, and a rule nobody wrote is refused',
      previous.opens.every((outcome) => outcome === 'landed') &&
        previous.opensUnnamed === 'landed' &&
        previous.reopens === 'landed' &&
        kept[0]?.reason === 'pinned' &&
        previous.kicks === 'landed' &&
        modelBound === 'landed' &&
        unknownOp === '23514' &&
        unknownRun === '23514',
      `previous ops=${previous.opens.join(',')}, unnamed=${previous.opensUnnamed}, reopened=${previous.reopens} keeping ${String(kept[0]?.reason)} (want pinned), run kicked=${previous.kicks}, model_bound=${modelBound} (want landed), unknown rule on an op=${unknownOp} and on a run=${unknownRun} (want 23514)`,
    );

    const rowsBefore = await digestRows(fixture);
    const second = await apply0241(fixture, file, ddl, false);
    const rowsAfter = await digestRows(fixture);
    const shapeAfter = await readShape(fixture);
    record(
      'a second run of migration 0241 changes no row and no definition, reading neither table',
      second.scans === 0 &&
        second.rewritten.length === 0 &&
        rowsAfter === rowsBefore &&
        shapeAfter === shape,
      `scans=${second.scans} rewritten=${second.rewritten.join(',') || 'none'} (want 0/none), rows unchanged=${String(rowsAfter === rowsBefore)}, shape unchanged=${String(shapeAfter === shape)}`,
    );
  } catch (error) {
    record(
      'migration 0241 on a database at 0240: the proof runs to its end',
      false,
      errorText(error),
    );
  } finally {
    let disconnected = false;
    try {
      await sql?.end({ timeout: 8 });
      disconnected = true;
    } catch (cleanup) {
      cleanupFailures.push(cleanup);
    }
    try {
      if (owned && disconnected) await dropOwnedDatabase(admin, name);
    } catch (cleanup) {
      cleanupFailures.push(cleanup);
    }
    try {
      await admin.end({ timeout: 8 });
    } catch (cleanup) {
      cleanupFailures.push(cleanup);
    }
  }
  if (cleanupFailures.length > 0)
    throw new AggregateError(
      cleanupFailures,
      'migration 0241 upgrade proof: its owned database could not be removed',
    );
}

/** What the control's transaction throws to roll back with its reading. */
class ControlReading extends Error {
  constructor(readonly scans: number) {
    super('the control reading, rolled back');
  }
}
