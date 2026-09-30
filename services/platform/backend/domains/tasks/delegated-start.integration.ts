/** Real Postgres proof of project agents put to work by a schedule and by
 * another agent (`delegated-start.ts`, migration 0139).
 *
 * `checkScheduledAgentStarts` runs the whole scheduled path natively: the
 * minute scan claims an occurrence of a project-bound automation, the
 * harness worker steps its `task.start_agent` node through the connector
 * door, and the native starts the role task's project agent in place. The
 * agent's turn is held inert (a BEFORE INSERT trigger on the queue's job
 * table parks every `task.agent_turn` and `task.agent_retry` job this lane's
 * projects enqueue a day ahead), so no sandbox, provider or model is touched.
 *
 * `checkDelegatedAgentStartTool` drives `task_start_agent` over the real
 * workspace-tool door (`POST /api/tools/execute`) with a native session
 * token for a project agent's live run.
 *
 * Together: blocked, started, coalesced, replayed and resumed occurrences;
 * cancelled and failed runs; the per-task circuit breaker; pause, resume and
 * no replay of a missed backlog; revocation by unbinding, pausing and a lost
 * role; webhook runs refused; cross-project dispatch refused; one run per
 * agent workspace under a race; the delegation depth limit; confined runs;
 * a pending review withdrawn but never approved; and the answer's authorship
 * kept on the agent. */
import { createHash, randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql } from 'postgres';

import { createTaskList } from '../../jobs/task-list.ts';
import { deploy, saveVersion, setTrigger } from '../automations/store.ts';
import { scanScheduledTriggers } from '../automations/triggers.ts';
import { pgTaskStore } from '../connectors/task-store.ts';
import {
  deleteProjectAgent,
  getProjectAuthContext,
} from '../projects/service.ts';
import { insertSessionToken } from '../sandbox/sessions.ts';
import { completeAgentRunInTx } from './agent-run-completion.ts';
import { cancelAgentRunInTx, failAgentRunFromTurn } from './agent-runs.ts';
import {
  AUTOMATED_STARTS_PER_TASK_PER_HOUR,
  SCHEDULE_REVOKED_BEFORE_LAUNCH,
} from './delegated-start.ts';
import { isTaskRunConfined } from './run-authority.ts';
import {
  agentUpdateTaskStatusTrusted,
  assignTask,
  updateTaskStatus,
} from './service.ts';

export type Recorder = (name: string, ok: boolean, detail: string) => void;

export interface LaneCtx {
  cookie: string;
  orgId: string;
  userId: string;
}

const WAIT_MS = 45_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return predicate();
}

/** A run's row as the lane reads it. */
export interface RunRow {
  id: string;
  taskId: string;
  status: string;
  trigger: string | null;
  startedBy: string;
  sessionId: string;
  agentId: string;
  execId: string;
  feedback: string | null;
  startedVia: string | null;
  viaRunId: string | null;
  viaNodeId: string | null;
  viaAutomation: string | null;
  viaAgentId: string | null;
}

export function runsOf(sql: Sql, taskId: string): Promise<RunRow[]> {
  return sql<RunRow[]>`
    SELECT id, task_id AS "taskId", status, trigger,
           started_by AS "startedBy",
           session_id AS "sessionId", agent_id AS "agentId",
           exec_id AS "execId", feedback, started_via AS "startedVia",
           started_via_run_id AS "viaRunId",
           started_via_node_id AS "viaNodeId",
           started_via_automation AS "viaAutomation",
           started_via_agent_id AS "viaAgentId"
    FROM app.project_agent_runs WHERE task_id = ${taskId} ORDER BY seq
  `;
}

export function describeRuns(runs: readonly RunRow[]): string {
  return (
    runs.map((run) => `${run.status}/${run.trigger ?? 'manual'}`).join(',') ||
    'none'
  );
}

/**
 * Fail the task's newest run the way a crashed turn does, then hand the
 * retry job that failure queued to the real retry worker (turns stay held
 * inert). The worker's skip reasons land in `skips`.
 */
async function failNewestRunAndRetry(
  sql: Sql,
  taskId: string,
  skips: string[],
): Promise<void> {
  const newest = (await runsOf(sql, taskId)).at(-1);
  if (newest === undefined) return;
  await failAgentRunFromTurn(sql, {
    runId: newest.id,
    execId: newest.execId,
    error: 'itest: the harness exited before the turn completed',
    failureCode: 'turn_crashed',
  });
  const jobs = await sql<{ data: unknown }[]>`
    SELECT data FROM pgboss.job
    WHERE name = 'task.agent_retry'
      AND data ->> 'expectedRunId' = ${newest.id}
  `;
  const retryWorker = createTaskList({ sql })['task.agent_retry'];
  const log = console.log;
  console.log = (...args: unknown[]) => {
    const match = /auto-retry skipped: (\S+)/.exec(args.map(String).join(' '));
    if (match?.[1] !== undefined) skips.push(match[1]);
    else log(...args);
  };
  try {
    for (const job of jobs) await retryWorker?.(job.data);
  } finally {
    console.log = log;
  }
}

/** The queues of an agent's turn and of its automatic retry — the arm and
 * the later checks of a retry that waits for its busy agent. */
const HELD_QUEUES = [
  'task.agent_turn',
  'task.agent_retry',
  'task.agent_retry_recheck',
];

/**
 * Park every agent-turn and retry job the lane's projects enqueue a day
 * ahead, at the queue's own insert — the worker runs for the whole harness
 * and would otherwise try to launch a sandbox. With `keepDelay`, a job sent
 * to start later is parked a day past its own start, so a lane can still
 * read how long it was meant to wait. Returns the teardown.
 */
