/**
 * Real PostgreSQL proof of a project's dispatch under the failures that
 * emptied Tale's own fleet (2026-10-14): a model the provider calls at
 * capacity, a sandbox host under pressure, a pass or an occurrence decided
 * twice, and a manager whose own task kept failing. The provider's refusals
 * are injected the way the turn host reports them (`failAgentRunFromTurn`
 * with `model_capacity`), and the host is a stand-in the pass asks
 * (`runDispatchPass`'s `askHost`). Every agent turn, retry, park wake and
 * dispatch pass the lane's project enqueues is held a day ahead
 * (`holdAgentJobs`), so the harness's worker launches nothing and every pass
 * is the lane's own.
 */
import { createHash, randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import { DEFAULT_SANDBOX_QUOTA } from '@tale/shared/schemas/governance';
import type { ProjectDispatch } from '@tale/shared/schemas/project-dispatch';
import type { Sql } from 'postgres';

import { resolvePolicyYamlFilePath } from '../../core/governance/file_utils.ts';
import { removeFileSafe } from '../../core/lib/file_io.ts';
import { createTaskList } from '../../jobs/task-list.ts';
import {
  readGovernancePolicySnapshot,
  writeGovernancePolicyFile,
} from '../../lib/governance-policy-write.ts';
import { clearOrgConfigCaches, resolveOrgSlug } from '../../lib/org-config.ts';
import type { ProjectAuthContext } from '../projects/service.ts';
import { failAgentRunFromTurn, settleAgentRun } from './agent-runs.ts';
import { claimAgentWorker } from './agent-workers.ts';
import { holdAgentJobs } from './delegated-start.integration.ts';
import { admitAutomatedStart } from './delegated-start.ts';
import {
  checkProjectDispatchSave,
  readProjectDispatchConfiguration,
  saveProjectDispatch,
} from './dispatch-config.ts';
import { reportDispatchGate } from './dispatch-gates.ts';
import { runDispatchPass, type HostVerdict } from './dispatch-pass.ts';
import {
  readProjectDispatchStatus,
  type DispatchAgentRun,
  type DispatchPoolAgent,
} from './dispatch-readback.ts';
import {
  clearModelCapacityHoldInTx,
  MODEL_CAPACITY_RAMP_MS,
  MODEL_CAPACITY_WAKE_SPACING_MS,
  recordModelCapacityRefusalInTx,
} from './model-capacity-holds.ts';
import { snapshotRunInstructions } from './run-instructions.ts';

const ADMIT: HostVerdict = {
  admitted: true,
  retryAfterMs: null,
  reason: null,
  evidence: { stand_in: 'admit' },
};
const PRESSURE: HostVerdict = {
  admitted: false,
  retryAfterMs: 15_000,
  reason: 'pressure',
  evidence: { stand_in: 'memory pressure' },
};

export async function checkFleetDispatch(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const { orgId, userId } = ctx;
  const suffix = randomUUID().slice(0, 8);
  const projectId = randomUUID();
  const modelA = `itest-dispatch-a-${suffix}`;
  const modelB = `itest-dispatch-b-${suffix}`;
  const agents = {
    a1: randomUUID(),
    a2: randomUUID(),
    b1: randomUUID(),
    manager: randomUUID(),
  };
  const tasks = {
    t1: randomUUID(),
    t2: randomUUID(),
    t3: randomUUID(),
    t4: randomUUID(),
    t5: randomUUID(),
    t6: randomUUID(),
    t7: randomUUID(),
    t8: randomUUID(),
    manager: randomUUID(),
  };
  const now = Date.now();
  const release = await holdAgentJobs(sql, `dispatch_${suffix}`, [projectId], {
    extraQueues: ['tasks.dispatch_project', 'task.agent_park_wake'],
  });
  const auth: ProjectAuthContext = {
    organizationId: orgId,
    userId,
    role: 'owner',
    teamIds: [],
  };
  // The organization's default two agent workers would hold the pool back
  // before its own limit does: give it ten for the lane.
  const restoreQuota = await raiseAgentWorkers(sql, orgId, 10);
  try {
    await sql`
      INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms, updated_at_ms)
      VALUES (${projectId}, ${orgId}, 'Fleet dispatch', ${userId}, ${now}, ${now})
    `;
    for (const [key, id] of Object.entries(agents)) {
      await sql`
        INSERT INTO app.project_agents (id, org_id, project_id, name, harness,
          model, created_by, created_at_ms, updated_at_ms)
        VALUES (${id}, ${orgId}, ${projectId}, ${`Agent ${key}`}, 'codex',
          ${key === 'a1' || key === 'a2' ? modelA : modelB}, ${userId},
          ${now}, ${now})
      `;
    }
    const insertTask = async (args: {
      id: string;
      title: string;
      status: 'todo' | 'backlog';
      priority: string | null;
      rank: string;
      assignee: string | null;
    }) => {
      await sql`
        INSERT INTO app.tasks (id, org_id, project_id, title, status, priority,
          assignee_type, assignee_id, rank, created_by, created_by_type,
          created_at_ms, updated_at_ms)
        VALUES (${args.id}, ${orgId}, ${projectId}, ${args.title}, ${args.status},
          ${args.priority}, ${args.assignee === null ? null : 'agent'},
          ${args.assignee}, ${args.rank}, ${userId}, 'user', ${now}, ${now})
      `;
    };
    await insertTask({
      id: tasks.t1,
      title: 'Release notes',
      status: 'todo',
      priority: 'p1',
      rank: 'a',
      assignee: agents.a1,
    });
    await insertTask({
      id: tasks.t2,
      title: 'Changelog',
      status: 'todo',
      priority: 'p2',
      rank: 'b',
      assignee: agents.a2,
    });
    await insertTask({
      id: tasks.t3,
      title: 'Sitemap',
      status: 'todo',
      priority: 'p2',
      rank: 'c',
      assignee: null,
    });
    await insertTask({
      id: tasks.t4,
      title: 'Press kit',
      status: 'backlog',
      priority: null,
      rank: 'd',
      assignee: null,
    });
    await insertTask({
      id: tasks.t5,
      title: 'Glossary',
      status: 'todo',
      priority: 'p3',
      rank: 'e',
      assignee: agents.a1,
    });
    await insertTask({
      id: tasks.manager,
      title: 'Fleet manager',
      status: 'todo',
      priority: null,
      rank: 'f',
      assignee: agents.manager,
    });

    const dispatch: ProjectDispatch = {
      enabled: true,
      agents: [agents.a1, agents.a2, agents.b1],
      maxConcurrentRuns: 3,
      statuses: ['todo', 'backlog'],
      assignment: 'pool',
      admission: {
        preset: 'conservative',
        startSpacingSeconds: 0,
        recheckSeconds: [60, 120],
      },
      standingRoles: [
        {
          key: 'manager',
          taskId: tasks.manager,
          agentId: agents.manager,
          cron: '* * * * *',
          timezone: 'Europe/Zurich',
          mode: 'light',
          brief: 'Route reviews and answer questions.',
        },
      ],
    };
    await transactSerializable(sql, (tx) =>
      saveProjectDispatch(tx, auth, {
        projectId,
        dispatch,
        expectedHash: null,
      }),
    );
    // A role decides nothing before its dispatch was saved: date the save two
    // minutes back so this minute's occurrence is due.
    await sql`
      UPDATE app.project_dispatch SET updated_at_ms = ${Date.now() - 120_000}
      WHERE project_id = ${projectId}
    `;

    const pass = (verdict: HostVerdict) =>
      runDispatchPass(
        sql,
        { organizationId: orgId, projectId, trigger: 'manual' },
        { askHost: () => Promise.resolve(verdict) },
      );
    const liveRuns = () =>
      sql<
        {
          id: string;
          execId: string;
          taskId: string;
          agentId: string;
          startedBy: string;
          trigger: string;
          startedVia: string | null;
          status: string;
          waitingReason: string | null;
        }[]
      >`
        SELECT id, exec_id AS "execId", task_id AS "taskId",
               agent_id AS "agentId", started_by AS "startedBy", trigger,
               started_via AS "startedVia", status,
               waiting_reason AS "waitingReason"
        FROM app.project_agent_runs
        WHERE project_id = ${projectId} AND status IN ('queued', 'running')
      `;
    const runOf = async (taskId: string) =>
      (await liveRuns()).find((run) => run.taskId === taskId);

    // 1. One pass: the standing role, then the best-ranked ready work, one
    // run per agent of the pool, the unassigned task to the idle agent.
    const first = await pass(ADMIT);
    const afterFirst = await liveRuns();
    const byTask = new Map(afterFirst.map((run) => [run.taskId, run]));
    const sitemap = await sql<{ assigneeId: string | null; status: string }[]>`
      SELECT assignee_id AS "assigneeId", status FROM app.tasks WHERE id = ${tasks.t3}
    `;
    record(
      'fleet dispatch: one pass starts the standing role and the best-ranked ready work, one run per agent of the pool [TASK-R41]',
      first !== null &&
        byTask.get(tasks.t1)?.agentId === agents.a1 &&
        byTask.get(tasks.t2)?.agentId === agents.a2 &&
        byTask.get(tasks.t3)?.agentId === agents.b1 &&
        sitemap[0]?.assigneeId === agents.b1 &&
        sitemap[0].status === 'in_progress' &&
        byTask.get(tasks.manager)?.agentId === agents.manager &&
        !byTask.has(tasks.t4) &&
        !byTask.has(tasks.t5) &&
        afterFirst.every(
          (run) =>
            run.startedBy === `dispatch:${projectId}` &&
            run.trigger === 'dispatch' &&
            run.startedVia === 'dispatch',
        ),
      `first=${JSON.stringify(first)} runs=${JSON.stringify(afterFirst)} sitemap=${JSON.stringify(sitemap)}`,
    );

    // 2. The same pass again: the pool is full and the occurrence decided.
    const second = await pass(ADMIT);
    const occurrences = await sql<{ outcome: string }[]>`
      SELECT outcome FROM app.project_standing_role_occurrences
      WHERE project_id = ${projectId}
    `;
    record(
      'fleet dispatch: a pass decided again starts nothing twice [TASK-R45]',
      second !== null &&
        second.stop === 'pool_full' &&
        second.started.length === 0 &&
        (await liveRuns()).length === afterFirst.length &&
        occurrences.length === 1 &&
        occurrences[0]?.outcome === 'started',
      `second=${JSON.stringify(second)} occurrences=${JSON.stringify(occurrences)}`,
    );

    // 3. The provider calls model A at capacity on Release notes; Sitemap
    // (model B) finishes. Model A's agents take nothing; the unassigned
    // Press kit goes to the agent on model B.
    const releaseNotes = await runOf(tasks.t1);
    const sitemapRun = await runOf(tasks.t3);
    if (releaseNotes === undefined || sitemapRun === undefined)
      throw new Error('itest: dispatch runs missing');
    await failAgentRunFromTurn(sql, {
      runId: releaseNotes.id,
      execId: releaseNotes.execId,
      error: 'Selected model is at capacity. Please try a different model.',
      failureCode: 'model_capacity',
    });
    // Sitemap's turn starts (as the turn host does it) and finishes: its
    // record names the instructions it was handed and the host's verdict
    // the pass started it on.
    const projectInstructions = 'Ship small, reviewed changes.';
    await sql`
      UPDATE app.projects SET instructions = ${projectInstructions}
      WHERE id = ${projectId}
    `;
    await snapshotRunInstructions(sql, {
      organizationId: orgId,
      runId: sitemapRun.id,
      taskId: tasks.t3,
      execId: sitemapRun.execId,
      agentInstructions: 'You map sites.',
    });
    await settleAgentRun(sql, {
      runId: sitemapRun.id,
      execId: sitemapRun.execId,
      resultText: 'Done.',
    });
    const ledger = await sql<{ metadata: Record<string, unknown> }[]>`
      SELECT metadata FROM app.audit_logs
      WHERE org_id = ${orgId} AND resource_id = ${sitemapRun.id}
        AND action = 'agent.run_settled'
    `;
    const sha = (text: string) =>
      createHash('sha256').update(text, 'utf8').digest('hex');
    const recorded = ledger[0]?.metadata;
    record(
      "fleet dispatch: a run's record names the instructions its turn was handed and the host's verdict it started on [TASK-R49]",
      ledger.length === 1 &&
        JSON.stringify(recorded?.admission) ===
          JSON.stringify(ADMIT.evidence) &&
        typeof recorded?.instructions === 'object' &&
        recorded.instructions !== null &&
        'project' in recorded.instructions &&
        recorded.instructions.project === sha(projectInstructions) &&
        'agent' in recorded.instructions &&
        recorded.instructions.agent === sha('You map sites.'),
      `ledger=${JSON.stringify(ledger)}`,
    );
    const third = await pass(ADMIT);
    const pressKit = await runOf(tasks.t4);
    record(
      'fleet dispatch: an agent whose model is at capacity takes nothing, and unassigned work goes to an agent whose model answers [TASK-R43]',
      third !== null &&
        pressKit?.agentId === agents.b1 &&
        (await runOf(tasks.t5)) === undefined &&
        third.held.some(
          (hold) =>
            hold.taskId === tasks.t5 && hold.reason === 'model_capacity',
        ),
      `third=${JSON.stringify(third)} pressKit=${JSON.stringify(pressKit)}`,
    );

    // 4. Its retry waits for the model with a live run: the card is never
    // In progress with no run behind it.
    const retries = await sql<{ data: Record<string, unknown> }[]>`
      SELECT data FROM pgboss.job
      WHERE name = 'task.agent_retry' AND data ->> 'expectedRunId' = ${releaseNotes.id}
    `;
    const retryJob = createTaskList({ sql })['task.agent_retry'];
    for (const job of retries) await retryJob?.(job.data);
    const retryRun = await runOf(tasks.t1);
    const claim =
      retryRun === undefined
        ? null
        : await claimAgentWorker(sql, {
            organizationId: orgId,
            runId: retryRun.id,
            execId: retryRun.execId,
          });
    const waiting = await runOf(tasks.t1);
    const card = await sql<{ status: string }[]>`
      SELECT status FROM app.tasks WHERE id = ${tasks.t1}
    `;
    record(
      'fleet dispatch: a task the provider refused keeps a live run that waits for its model, never an In progress card with no run [TASK-R40]',
      retries.length === 1 &&
        claim !== null &&
        'parked' in claim &&
        claim.parked === 'model_capacity' &&
        waiting?.status === 'queued' &&
        waiting.waitingReason === 'model_capacity' &&
        card[0]?.status === 'in_progress',
      `retries=${retries.length} claim=${JSON.stringify(claim)} waiting=${JSON.stringify(waiting)} card=${JSON.stringify(card)}`,
    );

    // 5. The host comes under pressure: dispatch holds, asks again after 60
    // then 120 seconds, then keeps 120, and starts once it admits.
    if (pressKit === undefined) throw new Error('itest: press kit run missing');
    await settleAgentRun(sql, {
      runId: pressKit.id,
      execId: pressKit.execId,
      resultText: 'Done.',
    });
    await sql`
      INSERT INTO app.tasks (id, org_id, project_id, title, status, rank,
        created_by, created_by_type, created_at_ms, updated_at_ms)
      VALUES (${tasks.t6}, ${orgId}, ${projectId}, 'Style guide', 'todo', 'g',
        ${userId}, 'user', ${now}, ${now})
    `;
    const nextOf = async () =>
      (
        await sql<{ nextPassAt: number | null; recheckIndex: number }[]>`
          SELECT next_pass_at_ms::float8 AS "nextPassAt",
                 recheck_index AS "recheckIndex"
          FROM app.project_dispatch_state WHERE project_id = ${projectId}
        `
      )[0];
    const held: Array<{ stop: string; delay: number; index: number }> = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const before = Date.now();
      const result = await pass(PRESSURE);
      const state = await nextOf();
      held.push({
        stop: result?.stop ?? 'none',
        delay: Math.round(((state?.nextPassAt ?? 0) - before) / 1000),
        index: state?.recheckIndex ?? -1,
      });
    }
    const admitted = await pass(ADMIT);
    const styleGuide = await runOf(tasks.t6);
    const afterAdmit = await nextOf();
    record(
      'fleet dispatch: a host under pressure holds starts, dispatch asks again after its recheck delays, then starts [TASK-R44]',
      held.every((entry) => entry.stop === 'host_pressure') &&
        [held[0], held[1], held[2]].map((entry) => entry?.index).join(',') ===
          '1,2,3' &&
        Math.abs((held[0]?.delay ?? 0) - 60) <= 2 &&
        Math.abs((held[1]?.delay ?? 0) - 120) <= 2 &&
        Math.abs((held[2]?.delay ?? 0) - 120) <= 2 &&
        admitted !== null &&
        styleGuide?.agentId === agents.b1 &&
        afterAdmit?.recheckIndex === 0,
      `held=${JSON.stringify(held)} admitted=${JSON.stringify(admitted)} styleGuide=${JSON.stringify(styleGuide)}`,
    );

    // 6. An occurrence that finds the role still working is coalesced.
    await sql`
      UPDATE app.project_standing_role_occurrences
      SET occurrence_at_ms = occurrence_at_ms - 3600000
      WHERE project_id = ${projectId} AND role_key = 'manager'
    `;
    const coalescing = await pass(ADMIT);
    const managerRuns = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM app.project_agent_runs
      WHERE task_id = ${tasks.manager}
    `;
    const coalesced = await sql<{ outcome: string; runId: string | null }[]>`
      SELECT outcome, run_id AS "runId"
      FROM app.project_standing_role_occurrences
      WHERE project_id = ${projectId}
      ORDER BY occurrence_at_ms DESC LIMIT 1
    `;
    record(
      'fleet dispatch: an occurrence that finds its role still working is coalesced into that run [TASK-R45]',
      coalescing !== null &&
        managerRuns[0]?.n === 1 &&
        coalesced[0]?.outcome === 'coalesced' &&
        coalesced[0].runId === byTask.get(tasks.manager)?.id,
      `managerRuns=${JSON.stringify(managerRuns)} coalesced=${JSON.stringify(coalesced)}`,
    );

    // 7. The readback says what each agent of the pool does.
    await sql`
      UPDATE app.model_capacity_holds SET held_until_ms = ${Date.now() + 600_000}
      WHERE org_id = ${orgId} AND model = ${modelA}
    `;
    const status = await readProjectDispatchStatus(sql, auth, projectId);
    const a1 = status.pool.find((entry) => entry.agentId === agents.a1);
    const a2 = status.pool.find((entry) => entry.agentId === agents.a2);
    // The counts tally the same runs the list names, by what they do.
    const countsMatchList = (agent: DispatchPoolAgent | undefined) => {
      if (agent === undefined) return false;
      const listed = (match: (run: DispatchAgentRun) => boolean) =>
        agent.runs.filter(match).length;
      const parked = listed((run) => run.waitingReason === 'model_capacity');
      return (
        agent.runCounts.total === agent.runs.length &&
        agent.runCounts.running === listed((run) => run.status === 'running') &&
        agent.runCounts.waiting.model_capacity ===
          (parked > 0 ? parked : undefined)
      );
    };
    record(
      'fleet dispatch: the readback names each agent’s runs, a run waiting for its model, and the model’s hold [TASK-R46]',
      status.configured &&
        a1?.runs[0]?.waitingReason === 'model_capacity' &&
        a1.modelHeldUntil !== null &&
        a2?.runs.length === 1 &&
        countsMatchList(a1) &&
        countsMatchList(a2) &&
        status.holds.some((hold) => hold.model === modelA) &&
        status.passes.length >= 7,
      `status=${JSON.stringify({ pool: status.pool, holds: status.holds, passes: status.passes.length })}`,
    );

    // 8. The manager's own task: capacity refusals close no circuit.
    const managerRun = byTask.get(tasks.manager);
    if (managerRun === undefined) throw new Error('itest: manager run missing');
    await failAgentRunFromTurn(sql, {
      runId: managerRun.id,
      execId: managerRun.execId,
      error: 'Selected model is at capacity. Please try a different model.',
      failureCode: 'model_capacity',
    });
    for (let refusal = 0; refusal < 3; refusal += 1) {
      const at = Date.now();
      const execId = randomUUID();
      const rows = await sql<{ id: string }[]>`
        INSERT INTO app.project_agent_runs (
          org_id, project_id, task_id, agent_id, exec_id, session_id, status,
          harness, model, started_by, trigger, started_via, started_via_run_id,
          started_at_ms, launched_at_ms, deadline_at_ms, updated_at_ms
        ) VALUES (
          ${orgId}, ${projectId}, ${tasks.manager}, ${agents.manager}, ${execId},
          ${`pa-${agents.manager}`}, 'running', 'codex', ${modelB},
          ${`dispatch:${projectId}`}, 'dispatch', 'dispatch',
          ${`manager@${at}`}, ${at - 2_000}, ${at - 1_000}, ${at + 3_600_000},
          ${at}
        ) RETURNING id
      `;
      const runId = rows[0]?.id;
      if (runId === undefined)
        throw new Error('itest: manager refusal missing');
      await failAgentRunFromTurn(sql, {
        runId,
        execId,
        error: 'Selected model is at capacity. Please try a different model.',
        failureCode: 'model_capacity',
      });
    }
    const circuit = await sql.begin((tx) =>
      admitAutomatedStart(tx, {
        task: { id: tasks.manager, organizationId: orgId, projectId },
        agentId: agents.manager,
      }),
    );
    record(
      "fleet dispatch: capacity refusals of the manager's own task close no circuit [TASK-R12]",
      circuit.admitted,
      `circuit=${JSON.stringify(circuit)}`,
    );

    // 9. A gate: the CI queue is full, so the work labelled `ci` waits and
    // the rest starts; the queue drains below the recover value, the gate
    // opens, a pass is asked for at once, and the held work starts.
    // Managed configuration asks before it writes anything: while the
    // project lacks the label the gate names, the check refuses it at that
    // field and leaves the stored dispatch and its audit as they were.
    const gatedDispatch: ProjectDispatch = {
      ...dispatch,
      gates: [{ key: 'ci', labels: ['ci'], holdAt: 20 }],
    };
    const dispatchAudits = async () =>
      (
        await sql<{ count: number }[]>`
          SELECT count(*)::int AS count FROM app.audit_logs
          WHERE org_id = ${orgId} AND resource_id = ${projectId}
        `
      )[0]?.count ?? 0;
    const beforeCheck = await readProjectDispatchConfiguration(
      sql,
      auth,
      projectId,
    );
    const auditsBeforeCheck = await dispatchAudits();
    const refusedCheck = await transactSerializable(sql, (tx) =>
      checkProjectDispatchSave(tx, auth, {
        projectId,
        dispatch: gatedDispatch,
        expectedHash: beforeCheck.hash,
      }),
    );
    const afterRefusedCheck = await readProjectDispatchConfiguration(
      sql,
      auth,
      projectId,
    );
    const ciLabel = randomUUID();
    await sql`
      INSERT INTO app.task_labels (id, org_id, project_id, name, color,
        created_by, created_at_ms, updated_at_ms)
      VALUES (${ciLabel}, ${orgId}, ${projectId}, 'ci', 'blue', ${userId},
        ${now}, ${now})
    `;
    const passingCheck = await transactSerializable(sql, (tx) =>
      checkProjectDispatchSave(tx, auth, {
        projectId,
        dispatch: gatedDispatch,
        expectedHash: beforeCheck.hash,
      }),
    );
    const auditsAfterChecks = await dispatchAudits();
    await sql`
      INSERT INTO app.tasks (id, org_id, project_id, title, status, rank,
        label_ids, created_by, created_by_type, created_at_ms, updated_at_ms)
      VALUES
        (${tasks.t7}, ${orgId}, ${projectId}, 'Release build', 'todo', 'h',
          ${[ciLabel]}, ${userId}, 'user', ${now}, ${now}),
        (${tasks.t8}, ${orgId}, ${projectId}, 'FAQ', 'todo', 'i',
          ${[]}::text[], ${userId}, 'user', ${now}, ${now})
    `;
    const current = await readProjectDispatchConfiguration(
      sql,
      auth,
      projectId,
    );
    const gatedSave = await transactSerializable(sql, (tx) =>
      saveProjectDispatch(tx, auth, {
        projectId,
        dispatch: gatedDispatch,
        expectedHash: current.hash,
      }),
    );
    record(
      'fleet dispatch: a check refuses a gate label the project lacks at its field, writes nothing, and answers what the save then does [TASK-R61]',
      !refusedCheck.ok &&
        refusedCheck.issues.map((issue) => issue.path).join() ===
          'gates.0.labels.0' &&
        afterRefusedCheck.hash === beforeCheck.hash &&
        current.hash === beforeCheck.hash &&
        auditsAfterChecks === auditsBeforeCheck &&
        passingCheck.ok &&
        passingCheck.changed &&
        passingCheck.hash === gatedSave.hash &&
        gatedSave.changed,
      `refused=${JSON.stringify(refusedCheck)} passing=${JSON.stringify(passingCheck)} saved=${JSON.stringify(gatedSave)} audits=${auditsBeforeCheck}->${auditsAfterChecks}`,
    );
    const report = (value: number) =>
      transactSerializable(sql, (tx) =>
        reportDispatchGate(tx, auth, {
          projectId,
          key: 'ci',
          report: { value, reason: 'queued CI jobs' },
          reporter: `user:${userId}`,
          access: 'administer',
        }),
      );
    const full = await report(23);
    if (styleGuide === undefined)
      throw new Error('itest: style guide run missing');
    await settleAgentRun(sql, {
      runId: styleGuide.id,
      execId: styleGuide.execId,
      resultText: 'Done.',
    });
    const gatedPass = await pass(ADMIT);
    const faq = await runOf(tasks.t8);
    const releaseBuildWaits = (await runOf(tasks.t7)) === undefined;
    const easing = await report(14);
    // One pass waits per project: drop the lane's own held requests, so the
    // pass the opening report asks for is a row of its own.
    await sql`
      DELETE FROM pgboss.job
      WHERE name = 'tasks.dispatch_project'
        AND data ->> 'projectId' = ${projectId} AND state = 'created'
    `;
    const drained = await report(9);
    const gatePasses = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pgboss.job
      WHERE name = 'tasks.dispatch_project'
        AND data ->> 'projectId' = ${projectId}
        AND data ->> 'trigger' = 'gate'
    `;
    if (faq === undefined) throw new Error('itest: FAQ run missing');
    await settleAgentRun(sql, {
      runId: faq.id,
      execId: faq.execId,
      resultText: 'Done.',
    });
    const openPass = await pass(ADMIT);
    const releaseBuild = await runOf(tasks.t7);
    record(
      'fleet dispatch: a held gate leaves the work it governs and starts the rest, holds until its value falls below the recover value, and asks for a pass when it opens [TASK-R51]',
      full.held &&
        gatedPass !== null &&
        faq.agentId === agents.b1 &&
        releaseBuildWaits &&
        gatedPass.held.some(
          (hold) => hold.taskId === tasks.t7 && hold.reason === 'gate:ci',
        ) &&
        easing.held &&
        !easing.changed &&
        !drained.held &&
        drained.changed &&
        gatePasses[0]?.n === 1 &&
        openPass !== null &&
        releaseBuild?.agentId === agents.b1,
      `full=${JSON.stringify(full)} gated=${JSON.stringify(gatedPass)} easing=${JSON.stringify(easing)} drained=${JSON.stringify(drained)} gatePasses=${gatePasses[0]?.n} open=${JSON.stringify(openPass)} releaseBuild=${JSON.stringify(releaseBuild)}`,
    );

    // A report nobody repeats goes stale: the gate opens again.
    await report(25);
    await sql`
      UPDATE app.project_dispatch_gates
      SET reported_at_ms = ${Date.now() - 11 * 60_000}
      WHERE project_id = ${projectId} AND gate_key = 'ci'
    `;
    const staleStatus = await readProjectDispatchStatus(sql, auth, projectId);
    const ciGate = staleStatus.gates.find((gate) => gate.key === 'ci');
    record(
      'fleet dispatch: a gate nobody reports on for its stale window opens again, and the readback says it is stale [TASK-R51]',
      ciGate !== undefined &&
        ciGate.stale &&
        !ciGate.held &&
        ciGate.value === 25,
      `gate=${JSON.stringify(ciGate)}`,
    );

    // 10. A dispatch a newer version stored, in a shape this one cannot
    // read: no pass acts on it, and the readback says it is there.
    await sql`
      UPDATE app.project_dispatch
      SET config = config || ${sql.json({ futureField: true })}
      WHERE project_id = ${projectId}
    `;
    const unreadablePass = await pass(ADMIT);
    const unreadableStatus = await readProjectDispatchStatus(
      sql,
      auth,
      projectId,
    );
    record(
      'fleet dispatch: a dispatch this version cannot read starts nothing, and the readback says it is there [TASK-R52]',
      unreadablePass === null &&
        unreadableStatus.configured &&
        unreadableStatus.unreadable &&
        unreadableStatus.config === null,
      `pass=${JSON.stringify(unreadablePass)} status=${JSON.stringify({ configured: unreadableStatus.configured, unreadable: unreadableStatus.unreadable })}`,
    );
  } finally {
    await sql`
      UPDATE app.project_dispatch SET enabled = false WHERE project_id = ${projectId}
    `;
    await sql`
      UPDATE app.project_agent_runs SET status = 'cancelled',
        settled_at_ms = ${Date.now()}, updated_at_ms = ${Date.now()}
      WHERE project_id = ${projectId} AND status IN ('queued', 'running')
    `;
    await sql`
      DELETE FROM app.model_capacity_holds
      WHERE org_id = ${orgId} AND model = ANY(${[modelA, modelB]})
    `;
    await sql`
      DELETE FROM app.model_capacity_recoveries
      WHERE org_id = ${orgId} AND model = ANY(${[modelA, modelB]})
    `;
    await restoreQuota();
    await release();
  }
}

