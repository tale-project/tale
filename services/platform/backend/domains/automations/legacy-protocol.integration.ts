/** A deliberately separate database: the cutover must run against actual
 * pre-migration app tables, without disabling a trigger or rewriting SQL to a
 * test schema. The normal integration database and its workers are untouched.
 * Retained b493 function bodies are guarded against their raw Git blobs by
 * automation-legacy-fixture.test.ts; their adapter adds no fence or retry. */
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

import postgres, { type Sql } from 'postgres';

import { workflowTurnStartRefusal } from '../../../tests/fixtures/automation-legacy-v1/agent.ts';
import {
  claimRun as legacyClaimRun,
  recordProgress as legacyRecordProgress,
} from '../../../tests/fixtures/automation-legacy-v1/store.ts';
import {
  applyMigrationFileInTx,
  isMigrationFile,
  runBootMigrations,
} from '../../db/migrate.ts';
import { resolvePostgresConnection } from '../../db/ssl.ts';
import { eraseSubjectAutomationRuns } from '../erasure/service.ts';
import {
  assertNoLegacyAutomationHolds,
  OrganizationError,
} from '../organizations/service.ts';
import { TaskError } from '../tasks/errors.ts';
import {
  findLatestAutomationRunForTask,
  findLiveAutomationRunForTask,
} from '../tasks/external-ref.ts';
import { retireTasksInTx } from '../tasks/retire.ts';
import {
  AutomationError,
  claimRun,
  getRun,
  requestLegacyRunStopInTx,
  toRunDetail,
} from './store.ts';
import { markAutomationWriterInTx } from './writer-protocol.ts';

type Recorder = (name: string, ok: boolean, detail: string) => void;
const migrationRoot = new URL('../../db/migrations/', import.meta.url);

function connect(url: string): Sql {
  const connection = new URL(url);
  connection.searchParams.set(
    'options',
    `${connection.searchParams.get('options') ?? ''} -c statement_timeout=8000 -c lock_timeout=8000`,
  );
  const resolved = resolvePostgresConnection(connection.toString());
  return postgres(resolved.url, {
    ssl: resolved.ssl,
    max: 1,
    connect_timeout: 8,
    onnotice: () => {},
  });
}

async function sqlState(
  action: () => Promise<unknown>,
): Promise<string | null> {
  try {
    await action();
    return null;
  } catch (error) {
    if (error instanceof postgres.PostgresError) return error.code;
    throw error;
  }
}

async function staleAskSnapshot(
  databaseUrl: string,
  isolation: 'isolation level repeatable read' | 'isolation level serializable',
): Promise<() => Promise<string | null>> {
  const connection = connect(databaseUrl);
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const observed = sqlState(() =>
    connection.begin(isolation, async (tx) => {
      await tx`SELECT count(*) FROM app_migrations`;
      ready.resolve();
      await release.promise;
      await tx`UPDATE app.automation_human_asks SET question = 'stale replacement' WHERE id = 'held-ask'`;
    }),
  ).then(
    (code) => code,
    (error: unknown) => {
      ready.reject(error);
      throw error;
    },
  );
  // Observe rejection immediately even while the caller is arranging cutover.
  void observed.catch(() => {});
  try {
    await ready.promise;
  } catch (error) {
    await connection.end({ timeout: 8 });
    throw error;
  }
  return async () => {
    release.resolve();
    try {
      return await observed;
    } finally {
      await connection.end({ timeout: 8 });
    }
  };
}

/** Hold the boot ledger only AFTER the migrator's initial read, to observe
 * its final INSERT wait with the real DDL already installed. No migration statement, trigger or snapshot is substituted. */
async function holdMigrationLedger(
  databaseUrl: string,
): Promise<() => Promise<void>> {
  const connection = connect(databaseUrl);
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const transaction = connection.begin(async (tx) => {
    await tx`LOCK TABLE app_migrations IN SHARE MODE`;
    ready.resolve();
    await release.promise;
  });
  void transaction.catch((error: unknown) => ready.reject(error));
  try {
    await ready.promise;
  } catch (error) {
    await connection.end({ timeout: 8 });
    throw error;
  }
  return async () => {
    release.resolve();
    try {
      await transaction;
    } finally {
      await connection.end({ timeout: 8 });
    }
  };
}

