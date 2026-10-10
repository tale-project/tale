/** Real Postgres proof of the standing-role wake's remaining cases (#4540,
 * design W2–W8, W8b (a), W10, W12, W14–W16, W18 variants; round 4: W19 the
 * fair scan, W20 and W21 one wake target per project under races; round 5:
 * W22 the REST install racing the claim it binds under, W23 the previous
 * image's writes, W24 claim swaps between binding changes; round 6: W22c the
 * absent-fence control, W25 binding writes that claim nothing never waiting
 * on each other; round 7: W25 held at a strict barrier that fails rather than
 * pass without the overlap). Every scenario
 * owns its project, manager, workers and opted-in schedule T (a yearly cron,
 * so only wakes and the lane's own occurrences fire it), so no scenario's
 * circuit, workspace or wake row reaches another. The agent turns stay
 * queued and inert (`holdAgentJobs`); a served pass is the turn host's two
 * marks, launch then settle. Assertions read the wake row's state, never who
 * fired it: the harness's in-process `automation.trigger_scan` tick runs the
 * same wake fire. */
import { randomUUID } from 'node:crypto';

import {
  RETRY_QUEUE_LOCK_CLASS,
  retryQueueKeysOf,
  transactSerializable,
} from '@tale/shared/db/serializable';
import type { Sql, TransactionSql } from 'postgres';

import { triggerRunInput } from '../../../lib/engine/core/slots.ts';
import {
  standingSessionIdForProjectAgent,
  workerSessionId,
} from '../../core/sandbox/session_naming.ts';
import {
  lockProjectWork,
  projectWorkQueueKey,
} from '../../lib/project-work-lock.ts';
import { loadRestProject } from '../../rest/shared.ts';
import { pgAutomationStore } from '../automations/dispatch-store.ts';
import {
  managedConfigurationHash,
  managedDefinitionValue,
  managedScheduleValue,
} from '../automations/managed-configuration-value.ts';
import {
  AutomationError,
  automationExists,
  beginRunInTx,
  bindProject,
  bindProjectInTx,
  deploy,
  saveVersion,
  setAutomationProjects,
  setTrigger,
  versionRow,
} from '../automations/store.ts';
import { stampFired } from '../automations/triggers.ts';
import { fireDueProjectWakes } from '../automations/wakes.ts';
import { pgTaskStore } from '../connectors/task-store.ts';
import { getProjectAuthContext } from '../projects/service.ts';
import { completeAgentRunInTx } from './agent-run-completion.ts';
import {
  cancelAgentRunInTx,
  failAgentRun,
  failAgentRunFromTurn,
  kickAgentRun,
  launchAgentRun,
  settleAgentRun,
} from './agent-runs.ts';
import {
  holdAgentJobs,
  waitFor,
  type LaneCtx,
  type Recorder,
} from './delegated-start.integration.ts';
import { markAutoRetryRetired } from './kick-plan.ts';
import { laneBarrier } from './lane-barrier.ts';
import { agentUpdateTaskStatusTrusted } from './service.ts';

const WAIT_MS = 30_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
/** The lane's own advisory-lock class for its barriers (two-int form). */
const BARRIER_CLASS = 72_085_099;
const CRON = '0 0 1 1 *';

interface WakeState {
  signalSeq: number;
  consumedSeq: number;
  firedSeq: number;
  firedRunId: string | null;
  attempts: number;
  notBefore: number | null;
  outcome: string | null;
  blockedReason: string | null;
  managerTaskId: string | null;
}

interface ManagerRun {
  id: string;
  execId: string;
  status: string;
  captured: number | null;
  startedAt: number;
}

interface Scenario {
  label: string;
  orgId: string;
  project: string;
  manager: string;
  roleTask: string;
  name: string;
  triggerId: string;
  workers: { agentId: string; taskId: string }[];
}