export async function holdAgentJobs(
  sql: Sql,
  suffix: string,
  projectIds: readonly string[],
  options: { keepDelay?: boolean } = {},
): Promise<() => Promise<void>> {
  for (const id of projectIds) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error(`itest: bad id ${id}`);
  }
  const tables = await sql<{ tableName: string }[]>`
    SELECT DISTINCT table_name AS "tableName" FROM pgboss.queue
    WHERE name IN ${sql(HELD_QUEUES)}
  `;
  const fn = `app.itest_hold_agent_jobs_${suffix}`;
  const list = projectIds.map((id) => `'${id}'`).join(', ');
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger AS $$
    BEGIN
      IF NEW.name IN (${HELD_QUEUES.map((name) => `'${name}'`).join(', ')}) AND (
        NEW.data ->> 'runId' IN (
          SELECT id FROM app.project_agent_runs WHERE project_id IN (${list})
        ) OR NEW.data ->> 'taskId' IN (
          SELECT id FROM app.tasks WHERE project_id IN (${list})
        )
      ) THEN
        NEW.start_after := ${options.keepDelay === true ? 'greatest(NEW.start_after, now())' : 'now()'} + interval '1 day';
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql
  `);
  for (const { tableName } of tables) {
    if (!/^[a-z0-9_]+$/.test(tableName)) {
      throw new Error(`itest: unexpected pg-boss table ${tableName}`);
    }
    await sql.unsafe(`
      CREATE TRIGGER itest_hold_agent_jobs_${suffix}
      BEFORE INSERT ON pgboss.${tableName}
      FOR EACH ROW EXECUTE FUNCTION ${fn}()
    `);
  }
  return async () => {
    for (const { tableName } of tables) {
      await sql.unsafe(
        `DROP TRIGGER IF EXISTS itest_hold_agent_jobs_${suffix} ON pgboss.${tableName}`,
      );
    }
    await sql.unsafe(`DROP FUNCTION IF EXISTS ${fn}()`);
    await sql`
      DELETE FROM pgboss.job
      WHERE name IN ${sql(HELD_QUEUES)}
        AND (data ->> 'runId' IN (SELECT id FROM app.project_agent_runs
                                  WHERE project_id = ANY(${[...projectIds]}))
             OR data ->> 'taskId' IN (SELECT id FROM app.tasks
                                      WHERE project_id = ANY(${[...projectIds]})))
    `;
  };
}

/** How many agent-turn jobs a run has, and how many of them are held. */
async function turnJobsOf(
  sql: Sql,
  runId: string,
): Promise<{ count: number; held: number }> {
  const rows = await sql<{ count: number; held: number }[]>`
    SELECT count(*)::int AS count,
           count(*) FILTER (WHERE start_after > now() + interval '1 hour'
                            AND state = 'created')::int AS held
    FROM pgboss.job
    WHERE name = 'task.agent_turn' AND data ->> 'runId' = ${runId}
  `;
  return rows[0] ?? { count: -1, held: -1 };
}

export interface Fixtures {
  suffix: string;
  now: number;
  insertUser: (id: string, role: string) => Promise<void>;
  insertProject: (id: string, name: string) => Promise<void>;
  insertAgent: (id: string, projectId: string, name: string) => Promise<void>;
  insertTask: (args: {
    projectId: string;
    title: string;
    status?: string;
    agentId?: string;
  }) => Promise<string>;
  block: (
    blockedId: string,
    blockerId: string,
    projectId: string,
  ) => Promise<void>;
  setRole: (userId: string, role: string) => Promise<void>;
  teardownUsers: () => Promise<void>;
}

export function fixtures(sql: Sql, ctx: LaneCtx): Fixtures {
  const suffix = randomUUID().slice(0, 8);
  const now = Date.now();
  const users: string[] = [];
  let rank = 0;
  return {
    suffix,
    now,
    async insertUser(id, role) {
      users.push(id);
      await sql`
        INSERT INTO "user" ("id", "name", "email", "emailVerified",
                            "createdAt", "updatedAt")
        VALUES (${id}, ${`Itest ${role}`}, ${`${id}@example.com`}, true,
                ${new Date()}, ${new Date()})
      `;
      await sql`
        INSERT INTO "member" ("id", "organizationId", "userId", "role",
                              "createdAt")
        VALUES (${`m-${id}`}, ${ctx.orgId}, ${id}, ${role}, ${new Date()})
      `;
    },
    async insertProject(id, name) {
      await sql`
        INSERT INTO app.projects (id, org_id, name, created_by,
                                  created_at_ms, updated_at_ms)
        VALUES (${id}, ${ctx.orgId}, ${name}, ${ctx.userId}, ${now}, ${now})
      `;
    },
    async insertAgent(id, projectId, name) {
      await sql`
        INSERT INTO app.project_agents (id, org_id, project_id, name, harness,
                                        model, created_by, created_at_ms,
                                        updated_at_ms)
        VALUES (${id}, ${ctx.orgId}, ${projectId}, ${name}, 'claude-code',
                'itest-model', ${ctx.userId}, ${now}, ${now})
      `;
    },
    async insertTask({ projectId, title, status = 'todo', agentId }) {
      const taskId = randomUUID();
      rank += 1;
      await sql`
        INSERT INTO app.tasks (id, org_id, project_id, title, status, rank,
          assignee_type, assignee_id, created_by, created_by_type,
          created_at_ms, updated_at_ms)
        VALUES (${taskId}, ${ctx.orgId}, ${projectId}, ${title}, ${status},
          ${`d${suffix}${String(rank).padStart(3, '0')}`},
          ${agentId === undefined ? null : 'agent'}, ${agentId ?? null},
          ${ctx.userId}, 'user', ${now}, ${now})
      `;
      return taskId;
    },
    async block(blockedId, blockerId, projectId) {
      await sql`
        INSERT INTO app.task_dependencies (org_id, project_id,
          blocker_task_id, blocked_task_id, created_by, created_by_type,
          created_at_ms)
        VALUES (${ctx.orgId}, ${projectId}, ${blockerId}, ${blockedId},
                ${ctx.userId}, 'user', ${now})
      `;
    },
    async setRole(userId, role) {
      await sql`UPDATE "member" SET "role" = ${role} WHERE "id" = ${`m-${userId}`}`;
    },
    async teardownUsers() {
      for (const id of users) {
        await sql`DELETE FROM "member" WHERE "id" = ${`m-${id}`}`;
        await sql`DELETE FROM "user" WHERE "id" = ${id}`;
      }
    },
  };
}

// ===========================================================================
// The scheduled path: scan → automation run → task.start_agent → agent run
// ===========================================================================

export async function checkScheduledAgentStarts(
  sql: Sql,
  base: string,
  ctx: LaneCtx,
  record: Recorder,
): Promise<void> {
  const { orgId, userId } = ctx;
  const fx = fixtures(sql, ctx);
  const { suffix } = fx;
  const projectA = randomUUID();
  const projectB = randomUUID();
  const manager = randomUUID();
  const worker = randomUUID();
  const parked = randomUUID();
  const outsider = randomUUID();
  const editor = `cycle-editor-${suffix}`;
  const name = `itest/cycle-${suffix}`;
  const hookName = `itest/cycle-hook-${suffix}`;
  const store = pgTaskStore(sql);
  const release = await holdAgentJobs(sql, suffix, [projectA, projectB]);

  const trigger = async () => {
    const rows = await sql<
      {
        id: string;
        enabled: boolean;
        lastRunId: string | null;
        consecutiveFailures: number;
        lastFailureCode: string | null;
      }[]
    >`
      SELECT id, enabled, last_run_id AS "lastRunId",
             consecutive_failures AS "consecutiveFailures",
             last_failure_code AS "lastFailureCode"
      FROM app.automation_triggers WHERE org_id = ${orgId} AND name = ${name}
    `;
    const row = rows[0];
    if (row === undefined) throw new Error(`itest: no trigger for ${name}`);
    return row;
  };
  const automationRuns = async (): Promise<number> => {
    const rows = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.automation_runs
      WHERE org_id = ${orgId} AND name = ${name}
    `;
    return rows[0]?.count ?? -1;
  };
  /** Move the schedule's cursor back so the current minute is due. */
  const backdate = (ms: number) => sql`
    UPDATE app.automation_triggers
    SET last_due_at_ms = ${Date.now() - ms}, last_fired_at_ms = NULL
    WHERE org_id = ${orgId} AND name = ${name}
  `;
  /** One occurrence: claim it, let the worker land its run, read it. */
  const fire = async (): Promise<{
    runId: string;
    status: string;
    output: Record<string, unknown> | null;
  }> => {
    const before = (await trigger()).lastRunId;
    const countBefore = await automationRuns();
    await backdate(120_000);
    await scanScheduledTriggers(sql);
    const countAfter = await automationRuns();
    const runs = await sql<{ id: string }[]>`
      SELECT id FROM app.automation_runs
      WHERE org_id = ${orgId} AND name = ${name}
      ORDER BY started_at_ms DESC, id DESC LIMIT 1
    `;
    const runId = runs[0]?.id ?? '';
    if (countAfter === countBefore || runId === '' || runId === before) {
      return { runId: '', status: 'not_fired', output: null };
    }
    await waitFor(async () => {
      const rows = await sql<{ status: string }[]>`
        SELECT status FROM app.automation_runs WHERE id = ${runId}
      `;
      return ['success', 'failed', 'cancelled'].includes(rows[0]?.status ?? '');
    }, WAIT_MS);
    const rows = await sql<{ status: string; output: unknown }[]>`
      SELECT status, output FROM app.automation_runs WHERE id = ${runId}
    `;
    const output = rows[0]?.output;
    return {
      runId,
      status: rows[0]?.status ?? 'missing',
      output: isRecord(output) ? output : null,
    };
  };

  try {
    await fx.insertUser(editor, 'editor');
    await fx.insertProject(projectA, 'Cycle project');
    await fx.insertProject(projectB, 'Neighbour project');
    await fx.insertAgent(manager, projectA, 'Fleet manager');
    await fx.insertAgent(worker, projectA, 'Implementer');
    await fx.insertAgent(parked, projectA, 'Parked implementer');
    await fx.insertAgent(outsider, projectB, 'Neighbour agent');
    const roleTask = await fx.insertTask({
      projectId: projectA,
      title: 'Autonomous cycle — manager',
      agentId: manager,
    });
    const reviewCard = await fx.insertTask({
      projectId: projectA,
      title: 'Waiting for its review',
      status: 'in_progress',
      agentId: parked,
    });
    const closedCard = await fx.insertTask({
      projectId: projectA,
      title: 'Called off',
      status: 'cancelled',
      agentId: parked,
    });
    const activation = await fx.insertTask({
      projectId: projectA,
      title: 'Activate the cycle',
      status: 'in_progress',
    });
    await fx.block(roleTask, activation, projectA);
    const implTask = await fx.insertTask({
      projectId: projectA,
      title: 'Implement a fix',
    });
    const foreignTask = await fx.insertTask({
      projectId: projectB,
      title: 'Neighbour work',
      agentId: outsider,
    });

    const document = {
      version: 1,
      name,
      nodes: [
        {
          id: 'slot',
          type: 'transform',
          input: { firedAt: '{{ input.firedAt }}' },
          code: [
            "const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(input.firedAt));",
            "const get = (type) => parts.find((part) => part.type === type)?.value ?? '';",
            "return { occurrence: `manager ${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} Europe/Zurich` };",
          ].join('\n'),
        },
        {
          id: 'start',
          type: 'task.start_agent',
          input: {
            taskId: roleTask,
            moveToInProgress: false,
            feedback:
              'Scheduled occurrence {{ nodes.slot.output.occurrence }}.',
          },
        },
      ],
      output: '{{ nodes.start.output }}',
    };
    await saveVersion(sql, {
      organizationId: orgId,
      name,
      document,
      actor: userId,
      projectId: projectA,
    });
    await deploy(sql, {
      organizationId: orgId,
      name,
      version: 1,
      actor: userId,
    });
    await setTrigger(sql, {
      organizationId: orgId,
      name,
      trigger: {
        kind: 'schedule',
        cron: '* * * * *',
        timezone: 'Europe/Zurich',
        enabled: true,
      },
      actor: userId,
    });
    const triggerId = (await trigger()).id;

    // ---- a role still blocked by its activation task starts nothing ----
    const blocked = await fire();
    const blockedRuns = await runsOf(sql, roleTask);
    record(
      'scheduled starts: an occurrence whose role task is still blocked starts nothing and says why',
      blocked.status === 'success' &&
        blocked.output?.started === false &&
        blocked.output.reason === 'blocked' &&
        JSON.stringify(blocked.output.blockedBy) ===
          JSON.stringify([activation]) &&
        blockedRuns.length === 0,
      `run=${blocked.status} output=${JSON.stringify(blocked.output)} agent runs=${describeRuns(blockedRuns)} (want success, started:false/blocked by the activation task, no agent run)`,
    );

    // ---- the activation closes: the next occurrence starts the agent ---
    await sql`UPDATE app.tasks SET status = 'done' WHERE id = ${activation}`;
    const first = await fire();
    const firstRuns = await runsOf(sql, roleTask);
    const x = firstRuns[0];
    const firstJobs =
      x === undefined ? { count: -1, held: -1 } : await turnJobsOf(sql, x.id);
    const roleAfter = await sql<{ status: string }[]>`
      SELECT status FROM app.tasks WHERE id = ${roleTask}
    `;
    const reviewsAfter = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.approvals
      WHERE resource_type = 'task_review' AND resource_id = ${roleTask}
    `;
    const ledger = await trigger();
    const automationRun = await sql<{ startedBy: string }[]>`
      SELECT started_by AS "startedBy" FROM app.automation_runs
      WHERE id = ${first.runId}
    `;
    record(
      'scheduled starts: the schedule-origin run starts the role task’s own project agent, in place, answering to the schedule',
      first.status === 'success' &&
        first.output?.started === true &&
        x !== undefined &&
        first.output.runId === x.id &&
        firstRuns.length === 1 &&
        x.status === 'queued' &&
        x.trigger === 'automation' &&
        x.agentId === manager &&
        x.startedBy === `trigger:${triggerId}` &&
        x.sessionId === `pa-${manager}` &&
        x.startedVia === 'automation' &&
        x.viaRunId === first.runId &&
        x.viaNodeId === 'start' &&
        x.viaAutomation === name &&
        /^Scheduled occurrence manager \d{4}-\d{2}-\d{2} \d{2}:\d{2} Europe\/Zurich\.$/.test(
          x.feedback ?? '',
        ) &&
        firstJobs.count === 1 &&
        firstJobs.held === 1 &&
        roleAfter[0]?.status === 'todo' &&
        reviewsAfter[0]?.count === 0 &&
        ledger.lastRunId === first.runId &&
        automationRun[0]?.startedBy === `trigger:${triggerId}`,
      `run=${first.status} output=${JSON.stringify(first.output)} agent runs=${describeRuns(firstRuns)} startedBy=${x?.startedBy} session=${x?.sessionId === `pa-${manager}` ? 'standing' : x?.sessionId} via=${x?.startedVia}/${x?.viaRunId === first.runId ? 'this run' : x?.viaRunId}/${x?.viaNodeId}/${x?.viaAutomation === name ? 'automation' : x?.viaAutomation} feedback=${JSON.stringify(x?.feedback)} turn jobs=${firstJobs.count}/${firstJobs.held} card=${roleAfter[0]?.status} reviews=${reviewsAfter[0]?.count} trigger lastRun=${ledger.lastRunId === first.runId ? 'this run' : ledger.lastRunId}`,
    );

    // ---- the task's run is visible, truthfully, on the app door ---------
    const listed = await fetch(
      `${base}/api/app/tasks/${roleTask}/agent-runs?orgId=${orgId}`,
      { headers: { cookie: ctx.cookie, origin: base } },
    );
    const listedBody: unknown = await listed.json().catch(() => null);
    const listedRuns: unknown[] =
      isRecord(listedBody) && Array.isArray(listedBody.runs)
        ? listedBody.runs
        : [];
    const listedRun = isRecord(listedRuns[0]) ? listedRuns[0] : undefined;
    record(
      'scheduled starts: the task’s run list names the automation run that started it',
      listed.status === 200 &&
        listedRun?.trigger === 'automation' &&
        listedRun.startedVia === 'automation' &&
        listedRun.startedViaRunId === first.runId &&
        listedRun.startedViaAutomation === name &&
        listedRun.startedBy === `trigger:${triggerId}`,
      `status=${listed.status} run=${JSON.stringify(listedRun)}`,
    );

    // ---- in place only under open work, on the connector's door ---------
    await sql.begin((tx) =>
      agentUpdateTaskStatusTrusted(tx, {
        organizationId: orgId,
        actorId: parked,
        taskId: reviewCard,
        status: 'in_review',
      }),
    );
    const stepOf = (nodeId: string) => ({
      kind: 'workflow' as const,
      runId: first.runId,
      nodeId,
    });
    const inPlaceReview = await store.startAgent({
      organizationId: orgId,
      caller: stepOf('in_place_review'),
      taskId: reviewCard,
      moveToInProgress: false,
    });
    const inPlaceClosed = await store.startAgent({
      organizationId: orgId,
      caller: stepOf('in_place_closed'),
      taskId: closedCard,
      moveToInProgress: false,
    });
    const reviewPending = await sql<{ status: string }[]>`
      SELECT status FROM app.approvals
      WHERE resource_type = 'task_review' AND resource_id = ${reviewCard}
    `;
    const cards = await sql<{ id: string; status: string }[]>`
      SELECT id, status FROM app.tasks WHERE id IN (${reviewCard}, ${closedCard})
    `;
    const cardStatus = (id: string) =>
      cards.find((card) => card.id === id)?.status;
    const parkedRuns = [
      ...(await runsOf(sql, reviewCard)),
      ...(await runsOf(sql, closedCard)),
    ];
    record(
      'scheduled starts: an in-place step (moveToInProgress false) under a card awaiting review or a closed one starts nothing and leaves the review and both cards as they were',
      !inPlaceReview.started &&
        inPlaceReview.reason === 'in_review' &&
        inPlaceReview.runId === null &&
        !inPlaceClosed.started &&
        inPlaceClosed.reason === 'closed' &&
        inPlaceClosed.taskStatus === 'cancelled' &&
        reviewPending.length === 1 &&
        reviewPending[0]?.status === 'pending' &&
        cardStatus(reviewCard) === 'in_review' &&
        cardStatus(closedCard) === 'cancelled' &&
        parkedRuns.length === 0,
      `review=${JSON.stringify(inPlaceReview)} closed=${JSON.stringify(inPlaceClosed)} reviews=${JSON.stringify(reviewPending)} cards=${cardStatus(reviewCard)}/${cardStatus(closedCard)} runs=${describeRuns(parkedRuns)}`,
    );
    const moved = await store.startAgent({
      organizationId: orgId,
      caller: stepOf('resume_review'),
      taskId: reviewCard,
    });
    const reviewAfterMove = await sql<
      { status: string; approvedBy: string | null; withdrawn: boolean | null }[]
    >`
      SELECT status, approved_by AS "approvedBy",
             (metadata ->> 'withdrawn')::boolean AS withdrawn
      FROM app.approvals
      WHERE resource_type = 'task_review' AND resource_id = ${reviewCard}
    `;
    const reviewCardAfter = await sql<{ status: string }[]>`
      SELECT status FROM app.tasks WHERE id = ${reviewCard}
    `;
    record(
      'scheduled starts: the default step on that card starts the agent, withdraws the pending review without approving it and moves the card to In progress',
      moved.started &&
        reviewAfterMove.length === 1 &&
        reviewAfterMove[0]?.status === 'rejected' &&
        reviewAfterMove[0].approvedBy === null &&
        reviewAfterMove[0].withdrawn === true &&
        reviewCardAfter[0]?.status === 'in_progress',
      `start=${JSON.stringify(moved)} reviews=${JSON.stringify(reviewAfterMove)} card=${reviewCardAfter[0]?.status}`,
    );

    // ---- a role still working: the next occurrence is coalesced --------
    const coalesced = await fire();
    const coalescedRuns = await runsOf(sql, roleTask);
    record(
      'scheduled starts: an occurrence that finds its role still working is coalesced onto the live run, not queued behind it',
      coalesced.status === 'success' &&
        coalesced.output?.started === false &&
        coalesced.output.reason === 'already_running' &&
        coalesced.output.runId === x?.id &&
        coalescedRuns.length === 1,
      `run=${coalesced.status} output=${JSON.stringify(coalesced.output)} agent runs=${describeRuns(coalescedRuns)} (want success, already_running on the live run, one agent run)`,
    );

    // ---- a step delivered again answers its first delivery's run --------
    const replayCaller = {
      kind: 'workflow' as const,
      runId: first.runId,
      nodeId: 'start',
    };
    if (x !== undefined) {
      await sql.begin((tx) =>
        cancelAgentRunInTx(tx, {
          organizationId: orgId,
          runId: x.id,
          taskId: roleTask,
        }),
      );
    }
    const replays = await Promise.all([
      store.startAgent({
        organizationId: orgId,
        caller: replayCaller,
        taskId: roleTask,
        moveToInProgress: false,
      }),
      store.startAgent({
        organizationId: orgId,
        caller: replayCaller,
        taskId: roleTask,
        moveToInProgress: false,
      }),
    ]);
    const replayRuns = await runsOf(sql, roleTask);
    record(
      'scheduled starts: a step delivered again (twice at once) answers the run its first delivery started — even once that run ended',
      replays.every(
        (answer) =>
          answer.started && answer.runId === x?.id && answer.replayed === true,
      ) &&
        replayRuns.length === 1 &&
        replayRuns[0]?.status === 'cancelled',
      `answers=${JSON.stringify(replays)} agent runs=${describeRuns(replayRuns)} (want the cancelled first run, replayed, no new run)`,
    );

    // ---- a cancelled run: the next occurrence starts afresh -------------
    const afterCancel = await fire();
    const afterCancelRuns = await runsOf(sql, roleTask);
    const y = afterCancelRuns[1];
    record(
      'scheduled starts: after a cancelled run the next occurrence starts a fresh one',
      afterCancel.status === 'success' &&
        afterCancel.output?.started === true &&
        y !== undefined &&
        afterCancel.output.runId === y.id &&
        y.status === 'queued' &&
        y.viaRunId === afterCancel.runId,
      `run=${afterCancel.status} output=${JSON.stringify(afterCancel.output)} agent runs=${describeRuns(afterCancelRuns)}`,
    );

    // ---- a failed in-place run is not retried; the next slot is --------
    const retrySkips: string[] = [];
    if (y !== undefined) {
      await failAgentRunFromTurn(sql, {
        runId: y.id,
        execId: y.execId,
        error: 'itest: the harness exited before the turn completed',
        failureCode: 'turn_crashed',
      });
      const jobs = await sql<{ data: unknown }[]>`
        SELECT data FROM pgboss.job
        WHERE name = 'task.agent_retry' AND data ->> 'expectedRunId' = ${y.id}
      `;
      const retry = createTaskList({ sql })['task.agent_retry'];
      const log = console.log;
      console.log = (...args: unknown[]) => {
        const match = /auto-retry skipped: (\S+)/.exec(
          args.map(String).join(' '),
        );
        if (match?.[1] !== undefined) retrySkips.push(match[1]);
        else log(...args);
      };
      try {
        for (const job of jobs) await retry?.(job.data);
      } finally {
        console.log = log;
      }
    }
    const afterFailRuns = await runsOf(sql, roleTask);
    const afterFail = await fire();
    const afterFailNext = await runsOf(sql, roleTask);
    const z = afterFailNext[2];
    record(
      'scheduled starts: a failed in-place run is not auto-retried (the card never left To do); the next occurrence starts the role again',
      afterFailRuns.length === 2 &&
        afterFailRuns[1]?.status === 'failed' &&
        retrySkips.join(',') === 'task_moved' &&
        afterFail.output?.started === true &&
        z !== undefined &&
        afterFail.output.runId === z.id,
      `runs after the failure=${describeRuns(afterFailRuns)} retry skips=${retrySkips.join(',') || 'none'} (want task_moved) next=${JSON.stringify(afterFail.output)} runs=${describeRuns(afterFailNext)}`,
    );

    // ---- the per-task circuit breaker ----------------------------------
    if (z !== undefined) {
      await sql.begin((tx) =>
        cancelAgentRunInTx(tx, {
          organizationId: orgId,
          runId: z.id,
          taskId: roleTask,
        }),
      );
    }
    const paused = await fire();
    const pausedRuns = await runsOf(sql, roleTask);
    const refusals = await sql<
      { actorType: string; actorId: string; toValue: string | null }[]
    >`
      SELECT actor_type AS "actorType", actor_id AS "actorId",
             to_value AS "toValue"
      FROM app.task_activity
      WHERE task_id = ${roleTask} AND action = 'agent_run.refused'
    `;
    record(
      `scheduled starts: a task that took ${AUTOMATED_STARTS_PER_TASK_PER_HOUR} automated starts within the hour refuses the next and says so on its timeline`,
      paused.status === 'success' &&
        paused.output?.started === false &&
        paused.output.reason === 'paused' &&
        typeof paused.output.retryAfter === 'number' &&
        pausedRuns.length === AUTOMATED_STARTS_PER_TASK_PER_HOUR &&
        refusals.length === 1 &&
        refusals[0]?.toValue === 'task_circuit_breaker' &&
        refusals[0].actorType === 'agent' &&
        refusals[0].actorId === manager,
      `run=${paused.status} output=${JSON.stringify(paused.output)} agent runs=${pausedRuns.length} refusals=${JSON.stringify(refusals)}`,
    );
    // The hour passes.
    await sql`
      UPDATE app.project_agent_runs
      SET started_at_ms = started_at_ms - 7200000
      WHERE task_id = ${roleTask}
    `;

    // ---- pause, then resume without replaying the missed minutes --------
    await setTrigger(sql, {
      organizationId: orgId,
      name,
      trigger: {
        kind: 'schedule',
        cron: '* * * * *',
        timezone: 'Europe/Zurich',
        enabled: false,
      },
      actor: userId,
    });
    const whilePaused = await fire();
    await setTrigger(sql, {
      organizationId: orgId,
      name,
      trigger: {
        kind: 'schedule',
        cron: '* * * * *',
        timezone: 'Europe/Zurich',
        enabled: true,
      },
      actor: userId,
    });
    const beforeResume = await automationRuns();
    // Thirty minutes of occurrences went by while it was paused.
    const resumedAt = Math.floor(Date.now() / 60_000) * 60_000;
    await backdate(30 * 60_000);
    await scanScheduledTriggers(sql);
    await scanScheduledTriggers(sql);
    const afterResume = await automationRuns();
    const resumedRunId = (await trigger()).lastRunId;
    // Every occurrence claimed after the resume is a minute that came due
    // then (the clock may have crossed one more minute between the scans),
    // never one of the thirty missed while paused.
    const resumedFires = await sql<{ firedAt: number }[]>`
      SELECT (input ->> 'firedAt')::float8 AS "firedAt"
      FROM app.automation_runs
      WHERE org_id = ${orgId} AND name = ${name}
      ORDER BY started_at_ms DESC
      LIMIT ${Math.max(afterResume - beforeResume, 0)}
    `;
    await waitFor(async () => {
      const rows = await sql<{ status: string }[]>`
        SELECT status FROM app.automation_runs WHERE id = ${resumedRunId ?? ''}
      `;
      return rows[0]?.status === 'success';
    }, WAIT_MS);
    const resumedRuns = await runsOf(sql, roleTask);
    const w = resumedRuns.at(-1);
    record(
      'scheduled starts: a paused schedule starts nothing; resumed, it fires its latest occurrence once and replays none of the thirty it missed',
      whilePaused.status === 'not_fired' &&
        afterResume >= beforeResume + 1 &&
        afterResume <= beforeResume + 2 &&
        resumedFires.every((claim) => claim.firedAt >= resumedAt) &&
        new Set(resumedFires.map((claim) => claim.firedAt)).size ===
          resumedFires.length &&
        w !== undefined &&
        w.viaRunId === resumedRunId &&
        w.status === 'queued',
      `paused fire=${whilePaused.status} (want not_fired), automation runs ${beforeResume}→${afterResume} (want +1, +2 only across a minute boundary) fired at=${JSON.stringify(resumedFires.map((claim) => claim.firedAt - resumedAt))} (want ≥ 0, distinct), newest agent run=${w?.status}/${w?.viaRunId === resumedRunId ? 'resumed occurrence' : w?.viaRunId}`,
    );

    // ---- revocation: unbinding the automation from the project ---------
    await sql`
      DELETE FROM app.automation_project_bindings
      WHERE org_id = ${orgId} AND automation_name = ${name}
    `;
    const confinedUnbound =
      w === undefined
        ? false
        : await isTaskRunConfined(sql, {
            organizationId: orgId,
            projectId: projectA,
            agentId: manager,
            sessionId: w.sessionId,
            startedBy: w.startedBy,
          });
    // W's turn job, held since its kick, is delivered now: a run whose
    // schedule lost the project before it launched fails without launching.
    const turn = createTaskList({ sql })['task.agent_turn'];
    const wJobs =
      w === undefined
        ? []
        : await sql<{ data: unknown }[]>`
            SELECT data FROM pgboss.job
            WHERE name = 'task.agent_turn' AND data ->> 'runId' = ${w.id}
          `;
    const warn = console.warn;
    const refusedTurns: string[] = [];
    console.warn = (...args: unknown[]) => {
      const line = args.map(String).join(' ');
      if (line.includes('its schedule may no longer act')) {
        refusedTurns.push(line);
      } else {
        warn(...args);
      }
    };
    try {
      for (const job of wJobs) await turn?.(job.data);
    } finally {
      console.warn = warn;
    }
    const wAfter =
      w === undefined
        ? []
        : (await runsOf(sql, roleTask)).filter((run) => run.id === w.id);
    const wError = await sql<
      { error: string | null; launchedAt: number | null }[]
    >`
      SELECT error, launched_at_ms::float8 AS "launchedAt"
      FROM app.project_agent_runs WHERE id = ${w?.id ?? ''}
    `;
    // Its provenance entry names no person: the schedule's door, as the
    // system's act, with the automation run that asked.
    const wLedger = await sql<
      { actorType: string; actorId: string; via: unknown }[]
    >`
      SELECT actor_type AS "actorType", actor_id AS "actorId",
             metadata -> 'startedVia' AS via
      FROM app.audit_logs
      WHERE org_id = ${orgId} AND resource_type = 'agent_run'
        AND resource_id = ${w?.id ?? ''}
    `;
    const wVia = isRecord(wLedger[0]?.via) ? wLedger[0]?.via : null;
    const unbound = await fire();
    const unboundRuns = await runsOf(sql, roleTask);
    const unboundLedger = await trigger();
    await sql`
      INSERT INTO app.automation_project_bindings (org_id, automation_name,
        project_id, bound_at_ms, bound_by)
      VALUES (${orgId}, ${name}, ${projectA}, ${Date.now()}, ${userId})
    `;
    const confinedRebound =
      w === undefined
        ? true
        : await isTaskRunConfined(sql, {
            organizationId: orgId,
            projectId: projectA,
            agentId: manager,
            sessionId: w.sessionId,
            startedBy: w.startedBy,
          });
    record(
      'scheduled starts: unbinding the automation revokes its schedule — a queued run fails at launch without launching, the next occurrence fails without starting anything, its failure counts, and the chain’s runs lose their authority until it is bound again',
      unbound.status === 'failed' &&
        unboundRuns.length === resumedRuns.length &&
        unboundLedger.consecutiveFailures === 1 &&
        unboundLedger.lastFailureCode === 'connector_error' &&
        wJobs.length === 1 &&
        refusedTurns.length === 1 &&
        wAfter[0]?.status === 'failed' &&
        wError[0]?.error === SCHEDULE_REVOKED_BEFORE_LAUNCH &&
        wError[0].launchedAt === null &&
        wLedger.length === 1 &&
        wLedger[0]?.actorType === 'system' &&
        wLedger[0].actorId === `trigger:${triggerId}` &&
        wVia?.kind === 'automation' &&
        wVia.runId === resumedRunId &&
        confinedUnbound &&
        !confinedRebound,
      `run=${unbound.status} agent runs ${resumedRuns.length}→${unboundRuns.length} streak=${unboundLedger.consecutiveFailures}/${unboundLedger.lastFailureCode} queued run at launch=${wAfter[0]?.status}/${JSON.stringify(wError[0])} ledger=${JSON.stringify(wLedger)} refused turns=${refusedTurns.length} confined unbound=${confinedUnbound} rebound=${confinedRebound}`,
    );

    // ---- a webhook-started run cannot start agents ----------------------
    await saveVersion(sql, {
      organizationId: orgId,
      name: hookName,
      document: { ...document, name: hookName },
      actor: userId,
      projectId: projectA,
    });
    await setTrigger(sql, {
      organizationId: orgId,
      name: hookName,
      trigger: { kind: 'webhook', enabled: true },
      actor: userId,
    });
    const hook = await sql<{ id: string }[]>`
      SELECT id FROM app.automation_triggers
      WHERE org_id = ${orgId} AND name = ${hookName}
    `;
    const insertRun = async (
      automation: string,
      startedBy: string,
    ): Promise<string> => {
      const rows = await sql<{ id: string }[]>`
        INSERT INTO app.automation_runs (org_id, name, version, project_id,
          status, mode, started_by, input, checkpoints, started_at_ms)
        VALUES (${orgId}, ${automation}, 1, ${projectA}, 'running', 'live',
          ${startedBy}, ${sql.json({})}, ${sql.json({ nodes: {}, executions: 0 })},
          ${Date.now()})
        RETURNING id
      `;
      return rows[0]?.id ?? '';
    };
    const hookRun = await insertRun(hookName, `trigger:${hook[0]?.id ?? ''}`);
    const hookRefusal = await store
      .startAgent({
        organizationId: orgId,
        caller: { kind: 'workflow', runId: hookRun, nodeId: 'start' },
        taskId: implTask,
        agentId: worker,
      })
      .then(
        () => 'started',
        (error: unknown) =>
          error instanceof Error ? error.message : String(error),
      );
    const hookRuns = await runsOf(sql, implTask);
    record(
      'scheduled starts: a run a webhook started cannot put an agent to work',
      /webhook or platform-event run cannot/.test(hookRefusal) &&
        hookRuns.length === 0,
      `answer=${hookRefusal} runs=${describeRuns(hookRuns)}`,
    );

    // ---- a person's run: answers to them while they may edit -----------
    const personRun = await insertRun(name, `user:${editor}`);
    const personStart = await store.startAgent({
      organizationId: orgId,
      caller: { kind: 'workflow', runId: personRun, nodeId: 'start' },
      taskId: implTask,
      agentId: worker,
    });
    const personRuns = await runsOf(sql, implTask);
    const implAfter = await sql<
      { status: string; assigneeId: string | null }[]
    >`
      SELECT status, assignee_id AS "assigneeId" FROM app.tasks
      WHERE id = ${implTask}
    `;
    const assignedBy = await sql<{ actorType: string; actorId: string }[]>`
      SELECT actor_type AS "actorType", actor_id AS "actorId"
      FROM app.task_activity
      WHERE task_id = ${implTask} AND action = 'assignee.changed'
    `;
    record(
      'scheduled starts: a person’s automation run assigns and starts the agent for that person, recording the automation as the actor',
      personStart.started &&
        personRuns.length === 1 &&
        personRuns[0]?.startedBy === editor &&
        personRuns[0].trigger === 'automation' &&
        implAfter[0]?.status === 'in_progress' &&
        implAfter[0].assigneeId === worker &&
        assignedBy[0]?.actorType === 'agent' &&
        assignedBy[0].actorId === 'workflow',
      `answer=${JSON.stringify(personStart)} runs=${describeRuns(personRuns)} startedBy=${personRuns[0]?.startedBy === editor ? 'the editor' : personRuns[0]?.startedBy} task=${JSON.stringify(implAfter[0])} assigned by=${JSON.stringify(assignedBy)}`,
    );
    if (personRuns[0] !== undefined) {
      const done = personRuns[0].id;
      await sql.begin((tx) =>
        cancelAgentRunInTx(tx, {
          organizationId: orgId,
          runId: done,
          taskId: implTask,
        }),
      );
    }
    await fx.setRole(editor, 'member');
    const demoted = await store
      .startAgent({
        organizationId: orgId,
        caller: { kind: 'workflow', runId: personRun, nodeId: 'again' },
        taskId: implTask,
      })
      .then(
        () => 'started',
        (error: unknown) =>
          error instanceof Error ? error.message : String(error),
      );
    await fx.setRole(editor, 'editor');
    const demotedRuns = await runsOf(sql, implTask);
    record(
      'scheduled starts: the person a run answers to losing the Editor role revokes its next start',
      /may no longer edit this project/.test(demoted) &&
        demotedRuns.length === 1,
      `answer=${demoted} runs=${describeRuns(demotedRuns)}`,
    );

    // ---- cross-project dispatch is refused, opaquely --------------------
    const crossTask = await store
      .startAgent({
        organizationId: orgId,
        caller: { kind: 'workflow', runId: personRun, nodeId: 'cross' },
        taskId: foreignTask,
      })
      .then(
        () => 'started',
        (error: unknown) =>
          error instanceof Error ? error.message : String(error),
      );
    const crossAgent = await store
      .startAgent({
        organizationId: orgId,
        caller: { kind: 'workflow', runId: personRun, nodeId: 'cross-agent' },
        taskId: implTask,
        agentId: outsider,
      })
      .then(
        () => 'started',
        (error: unknown) =>
          error instanceof Error ? error.message : String(error),
      );
    const foreignRuns = await runsOf(sql, foreignTask);
    const implRunsAfter = await runsOf(sql, implTask);
    record(
      'scheduled starts: a task or an agent of another project is out of reach, answered like a missing one',
      crossTask === 'Task not found' &&
        /No agent with that id works in this project/.test(crossAgent) &&
        foreignRuns.length === 0 &&
        implRunsAfter.length === 1,
      `other project's task=${crossTask} (want Task not found), other project's agent=${crossAgent} runs=${describeRuns(foreignRuns)}/${describeRuns(implRunsAfter)}`,
    );
  } finally {
    await release();
    await sql`
      DELETE FROM app.automation_triggers
      WHERE org_id = ${orgId} AND name IN (${name}, ${hookName})
    `;
    await sql`
      DELETE FROM app.automation_runs
      WHERE org_id = ${orgId} AND name IN (${name}, ${hookName})
    `;
    await sql`
      DELETE FROM app.automation_deployments
      WHERE org_id = ${orgId} AND name IN (${name}, ${hookName})
    `;
    await sql`
      DELETE FROM app.automation_project_bindings
      WHERE org_id = ${orgId} AND automation_name IN (${name}, ${hookName})
    `;
    await sql`
      DELETE FROM app.automations
      WHERE org_id = ${orgId} AND name IN (${name}, ${hookName})
    `;
    // Cascades to agents, tasks and runs.
    await sql`DELETE FROM app.projects WHERE id IN (${projectA}, ${projectB})`;
    await fx.teardownUsers();
  }
}

// ===========================================================================
// The delegation tool: a project agent's live run puts another to work
// ===========================================================================

export async function checkDelegatedAgentStartTool(
  sql: Sql,
  base: string,
  ctx: LaneCtx,
  record: Recorder,
): Promise<void> {
  const { orgId, userId } = ctx;
  const fx = fixtures(sql, ctx);
  const { suffix, now } = fx;
  const projectA = randomUUID();
  const projectB = randomUUID();
  const manager = randomUUID();
  const w1 = randomUUID();
  const w2 = randomUUID();
  const w3 = randomUUID();
  const w4 = randomUUID();
  const w5 = randomUUID();
  const w6 = randomUUID();
  const questionAgents = Array.from({ length: 10 }, () => randomUUID());
  const outsider = randomUUID();
  const editor = `delegate-editor-${suffix}`;
  const member = `delegate-member-${suffix}`;
  const scheduleName = `itest/delegate-${suffix}`;
  const release = await holdAgentJobs(sql, suffix, [projectA, projectB]);
  const tokens: string[] = [];

  /** A live run of `agentId` on `taskId`, in the standing workspace unless
   * a member session is named, and a token for its turn. */
  const liveRun = async (args: {
    agentId: string;
    taskId: string;
    startedBy: string;
    sessionId?: string;
    startedVia?: { runId: string; agentId: string };
  }): Promise<{ runId: string; token: string }> => {
    const execId = `exec-${randomUUID().slice(0, 12)}`;
    const sessionId = args.sessionId ?? `pa-${args.agentId}`;
    const rows = await sql<{ id: string }[]>`
      INSERT INTO app.project_agent_runs (
        org_id, project_id, task_id, agent_id, exec_id, session_id, status,
        harness, model, trigger, started_by, started_at_ms, launched_at_ms,
        deadline_at_ms, updated_at_ms, started_via, started_via_run_id,
        started_via_agent_id
      ) VALUES (
        ${orgId}, ${projectA}, ${args.taskId}, ${args.agentId}, ${execId},
        ${sessionId}, 'running', 'claude-code', 'itest-model',
        ${args.startedVia === undefined ? 'manual' : 'delegated'},
        ${args.startedBy}, ${Date.now() - 2_000}, ${Date.now() - 1_000},
        ${Date.now() + 3_600_000}, ${Date.now()},
        ${args.startedVia === undefined ? null : 'agent'},
        ${args.startedVia?.runId ?? null}, ${args.startedVia?.agentId ?? null}
      ) RETURNING id
    `;
    await sql`
      INSERT INTO app.sandbox_sessions (org_id, session_id, status,
        owner_type, owner_id, created_by, created_at_ms, expires_at_ms)
      VALUES (${orgId}, ${sessionId}, 'active', 'project_agent',
        ${args.agentId}, 'itest:delegate', ${now}, ${now + 3_600_000})
      ON CONFLICT DO NOTHING
    `;
    const token = `itest-delegate-${randomUUID()}`;
    tokens.push(token);
    await insertSessionToken(sql, {
      organizationId: orgId,
      sessionId,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      scope: {
        agentKind: 'claude-code',
        allowedModels: [],
        connectorGrants: [],
        budgetCents: 100,
        toolGrants: ['task_start_agent', 'task_comment', 'task_update_status'],
        taskRun: { execId },
      },
      ttlMs: 600_000,
    });
    return { runId: rows[0]?.id ?? '', token };
  };
  const dispatch = async (
    token: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const res = await fetch(`${base}/api/tools/execute`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ tool, args }),
    });
    const body: unknown = await res.json().catch(() => null);
    return isRecord(body) ? body : { status: 'PARSE_ERROR' };
  };
  const outputOf = (
    result: Record<string, unknown>,
  ): Record<string, unknown> => (isRecord(result.output) ? result.output : {});

  try {
    await fx.insertUser(editor, 'editor');
    await fx.insertUser(member, 'member');
    await fx.insertProject(projectA, 'Delegation project');
    await fx.insertProject(projectB, 'Neighbour project');
    await fx.insertAgent(manager, projectA, 'Fleet manager');
    await fx.insertAgent(w1, projectA, 'Implementer one');
    await fx.insertAgent(w2, projectA, 'Implementer two');
    await fx.insertAgent(w3, projectA, 'Implementer three');
    await fx.insertAgent(w4, projectA, 'Standing reporter');
    await fx.insertAgent(w5, projectA, 'Retrying implementer');
    await fx.insertAgent(w6, projectA, 'Person-started implementer');
    for (const [index, agent] of questionAgents.entries()) {
      await fx.insertAgent(agent, projectA, `Asking implementer ${index + 1}`);
    }
    await fx.insertAgent(outsider, projectB, 'Neighbour agent');
    const roleTask = await fx.insertTask({
      projectId: projectA,
      title: 'Manager role',
      agentId: manager,
    });
    const impl1 = await fx.insertTask({ projectId: projectA, title: 'Impl 1' });
    const impl2 = await fx.insertTask({
      projectId: projectA,
      title: 'Impl 2',
      agentId: w1,
    });
    const blockerTask = await fx.insertTask({
      projectId: projectA,
      title: 'Prerequisite',
    });
    const blockedTask = await fx.insertTask({
      projectId: projectA,
      title: 'Waits for the prerequisite',
      agentId: w2,
    });
    await fx.block(blockedTask, blockerTask, projectA);
    const reviewTask = await fx.insertTask({
      projectId: projectA,
      title: 'Parked with a question',
      status: 'in_progress',
      agentId: w2,
    });
    const standingTask = await fx.insertTask({
      projectId: projectA,
      title: 'Standing report',
      agentId: w4,
    });
    const closedTask = await fx.insertTask({
      projectId: projectA,
      title: 'Shipped already',
      status: 'done',
      agentId: w4,
    });
    const retryTask = await fx.insertTask({
      projectId: projectA,
      title: 'Keeps failing',
    });
    const personTask = await fx.insertTask({
      projectId: projectA,
      title: 'Restarted by agents, then by a person',
    });
    const race1 = await fx.insertTask({
      projectId: projectA,
      title: 'Race 1',
      agentId: w3,
    });
    const race2 = await fx.insertTask({
      projectId: projectA,
      title: 'Race 2',
      agentId: w3,
    });
    const foreignTask = await fx.insertTask({
      projectId: projectB,
      title: 'Neighbour work',
      agentId: outsider,
    });

    // The manager's live run, started by an editor.
    const managerRun = await liveRun({
      agentId: manager,
      taskId: roleTask,
      startedBy: editor,
    });

    // ---- an authorized delegation: assign, start, move, answer ---------
    const answer =
      'Answer from the manager: keep the retry budget in task_auto_retry.ts; see the repo contract.';
    const started = await dispatch(managerRun.token, 'task_start_agent', {
      taskId: impl1,
      agentId: w1,
      feedback: answer,
    });
    const startedOut = outputOf(started);
    const d1Runs = await runsOf(sql, impl1);
    const d1 = d1Runs[0];
    const d1Jobs =
      d1 === undefined ? { count: -1, held: -1 } : await turnJobsOf(sql, d1.id);
    const impl1Row = await sql<{ status: string; assigneeId: string | null }[]>`
      SELECT status, assignee_id AS "assigneeId" FROM app.tasks WHERE id = ${impl1}
    `;
    const impl1Activity = await sql<
      { action: string; actorType: string; actorId: string }[]
    >`
      SELECT action, actor_type AS "actorType", actor_id AS "actorId"
      FROM app.task_activity WHERE task_id = ${impl1} ORDER BY id
    `;
    record(
      'delegation: a granted manager run assigns another agent of its project and starts it, as the agent, for the person its run answers to',
      started.status === 'ok' &&
        startedOut.started === true &&
        d1 !== undefined &&
        startedOut.runId === d1.id &&
        d1.trigger === 'delegated' &&
        d1.agentId === w1 &&
        d1.startedBy === editor &&
        d1.startedVia === 'agent' &&
        d1.viaRunId === managerRun.runId &&
        d1.viaAgentId === manager &&
        d1.feedback === answer &&
        d1.sessionId === `pa-${w1}` &&
        d1Jobs.held === 1 &&
        impl1Row[0]?.status === 'in_progress' &&
        impl1Row[0].assigneeId === w1 &&
        impl1Activity.some(
          (row) =>
            row.action === 'assignee.changed' &&
            row.actorType === 'agent' &&
            row.actorId === manager,
        ) &&
        impl1Activity.some(
          (row) =>
            row.action === 'status.changed' &&
            row.actorType === 'agent' &&
            row.actorId === manager,
        ) &&
        impl1Activity.every((row) => row.actorType === 'agent'),
      `result=${JSON.stringify(started)} run=${JSON.stringify(d1)} jobs=${JSON.stringify(d1Jobs)} task=${JSON.stringify(impl1Row[0])} activity=${JSON.stringify(impl1Activity)}`,
    );

    // ---- the answer stays the agent's -----------------------------------
    const commented = await dispatch(managerRun.token, 'task_comment', {
      taskId: impl1,
      body: answer,
    });
    const authors = await sql<{ authorType: string; authorId: string }[]>`
      SELECT author_type AS "authorType", author_id AS "authorId"
      FROM app.task_discussion_message_meta WHERE task_id = ${impl1}
    `;
    const impl1RunsAfterComment = await runsOf(sql, impl1);
    record(
      'delegation: the manager’s answer is recorded as the agent’s — its comment and the started run’s message name the agent, and the comment starts nothing',
      commented.status === 'ok' &&
        authors.length === 1 &&
        authors[0]?.authorType === 'agent' &&
        authors[0].authorId === manager &&
        impl1RunsAfterComment.length === 1,
      `comment=${JSON.stringify(commented)} authors=${JSON.stringify(authors)} runs=${describeRuns(impl1RunsAfterComment)}`,
    );

    // ---- one active piece of work per agent workspace -------------------
    const busy = await dispatch(managerRun.token, 'task_start_agent', {
      taskId: impl2,
    });
    const busyOut = outputOf(busy);
    record(
      'delegation: an agent already working another task is not started again; the answer names the task it is on',
      busy.status === 'ok' &&
        busyOut.started === false &&
        busyOut.reason === 'agent_busy' &&
        busyOut.busyTaskId === impl1 &&
        (await runsOf(sql, impl2)).length === 0,
      `result=${JSON.stringify(busy)}`,
    );

    // ---- dependencies are checked --------------------------------------
    const blockedResult = await dispatch(managerRun.token, 'task_start_agent', {
      taskId: blockedTask,
    });
    const blockedOut = outputOf(blockedResult);
    record(
      'delegation: a task an open task blocks is not started',
      blockedResult.status === 'ok' &&
        blockedOut.started === false &&
        blockedOut.reason === 'blocked' &&
        JSON.stringify(blockedOut.blockedBy) ===
          JSON.stringify([blockerTask]) &&
        (await runsOf(sql, blockedTask)).length === 0,
      `result=${JSON.stringify(blockedResult)}`,
    );

    // ---- cross-project dispatch is refused ------------------------------
    const crossTask = await dispatch(managerRun.token, 'task_start_agent', {
      taskId: foreignTask,
    });
    const crossAgent = await dispatch(managerRun.token, 'task_start_agent', {
      taskId: blockerTask,
      agentId: outsider,
    });
    record(
      'delegation: another project’s task, or another project’s agent, is out of reach',
      crossTask.status === 'not_found' &&
        crossAgent.status === 'not_found' &&
        (await runsOf(sql, foreignTask)).length === 0 &&
        (await runsOf(sql, blockerTask)).length === 0,
      `task=${JSON.stringify(crossTask)} agent=${JSON.stringify(crossAgent)}`,
    );

    // ---- an agent another agent started cannot delegate in turn --------
    const d1Token = await (async () => {
      if (d1 === undefined) return '';
      const token = `itest-delegate-${randomUUID()}`;
      tokens.push(token);
      await sql`
        INSERT INTO app.sandbox_sessions (org_id, session_id, status,
          owner_type, owner_id, created_by, created_at_ms, expires_at_ms)
        VALUES (${orgId}, ${d1.sessionId}, 'active', 'project_agent', ${w1},
          'itest:delegate', ${now}, ${now + 3_600_000})
        ON CONFLICT DO NOTHING
      `;
      await insertSessionToken(sql, {
        organizationId: orgId,
        sessionId: d1.sessionId,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        scope: {
          agentKind: 'claude-code',
          allowedModels: [],
          connectorGrants: [],
          budgetCents: 100,
          toolGrants: ['task_start_agent'],
          taskRun: { execId: d1.execId },
        },
        ttlMs: 600_000,
      });
      // The run launched: queued → running.
      await sql`UPDATE app.project_agent_runs SET status = 'running' WHERE id = ${d1.id}`;
      return token;
    })();
    const chained = await dispatch(d1Token, 'task_start_agent', {
      taskId: race1,
    });
    record(
      'delegation: an agent another agent started cannot put further agents to work',
      chained.status === 'invalid_args' &&
        /AGENT_START_FORBIDDEN: An agent another agent started cannot put further agents to work/.test(
          String(chained.message),
        ) &&
        (await runsOf(sql, race1)).length === 0,
      `result=${JSON.stringify(chained)}`,
    );

    // ---- a pending review is withdrawn, never approved ------------------
    await sql.begin((tx) =>
      agentUpdateTaskStatusTrusted(tx, {
        organizationId: orgId,
        actorId: w2,
        taskId: reviewTask,
        status: 'in_review',
      }),
    );
    // In place (moveToInProgress false) under a card awaiting review:
    // nothing starts, and the review and the card stay as they were.
    const inPlace = await dispatch(managerRun.token, 'task_start_agent', {
      taskId: reviewTask,
      moveToInProgress: false,
      feedback: 'Answer from the manager: yes, keep the German label.',
    });
    const inPlaceReviews = await sql<{ status: string }[]>`
      SELECT status FROM app.approvals
      WHERE resource_type = 'task_review' AND resource_id = ${reviewTask}
    `;
    const inPlaceTask = await sql<{ status: string }[]>`
      SELECT status FROM app.tasks WHERE id = ${reviewTask}
    `;
    const inPlaceRuns = await runsOf(sql, reviewTask);
    record(
      'delegation: an in-place start (moveToInProgress false) on a task awaiting review starts nothing and leaves its pending review and card untouched',
      inPlace.status === 'ok' &&
        outputOf(inPlace).started === false &&
        outputOf(inPlace).reason === 'in_review' &&
        typeof outputOf(inPlace).guidance === 'string' &&
        inPlaceReviews.length === 1 &&
        inPlaceReviews[0]?.status === 'pending' &&
        inPlaceTask[0]?.status === 'in_review' &&
        inPlaceRuns.length === 0,
      `result=${JSON.stringify(inPlace)} reviews=${JSON.stringify(inPlaceReviews)} task=${inPlaceTask[0]?.status} runs=${describeRuns(inPlaceRuns)} (want in_review, the review still pending, the card at in_review, no run)`,
    );
    const resumed = await dispatch(managerRun.token, 'task_start_agent', {
      taskId: reviewTask,
      feedback: 'Answer from the manager: yes, keep the German label.',
    });
    const reviewRows = await sql<
      { status: string; approvedBy: string | null; withdrawn: boolean | null }[]
    >`
      SELECT status, approved_by AS "approvedBy",
             (metadata ->> 'withdrawn')::boolean AS withdrawn
      FROM app.approvals
      WHERE resource_type = 'task_review' AND resource_id = ${reviewTask}
    `;
    const reviewTaskRow = await sql<{ status: string }[]>`
      SELECT status FROM app.tasks WHERE id = ${reviewTask}
    `;
    const complete = await dispatch(managerRun.token, 'task_update_status', {
      taskId: reviewTask,
      status: 'done',
    });
    record(
      'delegation: resuming a task parked at In review withdraws its pending review without approving it, and an agent still cannot complete it',
      resumed.status === 'ok' &&
        outputOf(resumed).started === true &&
        reviewRows.length === 1 &&
        reviewRows[0]?.status === 'rejected' &&
        reviewRows[0].approvedBy === null &&
        reviewRows[0].withdrawn === true &&
        reviewTaskRow[0]?.status === 'in_progress' &&
        complete.status === 'unavailable' &&
        JSON.stringify(complete).includes('AGENTS_CANNOT_COMPLETE'),
      `resume=${JSON.stringify(resumed)} reviews=${JSON.stringify(reviewRows)} task=${reviewTaskRow[0]?.status} done=${JSON.stringify(complete)}`,
    );

    // ---- in place only under open work: closed refused, To do kept -------
    const closedStart = await dispatch(managerRun.token, 'task_start_agent', {
      taskId: closedTask,
      moveToInProgress: false,
    });
    const closedRow = await sql<{ status: string }[]>`
      SELECT status FROM app.tasks WHERE id = ${closedTask}
    `;
    const closedRuns = await runsOf(sql, closedTask);
    const standing = await dispatch(managerRun.token, 'task_start_agent', {
      taskId: standingTask,
      moveToInProgress: false,
    });
    const standingRow = await sql<{ status: string }[]>`
      SELECT status FROM app.tasks WHERE id = ${standingTask}
    `;
    const standingRuns = await runsOf(sql, standingTask);
    const standingReviews = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.approvals
      WHERE resource_type = 'task_review' AND resource_id = ${standingTask}
    `;
    record(
      'delegation: an in-place start never works under a Done card (closed, nothing started), and still starts a To do standing task in place without a review',
      closedStart.status === 'ok' &&
        outputOf(closedStart).started === false &&
        outputOf(closedStart).reason === 'closed' &&
        outputOf(closedStart).taskStatus === 'done' &&
        closedRow[0]?.status === 'done' &&
        closedRuns.length === 0 &&
        standing.status === 'ok' &&
        outputOf(standing).started === true &&
        standingRuns.length === 1 &&
        standingRuns[0]?.trigger === 'delegated' &&
        standingRow[0]?.status === 'todo' &&
        standingReviews[0]?.count === 0,
      `closed=${JSON.stringify(closedStart)} card=${closedRow[0]?.status} runs=${describeRuns(closedRuns)} standing=${JSON.stringify(standing)} card=${standingRow[0]?.status} runs=${describeRuns(standingRuns)} reviews=${standingReviews[0]?.count}`,
    );

    // ---- the hourly budget counts automatic retries, a person's never ------
    // A delegated start, then each failure's actual queued retry payload
    // through the real retry worker (turns held inert): the retries inherit
    // `started_via`, so the third automated start fills the hour's budget
    // and the retry that would be the fourth is refused, as is the manager's
    // next restart. A person's Start in that hour, and its retry, are not.
    const retrySkips: string[] = [];
    const failAndRetry = (taskId: string): Promise<void> =>
      failNewestRunAndRetry(sql, taskId, retrySkips);
    const budgetStart = await dispatch(managerRun.token, 'task_start_agent', {
      taskId: retryTask,
      agentId: w5,
    });
    for (let failure = 0; failure < 3; failure++) await failAndRetry(retryTask);
    const budgetRuns = await runsOf(sql, retryTask);
    const budgetRefusals = await sql<
      { actorId: string; toValue: string | null }[]
    >`
      SELECT actor_id AS "actorId", to_value AS "toValue"
      FROM app.task_activity
      WHERE task_id = ${retryTask} AND action = 'agent_run.refused'
    `;
    record(
      `delegation: a delegated chain's automatic retries count against the hourly budget — after ${AUTOMATED_STARTS_PER_TASK_PER_HOUR} automated starts the next retry is refused, nothing is kicked, and the timeline says why`,
      outputOf(budgetStart).started === true &&
        describeRuns(budgetRuns) ===
          'failed/delegated,failed/auto_retry,failed/auto_retry' &&
        budgetRuns.every((run) => run.startedVia === 'agent') &&
        retrySkips.join(',') === 'task_circuit_breaker' &&
        budgetRefusals.length === 1 &&
        budgetRefusals[0]?.actorId === w5 &&
        budgetRefusals[0].toValue === 'task_circuit_breaker',
      `start=${JSON.stringify(budgetStart)} runs=${describeRuns(budgetRuns)} via=${budgetRuns.map((run) => run.startedVia).join(',')} skips=${retrySkips.join(',')} budgetRefusals=${JSON.stringify(budgetRefusals)}`,
    );
    const budgetRestart = await dispatch(managerRun.token, 'task_start_agent', {
      taskId: retryTask,
    });
    const budgetAfterRestart = await runsOf(sql, retryTask);
    record(
      "delegation: the manager's next restart in that hour answers paused and starts no further run",
      budgetRestart.status === 'ok' &&
        outputOf(budgetRestart).started === false &&
        outputOf(budgetRestart).reason === 'paused' &&
        typeof outputOf(budgetRestart).retryAfter === 'number' &&
        budgetAfterRestart.length === 3,
      `restart=${JSON.stringify(budgetRestart)} runs=${describeRuns(budgetAfterRestart)}`,
    );
    // A person's work in a full hour: three delegated starts of another task
    // (each cancelled, so no failure streak builds) fill its budget and the
    // manager's fourth is paused; a person's Start still runs, and when it
    // fails its retry is still kicked.
    const personRefusedBefore: string[] = [];
    const skipsBeforePerson = retrySkips.length;
    for (let start = 0; start < AUTOMATED_STARTS_PER_TASK_PER_HOUR; start++) {
      const delegated = await dispatch(managerRun.token, 'task_start_agent', {
        taskId: personTask,
        agentId: w6,
      });
      if (outputOf(delegated).started !== true) {
        personRefusedBefore.push(JSON.stringify(delegated));
      }
      const live = (await runsOf(sql, personTask)).at(-1);
      if (live !== undefined) {
        await sql.begin((tx) =>
          cancelAgentRunInTx(tx, {
            organizationId: orgId,
            runId: live.id,
            taskId: personTask,
          }),
        );
      }
    }
    const fourth = await dispatch(managerRun.token, 'task_start_agent', {
      taskId: personTask,
    });
    const personBudgetStart = await fetch(
      `${base}/api/app/tasks/${personTask}/agent-runs/start?orgId=${orgId}`,
      {
        method: 'POST',
        headers: { cookie: ctx.cookie, origin: base },
      },
    );
    const personBudgetBody: unknown = await personBudgetStart
      .json()
      .catch(() => null);
    await failAndRetry(personTask);
    const budgetWithPerson = await runsOf(sql, personTask);
    record(
      "delegation: in an hour whose automated budget is spent, a person's Start still starts the agent, and its automatic retry is still kicked — neither is counted or refused",
      personRefusedBefore.length === 0 &&
        outputOf(fourth).reason === 'paused' &&
        personBudgetStart.status === 200 &&
        isRecord(personBudgetBody) &&
        personBudgetBody.started === true &&
        describeRuns(budgetWithPerson) ===
          'cancelled/delegated,cancelled/delegated,cancelled/delegated,failed/manual,queued/auto_retry' &&
        budgetWithPerson[3]?.startedVia === null &&
        budgetWithPerson[4]?.startedVia === null &&
        retrySkips.length === skipsBeforePerson,
      `refused before=${JSON.stringify(personRefusedBefore)} fourth=${JSON.stringify(fourth)} person=${personBudgetStart.status} ${JSON.stringify(personBudgetBody)} runs=${describeRuns(budgetWithPerson)} new skips=${retrySkips.slice(skipsBeforePerson).join(',') || 'none'}`,
    );

    // ---- a resumption answers the open question, or changes nothing ------
    // The manager answers an agent's question by resuming it with
    // `resumeFrom: {runId, approvalId}` — the run that asked and the review it
    // waits at, as the manager read them. Under the task's row lock, before
    // any write, the start requires that question to still be the open one.
    const personAuth = await getProjectAuthContext(sql, {
      organizationId: orgId,
      userId: editor,
      role: 'editor',
    });
    const asAgent = (index: number): string => questionAgents[index] ?? '';
    /** Delegate the task to the agent, complete its run with a question
     * through the real completion path: the card waits at In review with
     * the review bound to that run. */
    const parkWithQuestion = async (
      taskId: string,
      agentId: string,
    ): Promise<{ runId: string; approvalId: string }> => {
      await dispatch(managerRun.token, 'task_start_agent', { taskId, agentId });
      const asked = (await runsOf(sql, taskId)).at(-1);
      if (asked !== undefined) {
        await transactSerializable(sql, (tx) =>
          completeAgentRunInTx(tx, {
            organizationId: orgId,
            taskId,
            agentId,
            execId: asked.execId,
            runId: asked.id,
            resultText: 'Question: which label should the export use?',
            body: 'Question: which label should the export use?',
            files: [],
          }),
        );
      }
      const reviews = await sql<{ id: string }[]>`
        SELECT id FROM app.approvals
        WHERE resource_type = 'task_review' AND resource_id = ${taskId}
          AND status = 'pending'
      `;
      return { runId: asked?.id ?? '', approvalId: reviews[0]?.id ?? '' };
    };
    const reviewStates = (taskId: string) => sql<
      { id: string; status: string; withdrawn: boolean | null }[]
    >`
      SELECT id, status, (metadata ->> 'withdrawn')::boolean AS withdrawn
      FROM app.approvals
      WHERE resource_type = 'task_review' AND resource_id = ${taskId}
      ORDER BY seq
    `;
    const cardStatus = async (taskId: string) =>
      (
        await sql<{ status: string }[]>`
          SELECT status FROM app.tasks WHERE id = ${taskId}
        `
      )[0]?.status;
    const labelAnswer = 'Answer from the manager: use the German label.';
    const resume = (
      taskId: string,
      from: { runId: string; approvalId: string },
    ) =>
      dispatch(managerRun.token, 'task_start_agent', {
        taskId,
        feedback: labelAnswer,
        resumeFrom: from,
      });

    // A: the open question is answered once; a repeated call (a response the
    // manager lost) starts nothing more.
    const qa = await fx.insertTask({ projectId: projectA, title: 'Asks A' });
    const fromA = await parkWithQuestion(qa, asAgent(0));
    const resumedA = await resume(qa, fromA);
    const againA = await resume(qa, fromA);
    const runsA = await runsOf(sql, qa);
    const reviewsA = await reviewStates(qa);
    record(
      'resumption: an answer to the open question resumes the agent once — the review it waited at is withdrawn, never approved — and a repeated call after a lost response changes nothing',
      outputOf(resumedA).started === true &&
        runsA.length === 2 &&
        runsA[1]?.status === 'queued' &&
        runsA[1].feedback === labelAnswer &&
        (await cardStatus(qa)) === 'in_progress' &&
        reviewsA.length === 1 &&
        reviewsA[0]?.status === 'rejected' &&
        reviewsA[0].withdrawn === true &&
        outputOf(againA).started === false &&
        outputOf(againA).reason === 'stale_question' &&
        // The first call moved the card to In progress: the question it
        // answered is closed.
        outputOf(againA).staleBecause === 'task_moved',
      `from=${JSON.stringify(fromA)} resumed=${JSON.stringify(resumedA)} again=${JSON.stringify(againA)} runs=${describeRuns(runsA)} reviews=${JSON.stringify(reviewsA)}`,
    );

    // B, C: a person decided in between — Done, or Cancelled.
    const decided: Record<string, unknown> = {};
    for (const [index, status] of (['done', 'cancelled'] as const).entries()) {
      const task = await fx.insertTask({
        projectId: projectA,
        title: `Asks, then ${status}`,
      });
      const from = await parkWithQuestion(task, asAgent(1 + index));
      const reviewsBefore = await reviewStates(task);
      await sql.begin((tx) => updateTaskStatus(tx, personAuth, task, status));
      const reviewsDecided = await reviewStates(task);
      const late = await resume(task, from);
      decided[status] = {
        late: outputOf(late),
        card: await cardStatus(task),
        runs: describeRuns(await runsOf(sql, task)),
        reviewsBefore,
        reviewsDecided,
        reviewsAfter: await reviewStates(task),
      };
    }
    const decidedOk = (status: string, want: string): boolean => {
      const entry = decided[status];
      if (!isRecord(entry) || !isRecord(entry.late)) return false;
      return (
        entry.late.started === false &&
        entry.late.reason === 'stale_question' &&
        entry.late.staleBecause === 'task_moved' &&
        entry.card === want &&
        entry.runs === 'settled/delegated' &&
        JSON.stringify(entry.reviewsDecided) ===
          JSON.stringify(entry.reviewsAfter)
      );
    };
    record(
      'resumption: after a person moved the card to Done or Cancelled, a stale resumption answers stale_question and reopens nothing — no run, no card move, the person’s review decision kept',
      decidedOk('done', 'done') && decidedOk('cancelled', 'cancelled'),
      `decided=${JSON.stringify(decided)}`,
    );

    // D: a newer run and review exist — the stale resumption must not
    // withdraw the newer review.
    const qd = await fx.insertTask({
      projectId: projectA,
      title: 'Asks twice',
    });
    const fromD = await parkWithQuestion(qd, asAgent(3));
    const personRestart = await fetch(
      `${base}/api/app/tasks/${qd}/agent-runs/start?orgId=${orgId}`,
      { method: 'POST', headers: { cookie: ctx.cookie, origin: base } },
    );
    const restarted = (await runsOf(sql, qd)).at(-1);
    if (restarted !== undefined && restarted.id !== fromD.runId) {
      await transactSerializable(sql, (tx) =>
        completeAgentRunInTx(tx, {
          organizationId: orgId,
          taskId: qd,
          agentId: asAgent(3),
          execId: restarted.execId,
          runId: restarted.id,
          resultText: 'Question: and the date format?',
          body: 'Question: and the date format?',
          files: [],
        }),
      );
    }
    const reviewsNewer = await reviewStates(qd);
    const lateD = await resume(qd, fromD);
    const reviewsAfterD = await reviewStates(qd);
    const runsD = await runsOf(sql, qd);
    record(
      'resumption: once a newer run asked again and a newer review waits, a resumption of the older question answers stale_question and leaves the newer review pending',
      personRestart.status === 200 &&
        reviewsNewer.at(-1)?.status === 'pending' &&
        outputOf(lateD).started === false &&
        outputOf(lateD).reason === 'stale_question' &&
        outputOf(lateD).staleBecause === 'run_superseded' &&
        JSON.stringify(reviewsAfterD) === JSON.stringify(reviewsNewer) &&
        runsD.length === 2 &&
        (await cardStatus(qd)) === 'in_review',
      `restart=${personRestart.status} late=${JSON.stringify(lateD)} reviews=${JSON.stringify(reviewsAfterD)} runs=${describeRuns(runsD)}`,
    );

    // E: the assignee changed in between.
    const qe = await fx.insertTask({
      projectId: projectA,
      title: 'Asks, reassigned',
    });
    const fromE = await parkWithQuestion(qe, asAgent(4));
    await sql.begin((tx) =>
      assignTask(tx, personAuth, {
        taskId: qe,
        assigneeType: 'agent',
        assigneeId: asAgent(5),
      }),
    );
    const reviewsBeforeE = await reviewStates(qe);
    const lateE = await resume(qe, fromE);
    const runsE = await runsOf(sql, qe);
    record(
      'resumption: after a person reassigned the task, a resumption of the old question answers stale_question — nothing assigned, started, withdrawn or moved',
      outputOf(lateE).started === false &&
        outputOf(lateE).reason === 'stale_question' &&
        outputOf(lateE).staleBecause === 'assignee_changed' &&
        runsE.length === 1 &&
        (await cardStatus(qe)) === 'in_review' &&
        JSON.stringify(await reviewStates(qe)) ===
          JSON.stringify(reviewsBeforeE),
      `late=${JSON.stringify(lateE)} runs=${describeRuns(runsE)} reviews=${JSON.stringify(reviewsBeforeE)}`,
    );

    // G, H: handed to a person, or to nobody, in between. A resumption that
    // names no agent resumes the agent that asked, so the guard answers that
    // the assignee changed, as it does for one naming that agent.
    const handedOff: Record<string, unknown> = {};
    const handedTasks: Record<string, string> = {};
    for (const [index, to] of (['person', 'nobody'] as const).entries()) {
      const asked = asAgent(7 + index);
      const task = await fx.insertTask({
        projectId: projectA,
        title: `Asks, handed to ${to}`,
      });
      handedTasks[to] = task;
      const from = await parkWithQuestion(task, asked);
      await sql.begin((tx) =>
        assignTask(
          tx,
          personAuth,
          to === 'person'
            ? { taskId: task, assigneeType: 'user', assigneeId: editor }
            : { taskId: task },
        ),
      );
      const reviewsBefore = await reviewStates(task);
      const late = await resume(task, from);
      const named = await dispatch(managerRun.token, 'task_start_agent', {
        taskId: task,
        agentId: asked,
        feedback: labelAnswer,
        resumeFrom: from,
      });
      const holders = await sql<{ type: string | null; id: string | null }[]>`
        SELECT assignee_type AS type, assignee_id AS id FROM app.tasks
        WHERE id = ${task}
      `;
      handedOff[to] = {
        late: outputOf(late),
        named: outputOf(named),
        asked,
        card: await cardStatus(task),
        runs: describeRuns(await runsOf(sql, task)),
        holder: holders[0],
        reviewsKept:
          JSON.stringify(await reviewStates(task)) ===
          JSON.stringify(reviewsBefore),
      };
    }
    const handedOk = (
      to: string,
      holder: { type: string | null; id: string | null },
    ): boolean => {
      const entry = handedOff[to];
      if (!isRecord(entry) || !isRecord(entry.late) || !isRecord(entry.named)) {
        return false;
      }
      return (
        entry.late.started === false &&
        entry.late.reason === 'stale_question' &&
        entry.late.staleBecause === 'assignee_changed' &&
        entry.late.agentId === entry.asked &&
        entry.named.started === false &&
        entry.named.reason === 'stale_question' &&
        entry.named.staleBecause === 'assignee_changed' &&
        entry.card === 'in_review' &&
        entry.runs === 'settled/delegated' &&
        JSON.stringify(entry.holder) === JSON.stringify(holder) &&
        entry.reviewsKept === true
      );
    };
    record(
      'resumption: after a person handed the task to a person or to nobody, a resumption that names no agent answers stale_question (assignee_changed) for the agent that asked, as one naming that agent does — nothing assigned, started, withdrawn or moved',
      handedOk('person', { type: 'user', id: editor }) &&
        handedOk('nobody', { type: null, id: null }),
      `handed=${JSON.stringify(handedOff)}`,
    );

    // I: the agent that asked was deleted in between (which unassigns its
    // tasks), or the run named is not the task's: nobody to resume.
    const asker = asAgent(9);
    const qi = await fx.insertTask({
      projectId: projectA,
      title: 'Asks, then its agent is deleted',
    });
    const fromI = await parkWithQuestion(qi, asker);
    await sql.begin((tx) => deleteProjectAgent(tx, personAuth, asker));
    const reviewsBeforeI = await reviewStates(qi);
    const lateI = await resume(qi, fromI);
    const handedToPerson = handedTasks.person ?? '';
    const reviewsBeforeForeign = await reviewStates(handedToPerson);
    const foreign = await resume(handedToPerson, {
      runId: fromA.runId,
      approvalId: reviewsBeforeForeign.at(-1)?.id ?? '',
    });
    record(
      'resumption: once the agent that asked is deleted, or when the run named is not the task’s, a resumption that names no agent answers stale_question — with the deleted agent, or no agent, as the one it would have resumed — and changes nothing',
      outputOf(lateI).started === false &&
        outputOf(lateI).reason === 'stale_question' &&
        outputOf(lateI).staleBecause === 'assignee_changed' &&
        outputOf(lateI).agentId === asker &&
        (await cardStatus(qi)) === 'in_review' &&
        describeRuns(await runsOf(sql, qi)) === 'settled/delegated' &&
        JSON.stringify(await reviewStates(qi)) ===
          JSON.stringify(reviewsBeforeI) &&
        outputOf(foreign).started === false &&
        outputOf(foreign).reason === 'stale_question' &&
        outputOf(foreign).staleBecause === 'run_superseded' &&
        outputOf(foreign).agentId === null &&
        (await cardStatus(handedToPerson)) === 'in_review' &&
        describeRuns(await runsOf(sql, handedToPerson)) ===
          'settled/delegated' &&
        JSON.stringify(await reviewStates(handedToPerson)) ===
          JSON.stringify(reviewsBeforeForeign),
      `deleted=${JSON.stringify(lateI)} foreign=${JSON.stringify(foreign)}`,
    );

    // F: two transactions — a person's Done holds the task row while the
    // resumption arrives; the resumption waits, then sees the decision.
    const qf = await fx.insertTask({
      projectId: projectA,
      title: 'Asks, decided meanwhile',
    });
    const fromF = await parkWithQuestion(qf, asAgent(6));
    let resumeF: Promise<Record<string, unknown>> | undefined;
    let waited = false;
    await sql.begin(async (tx) => {
      await tx`SELECT id FROM app.tasks WHERE id = ${qf} FOR UPDATE`;
      resumeF = resume(qf, fromF);
      waited = await waitFor(async () => {
        const rows = await sql<{ count: number }[]>`
          SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
        `;
        return (rows[0]?.count ?? 0) > 0;
      }, 15_000);
      await updateTaskStatus(tx, personAuth, qf, 'done');
    });
    const lateF = resumeF === undefined ? {} : await resumeF;
    const runsF = await runsOf(sql, qf);
    record(
      'resumption: a resumption that arrives while a person’s Done holds the task waits for it, then answers stale_question — the decision is never undone',
      waited &&
        outputOf(lateF).started === false &&
        outputOf(lateF).reason === 'stale_question' &&
        outputOf(lateF).staleBecause === 'task_moved' &&
        runsF.length === 1 &&
        (await cardStatus(qf)) === 'done',
      `waited=${waited} late=${JSON.stringify(lateF)} runs=${describeRuns(runsF)} card=${await cardStatus(qf)}`,
    );

    // ---- two starts racing for one free agent start one run -------------
    const [raceA, raceB] = await Promise.all([
      dispatch(managerRun.token, 'task_start_agent', { taskId: race1 }),
      dispatch(managerRun.token, 'task_start_agent', { taskId: race2 }),
    ]);
    const raceRuns = [
      ...(await runsOf(sql, race1)),
      ...(await runsOf(sql, race2)),
    ];
    const raceOutcomes = [outputOf(raceA), outputOf(raceB)]
      .map((out) => (out.started === true ? 'started' : String(out.reason)))
      .sort();
    record(
      'delegation: two starts racing for one free agent start exactly one run; the other answers agent_busy',
      raceRuns.length === 1 &&
        JSON.stringify(raceOutcomes) ===
          JSON.stringify(['agent_busy', 'started']),
      `outcomes=${JSON.stringify(raceOutcomes)} runs=${describeRuns(raceRuns)} raw=${JSON.stringify([raceA, raceB])}`,
    );

    // ---- a member's confined run cannot delegate -------------------------
    const memberRun = await liveRun({
      agentId: manager,
      taskId: blockerTask,
      startedBy: member,
      sessionId: `pa-${manager}-m${suffix}`,
    });
    const confined = await dispatch(memberRun.token, 'task_start_agent', {
      taskId: impl2,
    });
    record(
      'delegation: a run a member started is confined and cannot put other agents to work',
      confined.status === 'unavailable' &&
        JSON.stringify(confined).includes('member_run'),
      `result=${JSON.stringify(confined)}`,
    );

    // ---- revocation: the person the chain answers to loses the role -----
    await fx.setRole(editor, 'member');
    const demoted = await dispatch(managerRun.token, 'task_start_agent', {
      taskId: impl2,
    });
    await fx.setRole(editor, 'editor');
    record(
      'delegation: once the person the manager’s run answers to may no longer edit the project, its run is confined and cannot start agents',
      demoted.status === 'unavailable' &&
        JSON.stringify(demoted).includes('member_run') &&
        (await runsOf(sql, impl2)).length === 0,
      `result=${JSON.stringify(demoted)}`,
    );

    // ---- a schedule's chain: paused schedule, no more delegations -------
    await saveVersion(sql, {
      organizationId: orgId,
      name: scheduleName,
      document: {
        version: 1,
        name: scheduleName,
        nodes: [{ id: 'noop', type: 'transform', code: 'return 1;' }],
        output: '{{ nodes.noop.output }}',
      },
      actor: userId,
      projectId: projectA,
    });
    await setTrigger(sql, {
      organizationId: orgId,
      name: scheduleName,
      trigger: {
        kind: 'schedule',
        cron: '0 3 * * *',
        timezone: 'Europe/Zurich',
        enabled: true,
      },
      actor: userId,
    });
    const scheduleTrigger = await sql<{ id: string }[]>`
      SELECT id FROM app.automation_triggers
      WHERE org_id = ${orgId} AND name = ${scheduleName}
    `;
    // Free agent w3 again for the schedule-chain checks.
    for (const run of raceRuns) {
      await sql.begin((tx) =>
        cancelAgentRunInTx(tx, {
          organizationId: orgId,
          runId: run.id,
          taskId: run.taskId,
        }),
      );
    }
    await sql.begin((tx) =>
      cancelAgentRunInTx(tx, {
        organizationId: orgId,
        runId: managerRun.runId,
        taskId: roleTask,
      }),
    );
    const scheduledManager = await liveRun({
      agentId: manager,
      taskId: roleTask,
      startedBy: `trigger:${scheduleTrigger[0]?.id ?? ''}`,
    });
    const chainStart = await dispatch(
      scheduledManager.token,
      'task_start_agent',
      {
        taskId: race1,
      },
    );
    const chainRuns = await runsOf(sql, race1);
    const chainRun = chainRuns.at(-1);
    if (chainRun !== undefined) {
      await sql.begin((tx) =>
        cancelAgentRunInTx(tx, {
          organizationId: orgId,
          runId: chainRun.id,
          taskId: race1,
        }),
      );
    }
    await setTrigger(sql, {
      organizationId: orgId,
      name: scheduleName,
      trigger: {
        kind: 'schedule',
        cron: '0 3 * * *',
        timezone: 'Europe/Zurich',
        enabled: false,
      },
      actor: userId,
    });
    const pausedChain = await dispatch(
      scheduledManager.token,
      'task_start_agent',
      {
        taskId: race2,
      },
    );
    record(
      'delegation: a schedule’s run delegates for the schedule while it is on, and pausing the schedule stops its chain from starting more',
      chainStart.status === 'ok' &&
        outputOf(chainStart).started === true &&
        chainRun?.startedBy === `trigger:${scheduleTrigger[0]?.id ?? ''}` &&
        chainRun.trigger === 'delegated' &&
        pausedChain.status === 'unavailable' &&
        JSON.stringify(pausedChain).includes('schedule_revoked') &&
        (await runsOf(sql, race2)).every((run) => run.status !== 'queued'),
      `start=${JSON.stringify(chainStart)} run=${chainRun?.startedBy}/${chainRun?.trigger} paused=${JSON.stringify(pausedChain)}`,
    );

    // ---- a run that ended acts for nobody ------------------------------
    await sql.begin((tx) =>
      cancelAgentRunInTx(tx, {
        organizationId: orgId,
        runId: scheduledManager.runId,
        taskId: roleTask,
      }),
    );
    const ended = await dispatch(scheduledManager.token, 'task_start_agent', {
      taskId: race2,
    });
    record(
      'delegation: a run that has ended cannot start anything',
      ended.status === 'unavailable' &&
        JSON.stringify(ended).includes('run_ended'),
      `result=${JSON.stringify(ended)}`,
    );
  } finally {
    await release();
    for (const token of tokens) {
      await sql`
        DELETE FROM app.sandbox_session_tokens
        WHERE token_hash = ${createHash('sha256').update(token).digest('hex')}
      `;
    }
    await sql`
      DELETE FROM app.sandbox_sessions
      WHERE org_id = ${orgId} AND created_by = 'itest:delegate'
    `;
    await sql`
      DELETE FROM app.automation_triggers
      WHERE org_id = ${orgId} AND name = ${scheduleName}
    `;
    await sql`
      DELETE FROM app.automation_project_bindings
      WHERE org_id = ${orgId} AND automation_name = ${scheduleName}
    `;
    await sql`
      DELETE FROM app.automations
      WHERE org_id = ${orgId} AND name = ${scheduleName}
    `;
    await sql`DELETE FROM app.projects WHERE id IN (${projectA}, ${projectB})`;
    await fx.teardownUsers();
  }
}