/** Give the organization `count` agent workers for a lane; the answer puts
 * back what it had. */
async function raiseAgentWorkers(
  sql: Sql,
  orgId: string,
  count: number,
): Promise<() => Promise<void>> {
  const orgSlug = await resolveOrgSlug(sql, orgId);
  if (orgSlug === null) throw new Error('itest: the organization has no slug');
  const quotaBefore = await readGovernancePolicySnapshot(
    orgSlug,
    'sandbox_quota',
  );
  await sql.begin((tx) =>
    writeGovernancePolicyFile(tx, orgSlug, 'sandbox_quota', {
      ...(quotaBefore.config ?? DEFAULT_SANDBOX_QUOTA),
      maxSessionsPerOrg: count,
    }),
  );
  return async () => {
    if (quotaBefore.config === null) {
      await removeFileSafe(resolvePolicyYamlFilePath(orgSlug, 'sandbox_quota'));
      clearOrgConfigCaches();
    } else {
      const config = quotaBefore.config;
      await sql.begin((tx) =>
        writeGovernancePolicyFile(tx, orgSlug, 'sandbox_quota', config),
      );
    }
  };
}

/**
 * A pool kept on one model as it answers again, and a pass that runs out of
 * time, against real PostgreSQL. Coder alone in the pool, with no time
 * between starts: once its model's hold clears, a pass starts the one run
 * the ramp lets through and asks again at the next wave, a pass before it
 * starts nothing, and the next wave starts the rest; a ramp that is over
 * holds nothing back. A pass whose time runs out after its first start asks
 * for the next at once, with no delay, and that pass starts the rest.
 */