export async function checkStandingRoleWakeScenarios(
  sql: Sql,
  ctx: LaneCtx,
  record: Recorder,
): Promise<void> {
  const { orgId, userId } = ctx;
  const suffix = randomUUID().slice(0, 8);
  const now = Date.now();
  let rank = 0;
  const foreignOrg = `itest-wake-org-${suffix}`;
  const scenarios = new Map<string, string>();
  const projectOf = (label: string): string => {
    const known = scenarios.get(label);
    if (known !== undefined) return known;
    const id = randomUUID();
    scenarios.set(label, id);
    return id;
  };
  const labels = [
    'w2',
    'w3',
    'w4',
    'w5',
    'w6',
    'w7',
    'w8',
    'w8b',
    'w10',
    'w12',
    'w14',
    'w15a',
    'w15b',
    'w16',
    'w18',
    'w19p',
    'w19w',
    'w19e',
    'w20',
    'w21a',
    'w21b',
    'w22y',
    'w23',
    'w23w',
    'w23off',
    'w24a',
    'w24b',
    'w25a',
    'w25b',
    'w25c',
    'w25d',
    'w26',
    'w27a',
    'w27b',
  ];
  for (const label of labels) projectOf(label);
  const release = await holdAgentJobs(sql, suffix, [...scenarios.values()]);
  const cleanup: (() => Promise<unknown>)[] = [];

  // ---- fixtures: one project per scenario --------------------------------
  const ownedProjects = new Map<string, string>();
  const insertProject = async (org: string, id: string, name: string) => {
    await sql`
      INSERT INTO app.projects (id, org_id, name, created_by,
                                created_at_ms, updated_at_ms)
      VALUES (${id}, ${org}, ${name}, ${userId}, ${now}, ${now})
    `;
    ownedProjects.set(id, org);
  };
  const removeProject = async (id: string) => {
    const org = ownedProjects.get(id);
    if (org === undefined)
      throw new Error('refuse cleanup of an unowned project');
    await sql.begin(async (tx) => {
      await tx`DELETE FROM app.automation_project_bindings WHERE org_id = ${org} AND project_id = ${id}`;
      await tx`DELETE FROM app.projects WHERE org_id = ${org} AND id = ${id}`;
    });
  };
  const insertAgent = async (
    org: string,
    id: string,
    project: string,
    name: string,
  ) => {
    await sql`
      INSERT INTO app.project_agents (id, org_id, project_id, name, harness,
                                      model, created_by, created_at_ms,
                                      updated_at_ms)
      VALUES (${id}, ${org}, ${project}, ${name}, 'claude-code',
              'itest-model', ${userId}, ${now}, ${now})
    `;
  };
  const insertTask = async (
    org: string,
    project: string,
    title: string,
    agentId?: string,
  ): Promise<string> => {
    const taskId = randomUUID();
    rank += 1;
    await sql`
      INSERT INTO app.tasks (id, org_id, project_id, title, status, rank,
        assignee_type, assignee_id, created_by, created_by_type,
        created_at_ms, updated_at_ms)
      VALUES (${taskId}, ${org}, ${project}, ${title}, 'todo',
        ${`d${suffix}${String(rank).padStart(3, '0')}`},
        ${agentId === undefined ? null : 'agent'}, ${agentId ?? null},
        ${userId}, 'user', ${now}, ${now})
    `;
    return taskId;
  };
  const optIn = (s: Scenario, wakeOnSlotFreed: boolean | undefined) =>
    setTrigger(sql, {
      organizationId: s.orgId,
      name: s.name,
      trigger: {
        kind: 'schedule',
        cron: CRON,
        timezone: 'UTC',
        enabled: true,
        ...(wakeOnSlotFreed === undefined ? {} : { wakeOnSlotFreed }),
      },
      actor: userId,
    });
  const setup = async (
    label: string,
    options: {
      workers?: number;
      optIn?: boolean;
      org?: string;
      name?: string;
    } = {},
  ): Promise<Scenario> => {
    const org = options.org ?? orgId;
    const project = scenarios.get(label);
    if (project === undefined)
      throw new Error(
        'scenario project was not enrolled in the held-job fixture',
      );
    const manager = randomUUID();
    await insertProject(org, project, `Wake ${label}`);
    await insertAgent(org, manager, project, 'Fleet manager');
    const roleTask = await insertTask(
      org,
      project,
      `Standing role ${label}`,
      manager,
    );
    const workers: Scenario['workers'] = [];
    for (let index = 0; index < (options.workers ?? 2); index += 1) {
      const agentId = randomUUID();
      await insertAgent(org, agentId, project, `Worker ${index + 1}`);
      workers.push({
        agentId,
        taskId: await insertTask(
          org,
          project,
          `Work ${label}.${index + 1}`,
          agentId,
        ),
      });
    }
    const name = options.name ?? `itest/wake-${label}-${suffix}`;
    await saveVersion(sql, {
      organizationId: org,
      name,
      document: {
        version: 1,
        name,
        nodes: [
          {
            id: 'start',
            type: 'task.start_agent',
            input: { taskId: roleTask, moveToInProgress: false },
          },
        ],
        output: '{{ nodes.start.output }}',
      },
      actor: userId,
      projectId: project,
    });
    await deploy(sql, { organizationId: org, name, version: 1, actor: userId });
    const s: Scenario = {
      label,
      orgId: org,
      project,
      manager,
      roleTask,
      name,
      triggerId: '',
      workers,
    };
    await optIn(s, options.optIn ?? true);
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM app.automation_triggers WHERE org_id = ${org} AND name = ${name}
    `;
    s.triggerId = rows[0]?.id ?? '';
    cleanup.push(async () => {
      await sql`DELETE FROM app.project_wakes WHERE org_id = ${org} AND project_id = ${project}`;
      await sql`DELETE FROM app.automation_triggers WHERE org_id = ${org} AND name = ${name}`;
    });
    return s;
  };

  // ---- reads and moves ----------------------------------------------------
  const wake = async (s: Scenario): Promise<WakeState | null> => {
    const rows = await sql<WakeState[]>`
      SELECT signal_seq::float8 AS "signalSeq",
             consumed_seq::float8 AS "consumedSeq",
             fired_seq::float8 AS "firedSeq", fired_run_id AS "firedRunId",
             attempts, not_before_ms::float8 AS "notBefore", outcome,
             blocked_reason AS "blockedReason",
             manager_task_id AS "managerTaskId"
      FROM app.project_wakes
      WHERE org_id = ${s.orgId} AND project_id = ${s.project}
    `;
    return rows[0] ?? null;
  };
  const show = (state: unknown) => JSON.stringify(state);
  const managerRuns = (s: Scenario) =>
    sql<ManagerRun[]>`
      SELECT id, exec_id AS "execId", status,
             wake_admitted_seq::float8 AS captured,
             started_at_ms::float8 AS "startedAt"
      FROM app.project_agent_runs
      WHERE org_id = ${s.orgId} AND agent_id = ${s.manager}
      ORDER BY seq DESC
    `;
  const kick = (s: Scenario, agentId: string, taskId: string, worker = 1) =>
    sql.begin((tx) =>
      kickAgentRun(tx, {
        organizationId: s.orgId,
        projectId: s.project,
        taskId,
        agentId,
        harness: 'claude-code',
        model: 'itest-model',
        startedBy: userId,
        sessionId: workerSessionId(
          agentId,
          standingSessionIdForProjectAgent(agentId),
          worker,
        ),
      }),
    );
  const kickWorker = (s: Scenario, index = 0) => {
    const worker = s.workers[index];
    if (worker === undefined) throw new Error(`itest: no worker ${index}`);
    return kick(s, worker.agentId, worker.taskId);
  };
  /** One worker release in its standing workspace: s + 1. */
  const releaseOnce = async (s: Scenario, index = 0) => {
    const run = await kickWorker(s, index);
    await settleAgentRun(sql, { runId: run.runId, resultText: 'done' });
  };
  // The claim moves back, and so does the instant the scan next finds the
  // schedule due, which a save or a fire set ahead.
  const backdate = (s: Scenario) => sql`
    UPDATE app.automation_triggers
    SET last_due_at_ms = ${Date.now() - 2 * MINUTE_MS}, last_fired_at_ms = NULL,
        next_due_at_ms = ${Date.now() - MINUTE_MS}
    WHERE org_id = ${s.orgId} AND name = ${s.name}
  `;
  const clearWait = (s: Scenario) => sql`
    UPDATE app.project_wakes SET not_before_ms = ${Date.now() - 1}
    WHERE org_id = ${s.orgId} AND project_id = ${s.project}
  `;
  const occurrenceOver = async (runId: string | null) => {
    if (runId === null) return;
    await waitFor(async () => {
      const rows = await sql<{ status: string }[]>`
        SELECT status FROM app.automation_runs WHERE id = ${runId}
      `;
      return ['success', 'failed', 'cancelled'].includes(rows[0]?.status ?? '');
    }, WAIT_MS);
  };
  const occurrence = async (runId: string | null) => {
    if (runId === null) return null;
    const rows = await sql<
      { status: string; output: unknown; endedAt: number | null; org: string }[]
    >`
      SELECT status, output, finished_at_ms::float8 AS "endedAt",
             org_id AS org
      FROM app.automation_runs WHERE id = ${runId}
    `;
    return rows[0] ?? null;
  };
  /** Fire the pending wake and let its occurrence land. */
  const fire = async (s: Scenario): Promise<WakeState | null> => {
    await backdate(s);
    await fireDueProjectWakes(sql);
    const state = await wake(s);
    await occurrenceOver(state?.firedRunId ?? null);
    return state;
  };
  /** One scan, firing nothing new unless the row is eligible. */
  const scan = async (s: Scenario): Promise<WakeState | null> => {
    await backdate(s);
    await fireDueProjectWakes(sql);
    return wake(s);
  };
  /** An occurrence of T started as the cron path starts one (the scan's
   * `beginRunInTx` + `stampFired`), landed. */
  const cronOccurrence = async (s: Scenario): Promise<string> => {
    const minute = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
    const started = await sql.begin(async (tx) => {
      const run = await beginRunInTx(tx, {
        organizationId: s.orgId,
        name: s.name,
        input: triggerRunInput({ kind: 'schedule', firedAt: minute }),
        mode: 'live',
        startedBy: `trigger:${s.triggerId}`,
      });
      if (run === null) throw new Error('itest: T has no deployed version');
      await stampFired(tx, s.triggerId, minute, run.runId);
      return run.runId;
    });
    await occurrenceOver(started);
    return started;
  };
  /** Launch and settle the newest manager run: a served pass. */
  const serve = async (s: Scenario) => {
    const [newest] = await managerRuns(s);
    if (newest === undefined) return;
    await launchAgentRun(sql, { runId: newest.id, execId: newest.execId });
    await settleAgentRun(sql, { runId: newest.id, resultText: 'served' });
  };
  /** A barrier: the lane holds (BARRIER_CLASS, key) on a reserved session;
   * a statement that takes it waits until the lane lets go. */
  const holdBarrier = async (key: number) => {
    const holder = await sql.reserve();
    await holder`SELECT pg_advisory_lock(${BARRIER_CLASS}, ${key})`;
    return async () => {
      await holder`SELECT pg_advisory_unlock(${BARRIER_CLASS}, ${key})`;
      holder.release();
    };
  };
  const waitersAt = async (key: number): Promise<number> => {
    const rows = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM pg_locks
      WHERE locktype = 'advisory' AND NOT granted
        AND classid::bigint = ${BARRIER_CLASS} AND objid::bigint = ${key}
    `;
    return rows[0]?.count ?? 0;
  };
  const triggerFn = async (
    fn: string,
    table: string,
    when: string,
    body: string,
    event: 'INSERT' | 'UPDATE' = 'INSERT',
  ): Promise<() => Promise<void>> => {
    if (!/^[a-z0-9_]+$/.test(fn)) throw new Error(`itest: bad name ${fn}`);
    await sql.unsafe(`
      CREATE OR REPLACE FUNCTION app.${fn}() RETURNS trigger AS $$
      BEGIN
        ${body}
        RETURN NEW;
      END $$ LANGUAGE plpgsql
    `);
    await sql.unsafe(`
      CREATE TRIGGER ${fn} BEFORE ${event} ON ${table}
      FOR EACH ROW WHEN (${when}) EXECUTE FUNCTION app.${fn}()
    `);
    const drop = async () => {
      await sql.unsafe(`DROP TRIGGER IF EXISTS ${fn} ON ${table}`);
      await sql.unsafe(`DROP FUNCTION IF EXISTS app.${fn}()`);
    };
    cleanup.push(drop);
    return drop;
  };
  const uuidLiteral = (id: string) => {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error(`itest: bad id ${id}`);
    return `'${id}'`;
  };
  const nameLiteral = (name: string) => {
    if (!/^[a-z0-9/_-]+$/.test(name))
      throw new Error(`itest: bad name ${name}`);
    return `'${name}'`;
  };
  /** Sessions waiting on a store lock taken as
   * `pg_advisory_xact_lock(hashtextextended(<key>, 0))`: the automation name
   * lock (`automation:<org>/<name>`) or a project's claim lock
   * (`project-wake:<org>/<project>`, migration 0168). */
  const keyWaiters = async (key: string): Promise<number> => {
    const rows = await sql<{ count: number }[]>`
      WITH k AS (SELECT hashtextextended(${key}, 0) AS key)
      SELECT count(*)::int AS count FROM pg_locks l, k
      WHERE l.locktype = 'advisory' AND NOT l.granted AND l.objsubid = 1
        AND l.classid = ((k.key >> 32) & 4294967295)::oid
        AND l.objid = (k.key & 4294967295)::oid
    `;
    return rows[0]?.count ?? 0;
  };
  const projectLock = (project: string) => `project-wake:${orgId}/${project}`;
  const answered409 = (outcome: unknown) =>
    outcome instanceof AutomationError &&
    outcome.code === 'AUTOMATION_TRIGGER_INVALID' &&
    outcome.status === 409;
  const said = (outcome: unknown) =>
    outcome instanceof Error
      ? `${outcome.message}${'code' in outcome ? ` [${String(outcome.code)}]` : ''}`
      : show(outcome);
  /** The REST install door's transaction, statement for statement
   * (`rest/v1-automations.ts`, POST /api/v1/automations/:name/projects/:id):
   * SERIALIZABLE, the project read first (it takes the snapshot), the
   * definition check, then the bind under the automation's name lock.
   * `attempts` counts the serializable retries' runs of the body. The
   * optional snapshot gate is test-only: it pauses immediately after that
   * first project read so a race can release its writer and then let this
   * stale snapshot continue without depending on pool scheduling. */
  const restInstall = (
    name: string,
    projectId: string,
    snapshotGate?: number,
  ) => {
    let attempts = 0;
    const outcome = getProjectAuthContext(sql, {
      organizationId: orgId,
      userId,
      role: 'owner',
    })
      .then((auth) =>
        transactSerializable(sql, async (tx) => {
          attempts += 1;
          const project = await loadRestProject(tx, auth, projectId, {
            write: true,
          });
          if (snapshotGate !== undefined) {
            await tx`
              SELECT pg_advisory_xact_lock(${BARRIER_CLASS}, ${snapshotGate})
            `;
          }
          if (!(await automationExists(tx, auth.organizationId, name)))
            return null;
          return bindProjectInTx(tx, {
            organizationId: auth.organizationId,
            name,
            projectId: project.id,
            actor: auth.userId,
          });
        }),
      )
      .then(
        (result) =>
          result === null
            ? ('missing' as const)
            : result.bound
              ? ('bound' as const)
              : ('unchanged' as const),
        (error: unknown) => error,
      );
    return { outcome, attempts: () => attempts };
  };
  /** Bindings of one project, claiming first. */
  const projectBindings = (project: string) =>
    sql<{ name: string; wakes: boolean }[]>`
      SELECT automation_name AS name, wakes
      FROM app.automation_project_bindings
      WHERE org_id = ${orgId} AND project_id = ${project}
      ORDER BY wakes DESC, automation_name
    `;
  const automationBindings = (name: string) =>
    sql<{ projectId: string; wakes: boolean }[]>`
      SELECT project_id AS "projectId", wakes
      FROM app.automation_project_bindings
      WHERE org_id = ${orgId} AND automation_name = ${name}
      ORDER BY project_id
    `;
  /** The automation's fence generation, or null while it has no row. */
  const fenceOf = async (name: string): Promise<number | null> => {
    const rows = await sql<{ generation: number }[]>`
      SELECT generation::float8 AS generation FROM app.automation_wake_fences
      WHERE org_id = ${orgId} AND automation_name = ${name}
    `;
    return rows[0]?.generation ?? null;
  };
  const extraProject = async (title: string) => {
    const id = randomUUID();
    await insertProject(orgId, id, title);
    cleanup.push(() => removeProject(id));
    return id;
  };
  /** The previous image's binding insert, verbatim in shape (store.ts at
   * the base): no `wakes` column, the conflict ignored. */
  const oldBindingInsert = (
    tx: TransactionSql,
    name: string,
    projectId: string,
  ) =>
    tx`
      INSERT INTO app.automation_project_bindings (
        org_id, automation_name, project_id, bound_at_ms, bound_by
      ) VALUES (
        ${orgId}, ${name}, ${projectId}, ${Date.now()},
        ${userId}
      )
      ON CONFLICT (org_id, automation_name, project_id) DO NOTHING
    `;

  /** One scenario: a throw is recorded against it, and the next one runs. */
  const scenario = async (label: string, body: () => Promise<void>) => {
    try {
      await body();
    } catch (error) {
      record(
        `standing-role wake: scenario ${label} ran to its end`,
        false,
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
    }
  };

  try {
    // ---- W2: four concurrent releases coalesce into one wake ---------------
    await scenario('W2', async () => {
      const s = await setup('w2', { workers: 4 });
      const runs = await Promise.all(
        s.workers.map((_, index) => kickWorker(s, index)),
      );
      await Promise.all(
        runs.map((run) =>
          settleAgentRun(sql, { runId: run.runId, resultText: 'done' }),
        ),
      );
      const pending = await wake(s);
      const fired = await fire(s);
      const [m] = await managerRuns(s);
      await serve(s);
      const served = await wake(s);
      record(
        'standing-role wake: four concurrent releases record four signals and one wake, served once (W2)',
        pending?.signalSeq === 4 &&
          pending.consumedSeq === 0 &&
          fired?.firedSeq === 4 &&
          m?.captured === 4 &&
          (await managerRuns(s)).length === 1 &&
          served?.outcome === 'served' &&
          served.consumedSeq === 4,
        `pending=${show(pending)} fired=${show(fired)} manager=${show(m)} served=${show(served)} (want s4, one fire capturing 4, served 4/4)`,
      );
    });

    // ---- W3: a manager started before the opt-in captures nothing ---------
    await scenario('W3', async () => {
      const s = await setup('w3', { optIn: false });
      await cronOccurrence(s);
      const [m] = await managerRuns(s);
      await optIn(s, true);
      await releaseOnce(s);
      const held = await scan(s);
      const runsWhileHeld = (await managerRuns(s)).length;
      await serve(s);
      const afterPass = await wake(s);
      await fire(s);
      const [m2] = await managerRuns(s);
      await serve(s);
      const done = await wake(s);
      record(
        'standing-role wake: a manager started before the opt-in holds the wake, covers nothing, and one wake follows (W3)',
        m !== undefined &&
          m.captured === null &&
          held?.signalSeq === 1 &&
          held.firedSeq === 0 &&
          runsWhileHeld === 1 &&
          afterPass?.consumedSeq === 0 &&
          afterPass.outcome === 'served' &&
          m2?.captured === 1 &&
          done?.consumedSeq === 1,
        `first=${show(m)} held=${show(held)} runs=${runsWhileHeld} afterPass=${show(afterPass)} second=${show(m2)} done=${show(done)} (want no capture, 0 fires while live, c0 after its pass, then a fire capturing 1, c1)`,
      );
    });

    // ---- W4: a release during the admission is not captured --------------
    await scenario('W4', async () => {
      const s = await setup('w4');
      const unlock = await holdBarrier(4);
      const dropBarrier = await triggerFn(
        `itest_wake_w4_${suffix}`,
        'app.project_agent_runs',
        `NEW.agent_id = ${uuidLiteral(s.manager)}`,
        `PERFORM pg_advisory_xact_lock(${BARRIER_CLASS}, 4);`,
      );
      let blocked = false;
      try {
        await releaseOnce(s, 0);
        await backdate(s);
        await fireDueProjectWakes(sql);
        blocked = await waitFor(async () => (await waitersAt(4)) > 0, WAIT_MS);
        await releaseOnce(s, 1);
      } finally {
        await unlock();
      }
      const firedRow = await wake(s);
      await occurrenceOver(firedRow?.firedRunId ?? null);
      await dropBarrier();
      const [m] = await managerRuns(s);
      await serve(s);
      const afterPass = await wake(s);
      await clearWait(s);
      await fire(s);
      const [m2] = await managerRuns(s);
      await serve(s);
      const done = await wake(s);
      record(
        'standing-role wake: a release committed inside the admission stays pending, and exactly one more wake covers it (W4)',
        blocked &&
          m?.captured === 1 &&
          afterPass?.signalSeq === 2 &&
          afterPass.consumedSeq === 1 &&
          m2?.captured === 2 &&
          done?.consumedSeq === 2 &&
          (await managerRuns(s)).length === 2,
        `blocked=${blocked} first=${show(m)} afterPass=${show(afterPass)} second=${show(m2)} done=${show(done)} (want capture 1 although s reached 2, then one more fire capturing 2)`,
      );
    });

    // ---- W5: a wake and a cron occurrence never start two managers --------
    await scenario('W5', async () => {
      const s = await setup('w5');
      // The wake first: the cron occurrence that follows answers already_running.
      await releaseOnce(s);
      await fire(s);
      const cronRun = await cronOccurrence(s);
      const cron = await occurrence(cronRun);
      const runsAfterBoth = (await managerRuns(s)).length;
      const heldA = await scan(s);
      await serve(s);
      const servedA = await wake(s);
      // The cron first: it admits (and captures) while the wake is quiet; the
      // wake holds while that manager lives, and fires once after.
      await cronOccurrence(s);
      const [cronManager] = await managerRuns(s);
      await releaseOnce(s);
      const heldB = await scan(s);
      const runsWhileHeldB = (await managerRuns(s)).length;
      await serve(s);
      await fire(s);
      const [m3] = await managerRuns(s);
      await serve(s);
      const doneB = await wake(s);
      const output = cron?.output;
      record(
        'standing-role wake: a wake and a cron occurrence start one manager in either order, and the winner’s capture stands (W5)',
        typeof output === 'object' &&
          output !== null &&
          'reason' in output &&
          output.reason === 'already_running' &&
          runsAfterBoth === 1 &&
          heldA?.firedSeq === 1 &&
          servedA?.consumedSeq === 1 &&
          cronManager?.captured === 1 &&
          heldB?.signalSeq === 2 &&
          runsWhileHeldB === 2 &&
          m3?.captured === 2 &&
          doneB?.consumedSeq === 2 &&
          (await managerRuns(s)).length === 3,
        `cron loser=${show(cron)} runs=${runsAfterBoth} heldA=${show(heldA)} servedA=${show(servedA)} cronManager=${show(cronManager)} heldB=${show(heldB)} runsB=${runsWhileHeldB} third=${show(m3)} done=${show(doneB)} (want already_running, one run per occurrence pair, captures 1 then 2)`,
      );
    });

    // ---- W6: a replayed start step changes no capture and starts nothing --
    await scenario('W6', async () => {
      const s = await setup('w6');
      await releaseOnce(s);
      const fired = await fire(s);
      const [m] = await managerRuns(s);
      await releaseOnce(s, 1);
      const replay: unknown = await pgTaskStore(sql)
        .startAgent({
          organizationId: s.orgId,
          caller: {
            kind: 'workflow',
            runId: fired?.firedRunId ?? '',
            nodeId: 'start',
          },
          taskId: s.roleTask,
          moveToInProgress: false,
        })
        .catch((error: unknown) => ({ threw: String(error) }));
      const after = await managerRuns(s);
      record(
        'standing-role wake: a replayed start step answers its first run, starts nothing and keeps its capture (W6)',
        m?.captured === 1 &&
          after.length === 1 &&
          after[0]?.id === m.id &&
          after[0]?.captured === 1 &&
          show(replay).includes(m.id),
        `first=${show(m)} replay=${show(replay)} after=${show(after)} (want the same run, capture still 1)`,
      );
    });

    // ---- W7: a fault in the admission leaves no run, no capture, a backoff -
    await scenario('W7', async () => {
      const s = await setup('w7');
      const dropFault = await triggerFn(
        `itest_wake_w7_${suffix}`,
        'app.project_agent_runs',
        `NEW.agent_id = ${uuidLiteral(s.manager)}`,
        `RAISE EXCEPTION 'itest admission fault';`,
      );
      await releaseOnce(s);
      const fired = await fire(s);
      const failed = await occurrence(fired?.firedRunId ?? null);
      const classified = await scan(s);
      const runsAfterFault = (await managerRuns(s)).length;
      await dropFault();
      await clearWait(s);
      await fire(s);
      const [m] = await managerRuns(s);
      await serve(s);
      const done = await wake(s);
      record(
        'standing-role wake: a faulted admission starts nothing, counts one attempt with the first backoff step, and the re-fire is served (W7)',
        runsAfterFault === 0 &&
          classified?.outcome === 'not_admitted' &&
          classified.attempts === 1 &&
          failed?.endedAt !== null &&
          failed?.endedAt !== undefined &&
          classified.notBefore === failed.endedAt + MINUTE_MS &&
          m?.captured === 1 &&
          done?.consumedSeq === 1 &&
          done.attempts === 0,
        `occurrence=${show(failed)} classified=${show(classified)} runs=${runsAfterFault} manager=${show(m)} done=${show(done)} (want no run, attempts 1 at end + 60 s, then served with attempts 0)`,
      );
    });

    // ---- W8: three failures back off 1, 2, 4 minutes; the same generation -
    await scenario('W8', async () => {
      const s = await setup('w8');
      const dropFault = await triggerFn(
        `itest_wake_w8_${suffix}`,
        'app.project_agent_runs',
        `NEW.agent_id = ${uuidLiteral(s.manager)}`,
        `RAISE EXCEPTION 'itest admission fault';`,
      );
      await releaseOnce(s);
      const steps: { attempts: number; wait: number | null }[] = [];
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const fired = await fire(s);
        const ended =
          (await occurrence(fired?.firedRunId ?? null))?.endedAt ?? null;
        const classified = await scan(s);
        steps.push({
          attempts: classified?.attempts ?? -1,
          wait:
            typeof classified?.notBefore === 'number' && ended !== null
              ? classified.notBefore - ended
              : null,
        });
        await clearWait(s);
      }
      await dropFault();
      await fire(s);
      const [m] = await managerRuns(s);
      await serve(s);
      const done = await wake(s);
      record(
        'standing-role wake: three failed occurrences wait 1, 2 and 4 minutes, and the same generation is served once the fault clears (W8)',
        JSON.stringify(steps) ===
          JSON.stringify([
            { attempts: 1, wait: MINUTE_MS },
            { attempts: 2, wait: 2 * MINUTE_MS },
            { attempts: 3, wait: 4 * MINUTE_MS },
          ]) &&
          m?.captured === 1 &&
          done?.signalSeq === 1 &&
          done.consumedSeq === 1 &&
          done.attempts === 0,
        `steps=${show(steps)} manager=${show(m)} done=${show(done)} (want 1, 2, 4 min, then served 1/1)`,
      );
    });

    // ---- W8b (a): a managed apply cannot clear an AUTO-R13 pause ----------
    await scenario('W8b (a)', async () => {
      const s = await setup('w8b');
      await sql`
        UPDATE app.automation_triggers
        SET enabled = false, last_skip_reason = 'paused_after_failures',
            last_skipped_at_ms = ${Date.now()}, last_failure_code = 'node_error',
            consecutive_failures = 5
        WHERE org_id = ${s.orgId} AND name = ${s.name}
      `;
      await releaseOnce(s);
      const blocked = await scan(s);
      const definition = await versionRow(sql, s.orgId, s.name, 1);
      const definitionSha256 = managedConfigurationHash(
        managedDefinitionValue(s.project, s.name, definition),
      );
      if (definitionSha256 === null)
        throw new Error('missing deployed wake definition');
      const current = managedScheduleValue(s.project, s.name, {
        kind: 'schedule',
        cron: CRON,
        timezone: 'UTC',
        enabled: false,
        repeat: null,
        startDate: null,
        catchUp: null,
        input: null,
        wakeOnSlotFreed: true,
      });
      const refused = await setTrigger(sql, {
        organizationId: s.orgId,
        name: s.name,
        trigger: {
          kind: 'schedule',
          cron: CRON,
          timezone: 'UTC',
          enabled: true,
          wakeOnSlotFreed: true,
        },
        actor: userId,
        managed: {
          projectId: s.project,
          expectedHash: managedConfigurationHash(current),
          definitionSha256,
        },
      }).then(
        () => null,
        (error: unknown) => error,
      );
      const stillPaused = await sql<
        { enabled: boolean; skip: string | null }[]
      >`
        SELECT enabled, last_skip_reason AS skip FROM app.automation_triggers
        WHERE org_id = ${s.orgId} AND name = ${s.name}
      `;
      const afterApply = await scan(s);
      record(
        'standing-role wake: a managed apply is refused (409) while AUTO-R13 holds the schedule, and the wake stays blocked with nothing fired (W8b a)',
        blocked?.outcome === 'blocked' &&
          blocked.blockedReason === 'paused_after_failures:node_error' &&
          refused instanceof AutomationError &&
          refused.code === 'AUTOMATION_TRIGGER_INVALID' &&
          refused.status === 409 &&
          stillPaused[0] !== undefined &&
          !stillPaused[0].enabled &&
          stillPaused[0]?.skip === 'paused_after_failures' &&
          afterApply?.outcome === 'blocked' &&
          afterApply.firedSeq === 0 &&
          (await managerRuns(s)).length === 0,
        `blocked=${show(blocked)} refused=${refused instanceof Error ? refused.message : show(refused)} trigger=${show(stillPaused[0])} after=${show(afterApply)} (want blocked, a 409, still paused, no fire)`,
      );
    });

    // ---- W10: another task of the manager agent uses another worker ------
    await scenario('W10', async () => {
      const s = await setup('w10');
      await releaseOnce(s);
      await fire(s);
      await serve(s);
      const other = await insertTask(
        s.orgId,
        s.project,
        'Manager side work',
        s.manager,
      );
      const side = await kick(s, s.manager, other, 2);
      await launchAgentRun(sql, { runId: side.runId, execId: side.execId });
      await releaseOnce(s);
      await fire(s);
      const [m] = await managerRuns(s);
      const sideWhileManagerStarts = await sql<
        { status: string }[]
      >`SELECT status FROM app.project_agent_runs WHERE id = ${side.runId}`;
      await serve(s);
      const servedFirst = await wake(s);
      await settleAgentRun(sql, { runId: side.runId, resultText: 'side done' });
      const signalled = await wake(s);
      await fire(s);
      const [next] = await managerRuns(s);
      await serve(s);
      const done = await wake(s);
      record(
        'standing-role wake: another task on the manager agent does not hold its wake; a higher standing worker release signals the next generation (W10)',
        m?.captured === 2 &&
          sideWhileManagerStarts[0]?.status === 'running' &&
          servedFirst?.consumedSeq === 2 &&
          signalled?.signalSeq === 3 &&
          next?.captured === 3 &&
          done?.consumedSeq === 3,
        `manager=${show(m)} side=${show(sideWhileManagerStarts)} served=${show(servedFirst)} signalled=${show(signalled)} next=${show(next)} done=${show(done)} (want manager capturing 2 while side runs; worker2 then signals and serves 3)`,
      );
    });

    // A queued provisional/parked name owns no worker (the claim's rule).
    await scenario('W26', async () => {
      const s = await setup('w26');
      const worker = s.workers[0];
      if (worker === undefined) throw new Error('missing worker');
      const other = await insertTask(
        s.orgId,
        s.project,
        'Provisional worker',
        worker.agentId,
      );
      const pending = await kick(s, worker.agentId, other);
      const pendingBefore = await sql<
        { status: string; claimed: number | null; jobs: number; held: number }[]
      >`
        SELECT r.status, r.session_claimed_at_ms::float8 AS claimed,
          (SELECT count(*)::int FROM pgboss.job j WHERE j.name = 'task.agent_turn' AND j.data ->> 'runId' = r.id) AS jobs,
          (SELECT count(*)::int FROM pgboss.job j WHERE j.name = 'task.agent_turn' AND j.data ->> 'runId' = r.id AND j.state = 'created' AND j.start_after > now() + interval '1 hour') AS held
        FROM app.project_agent_runs r WHERE r.id = ${pending.runId}
      `;
      await releaseOnce(s);
      const unclaimed = await wake(s);
      await sql`UPDATE app.project_agent_runs SET waiting_for_capacity_at_ms = ${Date.now()}, session_claimed_at_ms = ${Date.now()} WHERE id = ${pending.runId}`;
      // A previous image may park without clearing a claim. It still owns
      // no worker, just as the maintained unique occupancy index specifies.
      await releaseOnce(s);
      const parked = await wake(s);
      record(
        'standing-role wake: queued unclaimed and parked provisional runs do not suppress a free worker release (W26)',
        pendingBefore[0]?.status === 'queued' &&
          pendingBefore[0].claimed === null &&
          pendingBefore[0].jobs > 0 &&
          pendingBefore[0].held === pendingBefore[0].jobs &&
          unclaimed?.signalSeq === 1 &&
          parked?.signalSeq === 2,
        `pending=${show(pendingBefore)} unclaimed=${show(unclaimed)} parked=${show(parked)} (want inert unclaimed job, signals 1 then 2)`,
      );
    });

    // ---- W12: a failure for good and an armed retry consume nothing ------
    await scenario('W12', async () => {
      const s = await setup('w12');
      await releaseOnce(s);
      await fire(s);
      const [m] = await managerRuns(s);
      const failedAt = Date.now();
      if (m !== undefined) {
        await failAgentRun(sql, {
          organizationId: s.orgId,
          runId: m.id,
          execId: m.execId,
          error: 'itest: failed for good',
        });
      }
      const forGood = await wake(s);
      await clearWait(s);
      await fire(s);
      const [m2] = await managerRuns(s);
      if (m2 !== undefined) {
        await failAgentRunFromTurn(sql, {
          runId: m2.id,
          error: 'itest: retryable',
        });
      }
      const armed = await wake(s);
      const held = await scan(s);
      const runsWhileArmed = (await managerRuns(s)).length;
      const retiredAt = Date.now();
      if (m2 !== undefined) {
        await sql.begin((tx) =>
          markAutoRetryRetired(tx, {
            organizationId: s.orgId,
            taskId: s.roleTask,
            failedRunId: m2.id,
          }),
        );
      }
      const retired = await wake(s);
      record(
        'standing-role wake: a manager failure for good counts an attempt and consumes nothing; an armed retry holds; its retirement counts the next (W12)',
        forGood?.outcome === 'manager_failed' &&
          forGood.consumedSeq === 0 &&
          forGood.attempts === 1 &&
          forGood.notBefore !== null &&
          forGood.notBefore >= failedAt + MINUTE_MS &&
          armed?.attempts === 1 &&
          armed.consumedSeq === 0 &&
          held?.outcome === 'held' &&
          runsWhileArmed === 2 &&
          retired?.outcome === 'manager_failed' &&
          retired.attempts === 2 &&
          retired.consumedSeq === 0 &&
          retired.notBefore !== null &&
          retired.notBefore >= retiredAt + 2 * MINUTE_MS,
        `forGood=${show(forGood)} armed=${show(armed)} held=${show(held)} runs=${runsWhileArmed} retired=${show(retired)} (want manager_failed 1, armed unchanged, held, then manager_failed 2 at +2 min, c0 throughout)`,
      );
    });

    // ---- W14: a card the start would refuse holds the wake ----------------
    await scenario('W14', async () => {
      const s = await setup('w14');
      await releaseOnce(s);
      await fire(s);
      await serve(s);
      const workerRunsBefore = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM app.project_agent_runs
        WHERE org_id = ${s.orgId} AND project_id = ${s.project}
          AND agent_id <> ${s.manager} AND started_via IS NOT NULL
      `;
      await sql`UPDATE app.tasks SET status = 'in_review' WHERE id = ${s.roleTask}`;
      await releaseOnce(s);
      const inReview = await scan(s);
      await sql`UPDATE app.tasks SET status = 'done' WHERE id = ${s.roleTask}`;
      const done = await scan(s);
      const blocker = await insertTask(s.orgId, s.project, 'Blocks the role');
      await sql`UPDATE app.tasks SET status = 'todo' WHERE id = ${s.roleTask}`;
      await sql`
        INSERT INTO app.task_dependencies (org_id, project_id,
          blocker_task_id, blocked_task_id, created_by, created_by_type,
          created_at_ms)
        VALUES (${s.orgId}, ${s.project}, ${blocker}, ${s.roleTask},
                ${userId}, 'user', ${now})
      `;
      const blocked = await scan(s);
      await sql`UPDATE app.tasks SET status = 'done' WHERE id = ${blocker}`;
      const worker = s.workers[0];
      await sql`
        UPDATE app.tasks SET assignee_type = 'agent', assignee_id = ${worker?.agentId ?? null}
        WHERE id = ${s.roleTask}
      `;
      const reassigned = await scan(s);
      const workerRunsHeld = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM app.project_agent_runs
        WHERE org_id = ${s.orgId} AND project_id = ${s.project}
          AND agent_id <> ${s.manager} AND started_via IS NOT NULL
      `;
      const runsWhileHeld = (await managerRuns(s)).length;
      await sql`
        UPDATE app.tasks SET assignee_type = 'agent', assignee_id = ${s.manager}
        WHERE id = ${s.roleTask}
      `;
      await fire(s);
      const [m] = await managerRuns(s);
      await serve(s);
      const cleared = await wake(s);
      record(
        'standing-role wake: a role card in review, done, blocked or reassigned holds the wake with nothing fired and no worker started; one wake follows once it clears (W14)',
        [inReview, done, blocked, reassigned].every(
          (state) => state?.outcome === 'held_card' && state.firedSeq === 1,
        ) &&
          runsWhileHeld === 1 &&
          workerRunsHeld[0]?.count === workerRunsBefore[0]?.count &&
          m?.captured === 2 &&
          cleared?.consumedSeq === 2 &&
          (await managerRuns(s)).length === 2,
        `inReview=${show(inReview)} done=${show(done)} blocked=${show(blocked)} reassigned=${show(reassigned)} runs=${runsWhileHeld} manager=${show(m)} cleared=${show(cleared)} (want held_card four times, no new run, then one fire capturing 2)`,
      );
    });

    // ---- W15: two organizations never share a wake ------------------------
    await scenario('W15', async () => {
      await sql`
        INSERT INTO "organization" ("id", "name", "slug", "createdAt")
        VALUES (${foreignOrg}, 'Wake Foreign Tenant', ${`wake-${suffix}`}, now())
      `;
      const home = await setup('w15a');
      const foreign = await setup('w15b', { org: foreignOrg, name: home.name });
      const homeBefore = await wake(home);
      const homeTrigger = await sql<{ lastRunId: string | null }[]>`
        SELECT last_run_id AS "lastRunId" FROM app.automation_triggers
        WHERE id = ${home.triggerId}
      `;
      await releaseOnce(foreign);
      const foreignPending = await wake(foreign);
      const homePending = await wake(home);
      await backdate(foreign);
      await fireDueProjectWakes(sql);
      const foreignFired = await wake(foreign);
      const firedRun = await occurrence(foreignFired?.firedRunId ?? null);
      const homeAfter = await wake(home);
      const homeTriggerAfter = await sql<{ lastRunId: string | null }[]>`
        SELECT last_run_id AS "lastRunId" FROM app.automation_triggers
        WHERE id = ${home.triggerId}
      `;
      record(
        'standing-role wake: a release in one organization signals and fires only that organization’s schedule, even under the same automation name (W15)',
        homeBefore === null &&
          foreignPending?.signalSeq === 1 &&
          homePending === null &&
          foreignFired?.firedSeq === 1 &&
          firedRun?.org === foreignOrg &&
          homeAfter === null &&
          homeTriggerAfter[0]?.lastRunId === homeTrigger[0]?.lastRunId,
        `foreign=${show(foreignFired)} firedRunOrg=${firedRun?.org} home=${show(homeAfter)} homeTrigger=${show(homeTriggerAfter[0])} (want only the foreign row and run)`,
      );
      await occurrenceOver(foreignFired?.firedRunId ?? null);
    });

    // ---- W16: forced queued retries of the turn host's completion ---------
    await scenario('W16', async () => {
      const s = await setup('w16', { workers: 3 });
      const worker = s.workers[0];
      const auditor = s.workers[1];
      const doorAgent = s.workers[2];
      if (
        worker === undefined ||
        auditor === undefined ||
        doorAgent === undefined
      ) {
        throw new Error('itest: W16 needs three workers');
      }
      const complete = (
        run: { runId: string; execId: string },
        attempts: { code: unknown; keys: string[] }[],
      ) =>
        transactSerializable(sql, async (tx) => {
          try {
            return await completeAgentRunInTx(tx, {
              organizationId: s.orgId,
              taskId: worker.taskId,
              agentId: worker.agentId,
              runId: run.runId,
              execId: run.execId,
              resultText: 'report',
              body: 'itest report',
              files: [],
            });
          } catch (error) {
            attempts.push({
              code:
                typeof error === 'object' && error !== null && 'code' in error
                  ? error.code
                  : undefined,
              keys: [...retryQueueKeysOf(error)],
            });
            throw error;
          }
        });
      const ledgerOf = async (runId: string) => {
        const rows = await sql<{ count: number }[]>`
          SELECT count(*)::int AS count FROM app.audit_logs
          WHERE org_id = ${s.orgId} AND resource_id = ${runId}
            AND action = 'agent.run_settled'
        `;
        return rows[0]?.count ?? -1;
      };
      // A discussion that already exists: the next completion's first write
      // after its snapshot is the comment's own row, before any audit write.
      await complete(await kickWorker(s, 0), []);
      const expectedKeys = [
        `task-comment:${worker.taskId}`,
        projectWorkQueueKey(s.project),
      ];
      const barrier = (key: number) =>
        triggerFn(
          `itest_wake_w16_${key}_${suffix}`,
          'app.task_discussion_message_meta',
          `NEW.task_id = ${uuidLiteral(worker.taskId)}`,
          `PERFORM pg_advisory_xact_lock(${BARRIER_CLASS}, ${key});`,
        );

      // F-a: an audited release commits after the snapshot → 40001 at the
      // completion's wake upsert: the audit row itself meets no writer.
      const before = await wake(s);
      const runA = await kickWorker(s, 0);
      const auditedRun = await kick(s, auditor.agentId, auditor.taskId);
      const attemptsA: { code: unknown; keys: string[] }[] = [];
      const unlockA = await holdBarrier(161);
      const dropA = await barrier(161);
      const completionA = complete(runA, attemptsA);
      const pausedA = await waitFor(
        async () => (await waitersAt(161)) > 0,
        WAIT_MS,
      );
      await failAgentRun(sql, {
        organizationId: s.orgId,
        runId: auditedRun.runId,
        execId: auditedRun.execId,
        error: 'itest: audited release',
      });
      await unlockA();
      const doneA = await completionA;
      await dropA();
      const afterA = await wake(s);
      record(
        'standing-role wake: an audited release after the completion’s snapshot aborts it at the wake row, not at its audit row; the queued retry carries exactly [task-comment, project-work] and commits once (W16 F-a)',
        pausedA &&
          doneA &&
          show(attemptsA[0]?.keys) === show(expectedKeys) &&
          (await ledgerOf(runA.runId)) === 1 &&
          (await ledgerOf(auditedRun.runId)) === 1 &&
          afterA !== null &&
          before !== null &&
          afterA.signalSeq === before.signalSeq + 2,
        `paused=${pausedA} done=${doneA} attempts=${show(attemptsA)} before=${show(before)} after=${show(afterA)} (want one 40001 marked with both keys, one ledger row each, s + 2)`,
      );

      // F-b: a wake-row write under the project's work key, with no audit
      // row, commits after the snapshot → 40001 at the completion's own wake
      // upsert.
      const runB = await kickWorker(s, 0);
      const attemptsB: { code: unknown; keys: string[] }[] = [];
      const unlockB = await holdBarrier(162);
      const dropB = await barrier(162);
      const completionB = complete(runB, attemptsB);
      const pausedB = await waitFor(
        async () => (await waitersAt(162)) > 0,
        WAIT_MS,
      );
      const marker = Date.now();
      await sql.begin(async (tx) => {
        await lockProjectWork(tx, s.project);
        await tx`
          UPDATE app.project_wakes SET updated_at_ms = ${marker}
          WHERE org_id = ${s.orgId} AND project_id = ${s.project}
        `;
      });
      await unlockB();
      const doneB = await completionB;
      await dropB();
      const afterB = await wake(s);
      record(
        'standing-role wake: a non-audited wake-row write under the project’s work key makes the completion’s wake upsert fail; the retry carries the same two keys and commits once (W16 F-b)',
        pausedB &&
          doneB &&
          show(attemptsB[0]?.keys) === show(expectedKeys) &&
          (await ledgerOf(runB.runId)) === 1 &&
          afterB !== null &&
          afterB.signalSeq === (afterA?.signalSeq ?? -2) + 1,
        `paused=${pausedB} done=${doneB} attempts=${show(attemptsB)} after=${show(afterB)} (want one 40001 at the wake statement with both keys, one ledger row, s + 1)`,
      );

      // F-c: the inversion that exists today: a SERIALIZABLE status door on
      // the same task while the completion's retry is queued. Any 40P01 is
      // recorded; both sides must end recovered.
      const runC = await kickWorker(s, 0);
      const auditedC = await kick(s, doorAgent.agentId, doorAgent.taskId);
      const attemptsC: { code: unknown; keys: string[] }[] = [];
      const doorAttempts: { code: unknown; keys: string[] }[] = [];
      const unlockC = await holdBarrier(163);
      const dropC = await barrier(163);
      const completionC = complete(runC, attemptsC);
      const pausedC = await waitFor(
        async () => (await waitersAt(163)) > 0,
        WAIT_MS,
      );
      await failAgentRun(sql, {
        organizationId: s.orgId,
        runId: auditedC.runId,
        execId: auditedC.execId,
        error: 'itest: audited release',
      });
      const door = transactSerializable(sql, async (tx) => {
        try {
          return await agentUpdateTaskStatusTrusted(tx, {
            organizationId: s.orgId,
            // The task's own assignee moves it, as the agent's tool does.
            actorId: worker.agentId,
            taskId: worker.taskId,
            status: 'in_progress',
          });
        } catch (error) {
          doorAttempts.push({
            code:
              typeof error === 'object' && error !== null && 'code' in error
                ? error.code
                : undefined,
            keys: [...retryQueueKeysOf(error)],
          });
          throw error;
        }
      }).then(
        () => 'applied',
        (error: unknown) =>
          `refused: ${error instanceof Error ? error.message : String(error)}`,
      );
      await unlockC();
      const doneC = await completionC.then(
        (value) => value,
        (error: unknown) =>
          `threw: ${error instanceof Error ? error.message : String(error)}`,
      );
      const doorOutcome = await door;
      await dropC();
      const terminalC = await sql<{ status: string }[]>`
        SELECT status FROM app.project_agent_runs WHERE id = ${runC.runId}
      `;
      const deadlocks = [...attemptsC, ...doorAttempts].filter(
        (attempt) => attempt.code === '40P01',
      );
      record(
        'standing-role wake: with the existing inversion forced, the completion and a status door both end recovered; any 40P01 is recorded with its keys (W16 F-c)',
        pausedC &&
          typeof doneC === 'boolean' &&
          doorOutcome === 'applied' &&
          ['settled', 'cancelled'].includes(terminalC[0]?.status ?? '') &&
          (await ledgerOf(runC.runId)) === 1,
        `paused=${pausedC} completion=${doneC} door=${doorOutcome} run=${terminalC[0]?.status} attempts=${show(attemptsC)} door attempts=${show(doorAttempts)} 40P01=${show(deadlocks)} (want both recovered and one ledger row; the 40P01 profile is recorded, not required to be zero)`,
      );
    });

    // ---- W18 variants: a cancel after launch, then a closed circuit -------
    await scenario('W18 variants', async () => {
      const s = await setup('w18');
      const scanTrace: unknown[] = [];
      const startManager = async (
        expectedCount: number,
      ): Promise<ManagerRun> => {
        const before = new Set((await managerRuns(s)).map((run) => run.id));
        let manager: ManagerRun | undefined;
        await backdate(s);
        const admitted = await waitFor(async () => {
          // A global scan may legitimately skip an audit-busy organization.
          // Wait for this occurrence's actual receipt, not an optional row.
          const result = await fireDueProjectWakes(sql);
          const state = await wake(s);
          const runs = await managerRuns(s);
          manager = runs.find((run) => !before.has(run.id));
          const ended = await occurrence(state?.firedRunId ?? null);
          scanTrace.push({
            expectedCount,
            result,
            state,
            runs: runs.length,
            occurrence: ended?.status,
          });
          if (scanTrace.length > 8) scanTrace.shift();
          const output = ended?.output;
          return (
            runs.length === expectedCount &&
            manager !== undefined &&
            ended?.status === 'success' &&
            typeof output === 'object' &&
            output !== null &&
            'runId' in output &&
            output.runId === manager.id
          );
        }, WAIT_MS);
        if (!admitted || manager === undefined)
          throw new Error(
            `itest: W18 manager admission not observed: ${show(scanTrace)}`,
          );
        return manager;
      };
      await releaseOnce(s);
      const m = await startManager(1);
      const cancelledAt = Date.now();
      const launched = await launchAgentRun(sql, {
        runId: m.id,
        execId: m.execId,
      });
      const cancelled = await sql.begin((tx) =>
        cancelAgentRunInTx(tx, {
          organizationId: s.orgId,
          runId: m.id,
          taskId: s.roleTask,
        }),
      );
      if (!launched || !cancelled)
        throw new Error(
          `itest: W18 launch/cancel election lost: ${launched}/${cancelled}`,
        );
      const launchedCancel = await wake(s);
      for (let start = 2; start <= 3; start += 1) {
        await clearWait(s);
        const next = await startManager(start);
        const stopped = await sql.begin((tx) =>
          cancelAgentRunInTx(tx, {
            organizationId: s.orgId,
            runId: next.id,
            taskId: s.roleTask,
          }),
        );
        if (!stopped)
          throw new Error(`itest: W18 cancel election lost for start ${start}`);
      }
      const starts = await managerRuns(s);
      const oldest = Math.min(...starts.map((run) => run.startedAt));
      await clearWait(s);
      let circuit: WakeState | null = null;
      const classified = await waitFor(async () => {
        circuit = await scan(s);
        return circuit?.outcome === 'paused';
      }, WAIT_MS);
      // Read after the bounded wait so TypeScript and the diagnostic use
      // the committed row, rather than narrowing through a callback write.
      circuit = await wake(s);
      record(
        'standing-role wake: a cancel after launch keeps the generation like a queued one; once the circuit closes the wake waits for its exact retryAfter (W18)',
        launchedCancel?.outcome === 'manager_cancelled' &&
          launchedCancel.consumedSeq === 0 &&
          launchedCancel.attempts === 1 &&
          launchedCancel.notBefore !== null &&
          launchedCancel.notBefore >= cancelledAt + MINUTE_MS &&
          starts.length === 3 &&
          classified &&
          circuit?.outcome === 'paused' &&
          circuit.consumedSeq === 0 &&
          circuit.notBefore === oldest + HOUR_MS &&
          (await managerRuns(s)).length === 3,
        `launched cancel=${show(launchedCancel)} starts=${starts.length} circuit=${show(circuit)} oldest=${oldest} scans=${show(scanTrace)} (want manager_cancelled 1 at +60 s, then paused until the oldest start + 1 h)`,
      );
    });

    // ---- W19: rows that never become eligible cannot starve a later one ---
    await scenario('W19', async () => {
      const paused = await setup('w19p');
      await sql`
        UPDATE app.automation_triggers
        SET enabled = false, last_skip_reason = 'paused_after_failures',
            last_skipped_at_ms = ${Date.now()}, last_failure_code = 'node_error'
        WHERE id = ${paused.triggerId}
      `;
      const waiting = await setup('w19w');
      const eligible = await setup('w19e');
      const busyOrg = `itest-wake-busy-${suffix}`;
      await sql`
        INSERT INTO "organization" ("id", "name", "slug", "createdAt")
        VALUES (${busyOrg}, 'Wake Busy Tenant', ${`wake-busy-${suffix}`}, now())
      `;
      cleanup.push(
        () => sql`DELETE FROM "organization" WHERE "id" = ${busyOrg}`,
      );
      // 201 rows, all pending since before the eligible project's release.
      const kinds = [
        ...Array<string>(60).fill('disabled'),
        ...Array<string>(60).fill('blocked'),
        ...Array<string>(20).fill('waiting'),
        ...Array<string>(20).fill('held'),
        ...Array<string>(21).fill('error'),
        ...Array<string>(20).fill('busy'),
      ];
      const noise = kinds.map((kind) => ({
        kind,
        id: randomUUID(),
        org: kind === 'busy' ? busyOrg : orgId,
        trigger:
          kind === 'blocked' || kind === 'error'
            ? paused.triggerId
            : kind === 'waiting' || kind === 'held'
              ? waiting.triggerId
              : `itest-missing-${suffix}`,
      }));
      const ids = noise.map((row) => row.id);
      await sql`
        INSERT INTO app.projects (id, org_id, name, created_by,
                                  created_at_ms, updated_at_ms)
        SELECT id, org, 'Wake noise', ${userId}, ${now}, ${now}
        FROM unnest(${ids}::text[], ${noise.map((row) => row.org)}::text[])
          AS n(id, org)
      `;
      cleanup.push(() => sql`DELETE FROM app.projects WHERE id = ANY(${ids})`);
      // The waiting and held rows' projects are bound to an opted-in,
      // enabled schedule whose manager is still at work (a queued run).
      await sql`
        INSERT INTO app.automation_project_bindings (org_id, automation_name,
          project_id, bound_at_ms, bound_by, wakes)
        SELECT ${orgId}, ${waiting.name}, id, ${now}, ${userId}, true
        FROM unnest(${noise.filter((row) => row.kind === 'waiting' || row.kind === 'held').map((row) => row.id)}::text[]) AS n(id)
      `;
      await kick(waiting, waiting.manager, waiting.roleTask);
      cleanup.push(
        () =>
          sql`DELETE FROM app.automation_project_bindings WHERE project_id = ANY(${ids})`,
      );
      const oldest = Date.now() - HOUR_MS;
      const later = Date.now() + 24 * HOUR_MS;
      await sql`
        INSERT INTO app.project_wakes (org_id, project_id, trigger_id,
          signal_seq, pending_since_ms, signaled_at_ms, not_before_ms,
          manager_task_id, manager_agent_id, updated_at_ms)
        SELECT org, id, trig, 1, ${oldest} + ord, ${oldest} + ord,
               CASE WHEN kind = 'waiting' THEN ${later}::bigint END,
               CASE WHEN kind = 'held' THEN ${waiting.roleTask} END,
               CASE WHEN kind = 'held' THEN ${waiting.manager} END, ${now}
        FROM unnest(${ids}::text[], ${noise.map((row) => row.org)}::text[],
                    ${noise.map((row) => row.trigger)}::text[],
                    ${noise.map((row) => row.kind)}::text[])
          WITH ORDINALITY AS n(id, org, trig, kind, ord)
      `;
      cleanup.push(
        () => sql`DELETE FROM app.project_wakes WHERE project_id = ANY(${ids})`,
      );
      // The failing rows: any write to their wake row raises.
      const failing = noise
        .filter((row) => row.kind === 'error')
        .map((row) => uuidLiteral(row.id))
        .join(', ');
      await triggerFn(
        `itest_wake_w19_${suffix}`,
        'app.project_wakes',
        `NEW.project_id IN (${failing})`,
        `RAISE EXCEPTION 'itest wake row fault';`,
        'UPDATE',
      );
      // The busy rows: their projects' work keys are held throughout.
      const busyKeys = noise
        .filter((row) => row.kind === 'busy')
        .map((row) => projectWorkQueueKey(row.id));
      const holder = await sql.reserve();
      await holder`
        SELECT pg_advisory_lock(${RETRY_QUEUE_LOCK_CLASS}, hashtext(k.key))
        FROM unnest(${busyKeys}::text[]) AS k(key)
      `;
      let scans = 0;
      let fired = false;
      try {
        await releaseOnce(eligible);
        while (scans < 2 && !fired) {
          scans += 1;
          await backdate(eligible);
          await fireDueProjectWakes(sql);
          fired = ((await wake(eligible))?.firedSeq ?? 0) >= 1;
        }
      } finally {
        await holder`
          SELECT pg_advisory_unlock(${RETRY_QUEUE_LOCK_CLASS}, hashtext(k.key))
          FROM unnest(${busyKeys}::text[]) AS k(key)
        `;
        holder.release();
      }
      await occurrenceOver((await wake(eligible))?.firedRunId ?? null);
      const visited = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM app.project_wake_visits
        WHERE project_id = ANY(${[...ids, eligible.project]})
      `;
      const states = await sql<
        { kind: string; outcome: string | null; count: number }[]
      >`
        SELECT n.kind, w.outcome, count(*)::int AS count
        FROM unnest(${ids}::text[], ${noise.map((row) => row.kind)}::text[]) AS n(id, kind)
        JOIN app.project_wakes w ON w.project_id = n.id
        GROUP BY n.kind, w.outcome
        ORDER BY n.kind, w.outcome
      `;
      const count = (kind: string, outcome: string | null) =>
        states.find((row) => row.kind === kind && row.outcome === outcome)
          ?.count ?? 0;
      record(
        'standing-role wake: 201 earlier rows that stay disabled, blocked, waiting, held, failing or busy cannot starve a later eligible project — it fires within two scans and every row is visited (W19)',
        fired &&
          scans <= 2 &&
          visited[0]?.count === 202 &&
          count('disabled', 'target_disabled') === 60 &&
          count('blocked', 'blocked') === 60 &&
          count('waiting', null) === 20 &&
          count('held', 'held') === 20 &&
          count('error', null) === 21 &&
          count('busy', null) === 20,
        `fired=${fired} scans=${scans} visited=${visited[0]?.count} states=${show(states)} (want a fire within 2 scans, 202 visited, each noise row in its own state)`,
      );
    });

    // ---- W20: two schedules racing to wake one project — one wins, 409 -----
    await scenario('W20', async () => {
      const x = await setup('w20', { optIn: false });
      const otherName = `itest/wake-w20y-${suffix}`;
      await saveVersion(sql, {
        organizationId: orgId,
        name: otherName,
        document: { version: 1, name: otherName, nodes: [] },
        actor: userId,
        projectId: x.project,
      });
      await setTrigger(sql, {
        organizationId: orgId,
        name: otherName,
        trigger: {
          kind: 'schedule',
          cron: CRON,
          timezone: 'UTC',
          enabled: true,
        },
        actor: userId,
      });
      cleanup.push(
        () =>
          sql`DELETE FROM app.automation_triggers WHERE org_id = ${orgId} AND name = ${otherName}`,
      );
      const unlock = await holdBarrier(20);
      await triggerFn(
        `itest_wake_w20_${suffix}`,
        'app.automation_project_bindings',
        `NEW.wakes AND NOT OLD.wakes AND NEW.project_id = ${uuidLiteral(x.project)}`,
        `PERFORM pg_advisory_xact_lock(${BARRIER_CLASS}, 20);`,
        'UPDATE',
      );
      const enable = (name: string) =>
        setTrigger(sql, {
          organizationId: orgId,
          name,
          trigger: {
            kind: 'schedule',
            cron: CRON,
            timezone: 'UTC',
            enabled: true,
            wakeOnSlotFreed: true,
          },
          actor: userId,
        }).then(
          () => 'saved' as const,
          (error: unknown) => error,
        );
      const racing = [enable(x.name), enable(otherName)];
      // One save holds its name and the project's claim key at the database
      // barrier; the other is queued on that claim key.
      const bothWaiting = await waitFor(
        async () =>
          (await waitersAt(20)) + (await keyWaiters(projectLock(x.project))) ===
          2,
        WAIT_MS,
      );
      await unlock();
      const outcomes = await Promise.all(racing);
      const claims = await sql<{ name: string }[]>`
        SELECT automation_name AS name FROM app.automation_project_bindings
        WHERE org_id = ${orgId} AND project_id = ${x.project} AND wakes
      `;
      const optedIn = await sql<{ name: string; wakes: boolean }[]>`
        SELECT name, wake_on_slot_freed AS wakes FROM app.automation_triggers
        WHERE org_id = ${orgId} AND name = ANY(${[x.name, otherName]})
        ORDER BY name
      `;
      const refused = outcomes.filter(
        (outcome) =>
          outcome instanceof AutomationError &&
          outcome.code === 'AUTOMATION_TRIGGER_INVALID' &&
          outcome.status === 409,
      );
      record(
        'standing-role wake: two schedule saves overlapping under name/claim locks to wake one project — exactly one is saved, the other answers 409 and changes nothing (W20)',
        bothWaiting &&
          outcomes.filter((outcome) => outcome === 'saved').length === 1 &&
          refused.length === 1 &&
          claims.length === 1 &&
          optedIn.filter((row) => row.wakes).length === 1,
        `bothWaiting=${bothWaiting} outcomes=${show(outcomes.map((outcome) => (outcome instanceof Error ? outcome.message : outcome)))} claims=${show(claims)} triggers=${show(optedIn)} (want one saved, one 409, one claim, one opted-in trigger)`,
      );
    });

    // ---- W21: binding changes cannot give a project a second wake target ---
    await scenario('W21', async () => {
      const x = await setup('w21a');
      const y = await setup('w21b');
      const contested = randomUUID();
      await insertProject(orgId, contested, 'Contested project');
      cleanup.push(() => removeProject(contested));
      const unlock = await holdBarrier(21);
      await triggerFn(
        `itest_wake_w21_${suffix}`,
        'app.automation_project_bindings',
        `NEW.wakes AND NEW.project_id = ${uuidLiteral(contested)}`,
        `PERFORM pg_advisory_xact_lock(${BARRIER_CLASS}, 21);`,
      );
      const bind = (name: string) =>
        bindProject(sql, {
          organizationId: orgId,
          name,
          projectId: contested,
          actor: userId,
        }).then(
          (result) =>
            result.bound ? ('bound' as const) : ('unchanged' as const),
          (error: unknown) => error,
        );
      const racing = [bind(x.name), bind(y.name)];
      // One bind holds the contested claim at the barrier; the other
      // waits on that project's claim key.
      const bothWaiting = await waitFor(
        async () =>
          (await waitersAt(21)) + (await keyWaiters(projectLock(contested))) ===
          2,
        WAIT_MS,
      );
      await unlock();
      const outcomes = await Promise.all(racing);
      const contestedBindings = await sql<{ name: string; wakes: boolean }[]>`
        SELECT automation_name AS name, wakes FROM app.automation_project_bindings
        WHERE org_id = ${orgId} AND project_id = ${contested}
      `;
      // A later, unracing change: y asks for x's project as well.
      const later = await setAutomationProjects(sql, {
        organizationId: orgId,
        name: y.name,
        projectIds: [y.project, x.project],
        actor: userId,
      }).then(
        () => 'saved' as const,
        (error: unknown) => error,
      );
      const yBindings = await sql<{ projectId: string; wakes: boolean }[]>`
        SELECT project_id AS "projectId", wakes FROM app.automation_project_bindings
        WHERE org_id = ${orgId} AND automation_name = ${y.name}
        ORDER BY project_id
      `;
      const is409 = (outcome: unknown) =>
        outcome instanceof AutomationError &&
        outcome.code === 'AUTOMATION_TRIGGER_INVALID' &&
        outcome.status === 409;
      const yAfter = yBindings.map((row) => row.projectId);
      record(
        'standing-role wake: racing bindings of two waking automations to one project — one binds, the other answers 409; a later change that would add a second target is refused whole (W21)',
        bothWaiting &&
          outcomes.filter((outcome) => outcome === 'bound').length === 1 &&
          outcomes.filter(is409).length === 1 &&
          contestedBindings.length === 1 &&
          contestedBindings[0] !== undefined &&
          contestedBindings[0].wakes &&
          is409(later) &&
          show(yAfter) ===
            show(
              [
                y.project,
                ...(outcomes[1] === 'bound' ? [contested] : []),
              ].sort(),
            ) &&
          yBindings.every((row) => row.wakes),
        `bothWaiting=${bothWaiting} outcomes=${show(outcomes.map((outcome) => (outcome instanceof Error ? outcome.message : outcome)))} contested=${show(contestedBindings)} later=${later instanceof Error ? later.message : show(later)} y=${show(yBindings)} (want one bound, one 409, one claiming binding; the later change refused with y's bindings untouched)`,
      );
    });

    // ---- W22: the REST install racing the claim it binds under (R4-F1) ----
    await scenario('W22', async () => {
      const y = await setup('w22y');
      const xName = `itest/wake-w22x-${suffix}`;
      const xHome = randomUUID();
      await insertProject(orgId, xHome, 'Wake w22x');
      cleanup.push(() => removeProject(xHome));
      await saveVersion(sql, {
        organizationId: orgId,
        name: xName,
        document: { version: 1, name: xName, nodes: [] },
        actor: userId,
        projectId: xHome,
      });
      cleanup.push(
        () =>
          sql`DELETE FROM app.automation_triggers WHERE org_id = ${orgId} AND name = ${xName}`,
      );
      const xLock = `automation:${orgId}/${xName}`;
      const state = async () => ({
        intoY: (await automationBindings(xName)).filter(
          (row) => row.projectId === y.project,
        ),
        yClaims: (await projectBindings(y.project))
          .filter((row) => row.wakes)
          .map((row) => row.name),
        home: await projectBindings(xHome),
      });
      const settledAs = (
        after: Awaited<ReturnType<typeof state>>,
        outcome: unknown,
        attempts: number,
      ) =>
        answered409(outcome) &&
        // The first attempt meets the fence and retries; a second retry can
        // only be an unrelated serialization failure.
        attempts >= 2 &&
        after.intoY.length === 0 &&
        show(after.yClaims) === show([y.name]) &&
        after.home.length === 1 &&
        after.home[0] !== undefined &&
        after.home[0].wakes;

      // (a) absent → present: x's first trigger, opted in, is saved (under
      // x's name lock, held at the barrier) after the install took its
      // snapshot; the install then waits on that name lock.
      // x's home binding made its fence row: (a) and (b) meet a fence that
      // was there before the install's snapshot; (c) is the absent control.
      const fencePresent = (await fenceOf(xName)) !== null;
      const unlock = await holdBarrier(22);
      const dropBarrier = await triggerFn(
        `itest_wake_w22_${suffix}`,
        'app.automation_triggers',
        `NEW.name = ${nameLiteral(xName)}`,
        `PERFORM pg_advisory_xact_lock(${BARRIER_CLASS}, 22);`,
      );
      const created = setTrigger(sql, {
        organizationId: orgId,
        name: xName,
        trigger: {
          kind: 'schedule',
          cron: CRON,
          timezone: 'UTC',
          enabled: true,
          wakeOnSlotFreed: true,
        },
        actor: userId,
      }).then(
        () => 'saved' as const,
        (error: unknown) => error,
      );
      const saveHeld = await waitFor(
        async () => (await waitersAt(22)) === 1,
        WAIT_MS,
      );
      // Do not infer that the REST transaction took its snapshot from an
      // advisory-lock waiter. Under CI pool pressure it can be queued on a
      // different connection for the whole timeout. The explicit gate is
      // reached after loadRestProject, so its serializable snapshot is
      // definitely older than the save that is still held at barrier 22.
      const snapshotUnlock = await holdBarrier(220);
      const first = restInstall(xName, y.project, 220);
      const firstSnapshot = await waitFor(
        async () => (await waitersAt(220)) === 1,
        WAIT_MS,
      );
      await unlock();
      const saved = await created;
      await snapshotUnlock();
      const installed = await first.outcome;
      await dropBarrier();
      const afterFirst = await state();
      record(
        'standing-role wake: a REST install whose snapshot predates its automation’s first opted-in trigger retries and answers 409 in a project another schedule wakes — no false binding commits (W22a, R4-F1)',
        fencePresent &&
          saveHeld &&
          firstSnapshot &&
          saved === 'saved' &&
          settledAs(afterFirst, installed, first.attempts()),
        `fencePresent=${fencePresent} saveHeld=${saveHeld} snapshotGate=${firstSnapshot} save=${said(saved)} install=${said(installed)} attempts=${first.attempts()} state=${show(afterFirst)} (want the save, then a retried install answering 409; no x binding in y's project, y its one claim, x claiming its home)`,
      );

      // (b) delete and recreate: x opted out; after the install took its
      // snapshot, one writer under x's name lock deletes x's trigger and
      // creates it again, opted in.
      await setTrigger(sql, {
        organizationId: orgId,
        name: xName,
        trigger: {
          kind: 'schedule',
          cron: CRON,
          timezone: 'UTC',
          enabled: true,
          wakeOnSlotFreed: false,
        },
        actor: userId,
      });
      let holding = (): void => undefined;
      const held = new Promise<void>((resolve) => {
        holding = () => resolve();
      });
      let opening = (): void => undefined;
      const gate = new Promise<void>((resolve) => {
        opening = () => resolve();
      });
      const recreated = sql
        .begin(async (tx) => {
          await tx`SELECT pg_advisory_xact_lock(hashtextextended(${xLock}, 0))`;
          holding();
          await gate;
          await tx`
            DELETE FROM app.automation_triggers
            WHERE org_id = ${orgId} AND name = ${xName}
          `;
          await tx`
            INSERT INTO app.automation_triggers (
              org_id, name, kind, cron, timezone, enabled, wake_on_slot_freed,
              created_by, created_at_ms, updated_at_ms
            ) VALUES (
              ${orgId}, ${xName}, 'schedule', ${CRON}, 'UTC', true, true,
              ${userId}, ${Date.now()}, ${Date.now()}
            )
          `;
        })
        .then(
          () => 'recreated' as const,
          (error: unknown) => error,
        );
      await Promise.race([held, recreated]);
      const second = restInstall(xName, y.project);
      const secondWaits = await waitFor(
        async () => (await keyWaiters(xLock)) === 1,
        WAIT_MS,
      );
      opening();
      const [recreate, reinstalled] = await Promise.all([
        recreated,
        second.outcome,
      ]);
      const afterSecond = await state();
      record(
        'standing-role wake: a REST install whose snapshot predates a delete and opted-in recreate of its automation’s trigger retries and answers 409 in a project another schedule wakes (W22b, R4-F1)',
        secondWaits &&
          recreate === 'recreated' &&
          settledAs(afterSecond, reinstalled, second.attempts()),
        `installWaits=${secondWaits} recreate=${said(recreate)} install=${said(reinstalled)} attempts=${second.attempts()} state=${show(afterSecond)} (want the recreate, then a retried install answering 409; no x binding in y's project, x claiming its home again)`,
      );

      // (c) absent fence (control for (a)): z was saved without a project,
      // so it was never bound or claimed and has no fence row when the
      // install takes its snapshot; its first opted-in save creates the row.
      const zName = `itest/wake-w22z-${suffix}`;
      await saveVersion(sql, {
        organizationId: orgId,
        name: zName,
        document: { version: 1, name: zName, nodes: [] },
        actor: userId,
      });
      cleanup.push(
        () =>
          sql`DELETE FROM app.automation_triggers WHERE org_id = ${orgId} AND name = ${zName}`,
      );
      const fenceAbsent = (await fenceOf(zName)) === null;
      const unlockAbsent = await holdBarrier(22);
      const dropAbsent = await triggerFn(
        `itest_wake_w22c_${suffix}`,
        'app.automation_triggers',
        `NEW.name = ${nameLiteral(zName)}`,
        `PERFORM pg_advisory_xact_lock(${BARRIER_CLASS}, 22);`,
      );
      const createdAbsent = setTrigger(sql, {
        organizationId: orgId,
        name: zName,
        trigger: {
          kind: 'schedule',
          cron: CRON,
          timezone: 'UTC',
          enabled: true,
          wakeOnSlotFreed: true,
        },
        actor: userId,
      }).then(
        () => 'saved' as const,
        (error: unknown) => error,
      );
      const absentHeld = await waitFor(
        async () => (await waitersAt(22)) === 1,
        WAIT_MS,
      );
      const third = restInstall(zName, y.project);
      const thirdWaits = await waitFor(
        async () => (await keyWaiters(`automation:${orgId}/${zName}`)) === 1,
        WAIT_MS,
      );
      await unlockAbsent();
      const [savedAbsent, installedAbsent] = await Promise.all([
        createdAbsent,
        third.outcome,
      ]);
      await dropAbsent();
      const afterThird = {
        fence: await fenceOf(zName),
        intoY: (await automationBindings(zName)).filter(
          (row) => row.projectId === y.project,
        ),
        yClaims: (await projectBindings(y.project))
          .filter((row) => row.wakes)
          .map((row) => row.name),
      };
      record(
        'standing-role wake: with no fence row at the install’s snapshot, the first opted-in save creates it and the install still retries and answers 409 — no false binding commits (W22c, absent-fence control)',
        fenceAbsent &&
          absentHeld &&
          thirdWaits &&
          savedAbsent === 'saved' &&
          answered409(installedAbsent) &&
          third.attempts() >= 2 &&
          afterThird.fence !== null &&
          afterThird.intoY.length === 0 &&
          show(afterThird.yClaims) === show([y.name]),
        `fenceAbsent=${fenceAbsent} saveHeld=${absentHeld} installWaits=${thirdWaits} save=${said(savedAbsent)} install=${said(installedAbsent)} attempts=${third.attempts()} state=${show(afterThird)} (want no fence row before, the save creating it, then a retried install answering 409; no z binding in y's project)`,
      );
    });

    // ---- W23: the previous image's writes keep the claim (R4-F2) ----------
    // Each statement is the previous image's own (store.ts at the base,
    // d50f9065): binding writes without the wakes column, the trigger upsert
    // without wake_on_slot_freed, the plain delete. Migration 0168's
    // triggers alone keep the claim for them.
    await scenario('W23', async () => {
      const z = await setup('w23');
      const w = await setup('w23w');
      const off = await setup('w23off', { optIn: false });
      const free = randomUUID();
      await insertProject(orgId, free, 'Wake w23 free');
      cleanup.push(() => removeProject(free));
      const oldBind = (name: string, projectId: string) =>
        sql`
          INSERT INTO app.automation_project_bindings (
            org_id, automation_name, project_id, bound_at_ms, bound_by
          ) VALUES (
            ${orgId}, ${name}, ${projectId}, ${Date.now()},
            ${userId}
          )
          ON CONFLICT (org_id, automation_name, project_id) DO NOTHING
        `.then(
          () => 'bound' as const,
          (error: unknown) => error,
        );
      const oldReplace = (name: string, projectIds: string[]) =>
        sql
          .begin(async (tx) => {
            await tx`
              DELETE FROM app.automation_project_bindings
              WHERE org_id = ${orgId}
                AND automation_name = ${name}
                AND NOT (project_id = ANY(${projectIds}))
            `;
            for (const projectId of projectIds) {
              await tx`
                INSERT INTO app.automation_project_bindings (
                  org_id, automation_name, project_id, bound_at_ms, bound_by
                ) VALUES (
                  ${orgId}, ${name}, ${projectId}, ${Date.now()},
                  ${userId}
                )
                ON CONFLICT (org_id, automation_name, project_id) DO NOTHING
              `;
            }
          })
          .then(
            () => 'replaced' as const,
            (error: unknown) => error,
          );
      const oldSave = (
        name: string,
        kind: 'schedule' | 'webhook',
        enabled: boolean,
      ) => {
        const savedAt = Date.now();
        const minted =
          kind === 'webhook'
            ? `${randomUUID()}${randomUUID()}`.replaceAll('-', '')
            : null;
        return sql`
          INSERT INTO app.automation_triggers AS t (
            org_id, name, kind, cron, timezone, event, token_hash, enabled,
            created_by, created_at_ms, updated_at_ms
          ) VALUES (
            ${orgId}, ${name}, ${kind},
            ${kind === 'schedule' ? CRON : null}, ${kind === 'schedule' ? 'UTC' : null},
            ${null}, ${minted}, ${enabled},
            ${userId}, ${savedAt}, ${savedAt}
          )
          ON CONFLICT (org_id, name) DO UPDATE SET
            kind = EXCLUDED.kind,
            cron = EXCLUDED.cron,
            timezone = EXCLUDED.timezone,
            event = EXCLUDED.event,
            token_hash = CASE
              WHEN EXCLUDED.kind <> 'webhook' THEN NULL
              WHEN ${false}::boolean OR t.token_hash IS NULL THEN EXCLUDED.token_hash
              ELSE t.token_hash
            END,
            last_fired_at_ms = CASE
              WHEN t.kind = EXCLUDED.kind THEN t.last_fired_at_ms
              ELSE NULL
            END,
            last_due_at_ms = CASE
              WHEN t.kind = EXCLUDED.kind THEN t.last_due_at_ms
              ELSE NULL
            END,
            last_run_id = CASE
              WHEN t.kind = EXCLUDED.kind THEN t.last_run_id
              ELSE NULL
            END,
            last_skipped_at_ms = CASE
              WHEN t.last_skip_reason = 'paused_after_failures' THEN NULL
              WHEN t.kind = EXCLUDED.kind THEN t.last_skipped_at_ms
              ELSE NULL
            END,
            last_skip_reason = CASE
              WHEN t.last_skip_reason = 'paused_after_failures' THEN NULL
              WHEN t.kind = EXCLUDED.kind THEN t.last_skip_reason
              ELSE NULL
            END,
            consecutive_failures = CASE WHEN ${false} THEN t.consecutive_failures ELSE 0 END,
            last_failed_at_ms = CASE
              WHEN t.kind = EXCLUDED.kind THEN t.last_failed_at_ms
              ELSE NULL
            END,
            last_failure_code = CASE
              WHEN t.kind = EXCLUDED.kind THEN t.last_failure_code
              ELSE NULL
            END,
            last_failed_run_id = CASE
              WHEN t.kind = EXCLUDED.kind THEN t.last_failed_run_id
              ELSE NULL
            END,
            enabled = EXCLUDED.enabled,
            updated_at_ms = CASE WHEN ${false} THEN t.updated_at_ms ELSE EXCLUDED.updated_at_ms END
          WHERE ${true}
          RETURNING token_hash AS "tokenHash"
        `.then(
          () => 'saved' as const,
          (error: unknown) => error,
        );
      };
      const oldDelete = (name: string) =>
        sql`
          DELETE FROM app.automation_triggers
          WHERE org_id = ${orgId} AND name = ${name}
          RETURNING id, last_skip_reason AS "lastSkipReason"
        `.then(
          () => 'deleted' as const,
          (error: unknown) => error,
        );
      const claims = async (name: string) =>
        (await automationBindings(name)).map((row) => row.wakes);
      const optedIn = async (name: string) => {
        const rows = await sql<{ wakes: boolean }[]>`
          SELECT wake_on_slot_freed AS wakes FROM app.automation_triggers
          WHERE org_id = ${orgId} AND name = ${name}
        `;
        return rows[0]?.wakes ?? null;
      };
      const oneWake = (outcome: unknown) =>
        typeof outcome === 'object' &&
        outcome !== null &&
        'code' in outcome &&
        outcome.code === '23505' &&
        'constraint_name' in outcome &&
        outcome.constraint_name === 'automation_project_bindings_one_wake';

      // Binding writes: add, add into a claimed project, replace.
      const added = await oldBind(z.name, free);
      const addedClaim = (await automationBindings(z.name)).find(
        (row) => row.projectId === free,
      );
      const intoClaimed = await oldBind(z.name, w.project);
      const replaced = await oldReplace(z.name, [free]);
      const afterReplace = await automationBindings(z.name);
      const wClaims = (await projectBindings(w.project))
        .filter((row) => row.wakes)
        .map((row) => row.name);
      record(
        'standing-role wake: the previous image’s binding add and replace carry the claim the database keeps; its add into a project another schedule wakes is refused (W23 bindings, R4-F2)',
        added === 'bound' &&
          addedClaim?.wakes === true &&
          oneWake(intoClaimed) &&
          replaced === 'replaced' &&
          show(afterReplace) === show([{ projectId: free, wakes: true }]) &&
          show(wClaims) === show([w.name]),
        `add=${said(added)} claim=${show(addedClaim)} intoClaimed=${said(intoClaimed)} replace=${said(replaced)} z=${show(afterReplace)} w=${show(wClaims)} (want a claiming add, the one-wake refusal, z on the free project alone and claiming, w still the one claim on its project)`,
      );

      // Trigger writes: disable, re-enable, re-kind, back to schedule,
      // (new-image opt-in), delete.
      const steps: {
        step: string;
        outcome: unknown;
        claims: boolean[];
        optedIn: boolean | null;
      }[] = [];
      const step = async (label: string, write: Promise<unknown>) => {
        const outcome = await write;
        steps.push({
          step: label,
          outcome: said(outcome),
          claims: await claims(z.name),
          optedIn: await optedIn(z.name),
        });
      };
      await step('disable', oldSave(z.name, 'schedule', false));
      await step('re-enable', oldSave(z.name, 'schedule', true));
      await step('re-kind', oldSave(z.name, 'webhook', true));
      await step('schedule again', oldSave(z.name, 'schedule', true));
      await step(
        'opt in (this image)',
        optIn(z, true).then(() => 'saved'),
      );
      await step('delete', oldDelete(z.name));
      const want = [
        ['disable', '"saved"', [false], true],
        ['re-enable', '"saved"', [true], true],
        ['re-kind', '"saved"', [false], false],
        ['schedule again', '"saved"', [false], false],
        ['opt in (this image)', '"saved"', [true], true],
        ['delete', '"deleted"', [false], null],
      ].map(([label, outcome, claimed, opted]) => ({
        step: label,
        outcome,
        claims: claimed,
        optedIn: opted,
      }));
      record(
        'standing-role wake: the previous image’s disable, re-enable, re-kind and delete leave every binding’s claim as the trigger now says (W23 triggers, R4-F2)',
        show(steps) === show(want),
        `steps=${show(steps)} (want ${show(want)})`,
      );

      // Default off: the previous image's every shape on a schedule that
      // never opted in still works and never claims.
      const offSteps = [
        await oldBind(off.name, w.project),
        await oldSave(off.name, 'schedule', false),
        await oldSave(off.name, 'schedule', true),
        await oldReplace(off.name, [off.project, w.project, free]),
        await oldSave(off.name, 'webhook', true),
        await oldSave(off.name, 'schedule', true),
        await oldDelete(off.name),
      ];
      const offClaims = await claims(off.name);
      const wAfter = (await projectBindings(w.project))
        .filter((row) => row.wakes)
        .map((row) => row.name);
      record(
        'standing-role wake: with no opt-in, every previous-image write succeeds and no binding claims (W23 default off)',
        show(offSteps) ===
          show([
            'bound',
            'saved',
            'saved',
            'replaced',
            'saved',
            'saved',
            'deleted',
          ]) &&
          offClaims.length === 3 &&
          offClaims.every((claimed) => !claimed) &&
          show(wAfter) === show([w.name]),
        `steps=${show(offSteps.map(said))} claims=${show(offClaims)} w=${show(wAfter)} (want every write through, three unclaiming bindings, w still the one claim)`,
      );
    });

    // ---- W24: binding changes that swap claimed projects (R4-F3) ----------
    await scenario('W24', async () => {
      const a = await setup('w24a');
      const b = await setup('w24b');
      const extra = async (title: string) => {
        const id = randomUUID();
        await insertProject(orgId, id, title);
        cleanup.push(() => removeProject(id));
        return id;
      };
      const shared = await extra('Wake w24 shared');
      const aOnly = await extra('Wake w24 a-only');
      const bOnly = await extra('Wake w24 b-only');
      const move = (name: string, projectIds: string[]) =>
        setAutomationProjects(sql, {
          organizationId: orgId,
          name,
          projectIds,
          actor: userId,
        }).then(
          () => 'saved' as const,
          (error: unknown) => error,
        );
      const deadlocked = (outcome: unknown) =>
        typeof outcome === 'object' &&
        outcome !== null &&
        'code' in outcome &&
        outcome.code === '40P01';
      const claiming = (projectIds: string[]) =>
        [...projectIds].sort().map((projectId) => ({ projectId, wakes: true }));

      // The forced swap: a moves P → Q while b moves Q → P. A barrier holds
      // each binding insert after its change's delete, so neither can finish
      // before the other has started; both take the same two claim keys in
      // one order, so the second writer queues on the first of them.
      const unlock = await holdBarrier(24);
      const dropBarrier = await triggerFn(
        `itest_wake_w24_${suffix}`,
        'app.automation_project_bindings',
        `NEW.automation_name IN (${nameLiteral(a.name)}, ${nameLiteral(b.name)}) AND NEW.project_id IN (${uuidLiteral(a.project)}, ${uuidLiteral(b.project)})`,
        `PERFORM pg_advisory_xact_lock(${BARRIER_CLASS}, 24);`,
      );
      const swap = [move(a.name, [b.project]), move(b.name, [a.project])];
      const bothBlocked = await waitFor(
        async () =>
          (await waitersAt(24)) +
            (await keyWaiters(projectLock(a.project))) +
            (await keyWaiters(projectLock(b.project))) ===
          2,
        WAIT_MS,
      );
      await unlock();
      const swapped = await Promise.all(swap);
      await dropBarrier();
      const afterSwap = {
        a: await automationBindings(a.name),
        b: await automationBindings(b.name),
      };
      record(
        'standing-role wake: two binding changes swapping their claimed projects are refused whole with 409 — no deadlock, nothing half-moved (W24 swap, R4-F3)',
        bothBlocked &&
          swapped.every(answered409) &&
          !swapped.some(deadlocked) &&
          show(afterSwap.a) === show(claiming([a.project])) &&
          show(afterSwap.b) === show(claiming([b.project])),
        `blocked=${bothBlocked} outcomes=${show(swapped.map(said))} bindings=${show(afterSwap)} (want two 409s, no 40P01, both bindings as they were)`,
      );

      // Overlap: a asks for [P, R] and b for [Q, R] — one gets R, the other
      // answers 409 and keeps its bindings.
      const overlap = await Promise.all([
        move(a.name, [a.project, shared]),
        move(b.name, [b.project, shared]),
      ]);
      const aWon = overlap[0] === 'saved';
      const afterOverlap = {
        a: await automationBindings(a.name),
        b: await automationBindings(b.name),
        shared: await projectBindings(shared),
      };
      record(
        'standing-role wake: two binding changes overlapping on one project — exactly one gets it, the other answers 409 with its bindings untouched (W24 overlap)',
        overlap.filter((outcome) => outcome === 'saved').length === 1 &&
          overlap.filter(answered409).length === 1 &&
          show(afterOverlap.shared) ===
            show([{ name: aWon ? a.name : b.name, wakes: true }]) &&
          show(afterOverlap.a) ===
            show(claiming(aWon ? [a.project, shared] : [a.project])) &&
          show(afterOverlap.b) ===
            show(claiming(aWon ? [b.project] : [b.project, shared])),
        `outcomes=${show(overlap.map(said))} bindings=${show(afterOverlap)} (want one saved holding the shared project, one 409 with its old binding)`,
      );

      // Apart: changes with no project in common both commit.
      const apart = await Promise.all([
        move(a.name, [a.project, aOnly]),
        move(b.name, [b.project, bOnly]),
      ]);
      const afterApart = {
        a: await automationBindings(a.name),
        b: await automationBindings(b.name),
        shared: await projectBindings(shared),
      };
      record(
        'standing-role wake: overlapping binding changes with no project in common both commit (W24 apart)',
        apart.every((outcome) => outcome === 'saved') &&
          show(afterApart.a) === show(claiming([a.project, aOnly])) &&
          show(afterApart.b) === show(claiming([b.project, bOnly])) &&
          afterApart.shared.length === 0,
        `outcomes=${show(apart.map(said))} bindings=${show(afterApart)} (want both saved, each on its own two projects, the shared project left unbound)`,
      );
    });

    // ---- W27: the MCP editor's multi-project transaction preclaims before
    // its first deletion, then shares the definition writers' name/claim
    // order. ---------------------------------------------------------------
    await scenario('W27', async () => {
      const a = await setup('w27a');
      const b = await setup('w27b');
      const target = await extraProject('Wake w27 added project');
      const editor = pgAutomationStore(sql, {
        organizationId: orgId,
        actor: `user:${userId}`,
      });
      const change = editor.setAutomationProjects?.bind(editor);
      if (change === undefined)
        throw new Error('itest: MCP binding door missing');
      const move = (name: string, from: string, to: string) =>
        change(name, { add: [to], remove: [from] }).then(
          () => 'saved' as const,
          (error: unknown) => error,
        );
      const holder = await sql.reserve();
      await holder`SELECT pg_advisory_lock(hashtextextended(${projectLock(target)}, 0))`;
      let settled = false;
      const moving = move(a.name, a.project, target).then((outcome) => {
        settled = true;
        return outcome;
      });
      let waiting = false;
      let oldBindingLockable = false;
      let pendingBeforeRelease = false;
      try {
        waiting = await waitFor(
          async () => (await keyWaiters(projectLock(target))) === 1,
          WAIT_MS,
        );
        // MVCC visibility alone cannot tell whether a delete is uncommitted.
        // NOWAIT proves the prior binding has not even been locked/deleted.
        oldBindingLockable = await sql
          .begin(async (tx) => {
            const rows = await tx<{ wakes: boolean }[]>`
            SELECT wakes FROM app.automation_project_bindings
            WHERE org_id = ${orgId} AND automation_name = ${a.name}
              AND project_id = ${a.project}
            FOR UPDATE NOWAIT
          `;
            return rows.length === 1 && (rows[0]?.wakes ?? false);
          })
          .catch(() => false);
        pendingBeforeRelease = !settled;
      } finally {
        await holder`SELECT pg_advisory_unlock(hashtextextended(${projectLock(target)}, 0))`;
        holder.release();
      }
      const moved = await moving;
      const afterMove = await automationBindings(a.name);
      record(
        'standing-role wake: a real MCP multi-project move preclaims the added project before locking or deleting its old binding (W27 preclaim)',
        waiting &&
          oldBindingLockable &&
          pendingBeforeRelease &&
          moved === 'saved' &&
          show(afterMove) === show([{ projectId: target, wakes: true }]),
        `waiting=${waiting} oldBindingLockable=${oldBindingLockable} pending=${pendingBeforeRelease} outcome=${show(said(moved))} bindings=${show(afterMove)} (want pending on added key while old binding remains NOWAIT-lockable, then one complete move)`,
      );
      const unlock = await holdBarrier(27);
      const drop = await triggerFn(
        `itest_wake_w27_${suffix}`,
        'app.automation_project_bindings',
        `NEW.automation_name IN (${nameLiteral(a.name)}, ${nameLiteral(b.name)}) AND NEW.project_id IN (${uuidLiteral(target)}, ${uuidLiteral(b.project)})`,
        `PERFORM pg_advisory_xact_lock(${BARRIER_CLASS}, 27);`,
      );
      const swaps = [
        move(a.name, target, b.project),
        move(b.name, b.project, target),
      ];
      const bothWaiting = await waitFor(
        async () =>
          (await waitersAt(27)) +
            (await keyWaiters(projectLock(target))) +
            (await keyWaiters(projectLock(b.project))) ===
          2,
        WAIT_MS,
      );
      await unlock();
      const outcomes = await Promise.all(swaps);
      await drop();
      const after = {
        a: await automationBindings(a.name),
        b: await automationBindings(b.name),
      };
      record(
        'standing-role wake: overlapping real MCP binding swaps keep name/claim order and refuse both changes whole with 409 (W27 swap)',
        bothWaiting &&
          outcomes.every(answered409) &&
          show(after.a) === show([{ projectId: target, wakes: true }]) &&
          show(after.b) === show([{ projectId: b.project, wakes: true }]),
        `bothWaiting=${bothWaiting} outcomes=${show(outcomes.map(said))} bindings=${show(after)} (want two 409s and both original bindings retained)`,
      );
    });

    // ---- W25: binding writes that claim nothing never wait on each other
    // (R5-F1) ----------------------------------------------------------------
    // The previous image's `setAutomationProjects` loop, statement for
    // statement (store.ts at the base): one plain transaction, the delete,
    // then one insert per project in the caller's order, and no retry.
    await scenario('W25', async () => {
      const a = await setup('w25a', { optIn: false });
      const b = await setup('w25b', { optIn: false });
      const p = await extraProject('Wake w25 P');
      const q = await extraProject('Wake w25 Q');
      // Each loop is held after its first insert until both are; the two go
      // on together or not at all. A loop still held when WAIT_MS runs out —
      // or one that arrives after it — throws, and its transaction rolls
      // back: a late second arrival can only fail this case (R6-F1).
      const trace: string[] = [];
      const afterFirstInsert = laneBarrier(2, WAIT_MS, () =>
        trace.push('released'),
      );
      const oldLoop = (tag: string, name: string, projectIds: string[]) => {
        let attempts = 0;
        const outcome = sql
          .begin(async (tx) => {
            attempts += 1;
            await tx`
              DELETE FROM app.automation_project_bindings
              WHERE org_id = ${orgId}
                AND automation_name = ${name}
                AND NOT (project_id = ANY(${projectIds}))
            `;
            for (const [index, projectId] of projectIds.entries()) {
              await oldBindingInsert(tx, name, projectId);
              trace.push(`${tag}:${index}`);
              if (index === 0) await afterFirstInsert.arrive();
            }
          })
          .then(
            () => 'saved' as const,
            (error: unknown) => error,
          );
        return { outcome, attempts: () => attempts };
      };
      const first = oldLoop('a', a.name, [p, q]);
      const second = oldLoop('b', b.name, [q, p]);
      const outcomes = await Promise.all([first.outcome, second.outcome]);
      afterFirstInsert.dispose();
      // Both first inserts happened before the release, and no second one.
      const forced =
        afterFirstInsert.met() &&
        show(trace.slice(0, 2).sort()) === show(['a:0', 'b:0']) &&
        trace[2] === 'released';
      const bindings = {
        p: await projectBindings(p),
        q: await projectBindings(q),
      };
      const unclaimed = [a.name, b.name]
        .sort()
        .map((name) => ({ name, wakes: false }));
      record(
        'standing-role wake: two previous-image binding loops of schedules that never opted in, held after their first inserts in crossing order, both commit with four false bindings — no 40P01, no retry (W25, R5-F1)',
        forced &&
          outcomes.every((outcome) => outcome === 'saved') &&
          first.attempts() === 1 &&
          second.attempts() === 1 &&
          show(bindings.p) === show(unclaimed) &&
          show(bindings.q) === show(unclaimed),
        `forced=${forced} met=${afterFirstInsert.met()} trace=${show(trace)} outcomes=${show(outcomes.map(said))} attempts=${first.attempts()}/${second.attempts()} bindings=${show(bindings)} (want both first inserts before the release, both loops saved on their first attempt, P and Q each bound to both, every binding false)`,
      );
    });

    // ---- W25b: a change whose schedule does not claim takes no project key,
    // so it never waits on a claiming writer (R5-F1) -------------------------
    await scenario('W25b', async () => {
      const quiet = await setup('w25c', { optIn: false });
      const loud = await setup('w25d');
      const [lo, hi] = [
        await extraProject('Wake w25b one'),
        await extraProject('Wake w25b two'),
      ].sort();
      if (lo === undefined || hi === undefined)
        throw new Error('itest: no projects');
      // The previous image binds the claiming schedule [hi, lo]: after its
      // first insert it holds hi's claim key, and it waits there.
      let holding = (): void => undefined;
      const held = new Promise<void>((resolve) => {
        holding = () => resolve();
      });
      let resuming = (): void => undefined;
      const resumed = new Promise<void>((resolve) => {
        resuming = () => resolve();
      });
      const loudLoop = sql
        .begin(async (tx) => {
          await tx`
            DELETE FROM app.automation_project_bindings
            WHERE org_id = ${orgId}
              AND automation_name = ${loud.name}
              AND NOT (project_id = ANY(${[hi, lo]}))
          `;
          await oldBindingInsert(tx, loud.name, hi);
          holding();
          await resumed;
          await oldBindingInsert(tx, loud.name, lo);
        })
        .then(
          () => 'saved' as const,
          (error: unknown) => error,
        );
      await Promise.race([held, loudLoop]);
      // This image's change of the quiet schedule asks for both projects; a
      // project key of its own would make it wait on hi.
      let quietSettled = false;
      const quietChange = setAutomationProjects(sql, {
        organizationId: orgId,
        name: quiet.name,
        projectIds: [lo, hi],
        actor: userId,
      })
        .then(
          () => 'saved' as const,
          (error: unknown) => error,
        )
        .then((outcome) => {
          quietSettled = true;
          return outcome;
        });
      const decided = await waitFor(
        async () => quietSettled || (await keyWaiters(projectLock(hi))) === 1,
        WAIT_MS,
      );
      const quietFirst = quietSettled;
      resuming();
      const outcomes = await Promise.all([quietChange, loudLoop]);
      const after = {
        quiet: await automationBindings(quiet.name),
        loud: await automationBindings(loud.name),
      };
      const bound = (claimed: boolean) =>
        [lo, hi].map((projectId) => ({ projectId, wakes: claimed }));
      record(
        'standing-role wake: a binding change of a schedule that does not claim commits while a previous-image writer holds a claimed project’s key — it takes no project key (W25b, R5-F1)',
        decided &&
          quietFirst &&
          outcomes.every((outcome) => outcome === 'saved') &&
          show(after.quiet) === show(bound(false)) &&
          show(after.loud) === show(bound(true)),
        `decided=${decided} quietFirst=${quietFirst} outcomes=${show(outcomes.map(said))} bindings=${show(after)} (want the quiet change saved before the claiming loop resumed, both saved, quiet's two bindings false and loud's true)`,
      );
    });
  } finally {
    await release();
    for (const step of cleanup.reverse()) {
      await step().catch((error: unknown) => {
        console.warn('[itest] standing-role wake cleanup step failed:', error);
      });
    }
    await sql`DELETE FROM "organization" WHERE "id" = ${foreignOrg}`.catch(
      (error: unknown) => {
        console.warn('[itest] foreign organization cleanup failed:', error);
      },
    );
  }
}