// ===========================================================================
// A standing role recurs: a successful in-place run, then the next occurrence
// ===========================================================================

/**
 * The real completion path (`completeAgentRunInTx`, what the turn host calls
 * when a run finishes) for runs a schedule started in place, followed by the
 * schedule's next occurrence. The card is left where it is and no review is
 * requested — on a To do role card and on one a person moved to In progress —
 * so the role recurs; the report, the deliverable and the run's provenance
 * land as for any run. A default start still parks its result at In review for
 * a person, and a run cancelled before its completion lands changes nothing.
 */
export async function checkInPlaceCompletionCycle(
  sql: Sql,
  ctx: LaneCtx,
  record: Recorder,
): Promise<void> {
  const { orgId, userId } = ctx;
  const fx = fixtures(sql, ctx);
  const { suffix } = fx;
  const projectA = randomUUID();
  const roleAgent = randomUUID();
  const progressAgent = randomUUID();
  const ordinaryAgent = randomUUID();
  const pickedUpAgent = randomUUID();
  const editor = `role-editor-${suffix}`;
  const todoName = `itest/role-todo-${suffix}`;
  const progressName = `itest/role-progress-${suffix}`;
  const pickedUpName = `itest/role-picked-up-${suffix}`;
  const store = pgTaskStore(sql);
  const release = await holdAgentJobs(sql, suffix, [projectA]);

  const runCount = async (name: string): Promise<number> => {
    const rows = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.automation_runs
      WHERE org_id = ${orgId} AND name = ${name}
    `;
    return rows[0]?.count ?? -1;
  };
  /** One occurrence of the named schedule, landed by the worker. */
  const fire = async (
    name: string,
  ): Promise<{ runId: string; output: Record<string, unknown> | null }> => {
    const before = await runCount(name);
    await sql`
      UPDATE app.automation_triggers
      SET last_due_at_ms = ${Date.now() - 120_000}, last_fired_at_ms = NULL
      WHERE org_id = ${orgId} AND name = ${name}
    `;
    await scanScheduledTriggers(sql);
    const runs = await sql<{ id: string }[]>`
      SELECT id FROM app.automation_runs WHERE org_id = ${orgId} AND name = ${name}
      ORDER BY started_at_ms DESC, id DESC LIMIT 1
    `;
    const runId = runs[0]?.id ?? '';
    if ((await runCount(name)) === before || runId === '') {
      return { runId: '', output: null };
    }
    await waitFor(async () => {
      const rows = await sql<{ status: string }[]>`
        SELECT status FROM app.automation_runs WHERE id = ${runId}
      `;
      return ['success', 'failed', 'cancelled'].includes(rows[0]?.status ?? '');
    }, WAIT_MS);
    const rows = await sql<{ output: unknown }[]>`
      SELECT output FROM app.automation_runs WHERE id = ${runId}
    `;
    const output = rows[0]?.output;
    return { runId, output: isRecord(output) ? output : null };
  };
  /** The turn host's successful completion of a run, as it calls it. */
  const complete = (run: RunRow, report: string) =>
    transactSerializable(sql, (tx) =>
      completeAgentRunInTx(tx, {
        organizationId: orgId,
        taskId: run.taskId,
        agentId: run.agentId,
        execId: run.execId,
        runId: run.id,
        resultText: report,
        body: report,
        files: [
          {
            fileId: `itest-blob-${run.id}`,
            fileName: `receipt-${run.id.slice(0, 8)}.md`,
            fileType: 'text/markdown',
            fileSize: 64,
          },
        ],
      }),
    );
  const cardOf = async (taskId: string) => {
    const rows = await sql<{ status: string; outputs: unknown }[]>`
      SELECT status, outputs FROM app.tasks WHERE id = ${taskId}
    `;
    return rows[0];
  };
  const reviewsOf = (taskId: string) => sql<{ status: string }[]>`
    SELECT status FROM app.approvals
    WHERE resource_type = 'task_review' AND resource_id = ${taskId}
  `;
  const settledOf = async (runId: string) => {
    const rows = await sql<{ status: string; ledger: number }[]>`
      SELECT r.status,
             (SELECT count(*)::int FROM app.audit_logs a
              WHERE a.org_id = ${orgId} AND a.resource_type = 'agent_run'
                AND a.resource_id = ${runId}
                AND a.action = 'agent.run_settled') AS ledger
      FROM app.project_agent_runs r WHERE r.id = ${runId}
    `;
    return rows[0];
  };
  const hasOutput = (outputs: unknown, runId: string): boolean =>
    Array.isArray(outputs) &&
    outputs.some((entry) => isRecord(entry) && entry.runId === runId);
  const comments = async (taskId: string): Promise<string[]> =>
    (await store.listComments({ organizationId: orgId, taskId })).comments.map(
      (comment) => comment.body,
    );
  const documentFor = (name: string, taskId: string) => ({
    version: 1,
    name,
    nodes: [
      {
        id: 'start',
        type: 'task.start_agent',
        input: { taskId, moveToInProgress: false },
      },
    ],
    output: '{{ nodes.start.output }}',
  });
  const install = async (name: string, taskId: string) => {
    await saveVersion(sql, {
      organizationId: orgId,
      name,
      document: documentFor(name, taskId),
      actor: userId,
      projectId: projectA,
    });
    await deploy(sql, {
      organizationId: orgId,
      name,
      version: 1,
      actor: userId,
    });
  };
  const schedule = (name: string, enabled: boolean) =>
    setTrigger(sql, {
      organizationId: orgId,
      name,
      trigger: {
        kind: 'schedule',
        cron: '* * * * *',
        timezone: 'Europe/Zurich',
        enabled,
      },
      actor: userId,
    });

  try {
    await fx.insertProject(projectA, 'Standing roles');
    await fx.insertAgent(roleAgent, projectA, 'Standing role');
    await fx.insertAgent(progressAgent, projectA, 'Standing role in progress');
    await fx.insertAgent(ordinaryAgent, projectA, 'Ordinary implementer');
    await fx.insertAgent(pickedUpAgent, projectA, 'Standing role picked up');
    await fx.insertUser(editor, 'editor');
    const roleCard = await fx.insertTask({
      projectId: projectA,
      title: 'Autonomous cycle — role',
      agentId: roleAgent,
    });
    const progressCard = await fx.insertTask({
      projectId: projectA,
      title: 'Autonomous cycle — role a person moved to In progress',
      status: 'in_progress',
      agentId: progressAgent,
    });
    const ordinaryCard = await fx.insertTask({
      projectId: projectA,
      title: 'Ordinary work',
    });
    const pickedUpCard = await fx.insertTask({
      projectId: projectA,
      title: 'Autonomous cycle — role a person picks up during its run',
      agentId: pickedUpAgent,
    });
    await install(todoName, roleCard);
    await install(progressName, progressCard);
    await install(pickedUpName, pickedUpCard);

    // ---- a To do role: complete the occurrence, then the next one ------
    await schedule(todoName, true);
    const first = await fire(todoName);
    const r1 = (await runsOf(sql, roleCard))[0];
    const completed1 =
      r1 === undefined
        ? false
        : await complete(r1, 'Role receipt: first occurrence done.');
    const afterFirst = await cardOf(roleCard);
    const reviewsFirst = await reviewsOf(roleCard);
    const settled1 = r1 === undefined ? undefined : await settledOf(r1.id);
    const roleComments = await comments(roleCard);
    const second = await fire(todoName);
    const roleRuns = await runsOf(sql, roleCard);
    const afterSecond = await cardOf(roleCard);
    record(
      'in-place completion: a scheduled role run that completes leaves its To do card where it is with no review, keeps its report, deliverable and provenance, and the next occurrence starts the role again',
      first.output?.started === true &&
        r1 !== undefined &&
        completed1 &&
        settled1?.status === 'settled' &&
        settled1.ledger === 1 &&
        afterFirst?.status === 'todo' &&
        hasOutput(afterFirst.outputs, r1.id) &&
        reviewsFirst.length === 0 &&
        roleComments.includes('Role receipt: first occurrence done.') &&
        second.output?.started === true &&
        roleRuns.length === 2 &&
        roleRuns[1]?.status === 'queued' &&
        roleRuns[1].trigger === 'automation' &&
        afterSecond?.status === 'todo',
      `first=${JSON.stringify(first.output)} completed=${completed1} run=${JSON.stringify(settled1)} card=${afterFirst?.status} output=${hasOutput(afterFirst?.outputs, r1?.id ?? '')} reviews=${reviewsFirst.length} comment=${roleComments.includes('Role receipt: first occurrence done.')} second=${JSON.stringify(second.output)} runs=${describeRuns(roleRuns)} card after=${afterSecond?.status}`,
    );
    await schedule(todoName, false);

    // ---- a role card a person moved to In progress: the start's intent --
    // decides the completion, not the card's column.
    await schedule(progressName, true);
    const third = await fire(progressName);
    const r3 = (await runsOf(sql, progressCard))[0];
    const completed3 =
      r3 === undefined
        ? false
        : await complete(r3, 'Role receipt: in-progress occurrence done.');
    const afterThird = await cardOf(progressCard);
    const reviewsThird = await reviewsOf(progressCard);
    const settled3 = r3 === undefined ? undefined : await settledOf(r3.id);
    const fourth = await fire(progressName);
    const progressRuns = await runsOf(sql, progressCard);
    record(
      'in-place completion: the in-place intent the start recorded, not the card’s column, decides the completion — a role card a person moved to In progress stays there with no review, and the next occurrence starts again',
      third.output?.started === true &&
        r3 !== undefined &&
        completed3 &&
        settled3?.status === 'settled' &&
        afterThird?.status === 'in_progress' &&
        reviewsThird.length === 0 &&
        fourth.output?.started === true &&
        progressRuns.length === 2,
      `third=${JSON.stringify(third.output)} completed=${completed3} run=${JSON.stringify(settled3)} card=${afterThird?.status} reviews=${JSON.stringify(reviewsThird)} fourth=${JSON.stringify(fourth.output)} runs=${describeRuns(progressRuns)}`,
    );

    // ---- a run cancelled before its completion lands changes nothing ---
    const r4 = progressRuns[1];
    if (r4 !== undefined) {
      await sql.begin((tx) =>
        cancelAgentRunInTx(tx, {
          organizationId: orgId,
          runId: r4.id,
          taskId: progressCard,
        }),
      );
    }
    const lateCompletion =
      r4 === undefined ? true : await complete(r4, 'Too late.');
    const afterCancel = await cardOf(progressCard);
    const reviewsCancel = await reviewsOf(progressCard);
    const cancelComments = await comments(progressCard);
    record(
      'in-place completion: a completion that lands after the run was cancelled writes nothing — no report, no card move, no review',
      r4 !== undefined &&
        !lateCompletion &&
        afterCancel?.status === 'in_progress' &&
        reviewsCancel.length === 0 &&
        !cancelComments.includes('Too late.'),
      `late=${lateCompletion} card=${afterCancel?.status} reviews=${reviewsCancel.length}`,
    );

    // ---- an ordinary start still parks its result for a person --------
    const ordinary = await store.startAgent({
      organizationId: orgId,
      caller: { kind: 'workflow', runId: third.runId, nodeId: 'ordinary' },
      taskId: ordinaryCard,
      agentId: ordinaryAgent,
    });
    const r5 = (await runsOf(sql, ordinaryCard))[0];
    const movedIn = await cardOf(ordinaryCard);
    const completed5 =
      r5 === undefined
        ? false
        : await complete(r5, 'Ordinary report: the fix is ready.');
    const afterOrdinary = await cardOf(ordinaryCard);
    const reviewsOrdinary = await reviewsOf(ordinaryCard);
    record(
      'in-place completion: an ordinary (default) start still moves its card to In progress and parks the completed result at In review with a pending review',
      ordinary.started &&
        r5 !== undefined &&
        movedIn?.status === 'in_progress' &&
        completed5 &&
        afterOrdinary?.status === 'in_review' &&
        reviewsOrdinary.length === 1 &&
        reviewsOrdinary[0]?.status === 'pending',
      `start=${JSON.stringify(ordinary)} moved=${movedIn?.status} completed=${completed5} card=${afterOrdinary?.status} reviews=${JSON.stringify(reviewsOrdinary)}`,
    );

    // ---- a person picks a To do role card up while its run is live ------
    // They move it to In progress through the real status door, which keeps
    // the live run rather than starting their own. The run fails, the real
    // retry worker retries it and the retry completes: the retry carries the
    // start's in-place intent, so the card stays In progress with no review.
    await schedule(pickedUpName, true);
    const fifth = await fire(pickedUpName);
    const personAuth = await getProjectAuthContext(sql, {
      organizationId: orgId,
      userId: editor,
      role: 'editor',
    });
    await sql.begin((tx) =>
      updateTaskStatus(tx, personAuth, pickedUpCard, 'in_progress'),
    );
    const pickedUp = await cardOf(pickedUpCard);
    const pickedUpRuns = await runsOf(sql, pickedUpCard);
    const retrySkips: string[] = [];
    await failNewestRunAndRetry(sql, pickedUpCard, retrySkips);
    const retryRun = (await runsOf(sql, pickedUpCard))[1];
    const retryIntent =
      retryRun === undefined
        ? undefined
        : (
            await sql<{ inPlace: boolean }[]>`
              SELECT in_place AS "inPlace" FROM app.project_agent_runs
              WHERE id = ${retryRun.id}
            `
          )[0]?.inPlace;
    const completedRetry =
      retryRun === undefined
        ? false
        : await complete(retryRun, 'Role receipt: done after a retry.');
    const afterRetry = await cardOf(pickedUpCard);
    const reviewsRetry = await reviewsOf(pickedUpCard);
    const settledRetry =
      retryRun === undefined ? undefined : await settledOf(retryRun.id);
    const sixth = await fire(pickedUpName);
    const pickedUpAll = await runsOf(sql, pickedUpCard);
    record(
      'in-place completion: a person moves a To do role card to In progress while its run is live (the run is kept), the run fails and its automatic retry completes — the retry carries the in-place intent, so the card stays In progress with no review and the next occurrence starts the role again',
      fifth.output?.started === true &&
        pickedUp?.status === 'in_progress' &&
        pickedUpRuns.length === 1 &&
        retrySkips.length === 0 &&
        retryRun !== undefined &&
        retryRun.trigger === 'auto_retry' &&
        retryRun.startedVia === 'automation' &&
        retryIntent === true &&
        completedRetry &&
        settledRetry?.status === 'settled' &&
        afterRetry?.status === 'in_progress' &&
        hasOutput(afterRetry.outputs, retryRun.id) &&
        reviewsRetry.length === 0 &&
        sixth.output?.started === true &&
        pickedUpAll.length === 3 &&
        pickedUpAll[2]?.status === 'queued',
      `fifth=${JSON.stringify(fifth.output)} card after the move=${pickedUp?.status} runs=${describeRuns(pickedUpRuns)} retry skips=${retrySkips.join(',') || 'none'} retry=${retryRun?.trigger}/${retryRun?.startedVia} inPlace=${retryIntent} completed=${completedRetry} run=${JSON.stringify(settledRetry)} card=${afterRetry?.status} reviews=${JSON.stringify(reviewsRetry)} sixth=${JSON.stringify(sixth.output)} runs=${describeRuns(pickedUpAll)}`,
    );
    await schedule(pickedUpName, false);
  } finally {
    await release();
    for (const name of [todoName, progressName, pickedUpName]) {
      await sql`DELETE FROM app.automation_triggers WHERE org_id = ${orgId} AND name = ${name}`;
      await sql`DELETE FROM app.automation_runs WHERE org_id = ${orgId} AND name = ${name}`;
      await sql`DELETE FROM app.automation_deployments WHERE org_id = ${orgId} AND name = ${name}`;
      await sql`DELETE FROM app.automation_project_bindings WHERE org_id = ${orgId} AND automation_name = ${name}`;
      await sql`DELETE FROM app.automations WHERE org_id = ${orgId} AND name = ${name}`;
    }
    // Cascades to agents, tasks and runs.
    await sql`DELETE FROM app.projects WHERE id = ${projectA}`;
    await fx.teardownUsers();
  }
}
