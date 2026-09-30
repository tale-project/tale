/** Real Postgres proof: a queued agent retry, and a steer that missed its
 * run, start new work only where a manual Start would admit it NOW — an
 * active project, and a starter who may still edit it. The queue is inert:
 * every job this lane's writes enqueue is held a day inside the writing
 * transaction, no worker ever takes one, and the lane delivers each retry
 * job itself, as pg-boss would (again for a duplicate delivery). */
import { randomUUID } from 'node:crypto';

import type { Sql, TransactionSql } from 'postgres';

import { createTaskList } from '../../jobs/task-list.ts';
import { archiveProject, restoreProject } from '../projects/service.ts';
import { failAgentRunFromTurn } from './agent-runs.ts';
import { agentTurnShimHandlers } from './agent-turn-shim.ts';

type Recorder = (name: string, ok: boolean, detail: string) => void;

type Begin = (
  first: string | ((tx: TransactionSql) => Promise<unknown>),
  second?: (tx: TransactionSql) => Promise<unknown>,
) => Promise<unknown>;

/** `sql` whose every transaction first runs `before` and, after its own
 * statements, `after` — both on the transaction itself, before it commits.
 * Covers `begin(fn)` and the serializable `begin(options, fn)`. Shared with
 * the lanes that hold their own jobs the same way. */
export function aroundTransactions(
  sql: Sql,
  hooks: {
    before?: (tx: TransactionSql) => Promise<void>;
    after?: (tx: TransactionSql) => Promise<void>;
    wrap?: (tx: TransactionSql) => TransactionSql;
  },
): Sql {
  return new Proxy(sql, {
    get(target, property, receiver) {
      if (property !== 'begin') return Reflect.get(target, property, receiver);
      const begin: Begin = (first, second) => {
        const body = typeof first === 'function' ? first : second;
        if (body === undefined) throw new Error('itest: begin without a body');
        const run = async (tx: TransactionSql) => {
          await hooks.before?.(tx);
          const result = await body(hooks.wrap?.(tx) ?? tx);
          await hooks.after?.(tx);
          return result;
        };
        return typeof first === 'function'
          ? target.begin(run)
          : target.begin(first, run);
      };
      return begin;
    },
  });
}