export async function checkDispatchRampAndBudget(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const { orgId, userId } = ctx;
  const suffix = randomUUID().slice(0, 8);
  const projectId = randomUUID();
  const coder = randomUUID();
  const model = `itest-dispatch-ramp-${suffix}`;
  const tasks: string[] = Array.from({ length: 6 }, () => randomUUID());
  const now = Date.now();
  // Every request keeps its delay, a day later: the lane reads whether the
  // pass asked for the next at once.
  const release = await holdAgentJobs(sql, `ramp_${suffix}`, [projectId], {
    keepDelay: true,
    extraQueues: ['tasks.dispatch_project', 'task.agent_park_wake'],
  });
  const auth: ProjectAuthContext = {
    organizationId: orgId,
    userId,
    role: 'owner',
    teamIds: [],
  };
  // Room for the lane's six runs whatever other lanes left behind.
  const restoreQuota = await raiseAgentWorkers(sql, orgId, 20);
  try {
    await sql`
      INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms, updated_at_ms)
      VALUES (${projectId}, ${orgId}, 'Fleet ramp', ${userId}, ${now}, ${now})
    `;
    await sql`
      INSERT INTO app.project_agents (id, org_id, project_id, name, harness,
        model, created_by, created_at_ms, updated_at_ms)
      VALUES (${coder}, ${orgId}, ${projectId}, 'Coder', 'codex', ${model},
        ${userId}, ${now}, ${now})
    `;
    // Ranked in the order they are listed.
    const addTasks = async (ids: readonly string[]) => {
      for (const id of ids) {
        const place = tasks.indexOf(id);
        await sql`
          INSERT INTO app.tasks (id, org_id, project_id, title, status,
            assignee_type, assignee_id, rank, created_by, created_by_type,
            created_at_ms, updated_at_ms)
          VALUES (${id}, ${orgId}, ${projectId}, ${`Fleet task ${place}`},
            'todo', 'agent', ${coder}, ${`r${place}`}, ${userId}, 'user',
            ${now}, ${now})
        `;
      }
    };
    await addTasks(tasks.slice(0, 3));
    await transactSerializable(sql, (tx) =>
      saveProjectDispatch(tx, auth, {
        projectId,
        dispatch: {
          enabled: true,
          agents: [coder],
          maxConcurrentRuns: 10,
          perAgentConcurrency: 10,
          statuses: ['todo'],
          assignment: 'assigned',
          admission: {
            preset: 'default',
            startSpacingSeconds: 0,
            recheckSeconds: [60],
          },
        },
        expectedHash: null,
      }),
    );
    const pass = (budgetMs?: number) =>
      runDispatchPass(
        sql,
        { organizationId: orgId, projectId, trigger: 'manual' },
        {
          askHost: () => Promise.resolve(ADMIT),
          ...(budgetMs === undefined ? {} : { budgetMs }),
        },
      );
    const startedTasks = async () =>
      (
        await sql<{ taskId: string }[]>`
          SELECT task_id AS "taskId" FROM app.project_agent_runs
          WHERE project_id = ${projectId} AND status IN ('queued', 'running')
        `
      ).map((row) => row.taskId);
    const clearedAt = async () =>
      (
        await sql<{ clearedAt: number }[]>`
          SELECT cleared_at_ms::float8 AS "clearedAt"
          FROM app.model_capacity_recoveries
          WHERE org_id = ${orgId} AND model_provider = '' AND model = ${model}
        `
      )[0]?.clearedAt ?? null;

    // 1. The provider refused the model, and a run on it then settled: the
    // hold clears and the ramp starts.
    await sql.begin(async (tx) => {
      await recordModelCapacityRefusalInTx(tx, {
        organizationId: orgId,
        modelProvider: null,
        model,
        runId: `itest-refused-${suffix}`,
      });
      await clearModelCapacityHoldInTx(tx, {
        organizationId: orgId,
        modelProvider: null,
        model,
      });
    });
    const cleared = await clearedAt();
    const first = await pass();
    const second = await pass();
    const afterRamp = await startedTasks();
    record(
      'fleet dispatch: once a model answers again, a pass with no time between starts starts the one run its ramp lets through and asks again at the next wave [TASK-R43]',
      cleared !== null &&
        first !== null &&
        first.stop === 'model_ramp' &&
        first.started.map((start) => start.taskId).join() === tasks[0] &&
        first.held.filter((hold) => hold.reason === 'model_ramp').length ===
          2 &&
        first.nextPassAt === cleared + MODEL_CAPACITY_WAKE_SPACING_MS &&
        second !== null &&
        second.stop === 'model_ramp' &&
        second.started.length === 0 &&
        second.nextPassAt === cleared + MODEL_CAPACITY_WAKE_SPACING_MS &&
        afterRamp.length === 1,
      `cleared=${cleared} first=${JSON.stringify(first)} second=${JSON.stringify(second)} started=${JSON.stringify(afterRamp)}`,
    );

    // 2. The next wave lets two more through: a clear 15 seconds back.
    await sql`
      UPDATE app.model_capacity_recoveries
      SET cleared_at_ms = cleared_at_ms - ${MODEL_CAPACITY_WAKE_SPACING_MS}
      WHERE org_id = ${orgId} AND model = ${model}
    `;
    const wave = await pass();
    // A ramp that is over holds nothing back.
    await sql`
      UPDATE app.model_capacity_recoveries
      SET cleared_at_ms = cleared_at_ms - ${MODEL_CAPACITY_RAMP_MS}
      WHERE org_id = ${orgId} AND model = ${model}
    `;
    await addTasks(tasks.slice(3, 4));
    const over = await pass();
    record(
      'fleet dispatch: the next wave starts the work the ramp held, and a ramp that is over holds nothing back [TASK-R43]',
      wave !== null &&
        wave.stop === 'started' &&
        wave.started.map((start) => start.taskId).join() ===
          [tasks[1], tasks[2]].join() &&
        wave.nextPassAt === null &&
        over !== null &&
        over.stop === 'started' &&
        over.started.map((start) => start.taskId).join() === tasks[3],
      `wave=${JSON.stringify(wave)} over=${JSON.stringify(over)}`,
    );

    // 3. A pass out of time after its first start: the next goes on at once.
    await addTasks(tasks.slice(4, 6));
    // One pass waits per project: drop the lane's own held requests, so the
    // pass this one asks for is a row of its own.
    await sql`
      DELETE FROM pgboss.job
      WHERE name = 'tasks.dispatch_project'
        AND data ->> 'projectId' = ${projectId} AND state = 'created'
    `;
    const before = Date.now();
    const outOfTime = await pass(0);
    const after = Date.now();
    const recorded = await sql<
      { stopReason: string; nextPassAt: number | null }[]
    >`
      SELECT stop_reason AS "stopReason",
             next_pass_at_ms::float8 AS "nextPassAt"
      FROM app.project_dispatch_passes WHERE id = ${outOfTime?.passId ?? ''}
    `;
    const asked = await sql<{ trigger: string; delayMs: number }[]>`
      SELECT data ->> 'trigger' AS trigger,
             (extract(epoch FROM start_after - created_on) * 1000)::float8
               AS "delayMs"
      FROM pgboss.job
      WHERE name = 'tasks.dispatch_project'
        AND data ->> 'projectId' = ${projectId} AND state = 'created'
    `;
    const next = await pass();
    const allStarted = await startedTasks();
    const day = 24 * 60 * 60_000;
    record(
      'fleet dispatch: a pass out of time after its first start asks for the next at once, which starts the rest [TASK-R63]',
      outOfTime !== null &&
        outOfTime.stop === 'budget' &&
        outOfTime.started.length === 1 &&
        outOfTime.nextPassAt !== null &&
        outOfTime.nextPassAt >= before &&
        outOfTime.nextPassAt <= after &&
        recorded[0]?.stopReason === 'budget' &&
        recorded[0].nextPassAt === outOfTime.nextPassAt &&
        asked.length === 1 &&
        asked[0]?.trigger === 'recheck' &&
        // Held a day by the lane, and not a moment more.
        Math.abs((asked[0]?.delayMs ?? 0) - day) < 5_000 &&
        next !== null &&
        next.started.length === 1 &&
        allStarted.length === 6,
      `outOfTime=${JSON.stringify(outOfTime)} recorded=${JSON.stringify(recorded)} asked=${JSON.stringify(asked)} next=${JSON.stringify(next)} started=${allStarted.length}`,
    );
  } finally {
    await sql`
      UPDATE app.project_dispatch SET enabled = false WHERE project_id = ${projectId}
    `;
    await sql`
      UPDATE app.project_agent_runs SET status = 'cancelled',
        settled_at_ms = ${Date.now()}, updated_at_ms = ${Date.now()}
      WHERE project_id = ${projectId} AND status IN ('queued', 'running')
    `;
    await sql`
      DELETE FROM app.model_capacity_holds WHERE org_id = ${orgId} AND model = ${model}
    `;
    await sql`
      DELETE FROM app.model_capacity_recoveries
      WHERE org_id = ${orgId} AND model = ${model}
    `;
    await restoreQuota();
    await release();
  }
}