export async function checkLegacyAutomationProtocol(
  databaseUrl: string,
  record: Recorder,
): Promise<void> {
  const admin = connect(databaseUrl);
  const name = `itest_legacy_${randomUUID().replaceAll('-', '')}`;
  const target = new URL(databaseUrl);
  target.pathname = `/${name}`;
  let owned = false;
  let sql: Sql | undefined;
  let releaseLedger: (() => Promise<void>) | undefined;
  let lateWriter: Sql | undefined;
  let lateWrite: Promise<string | null> | undefined;
  const finishSnapshots: Array<() => Promise<string | null>> = [];
  try {
    // No IF NOT EXISTS, template clone or FORCE cleanup: only this fresh,
    // uniquely created database belongs to this fixture.
    await admin`CREATE DATABASE ${admin(name)}`;
    owned = true;
    await admin`ALTER DATABASE ${admin(name)} SET search_path TO tale, public`;
    sql = connect(target.toString());
    await sql`CREATE SCHEMA tale`;
    await sql`CREATE TABLE app_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const files = (await readdir(migrationRoot)).filter(isMigrationFile).sort();
    for (const file of files.filter(
      (entry) => entry < '0163_automation_legacy_protocol.sql',
    )) {
      await sql.begin(async (tx) => {
        await applyMigrationFileInTx(tx, file);
        await tx`INSERT INTO app_migrations (name) VALUES (${file})`;
      });
    }
    await sql`INSERT INTO app.projects
      (id, org_id, name, created_by, created_at_ms, updated_at_ms)
      VALUES ('held-project', 'fixture', 'Held project', 'fixture', 1, 1),
        ('other-project', 'other', 'Other project', 'fixture', 1, 1)`;
    await sql`INSERT INTO app.tasks
      (id, org_id, project_id, title, status, rank, created_by, created_by_type, created_at_ms, updated_at_ms)
      VALUES ('held-task', 'fixture', 'held-project', 'Held task', 'in_progress', 'a', 'fixture', 'user', 1, 1),
        ('other-task', 'other', 'other-project', 'Other task', 'todo', 'a', 'fixture', 'user', 1, 1)`;
    await sql`
      INSERT INTO app.automation_runs
        (id, org_id, name, version, status, mode, started_by, checkpoints,
         claim_epoch, chain_seq, started_at_ms, wake_at_ms)
      VALUES ('queued', 'fixture', 'example', 1, 'queued', 'live', 'user:fixture',
        '{"nodes":{},"executions":0}', 0, 0, 1, 1),
        ('running', 'fixture', 'example', 1, 'running', 'live', 'user:fixture',
        '{"nodes":{"sent":{"status":"success"}},"executions":1}', 3, 4, 1, 1),
        ('waiting', 'fixture', 'example', 1, 'waiting', 'live', 'user:fixture',
        '{"nodes":{},"executions":0}', 5, 6, 1, 1)
    `;
    await sql`UPDATE app.automation_runs SET input = '{"task":{"id":"held-task"}}' WHERE id = 'waiting'`;
    await sql`INSERT INTO app.automation_human_asks
      (id, org_id, run_id, node_id, session_id, exec_id, question, status, expires_at_ms, created_at_ms)
      VALUES ('held-ask', 'fixture', 'waiting', 'agent', 'session', 'exec', 'original question', 'pending', 9999999999999, 1)`;
    finishSnapshots.push(
      await staleAskSnapshot(
        target.toString(),
        'isolation level repeatable read',
      ),
    );
    finishSnapshots.push(
      await staleAskSnapshot(target.toString(), 'isolation level serializable'),
    );
    const before = await sql<{ id: string; checkpoints: unknown }[]>`
      SELECT id, checkpoints FROM app.automation_runs ORDER BY id
    `;
    const fence = await readFile(
      new URL('0163_automation_legacy_protocol.sql', migrationRoot),
      'utf8',
    );
    // A legacy transaction's table lock precedes migration installation.
    // We do not pretend DDL can install between its SELECT and UPDATE.
    const cutoverUrl = new URL(target);
    cutoverUrl.searchParams.set(
      'options',
      `-c application_name=${name}_cutover`,
    );
    let applying: Promise<void> | undefined;
    let cutoverFailure: unknown;
    let observedWaiting = false;
    try {
      await sql.begin(async (tx) => {
        await tx`SELECT id FROM app.automation_runs WHERE id = 'running'`;
        await tx`UPDATE app.automation_runs SET wake_at_ms = 42 WHERE id = 'running'`;
        applying = runBootMigrations({
          databaseUrl: cutoverUrl.toString(),
          databaseWaitMs: 0,
          log: () => {},
        })
          .then(() => {})
          .catch((error: unknown) => {
            cutoverFailure = error;
          });
        const deadline = performance.now() + 2000;
        while (performance.now() < deadline) {
          const [state] = await admin<{ waiting: boolean }[]>`
            SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity
            WHERE datname = ${name} AND wait_event_type = 'Lock'
          `;
          if (state?.waiting) {
            observedWaiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        releaseLedger = await holdMigrationLedger(target.toString());
      });
      // The real migrator has installed all DDL, but its final ledger INSERT
      // waits for our SHARE lock. A READ COMMITTED child writer queues behind
      // the migration's locks and must refuse after the atomic commit.
      const [relations] = await sql<{ ask: number; ledger: number }[]>`
        SELECT 'app.automation_human_asks'::regclass::oid::int AS ask, 'app_migrations'::regclass::oid::int AS ledger
      `;
      let ddlWait = false;
      let lockModes: string[] = [];
      const waitUntil = performance.now() + 2000;
      while (performance.now() < waitUntil) {
        const pending = await admin<{ mode: string }[]>`
          SELECT l.mode FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
            WHERE a.datname = ${name} AND l.relation = ${relations?.ledger ?? 0}::oid
              AND NOT l.granted
        `;
        lockModes = pending.map((row) => row.mode);
        if (lockModes.includes('RowExclusiveLock')) {
          ddlWait = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      lateWriter = connect(target.toString());
      const [writer] = await lateWriter<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`;
      const late = lateWriter;
      lateWrite = sqlState(async () => {
        await late`UPDATE app.automation_human_asks SET question = 'concurrent replacement' WHERE id = 'held-ask'`;
      });
      let writerWait = false;
      const writerUntil = performance.now() + 2000;
      while (performance.now() < writerUntil) {
        const [pending] = await admin<{ waiting: boolean }[]>`
          SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid = ${writer?.pid ?? 0}
            AND relation = ${relations?.ask ?? 0}::oid AND NOT granted) AS waiting
        `;
        if (pending?.waiting) {
          writerWait = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      if (releaseLedger === undefined)
        throw new Error('fixture did not own the ledger barrier');
      await releaseLedger();
      releaseLedger = undefined;
      await applying;
      if (cutoverFailure !== undefined) throw cutoverFailure;
      const lateCode = await lateWrite;
      record(
        'a concurrent READ COMMITTED child write cannot cross the real DDL cutover',
        ddlWait && writerWait && (lateCode === '40001' || lateCode === 'P7502'),
        `native final-ledger waiter=${ddlWait}; lock modes=${lockModes.join(',')}; native writer waiter=${writerWait}; SQLSTATE=${lateCode}`,
      );
    } finally {
      await releaseLedger?.();
      releaseLedger = undefined;
      await applying;
    }
    const [prior] = await sql<{ wake: number }[]>`
      SELECT (legacy_quarantine -> 'prior' ->> 'wakeAtMs')::int AS wake
      FROM app.automation_runs WHERE id = 'running'
    `;
    record(
      'cutover waits for the complete pre-existing legacy transaction',
      observedWaiting && prior?.wake === 42,
      `actual cutover lock wait=${observedWaiting}, preserved committed wake=${prior?.wake}`,
    );
    const oldSnapshots = await Promise.all(
      finishSnapshots.splice(0).map((finish) => finish()),
    );
    record(
      'pre-cutover repeatable-read and serializable snapshots cannot miss the hold',
      oldSnapshots.length === 2 &&
        oldSnapshots.every((code) => code === '40001'),
      'actual boot migration and ledger transaction; no trigger or sentinel bypass',
    );
    const fixture = sql;
    const [ledger] = await sql<{ actual: string; bound: boolean }[]>`
      SELECT to_regclass('app_migrations')::text AS actual,
        position('tale.app_migrations' in pg_get_functiondef('app.assert_automation_cutover_visible()'::regprocedure)) > 0 AS bound
    `;
    // A caller's unrelated shadow ledger must not redirect the installed guard.
    await sql`CREATE TABLE public.app_migrations (name text PRIMARY KEY)`;
    const shadow = await sqlState(async () => {
      await fixture.begin(async (tx) => {
        await tx`SET LOCAL search_path TO public`;
        await tx`UPDATE app.automation_human_asks SET question = 'shadow bypass' WHERE id = 'held-ask'`;
      });
    });
    record(
      'sentinel binds the actual boot ledger despite a caller search-path shadow',
      ledger?.actual === 'app_migrations' && ledger.bound && shadow === 'P7502',
      'tale,public database default; qualified function body; empty public shadow',
    );
    const insertAgent = async (
      org: string,
      project: string,
      task: string,
    ): Promise<void> => {
      await fixture`INSERT INTO app.project_agent_runs
        (org_id, project_id, task_id, agent_id, exec_id, session_id, status, harness, model,
         started_by, started_at_ms, deadline_at_ms, updated_at_ms)
        VALUES (${org}, ${project}, ${task}, 'fixture', ${randomUUID()}, 'session', 'queued',
          'fixture', 'fixture', 'fixture', 1, 9999999999999, 1)`;
    };
    const agentHeld = await sqlState(() =>
      insertAgent('fixture', 'held-project', 'held-task'),
    );
    const agentOther = await sqlState(() =>
      insertAgent('other', 'other-project', 'other-task'),
    );
    const taskDelete = await sqlState(async () => {
      await fixture`DELETE FROM app.tasks WHERE id = 'held-task'`;
    });
    const projectDelete = await sqlState(async () => {
      await fixture`DELETE FROM app.projects WHERE id = 'held-project'`;
    });
    const otherDelete = await sqlState(async () => {
      await fixture`DELETE FROM app.projects WHERE id = 'other-project'`;
    });
    const newRunHeld = await sqlState(async () => {
      await fixture`INSERT INTO app.automation_runs
        (org_id, name, version, project_id, status, mode, started_by, input, checkpoints, started_at_ms)
        VALUES ('fixture', 'another', 1, 'held-project', 'queued', 'live', 'user:fixture',
          '{"task":{"id":"held-task"}}', '{"nodes":{},"executions":0}', 1)`;
    });
    record(
      'held task excludes old agent/new automation admission and subject retirement',
      agentHeld === 'P7502' &&
        newRunHeld === 'P7502' &&
        taskDelete === 'P7502' &&
        projectDelete === 'P7502' &&
        agentOther === null &&
        otherDelete === null,
      'org-level held run; different run/project binding; unrelated tenant remains usable',
    );
    const askUpdate = await sqlState(async () => {
      await fixture`UPDATE app.automation_human_asks SET status = 'answered', answer = 'changed' WHERE id = 'held-ask'`;
    });
    const askFold = await sqlState(async () => {
      await fixture`INSERT INTO app.automation_human_asks AS t
        (org_id, run_id, node_id, session_id, exec_id, question, status, expires_at_ms, created_at_ms)
        VALUES ('fixture', 'waiting', 'agent', 'session', 'exec', 'late question', 'pending', 9999999999999, 1)
        ON CONFLICT (session_id, exec_id) WHERE status = 'pending' DO UPDATE SET
          question = t.question || EXCLUDED.question, questions = NULL`;
    });
    const askDelete = await sqlState(async () => {
      await fixture`DELETE FROM app.automation_human_asks WHERE id = 'held-ask'`;
    });
    record(
      'standalone legacy ask update, insert/upsert and deletion preserve held evidence',
      askUpdate === 'P7502' && askFold === 'P7502' && askDelete === 'P7502',
      'no parent writer or transaction marker assumed at these old boundaries',
    );
    const held = await sql<
      {
        id: string;
        status: string;
        claimEpoch: number;
        checkpoints: unknown;
        legacyQuarantine: { prior: { status: string; claimEpoch: number } };
      }[]
    >`
      SELECT id, status, claim_epoch AS "claimEpoch", checkpoints,
        legacy_quarantine AS "legacyQuarantine"
      FROM app.automation_runs ORDER BY id
    `;
    record(
      'legacy cutover preserves all three active dispositions and checkpoints',
      held.length === 3 &&
        held.every(
          (row, index) =>
            row.status === 'quarantined' &&
            row.claimEpoch === row.legacyQuarantine.prior.claimEpoch + 1 &&
            JSON.stringify(row.checkpoints) ===
              JSON.stringify(before[index]?.checkpoints),
        ),
      'atomic queued/running/waiting hold; no terminal hook or invented attempt',
    );
    const legacyClaim = await legacyClaimRun(sql, 'fixture', 'queued');
    const progress = await legacyRecordProgress(sql, {
      organizationId: 'fixture',
      runId: 'running',
      epoch: 3,
      executions: 2,
    });
    const refusal = workflowTurnStartRefusal(
      { status: 'quarantined' },
      {
        nodeId: 'agent',
        execId: 'old-exec',
      },
    );
    record(
      'retained legacy claim, progress and absent-cursor admission stop',
      !legacyClaim.claimed &&
        progress.status === 'stale' &&
        refusal?.runEnded === true,
      'actual b493 function bodies; the agent predicate is not a complete host launch',
    );

    const staleWrite = await sqlState(async () => {
      await fixture`UPDATE app.automation_runs SET checkpoints = '{"nodes":{},"executions":2}' WHERE id = 'running'`;
    });
    record(
      'a later unconditional legacy UPDATE throws instead of silently succeeding',
      staleWrite === 'P7501',
      'a SQL error, not a zero-row success',
    );

    // Named-column old inserts still work. They are stamped by the database,
    // never by a default old callers could accidentally inherit as authority.
    await sql`
      INSERT INTO app.automation_runs
        (id, org_id, name, version, status, mode, started_by, checkpoints, started_at_ms)
      VALUES ('fresh', 'fixture', 'example', 1, 'queued', 'live', 'user:fixture',
        '{"nodes":{},"executions":0}', 1)
    `;
    const oldFresh = await sqlState(() =>
      legacyClaimRun(fixture, 'fixture', 'fresh'),
    );
    const fresh = await claimRun(sql, 'fixture', 'fresh');
    const [freshRow] = await sql<{ engineProtocol: number; held: boolean }[]>`
      SELECT engine_protocol AS "engineProtocol", legacy_quarantine IS NOT NULL AS held
      FROM app.automation_runs WHERE id = 'fresh'
    `;
    record(
      'old canonical insert is protected and the actual new claim works',
      oldFresh === 'P7501' &&
        fresh.claimed &&
        fresh.epoch === 1 &&
        freshRow?.engineProtocol === 2 &&
        !freshRow.held,
      'fresh queued work remains runnable; no legacy automatic takeover',
    );
    const nullInsert = async (marked: boolean) =>
      sqlState(async () => {
        await fixture.begin(async (tx) => {
          if (marked) await markAutomationWriterInTx(tx);
          await tx`INSERT INTO app.automation_runs
            (id, org_id, name, version, status, mode, started_by, checkpoints, started_at_ms, engine_protocol)
            VALUES (${marked ? 'marked-null' : 'unmarked-null'}, 'fixture', 'example', 1,
              'queued', 'live', 'user:fixture', '{"nodes":{},"executions":0}', 1, NULL)`;
        });
      });
    const unmarkedNull = await nullInsert(false);
    const markedNull = await nullInsert(true);
    await sql.begin(async (tx) => {
      await markAutomationWriterInTx(tx);
      await tx`INSERT INTO app.automation_runs
        (id, org_id, name, version, status, mode, started_by, checkpoints, started_at_ms, engine_protocol)
        VALUES ('future-floor', 'fixture', 'example', 1, 'queued', 'live', 'user:fixture',
          '{"nodes":{},"executions":0}', 1, 3)`;
    });
    const nullUpdate = async (id: string) =>
      sqlState(async () => {
        await fixture.begin(async (tx) => {
          await markAutomationWriterInTx(tx);
          await tx`UPDATE app.automation_runs SET engine_protocol = NULL WHERE id = ${id}`;
        });
      });
    const currentNull = await nullUpdate('fresh');
    const futureNull = await nullUpdate('future-floor');
    const floors = await sql<{ id: string; protocol: number }[]>`
      SELECT id, engine_protocol AS protocol FROM app.automation_runs
      WHERE id IN ('fresh', 'future-floor', 'marked-null', 'unmarked-null') ORDER BY id
    `;
    record(
      'NULL is never protocol admission or a way to lower an existing floor',
      [unmarkedNull, markedNull, currentNull, futureNull].every(
        (code) => code === 'P7501',
      ) &&
        floors.length === 2 &&
        floors[0]?.id === 'fresh' &&
        floors[0]?.protocol === 2 &&
        floors[1]?.id === 'future-floor' &&
        floors[1]?.protocol === 3,
      `refusals=${[unmarkedNull, markedNull, currentNull, futureNull].join(',')}; floors=${floors.map((row) => `${row.id}:${row.protocol}`).join(',')}`,
    );
    await sql`INSERT INTO app.automation_human_asks
      (id, org_id, run_id, node_id, session_id, exec_id, question, status, expires_at_ms, created_at_ms)
      VALUES ('fresh-ask', 'fixture', 'fresh', 'agent', 'fresh-session', 'fresh-exec', 'fresh question', 'pending', 9999999999999, 1)`;
    const moveFromHeld = await sqlState(async () => {
      await fixture`UPDATE app.automation_human_asks SET run_id = 'fresh' WHERE id = 'held-ask'`;
    });
    const moveToHeld = await sqlState(async () => {
      await fixture`UPDATE app.automation_human_asks SET run_id = 'waiting' WHERE id = 'fresh-ask'`;
    });
    const freshAnswer = await sqlState(async () => {
      await fixture`UPDATE app.automation_human_asks SET status = 'answered', answer = 'actual answer' WHERE id = 'fresh-ask'`;
      await fixture`DELETE FROM app.automation_human_asks WHERE id = 'fresh-ask'`;
    });
    record(
      'ask parent moves refuse either held endpoint while ordinary answers remain usable',
      moveFromHeld === 'P7502' &&
        moveToHeld === 'P7502' &&
        freshAnswer === null,
      'both immutable parent identities checked; no blanket ask-write restriction',
    );

    const [connection] = await sql<
      { pid: number }[]
    >`SELECT pg_backend_pid() AS pid`;
    const unmarkedWrite = () =>
      sqlState(async () => {
        await fixture`UPDATE app.automation_runs SET detail = 'unmarked' WHERE id = 'fresh'`;
      });
    const afterCommit = await unmarkedWrite();
    const rollback = await sqlState(async () => {
      await fixture.begin(async (tx) => {
        await markAutomationWriterInTx(tx);
        await tx`SELECT 1 / 0`;
      });
    });
    const afterRollback = await unmarkedWrite();
    let savepointReset = false;
    await sql.begin(async (tx) => {
      await tx`SAVEPOINT marker_scope`;
      await markAutomationWriterInTx(tx);
      await tx`ROLLBACK TO SAVEPOINT marker_scope`;
      const [value] = await tx<{ marker: string | null }[]>`
        SELECT current_setting('tale.automation_writer_protocol', true) AS marker
      `;
      savepointReset = value?.marker !== '2';
    });
    const afterSavepoint = await unmarkedWrite();
    const timeout = await sqlState(async () => {
      await fixture.begin(async (tx) => {
        await markAutomationWriterInTx(tx);
        await tx`SET LOCAL statement_timeout = '40ms'`;
        await tx`SELECT pg_sleep(1)`;
      });
    });
    const afterCancellation = await unmarkedWrite();
    const [reused] = await sql<
      { pid: number }[]
    >`SELECT pg_backend_pid() AS pid`;
    record(
      'transaction marker never leaks through commit, rollback, savepoint or cancellation',
      afterCommit === 'P7501' &&
        rollback === '22012' &&
        afterRollback === 'P7501' &&
        savepointReset &&
        afterSavepoint === 'P7501' &&
        timeout === '57014' &&
        afterCancellation === 'P7501' &&
        connection?.pid === reused?.pid,
      'max-one pool, same server connection, each unmarked UPDATE refused',
    );

    const heldWrite = await sqlState(async () => {
      await fixture.begin(async (tx) => {
        await markAutomationWriterInTx(tx);
        await tx`UPDATE app.automation_runs SET status = 'queued' WHERE id = 'queued'`;
      });
    });
    const heldDelete = await sqlState(async () => {
      await fixture.begin(async (tx) => {
        await markAutomationWriterInTx(tx);
        await tx`DELETE FROM app.automation_runs WHERE id = 'queued'`;
      });
    });
    const childDelete = await sqlState(async () => {
      await fixture`DELETE FROM app.automation_run_events WHERE run_id = 'queued'`;
    });
    // Idempotent reapplication neither changes the hold nor invents evidence.
    await sql.begin(async (tx) => {
      await tx.unsafe(fence);
    });
    const [evidence] = await sql<{ events: number; attempts: number }[]>`
      SELECT (SELECT count(*)::int FROM app.automation_run_events WHERE kind = 'legacy_quarantined') AS events,
        (SELECT count(*)::int FROM app.automation_node_attempts) AS attempts
    `;
    record(
      'general protocol authority cannot replay or erase unresolved holds',
      heldWrite === 'P7502' &&
        heldDelete === 'P7502' &&
        childDelete === 'P7502' &&
        evidence?.events === 3 &&
        evidence.attempts === 0,
      'three real hold events and zero fabricated node attempts',
    );
    const heldRun = await getRun(fixture, 'fixture', 'waiting');
    const publicHold =
      heldRun === null ? undefined : toRunDetail(heldRun).legacyQuarantine;
    if (publicHold === undefined)
      throw new Error('held run readback is absent');
    const subject = {
      organizationId: 'fixture',
      projectId: 'held-project',
      taskId: 'held-task',
    };
    const liveTaskRun = await findLiveAutomationRunForTask(fixture, subject);
    const latestTaskRun = await findLatestAutomationRunForTask(
      fixture,
      subject,
    );
    let retirementCode: string | undefined;
    try {
      await fixture.begin((tx) =>
        retireTasksInTx(tx, {
          organizationId: subject.organizationId,
          projectId: subject.projectId,
          taskIds: [subject.taskId],
          closedReason: 'task_deleted',
        }),
      );
    } catch (error) {
      if (!(error instanceof TaskError)) throw error;
      retirementCode = error.code;
    }
    const [taskStillHeld] = await fixture<{ status: string }[]>`
      SELECT status FROM app.tasks WHERE id = 'held-task'
    `;
    record(
      'task readers expose the exact hold and ordinary retirement refuses before effects',
      liveTaskRun?.status === 'quarantined' &&
        latestTaskRun?.runId === liveTaskRun.runId &&
        JSON.stringify(liveTaskRun.legacyQuarantine) ===
          JSON.stringify(publicHold) &&
        JSON.stringify(latestTaskRun.legacyQuarantine) ===
          JSON.stringify(publicHold) &&
        retirementCode === 'TASK_HAS_LIVE_RUN' &&
        taskStillHeld?.status === 'in_progress',
      'same public hold on run and task; task state remains unchanged',
    );
    const request = {
      expectedClaimEpoch: publicHold.claimEpoch,
      expectedObservedAt: publicHold.observedAt,
      action: 'stop',
      acknowledgeUnknownExternalEffects: true,
    };
    const stop = () =>
      fixture.begin((tx) =>
        requestLegacyRunStopInTx(tx, {
          organizationId: 'fixture',
          runId: 'waiting',
          actor: 'fixture',
          request,
        }),
      );
    const refusals: string[] = [];
    for (const override of [
      { expectedClaimEpoch: publicHold.claimEpoch + 1 },
      { expectedObservedAt: publicHold.observedAt + 1 },
    ]) {
      try {
        await fixture.begin((tx) =>
          requestLegacyRunStopInTx(tx, {
            organizationId: 'fixture',
            runId: 'waiting',
            actor: 'fixture',
            request: { ...request, ...override },
          }),
        );
        refusals.push('accepted');
      } catch (error) {
        if (!(error instanceof AutomationError)) throw error;
        refusals.push(error.code);
      }
    }
    const [beforeStop] = await fixture<{ hold: unknown; events: number }[]>`
      SELECT legacy_quarantine AS hold,
        (SELECT count(*)::int FROM app.automation_run_events WHERE run_id = 'waiting' AND kind = 'legacy_stop_requested') AS events
      FROM app.automation_runs WHERE id = 'waiting'
    `;
    record(
      'stop request refuses stale epoch or observed-time without recording a decision',
      refusals.every((code) => code === 'RUN_QUARANTINE_CHANGED') &&
        beforeStop?.events === 0 &&
        JSON.stringify(beforeStop.hold) ===
          JSON.stringify(heldRun?.legacyQuarantine),
      'both expected identity fields are independently checked before mutation',
    );
    const stopped = await stop();
    const repeated = await stop();
    const [afterStop] = await fixture<
      { status: string; events: number; question: string }[]
    >`
      SELECT r.status,
        (SELECT count(*)::int FROM app.automation_run_events WHERE run_id = r.id AND kind = 'legacy_stop_requested') AS events,
        (SELECT question FROM app.automation_human_asks WHERE id = 'held-ask') AS question
      FROM app.automation_runs r WHERE r.id = 'waiting'
    `;
    const afterStopAgent = await sqlState(() =>
      insertAgent('fixture', 'held-project', 'held-task'),
    );
    const afterStopDelete = await sqlState(async () => {
      await fixture.begin(async (tx) => {
        await markAutomationWriterInTx(tx);
        await tx`DELETE FROM app.automation_runs WHERE id = 'waiting'`;
      });
    });
    record(
      'explicit stop request is idempotent and never asserts cleanup or releases the hold',
      stopped.legacyQuarantine.resolution?.actor === 'fixture' &&
        JSON.stringify(stopped) === JSON.stringify(repeated) &&
        afterStop?.status === 'quarantined' &&
        afterStop.events === 1 &&
        afterStop.question === 'original question' &&
        afterStopAgent === 'P7502' &&
        afterStopDelete === 'P7502',
      'one operator decision; original asks preserved; task start and purge still refused',
    );

    // Exercise the real erasure primitive against an actual 0163 cutover,
    // including a stopped hold. Ordinary subject rows must still be erased.
    await fixture.begin(async (tx) => {
      await markAutomationWriterInTx(tx);
      await tx`
        INSERT INTO app.automation_runs
          (id, org_id, name, version, status, mode, started_by, started_at_ms, finished_at_ms)
        VALUES ('erasure-unheld', 'fixture', 'example', 1, 'success', 'live', 'user:fixture', 1, 2),
          ('erasure-other-subject', 'fixture', 'example', 1, 'success', 'live', 'user:other', 1, 2),
          ('erasure-other-org', 'other', 'example', 1, 'success', 'live', 'user:fixture', 1, 2)
      `;
    });
    const heldSnapshot = () => fixture<{ rows: unknown }[]>`
      SELECT jsonb_agg(to_jsonb(r) ORDER BY id) AS rows
      FROM app.automation_runs r WHERE legacy_quarantine IS NOT NULL
    `;
    // The earlier writer-admission probes also left two unheld subject runs.
    // Assert that complete starting set so the deletion count cannot ignore it.
    const unheldSubjectRuns = () => fixture<{ id: string }[]>`
      SELECT id FROM app.automation_runs
      WHERE org_id = 'fixture' AND started_by = 'user:fixture'
        AND legacy_quarantine IS NULL
      ORDER BY id
    `;
    const beforeUnheldErasure = await unheldSubjectRuns();
    const beforeErasure = await heldSnapshot();
    const erased = await eraseSubjectAutomationRuns(
      fixture,
      'fixture',
      'fixture',
    );
    const afterErasure = await heldSnapshot();
    const afterUnheldErasure = await unheldSubjectRuns();
    const kept = await fixture<{ id: string }[]>`
      SELECT id FROM app.automation_runs WHERE id LIKE 'erasure-%' ORDER BY id
    `;
    const [ask] = await fixture<{ question: string }[]>`
      SELECT question FROM app.automation_human_asks WHERE id = 'held-ask'
    `;
    const repeatErasure = await eraseSubjectAutomationRuns(
      fixture,
      'fixture',
      'fixture',
    );
    record(
      'subject erasure deletes unheld runs and preserves exact held evidence across retries [ERASE-R9]',
      beforeUnheldErasure.map((row) => row.id).join(',') ===
        'erasure-unheld,fresh,future-floor' &&
        erased.deleted === 3 &&
        erased.held === 3 &&
        afterUnheldErasure.length === 0 &&
        repeatErasure.deleted === 0 &&
        repeatErasure.held === 3 &&
        JSON.stringify(beforeErasure) === JSON.stringify(afterErasure) &&
        kept.map((row) => row.id).join(',') ===
          'erasure-other-org,erasure-other-subject' &&
        ask?.question === 'original question',
      'same subject in another tenant and another subject in this tenant survive; stop never grants deletion authority',
    );
    let orgConflict: string | undefined;
    try {
      await fixture.begin((tx) => assertNoLegacyAutomationHolds(tx, 'fixture'));
    } catch (error) {
      if (!(error instanceof OrganizationError) || error.status !== 409)
        throw error;
      orgConflict = error.code;
    }
    await fixture.begin((tx) => assertNoLegacyAutomationHolds(tx, 'other'));
    record(
      'organization legacy-hold preflight returns a tenant-scoped conflict [ORG-R12]',
      orgConflict === 'ORG_LEGACY_AUTOMATION_HELD' &&
        JSON.stringify(afterErasure) === JSON.stringify(await heldSnapshot()),
      'held organization is refused; another tenant is admitted; hold facts remain unchanged',
    );
  } finally {
    await releaseLedger?.();
    await lateWrite;
    await lateWriter?.end({ timeout: 8 });
    await Promise.allSettled(finishSnapshots.map((finish) => finish()));
    try {
      // Do not force-drop a database if a connection fails to settle.
      await sql?.end({ timeout: 8 });
      if (owned) await admin`DROP DATABASE ${admin(name)}`;
    } finally {
      await admin.end({ timeout: 8 });
    }
  }
}