export async function checkTaskRetryProjectEligibility(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
  record: Recorder,
): Promise<void> {
  const { orgId, userId } = ctx;
  const suffix = randomUUID().slice(0, 8);
  const starter = `retry-starter-${suffix}`;
  const starterMember = `m-${starter}`;
  const teamId = `retry-team-${suffix}`;
  const projectId = randomUUID();
  const agentId = randomUUID();
  const owner = {
    organizationId: orgId,
    userId,
    role: 'owner',
    teamIds: [] as string[],
  };

  // Every task and retry job this lane's writes enqueue stays queued a day:
  // held in the writing transaction, before any worker can see it.
  const holdJobs = async (tx: TransactionSql) => {
    await tx`
      UPDATE pgboss.job SET start_after = now() + interval '1 day'
      WHERE name IN ('task.agent_turn', 'task.agent_retry')
        AND state = 'created'
        AND (data ->> 'runId' IN (SELECT id FROM app.project_agent_runs
                                  WHERE project_id = ${projectId})
             OR data ->> 'taskId' IN (SELECT id FROM app.tasks
                                      WHERE project_id = ${projectId}))
    `;
  };
  const held = aroundTransactions(sql, { after: holdJobs });
  const retryHandler = createTaskList({ sql: held })['task.agent_retry'];
  const steerMiss =
    agentTurnShimHandlers(held)['tasks/mutations:kickMentionRunAfterSteerMiss'];
  if (retryHandler === undefined || steerMiss === undefined) {
    throw new Error('itest: the retry or steer-miss handler is missing');
  }

  /** The skip reasons the handler logs while `work` runs. */
  const skipsDuring = async (work: () => Promise<unknown>) => {
    const skips: string[] = [];
    const log = console.log;
    console.log = (...args: unknown[]) => {
      const line = args.map(String).join(' ');
      const match = /auto-retry skipped: (\S+)/.exec(line);
      if (match?.[1] !== undefined) skips.push(match[1]);
      else log(...args);
    };
    try {
      await work();
    } finally {
      console.log = log;
    }
    return skips;
  };

  const now = Date.now();
  /** An agent-owned task at In progress. The owner creates it, so the
   * starter works it as an editor, not as the member whose own task it is,
   * unless `createdBy` says otherwise. */
  const mkTask = async (title: string, createdBy = userId): Promise<string> => {
    const taskId = randomUUID();
    await sql`
      INSERT INTO app.tasks (id, org_id, project_id, title, status, rank,
        assignee_type, assignee_id, created_by, created_by_type,
        created_at_ms, updated_at_ms)
      VALUES (${taskId}, ${orgId}, ${projectId}, ${title}, 'in_progress',
        ${`a${suffix}${title.length}`}, 'agent', ${agentId}, ${createdBy},
        'user', ${now}, ${now})
    `;
    return taskId;
  };
  /** A run the starter kicked, failed by its own turn: the real failure
   * mark arms the retry job — held — and the lane reads its payload. */
  const armRetry = async (
    taskId: string,
    startedBy = starter,
  ): Promise<{ failedRunId: string; payload: unknown }> => {
    const execId = `exec-retry-${randomUUID().slice(0, 8)}`;
    const started = Date.now();
    const rows = await sql<{ id: string }[]>`
      INSERT INTO app.project_agent_runs (
        org_id, project_id, task_id, agent_id, exec_id, session_id, status,
        harness, model, started_by, started_at_ms, launched_at_ms,
        deadline_at_ms, updated_at_ms
      ) VALUES (
        ${orgId}, ${projectId}, ${taskId}, ${agentId}, ${execId},
        ${`pa-${agentId}`}, 'running', 'claude-code', 'itest-model',
        ${startedBy}, ${started - 2_000}, ${started - 1_000},
        ${started + 3_600_000}, ${started}
      ) RETURNING id
    `;
    const failedRunId = rows[0]?.id ?? '';
    await failAgentRunFromTurn(held, {
      runId: failedRunId,
      execId,
      error: 'itest: the harness exited before the turn completed',
      failureCode: 'turn_crashed',
    });
    const jobs = await sql<{ data: unknown }[]>`
      SELECT data FROM pgboss.job
      WHERE name = 'task.agent_retry'
        AND data ->> 'expectedRunId' = ${failedRunId}
    `;
    if (jobs.length !== 1) {
      throw new Error(`itest: ${jobs.length} retry jobs armed (want 1)`);
    }
    return { failedRunId, payload: jobs[0]?.data };
  };
  const runsOf = (taskId: string) =>
    sql<
      {
        id: string;
        status: string;
        trigger: string | null;
        startedBy: string;
        attempt: number | null;
      }[]
    >`
      SELECT id, status, trigger, started_by AS "startedBy",
             auto_retry_attempt AS attempt
      FROM app.project_agent_runs WHERE task_id = ${taskId} ORDER BY seq
    `;
  const turnJobsOf = async (taskId: string) => {
    const rows = await sql<{ count: number; held: number }[]>`
      SELECT count(*)::int AS count,
             count(*) FILTER (WHERE start_after > now() + interval '1 hour'
                              AND state = 'created')::int AS held
      FROM pgboss.job
      WHERE name = 'task.agent_turn'
        AND data ->> 'runId' IN (SELECT id FROM app.project_agent_runs
                                 WHERE task_id = ${taskId})
    `;
    return rows[0] ?? { count: -1, held: -1 };
  };
  const describe = (runs: Awaited<ReturnType<typeof runsOf>>) =>
    runs.map((run) => `${run.status}/${run.trigger ?? 'manual'}`).join(',') ||
    'none';
  const setStarterRole = (role: string) =>
    sql`UPDATE "member" SET "role" = ${role} WHERE "id" = ${starterMember}`;

  try {
    await sql`
      INSERT INTO "user" ("id", "name", "email", "emailVerified",
                          "createdAt", "updatedAt")
      VALUES (${starter}, 'Retry Starter', ${`${starter}@example.com`}, true,
              ${new Date()}, ${new Date()})
    `;
    await sql`
      INSERT INTO "member" ("id", "organizationId", "userId", "role",
                            "createdAt")
      VALUES (${starterMember}, ${orgId}, ${starter}, 'editor', ${new Date()})
    `;
    await sql`
      INSERT INTO "team" ("id", "name", "organizationId", "createdAt",
                          "updatedAt")
      VALUES (${teamId}, 'Retry squad', ${orgId}, ${new Date()}, ${new Date()})
    `;
    await sql`
      INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms,
                                updated_at_ms)
      VALUES (${projectId}, ${orgId}, 'Retry eligibility', ${userId}, ${now},
              ${now})
    `;
    await sql`
      INSERT INTO app.project_agents (id, org_id, project_id, name, harness,
                                      model, created_by, created_at_ms,
                                      updated_at_ms)
      VALUES (${agentId}, ${orgId}, ${projectId}, 'Retry agent',
              'claude-code', 'itest-model', ${userId}, ${now}, ${now})
    `;

    // ---- eligible: one retry, once, whatever the queue delivers --------
    const eligibleTask = await mkTask('Eligible retry');
    const eligible = await armRetry(eligibleTask);
    const eligibleSkips = await skipsDuring(async () => {
      await retryHandler(eligible.payload);
      // pg-boss delivers at least once: the same job again.
      await retryHandler(eligible.payload);
    });
    const eligibleRuns = await runsOf(eligibleTask);
    const eligibleJobs = await turnJobsOf(eligibleTask);
    record(
      'retry eligibility: an active project admits one queued retry for its starter, and a duplicate delivery adds nothing',
      eligibleRuns.length === 2 &&
        eligibleRuns[0]?.status === 'failed' &&
        eligibleRuns[1]?.status === 'queued' &&
        eligibleRuns[1].trigger === 'auto_retry' &&
        eligibleRuns[1].attempt === 1 &&
        eligibleRuns[1].startedBy === starter &&
        eligibleJobs.count === 1 &&
        eligibleJobs.held === 1 &&
        eligibleSkips.join(',') === 'superseded',
      `runs=${describe(eligibleRuns)} (want failed/manual,queued/auto_retry), attempt=${eligibleRuns[1]?.attempt} startedBy=${eligibleRuns[1]?.startedBy === starter ? 'starter' : eligibleRuns[1]?.startedBy} (want 1, starter), turn jobs=${eligibleJobs.count} held=${eligibleJobs.held} (want 1, 1), skips=${eligibleSkips.join(',') || 'none'} (want superseded: the duplicate)`,
    );

    // ---- archived after the retry was queued ---------------------------
    const archivedTask = await mkTask('Archived before delivery');
    const archived = await armRetry(archivedTask);
    await sql.begin((tx) => archiveProject(tx, owner, projectId));
    const archivedSkips = await skipsDuring(async () => {
      await retryHandler(archived.payload);
      await retryHandler(archived.payload);
    });
    const archivedRuns = await runsOf(archivedTask);
    const archivedJobs = await turnJobsOf(archivedTask);
    // The manual Start on the same task answers the archive — the parity
    // the retry now keeps.
    const manualStart = await fetch(
      `${base}/api/app/tasks/${archivedTask}/agent-runs/start?orgId=${orgId}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: ctx.cookie,
          origin: base,
        },
        body: '{}',
      },
    );
    const manualBody: unknown = await manualStart.json().catch(() => null);
    const manualError =
      typeof manualBody === 'object' &&
      manualBody !== null &&
      'error' in manualBody
        ? manualBody.error
        : undefined;
    const archivedTaskRow = await sql<{ status: string }[]>`
      SELECT status FROM app.tasks WHERE id = ${archivedTask}
    `;
    record(
      'retry eligibility: a project archived after the retry was queued admits nothing, like the manual Start',
      archivedRuns.length === 1 &&
        archivedRuns[0]?.status === 'failed' &&
        archivedJobs.count === 0 &&
        archivedSkips.join(',') === 'project_archived,project_archived' &&
        manualStart.status === 403 &&
        manualError === 'PROJECT_ARCHIVED' &&
        archivedTaskRow[0]?.status === 'in_progress',
      `runs=${describe(archivedRuns)} (want failed/manual only), turn jobs=${archivedJobs.count} (want 0), skips=${archivedSkips.join(',') || 'none'} (want project_archived twice), manual start=${manualStart.status}/${String(manualError)} (want 403/PROJECT_ARCHIVED), task=${archivedTaskRow[0]?.status} (want in_progress)`,
    );

    // ---- restored before a later delivery: eligibility is read then ----
    await sql.begin((tx) => restoreProject(tx, owner, projectId));
    const restoredSkips = await skipsDuring(async () => {
      await retryHandler(archived.payload);
    });
    const restoredRuns = await runsOf(archivedTask);
    const restoredJobs = await turnJobsOf(archivedTask);
    record(
      'retry eligibility: once the project is restored, the next delivery of the same job admits the retry',
      restoredRuns.length === 2 &&
        restoredRuns[1]?.status === 'queued' &&
        restoredRuns[1].trigger === 'auto_retry' &&
        restoredRuns[1].startedBy === starter &&
        restoredJobs.count === 1 &&
        restoredJobs.held === 1 &&
        restoredSkips.length === 0,
      `runs=${describe(restoredRuns)} (want failed/manual,queued/auto_retry), turn jobs=${restoredJobs.count} held=${restoredJobs.held} (want 1, 1), skips=${restoredSkips.join(',') || 'none'} (want none)`,
    );

    // ---- the starter's access revoked after queuing --------------------
    const revocations: {
      label: string;
      revoke: () => Promise<unknown>;
      restore: () => Promise<unknown>;
    }[] = [
      {
        label: 'removed from the organization',
        revoke: () => sql`DELETE FROM "member" WHERE "id" = ${starterMember}`,
        restore: () => sql`
          INSERT INTO "member" ("id", "organizationId", "userId", "role",
                                "createdAt")
          VALUES (${starterMember}, ${orgId}, ${starter}, 'editor',
                  ${new Date()})
        `,
      },
      {
        label: 'demoted to a read-only member',
        revoke: () => setStarterRole('member'),
        restore: () => setStarterRole('editor'),
      },
      {
        label: 'disabled',
        revoke: () => setStarterRole('disabled'),
        restore: () => setStarterRole('editor'),
      },
      {
        label: 'outside the team the project moved to',
        revoke: () => sql`
          UPDATE app.projects SET team_ids = ARRAY[${teamId}]::text[]
          WHERE id = ${projectId}
        `,
        restore: () => sql`
          UPDATE app.projects SET team_ids = '{}'::text[]
          WHERE id = ${projectId}
        `,
      },
    ];
    for (const revocation of revocations) {
      const taskId = await mkTask(`Revoked ${revocation.label}`);
      const armed = await armRetry(taskId);
      await revocation.revoke();
      const skips = await skipsDuring(async () => {
        await retryHandler(armed.payload);
      });
      const runs = await runsOf(taskId);
      const jobs = await turnJobsOf(taskId);
      await revocation.restore();
      record(
        `retry eligibility: a starter ${revocation.label} after queuing gets no retry`,
        runs.length === 1 &&
          runs[0]?.status === 'failed' &&
          jobs.count === 0 &&
          skips.join(',') === 'not_permitted',
        `runs=${describe(runs)} (want failed/manual only), turn jobs=${jobs.count} (want 0), skips=${skips.join(',') || 'none'} (want not_permitted)`,
      );
    }

    // ---- a member works their own task: the retry follows --------------
    // A read-only member may still work a task they created, so their run
    // is retried on it — and a demotion is no refusal there.
    const ownTask = await mkTask('Member own task', starter);
    const own = await armRetry(ownTask);
    await setStarterRole('member');
    const ownSkips = await skipsDuring(async () => {
      await retryHandler(own.payload);
    });
    const ownRuns = await runsOf(ownTask);
    await setStarterRole('editor');
    record(
      'retry eligibility: a read-only member is retried on a task of their own, which they may still work',
      ownRuns.length === 2 &&
        ownRuns[1]?.status === 'queued' &&
        ownRuns[1].startedBy === starter &&
        ownSkips.length === 0,
      `runs=${describe(ownRuns)} (want failed/manual,queued/auto_retry), skips=${ownSkips.join(',') || 'none'} (want none)`,
    );

    // ---- a team project: its member keeps the retry ---------------------
    await sql`
      UPDATE app.projects SET team_ids = ARRAY[${teamId}]::text[]
      WHERE id = ${projectId}
    `;
    await sql`
      INSERT INTO "teamMember" ("id", "teamId", "userId", "createdAt")
      VALUES (${`tm-${starter}`}, ${teamId}, ${starter}, ${new Date()})
    `;
    const teamTask = await mkTask('Team retry');
    const team = await armRetry(teamTask);
    const teamSkips = await skipsDuring(async () => {
      await retryHandler(team.payload);
    });
    const teamRuns = await runsOf(teamTask);
    const leftTask = await mkTask('Left the team');
    const left = await armRetry(leftTask);
    await sql`DELETE FROM "teamMember" WHERE "id" = ${`tm-${starter}`}`;
    const leftSkips = await skipsDuring(async () => {
      await retryHandler(left.payload);
    });
    const leftRuns = await runsOf(leftTask);
    await sql`
      UPDATE app.projects SET team_ids = '{}'::text[] WHERE id = ${projectId}
    `;
    record(
      'retry eligibility: on a team project the team member is retried, and one who left the team after queuing is not',
      teamRuns.length === 2 &&
        teamRuns[1]?.status === 'queued' &&
        teamSkips.length === 0 &&
        leftRuns.length === 1 &&
        leftSkips.join(',') === 'not_permitted',
      `member: runs=${describe(teamRuns)} skips=${teamSkips.join(',') || 'none'} (want a queued retry, no skip); left: runs=${describe(leftRuns)} skips=${leftSkips.join(',') || 'none'} (want failed only, not_permitted)`,
    );

    // ---- an archived task keeps its own refusal ---------------------------
    const archivedTaskOnly = await mkTask('Archived task');
    const archivedOnly = await armRetry(archivedTaskOnly);
    await sql`
      UPDATE app.tasks SET archived_at_ms = ${Date.now()}
      WHERE id = ${archivedTaskOnly}
    `;
    const archivedOnlySkips = await skipsDuring(async () => {
      await retryHandler(archivedOnly.payload);
    });
    const archivedOnlyRuns = await runsOf(archivedTaskOnly);
    record(
      'retry eligibility: an archived task on an active project is still refused as unavailable',
      archivedOnlyRuns.length === 1 &&
        archivedOnlySkips.join(',') === 'task_unavailable',
      `runs=${describe(archivedOnlyRuns)} (want failed only), skips=${archivedOnlySkips.join(',') || 'none'} (want task_unavailable)`,
    );

    // ---- an archive racing a retry that already passed the check --------
    // The retry holds the project row from its check to its commit, so the
    // archive waits and lands after the run: no run is committed after an
    // archive a person was told had taken effect.
    const racedTask = await mkTask('Archive waits for the admitted retry');
    const raced = await armRetry(racedTask);
    let reachInsert = () => {};
    const atInsert = new Promise<void>((resolve) => {
      reachInsert = resolve;
    });
    let releaseInsert = () => {};
    const insertReleased = new Promise<void>((resolve) => {
      releaseInsert = resolve;
    });
    const pausedBeforeInsert = (tx: TransactionSql): TransactionSql =>
      new Proxy(tx, {
        apply(target, thisArg, argArray: unknown[]) {
          const strings = argArray[0];
          if (
            Array.isArray(strings) &&
            strings.join('').includes('INSERT INTO app.project_agent_runs')
          ) {
            reachInsert();
            return insertReleased.then(() =>
              Reflect.apply(target, thisArg, argArray),
            );
          }
          return Reflect.apply(target, thisArg, argArray);
        },
      });
    const pausedHandler = createTaskList({
      sql: aroundTransactions(sql, {
        after: holdJobs,
        wrap: pausedBeforeInsert,
      }),
    })['task.agent_retry'];
    const racedDelivery = pausedHandler?.(raced.payload);
    await Promise.race([
      atInsert,
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    let archivePid = 0;
    let archiveDone = false;
    const archiving = sql
      .begin(async (tx) => {
        const pid = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        archivePid = pid[0]?.pid ?? 0;
        await archiveProject(tx, owner, projectId);
      })
      .then(() => {
        archiveDone = true;
      });
    let archiveBlocked = false;
    for (let i = 0; i < 50; i++) {
      if (archiveDone) break;
      if (archivePid !== 0) {
        const blockers = await sql<{ blockers: number[] }[]>`
          SELECT pg_blocking_pids(${archivePid}) AS blockers
        `;
        if ((blockers[0]?.blockers.length ?? 0) > 0) {
          archiveBlocked = true;
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const archiveDoneWhileHeld = archiveDone;
    releaseInsert();
    await racedDelivery;
    await archiving;
    const racedRuns = await runsOf(racedTask);
    const racedProject = await sql<{ archivedAt: number | null }[]>`
      SELECT archived_at_ms::float8 AS "archivedAt" FROM app.projects
      WHERE id = ${projectId}
    `;
    record(
      'retry eligibility: an archive that races an admitted retry waits for its commit, so no run lands after the archive',
      archiveBlocked &&
        !archiveDoneWhileHeld &&
        racedRuns.length === 2 &&
        racedRuns[1]?.status === 'queued' &&
        racedProject[0]?.archivedAt !== null,
      `archive blocked=${archiveBlocked} (want true), archive done while the retry held=${archiveDoneWhileHeld} (want false), runs=${describe(racedRuns)} (want failed/manual,queued/auto_retry), archived=${racedProject[0]?.archivedAt !== null}`,
    );
    await sql.begin((tx) => restoreProject(tx, owner, projectId));

    // ---- a retry delivered while an archive is in flight waits for it ----
    const waitingTask = await mkTask('Retry waits for the archive');
    const waiting = await armRetry(waitingTask);
    let archivedInFlight = () => {};
    const inFlight = new Promise<void>((resolve) => {
      archivedInFlight = resolve;
    });
    let commitArchive = () => {};
    const archiveCommit = new Promise<void>((resolve) => {
      commitArchive = resolve;
    });
    const openArchive = sql.begin(async (tx) => {
      await archiveProject(tx, owner, projectId);
      archivedInFlight();
      await archiveCommit;
    });
    await inFlight;
    let retryPid = 0;
    const tracedHandler = createTaskList({
      sql: aroundTransactions(sql, {
        before: async (tx) => {
          const pid = await tx<
            { pid: number }[]
          >`SELECT pg_backend_pid() AS pid`;
          retryPid = pid[0]?.pid ?? 0;
        },
        after: holdJobs,
      }),
    })['task.agent_retry'];
    let waitingSkips: string[] = [];
    const waitingDelivery = skipsDuring(async () => {
      await tracedHandler?.(waiting.payload);
    }).then((skips) => {
      waitingSkips = skips;
    });
    let retryBlocked = false;
    for (let i = 0; i < 50; i++) {
      if (retryPid !== 0) {
        const blockers = await sql<{ blockers: number[] }[]>`
          SELECT pg_blocking_pids(${retryPid}) AS blockers
        `;
        if ((blockers[0]?.blockers.length ?? 0) > 0) {
          retryBlocked = true;
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    commitArchive();
    await openArchive;
    await waitingDelivery;
    const waitingRuns = await runsOf(waitingTask);
    record(
      'retry eligibility: a retry delivered while an archive is in flight waits for it and then admits nothing',
      retryBlocked &&
        waitingRuns.length === 1 &&
        waitingSkips.join(',') === 'project_archived',
      `retry blocked=${retryBlocked} (want true), runs=${describe(waitingRuns)} (want failed only), skips=${waitingSkips.join(',') || 'none'} (want project_archived)`,
    );
    await sql.begin((tx) => restoreProject(tx, owner, projectId));

    // ---- the steer-miss fallback kick: the same admission ----------------
    const steerTask = await mkTask('Steer miss');
    await sql.begin((tx) => archiveProject(tx, owner, projectId));
    const steerArchived = await steerMiss({
      organizationId: orgId,
      taskId: steerTask,
      authorId: starter,
      feedback: 'please also check the totals',
    });
    const steerArchivedRuns = await runsOf(steerTask);
    await sql.begin((tx) => restoreProject(tx, owner, projectId));
    await setStarterRole('member');
    const steerRevoked = await steerMiss({
      organizationId: orgId,
      taskId: steerTask,
      authorId: starter,
      feedback: 'please also check the totals',
    });
    const steerRevokedRuns = await runsOf(steerTask);
    await setStarterRole('editor');
    const steerEligible = await steerMiss({
      organizationId: orgId,
      taskId: steerTask,
      authorId: starter,
      feedback: 'please also check the totals',
    });
    const steerEligibleRuns = await runsOf(steerTask);
    const steerJobs = await turnJobsOf(steerTask);
    record(
      'retry eligibility: a steer that missed its run starts a fresh one only where its author may still start work',
      JSON.stringify(steerArchived) ===
        JSON.stringify({ started: false, reason: 'project_archived' }) &&
        steerArchivedRuns.length === 0 &&
        JSON.stringify(steerRevoked) ===
          JSON.stringify({ started: false, reason: 'not_permitted' }) &&
        steerRevokedRuns.length === 0 &&
        JSON.stringify(steerEligible) === JSON.stringify({ started: true }) &&
        steerEligibleRuns.length === 1 &&
        steerEligibleRuns[0]?.status === 'queued' &&
        steerEligibleRuns[0].trigger === 'mention' &&
        steerJobs.held === 1,
      `archived=${JSON.stringify(steerArchived)} runs=${steerArchivedRuns.length} (want not started, project_archived, 0); revoked=${JSON.stringify(steerRevoked)} runs=${steerRevokedRuns.length} (want not started, not_permitted, 0); eligible=${JSON.stringify(steerEligible)} runs=${describe(steerEligibleRuns)} held turn jobs=${steerJobs.held} (want started, queued/mention, 1)`,
    );
  } finally {
    await sql`
      DELETE FROM pgboss.job
      WHERE name IN ('task.agent_turn', 'task.agent_retry')
        AND (data ->> 'runId' IN (SELECT id FROM app.project_agent_runs
                                  WHERE project_id = ${projectId})
             OR data ->> 'taskId' IN (SELECT id FROM app.tasks
                                      WHERE project_id = ${projectId}))
    `;
    // Cascades to its agent, tasks and runs.
    await sql`DELETE FROM app.projects WHERE id = ${projectId}`;
    await sql`DELETE FROM "teamMember" WHERE "teamId" = ${teamId}`;
    await sql`DELETE FROM "team" WHERE "id" = ${teamId}`;
    await sql`DELETE FROM "member" WHERE "id" = ${starterMember}`;
    await sql`DELETE FROM "user" WHERE "id" = ${starter}`;
  }
}
