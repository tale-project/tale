/** Real Postgres proof that the automatic retry of a run an automation or
 * another agent started (`started_via`, migration 0139) looks at its agent's
 * workspace before it starts, under the same agent-row lock and the same
 * busy probe as the delegated start (`delegated-start.ts`, #3977):
 *
 * - the sequence that put two runs in one workspace — a delegated task fails,
 *   the manager starts the now-free agent on another task, the failed task's
 *   retry arrives — leaves one live run, and the retry waits on a later
 *   delivery of its own job instead of joining the workspace;
 * - once the run holding the workspace settles, the waiting retry starts on
 *   its next look, as the same chain's automatic retry, spending nothing
 *   while it waited;
 * - a retry and a delegated start racing for the same free agent leave one
 *   live run in each order — the delegated start first, the retry first
 *   (the delegated start's serializable snapshot is invalidated by the
 *   agent-row write and its retry answers `agent_busy`), and unordered —
 *   and the retry takes the agent row before the task row: holding the task
 *   first would deadlock beside a delegated restart of the same task, which
 *   the lane shows with that order;
 * - every look re-reads the task and the starter: a person's move, a
 *   reassignment, an archived task or project and a starter who lost the
 *   Editor role end the wait with nothing started, and a To do standing card
 *   still waits for its next occurrence;
 * - the wait is bounded: past its looks or its age the retry is refused once,
 *   on the task's timeline (`agent_run.refused`, `agent_busy`), and the
 *   manager's next start of that task runs;
 * - the delivery lifecycle is pg-boss's own, replayed as pg-boss would: a
 *   failed run has at most one future check queued, however its jobs are
 *   delivered — twice in a row after a commit its ack never followed, twice
 *   at once, again after a worker took the queued check, or a check that
 *   expired unacknowledged — and the one chain still moves on; a refused
 *   retry stays retired when the same jobs arrive after the agent is free,
 *   and the check that ends the wait, delivered twice at once, retires it
 *   once (one mark, the migration's column, and one timeline row), while the
 *   manager's restart and a person's Start still start the task;
 * - another agent's run, the agent's run in a member's own workspace and a
 *   run of another organization hold nothing; a confined retry looks in the
 *   member's workspace it joins; a payload naming another organization locks
 *   nothing; a person's run and its retry are left as they were (all-door
 *   admission is TALE-386's).
 *
 * The queue is inert: every agent-turn and retry job the lane's projects
 * enqueue is parked a day past its own start at the queue's insert, no
 * worker takes one, and the lane delivers each retry job itself, as pg-boss
 * would. No sandbox, provider or model is touched. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql, TransactionSql } from 'postgres';

import { memberSessionIdForProjectAgent } from '../../core/sandbox/session_naming.ts';
import { createTaskList } from '../../jobs/task-list.ts';
import {
  archiveProject,
  getProjectAuthContext,
  restoreProject,
} from '../projects/service.ts';
import { failAgentRunFromTurn, settleAgentRun } from './agent-runs.ts';
import {
  describeRuns,
  fixtures,
  holdAgentJobs,
  runsOf,
  waitFor,
  type LaneCtx,
  type Recorder,
} from './delegated-start.integration.ts';
import {
  startDelegatedAgentRun,
  type DelegatedAgentStart,
} from './delegated-start.ts';
import { archiveTask, assignTask, updateTaskStatus } from './service.ts';

/** How long a case waits for one transaction to queue behind another. */
const BLOCK_WAIT_MS = 10_000;

/** One point a transaction waits at until the case lets it go on. */
interface Gate {
  reached: Promise<void>;
  reach: () => void;
  released: Promise<void>;
  release: () => void;
}

function gate(): Gate {
  let reach!: () => void;
  const reached = new Promise<void>((resolve) => {
    reach = resolve;
  });
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { reached, reach, released, release };
}

/** Whether the gate was reached within the wait. */
async function reachedWithin(at: Gate, ms: number): Promise<boolean> {
  return Promise.race([
    at.reached.then(() => true),
    new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), ms);
    }),
  ]);
}

type Begin = (
  first: string | ((tx: TransactionSql) => Promise<unknown>),
  second?: (tx: TransactionSql) => Promise<unknown>,
) => Promise<unknown>;

/** The SQLSTATE an error carries, else its text. */
function codeOf(error: unknown): string {
  return error instanceof Error && 'code' in error
    ? String(error.code)
    : String(error);
}

/**
 * `sql` whose transactions report each attempt's backend (`onAttempt`) and
 * the code it failed with (`onError`) and, with `hold`, wait at their first
 * statement after the one naming `hold.after` until the gate opens — the
 * lock that statement took is held meanwhile. Covers `begin(fn)` and the
 * serializable `begin(options, fn)`.
 */
function traced(
  sql: Sql,
  options: {
    onAttempt?: (pid: number) => void;
    onError?: (code: string) => void;
    hold?: { after: string; at: Gate };
  },
): Sql {
  return new Proxy(sql, {
    get(target, property, receiver) {
      if (property !== 'begin') return Reflect.get(target, property, receiver);
      const begin: Begin = (first, second) => {
        const body = typeof first === 'function' ? first : second;
        if (body === undefined) throw new Error('itest: begin without a body');
        const run = async (tx: TransactionSql) => {
          if (options.onAttempt !== undefined) {
            const rows = await tx<{ pid: number }[]>`
              SELECT pg_backend_pid() AS pid
            `;
            options.onAttempt(rows[0]?.pid ?? 0);
          }
          const hold = options.hold;
          if (hold === undefined) return body(tx);
          let seen = false;
          let held = false;
          const wrapped = new Proxy(tx, {
            apply(fn, thisArg, argArray: unknown[]) {
              const strings = argArray[0];
              const statement =
                Array.isArray(strings) && Object.hasOwn(strings, 'raw');
              if (statement && seen && !held) {
                held = true;
                hold.at.reach();
                return hold.at.released.then(() =>
                  Reflect.apply(fn, thisArg, argArray),
                );
              }
              if (statement && strings.join('').includes(hold.after)) {
                seen = true;
              }
              return Reflect.apply(fn, thisArg, argArray);
            },
          });
          return body(wrapped);
        };
        const attempt =
          typeof first === 'function'
            ? target.begin(run)
            : target.begin(first, run);
        return attempt.catch((error: unknown) => {
          options.onError?.(codeOf(error));
          throw error;
        });
      };
      return begin;
    },
  });
}

/** The code a settled promise failed with, or `committed`. */
function outcomeOf(result: PromiseSettledResult<unknown>): string {
  return result.status === 'fulfilled' ? 'committed' : codeOf(result.reason);
}

interface RetryJob {
  id: string;
  /** The queue it was sent to. */
  name: string;
  /** Its pg-boss state: `created` is queued, `active` taken by a worker. */
  state: string;
  data: Record<string, unknown>;
  /** How long after its send the job was meant to start, in seconds. */
  waitSeconds: number;
}

/** The queues a failed run's retry is delivered on: the arm, and the later
 * checks of a retry that waits for its busy agent. */
const RETRY_QUEUES = ['task.agent_retry', 'task.agent_retry_recheck'];

export async function checkAutomatedRetryAgentBusy(
  sql: Sql,
  base: string,
  ctx: LaneCtx,
  record: Recorder,
): Promise<void> {
  const { orgId, userId } = ctx;
  const fx = fixtures(sql, ctx);
  const { suffix } = fx;
  const projectA = randomUUID();
  const foreignOrg = randomUUID();
  const foreignProject = randomUUID();
  const manager = randomUUID();
  const worker = randomUUID();
  const other = randomUUID();
  const editor = `busy-editor-${suffix}`;
  const standing = `pa-${worker}`;
  const release = await holdAgentJobs(sql, suffix, [projectA, foreignProject], {
    keepDelay: true,
  });
  const owner = {
    organizationId: orgId,
    userId,
    role: 'owner',
    teamIds: [] as string[],
  };

  const tasks = createTaskList({ sql });
  /** Every line the retry worker logged about its outcome, verbatim: the raw
   * record a case's detail quotes. */
  const raw: string[] = [];
  /** The outcome lines of the delivery running in this async context — one
   * list per delivery, so deliveries at once neither share one nor leave a
   * stale capture behind (the harness's own `record` lines always print). */
  const heard = new AsyncLocalStorage<string[]>();
  const consoleLog = console.log;
  const OUTCOME = /auto-retry (skipped|waiting): (\S+)/;

  /** Hand a retry job to the real worker of its queue, as pg-boss would;
   * answers what it logged: `skipped:<reason>` or `waiting:<reason>`,
   * nothing when it started the retry. */
  const deliver = async (
    payload: unknown,
    through: Sql = sql,
    queue = 'task.agent_retry',
  ): Promise<string[]> => {
    const handler =
      through === sql ? tasks[queue] : createTaskList({ sql: through })[queue];
    if (handler === undefined) {
      throw new Error(`itest: no worker for ${queue}`);
    }
    const lines: string[] = [];
    await heard.run(lines, () => handler(payload));
    return lines.map((line) => {
      const match = OUTCOME.exec(line);
      return `${match?.[1]}:${match?.[2]}`;
    });
  };
  /** The worker's lines since the last call, verbatim. */
  const rawSince = (): string[] => raw.splice(0, raw.length);
  const retryJobsOf = (runId: string) =>
    sql<RetryJob[]>`
      SELECT id, name, state::text AS state, data,
             extract(epoch FROM start_after - created_on)::float8 - 86400
               AS "waitSeconds"
      FROM pgboss.job
      WHERE name IN ${sql(RETRY_QUEUES)}
        AND data ->> 'expectedRunId' = ${runId}
      ORDER BY created_on, id
    `;
  /** The later checks a waiting retry sent itself, on whichever queue. */
  const looksOf = async (runId: string): Promise<RetryJob[]> =>
    (await retryJobsOf(runId)).filter(
      (job) => job.data.agentBusyWaits !== undefined,
    );
  /** Its future checks: the ones still queued. */
  const queuedChecksOf = async (runId: string): Promise<RetryJob[]> =>
    (await looksOf(runId)).filter((job) => job.state === 'created');
  // The delivery lifecycle as pg-boss runs it (`pgboss.job` states). A
  // worker's fetch takes a queued job (created → active); its completion
  // acknowledges it; a job whose worker died after its handler committed is
  // expired and queued again for its retry (active → retry) and taken anew.
  const fetchJob = (id: string) => sql`
    UPDATE pgboss.job SET state = 'active', started_on = now()
    WHERE id = ${id} AND state IN ('created', 'retry')
  `;
  const completeJob = (id: string) => sql`
    UPDATE pgboss.job SET state = 'completed', completed_on = now()
    WHERE id = ${id} AND state = 'active'
  `;
  const expireJob = (id: string) => sql`
    UPDATE pgboss.job SET state = 'retry', retry_count = retry_count + 1
    WHERE id = ${id} AND state = 'active'
  `;
  /** A queued job taken, run and acknowledged, as a worker does. */
  const runJob = async (job: RetryJob): Promise<string[]> => {
    await fetchJob(job.id);
    const lines = await deliver(job.data, sql, job.name);
    await completeJob(job.id);
    return lines;
  };
  /** When the failed run's automatic retry was retired, if it was — read
   * off the whole row, so the lane also runs on a schema without it. */
  const retiredAt = async (runId: string): Promise<string | null> => {
    const rows = await sql<{ at: string | null }[]>`
      SELECT to_jsonb(r) ->> 'auto_retry_refused_at_ms' AS at
      FROM app.project_agent_runs r WHERE id = ${runId}
    `;
    return rows[0]?.at ?? null;
  };
  const liveIn = (sessionId: string) =>
    sql<{ id: string; taskId: string; trigger: string | null }[]>`
      SELECT id, task_id AS "taskId", trigger FROM app.project_agent_runs
      WHERE org_id = ${orgId} AND session_id = ${sessionId}
        AND status IN ('queued', 'running')
      ORDER BY seq
    `;
  const retryFacts = async (runId: string) => {
    const rows = await sql<{ attempt: number | null; inPlace: boolean }[]>`
      SELECT auto_retry_attempt AS attempt, in_place AS "inPlace"
      FROM app.project_agent_runs WHERE id = ${runId}
    `;
    return rows[0];
  };
  const refusalsOf = (taskId: string) =>
    sql<{ actorId: string; toValue: string | null }[]>`
      SELECT actor_id AS "actorId", to_value AS "toValue"
      FROM app.task_activity
      WHERE task_id = ${taskId} AND action = 'agent_run.refused'
      ORDER BY id
    `;
  const agentVersion = async (agentId: string): Promise<string> => {
    const rows = await sql<{ version: string }[]>`
      SELECT xmin::text AS version FROM app.project_agents WHERE id = ${agentId}
    `;
    return rows[0]?.version ?? 'missing';
  };
  /** Whether a row can be locked right now (`FOR UPDATE NOWAIT` in a
   * transaction of its own, rolled back). */
  const lockable = async (
    lock: (tx: TransactionSql) => Promise<unknown>,
  ): Promise<boolean> => {
    const done = new Error('itest: probe rolled back');
    try {
      await sql.begin(async (tx) => {
        await lock(tx);
        throw done;
      });
    } catch (error) {
      if (error === done) return true;
      if (error instanceof Error && 'code' in error && error.code === '55P03') {
        return false;
      }
      throw error;
    }
    return true;
  };
  const taskLockable = (taskId: string) =>
    lockable(
      (tx) =>
        tx`SELECT id FROM app.tasks WHERE id = ${taskId} FOR UPDATE NOWAIT`,
    );
  const agentLockable = (agentId: string) =>
    lockable(
      (tx) =>
        tx`SELECT id FROM app.project_agents WHERE id = ${agentId} FOR UPDATE NOWAIT`,
    );
  /** Whether the backend `waiter()` waits on the backend `holder()`. */
  const blockedBy = (waiter: () => number, holder: () => number) =>
    waitFor(async () => {
      if (waiter() === 0 || holder() === 0) return false;
      const rows = await sql<{ blockers: number[] }[]>`
        SELECT pg_blocking_pids(${waiter()}::int) AS blockers
      `;
      return rows[0]?.blockers.includes(holder()) ?? false;
    }, BLOCK_WAIT_MS);
  /** Settle every live run of the agent, so it is free again. */
  const free = async (agentId: string) => {
    const live = await sql<{ id: string }[]>`
      SELECT id FROM app.project_agent_runs
      WHERE org_id = ${orgId} AND agent_id = ${agentId}
        AND status IN ('queued', 'running')
    `;
    for (const run of live) {
      await settleAgentRun(sql, { runId: run.id, resultText: 'itest: done' });
    }
  };

  let managerRun = '';
  /** The manager's `task_start_agent`, as the tool door runs it: the
   * delegated start in a serializable transaction, for the editor its run
   * answers to. */
  const delegate = (
    taskId: string,
    extra: { agentId?: string; moveToInProgress?: boolean } = {},
    through: Sql = sql,
  ): Promise<DelegatedAgentStart> =>
    transactSerializable(through, (tx) =>
      startDelegatedAgentRun(tx, {
        organizationId: orgId,
        scopeProjectIds: [projectA],
        taskId,
        startedBy: editor,
        via: { kind: 'agent', runId: managerRun, agentId: manager },
        ...extra,
      }),
    );
  /** Fail the task's newest run as a crashed turn does; answers the retry
   * job that failure armed. */
  const failNewest = async (
    taskId: string,
  ): Promise<{ runId: string; payload: Record<string, unknown> }> => {
    const newest = (await runsOf(sql, taskId)).at(-1);
    if (newest === undefined) {
      throw new Error(`itest: task ${taskId} has no run to fail`);
    }
    await failAgentRunFromTurn(sql, {
      runId: newest.id,
      execId: newest.execId,
      error: 'itest: the harness exited before the turn completed',
      failureCode: 'turn_crashed',
    });
    const jobs = await retryJobsOf(newest.id);
    const payload = jobs[0]?.data;
    if (jobs.length !== 1 || payload === undefined) {
      throw new Error(`itest: ${jobs.length} retry jobs armed (want 1)`);
    }
    return { runId: newest.id, payload };
  };
  /** A task the manager handed the worker whose run then failed: its retry
   * armed, the worker free again. */
  const failedDelegation = async (
    title: string,
    extra: { moveToInProgress?: boolean } = {},
  ) => {
    const taskId = await fx.insertTask({ projectId: projectA, title });
    const started = await delegate(taskId, { agentId: worker, ...extra });
    if (started.outcome !== 'started') {
      throw new Error(`itest: delegating ${title} answered ${started.outcome}`);
    }
    return { taskId, ...(await failNewest(taskId)) };
  };
  /** The manager puts the worker to work on another task. */
  const occupy = async (title: string) => {
    const taskId = await fx.insertTask({ projectId: projectA, title });
    const started = await delegate(taskId, { agentId: worker });
    return { taskId, outcome: started.outcome };
  };
  const editorAuth = () =>
    getProjectAuthContext(sql, {
      organizationId: orgId,
      userId: editor,
      role: 'editor',
    });

  console.log = (...args: unknown[]) => {
    const lines = heard.getStore();
    const line = args.map(String).join(' ');
    if (lines !== undefined && OUTCOME.test(line)) {
      lines.push(line);
      raw.push(line);
      return;
    }
    consoleLog(...args);
  };
  try {
    await fx.insertUser(editor, 'editor');
    await fx.insertProject(projectA, 'Busy agent retries');
    await fx.insertAgent(manager, projectA, 'Fleet manager');
    await fx.insertAgent(worker, projectA, 'Implementer');
    await fx.insertAgent(other, projectA, 'Second implementer');
    const roleTask = await fx.insertTask({
      projectId: projectA,
      title: 'Manager role',
      status: 'in_progress',
      agentId: manager,
    });
    // The manager's own live run, started by the editor in its standing
    // workspace: what the tool door finds for its session.
    const managerRows = await sql<{ id: string }[]>`
      INSERT INTO app.project_agent_runs (
        org_id, project_id, task_id, agent_id, exec_id, session_id, status,
        harness, model, trigger, started_by, started_at_ms, launched_at_ms,
        deadline_at_ms, updated_at_ms
      ) VALUES (
        ${orgId}, ${projectA}, ${roleTask}, ${manager},
        ${`exec-${randomUUID().slice(0, 12)}`}, ${`pa-${manager}`}, 'running',
        'claude-code', 'itest-model', 'manual', ${editor},
        ${Date.now() - 2_000}, ${Date.now() - 1_000},
        ${Date.now() + 3_600_000}, ${Date.now()}
      ) RETURNING id
    `;
    managerRun = managerRows[0]?.id ?? '';

    // ---- the reported sequence: B starts first, then A's retry ---------
    const a1 = await failedDelegation('Delegated work that fails');
    const b1 = await occupy('Next work for the free agent');
    const agentBeforeWait = await agentVersion(worker);
    const waited = await deliver(a1.payload);
    const agentAfterWait = await agentVersion(worker);
    const a1Runs = await runsOf(sql, a1.taskId);
    const liveAfterWait = await liveIn(standing);
    const a1Looks = await looksOf(a1.runId);
    const a1Look = a1Looks[0];
    record(
      'busy retry: a delegated task fails, the manager starts the free agent on another task, and the failed task’s retry then waits — no second run joins the workspace, the retry sends itself a later look, and nothing is refused yet',
      b1.outcome === 'started' &&
        describeRuns(a1Runs) === 'failed/delegated' &&
        liveAfterWait.length === 1 &&
        liveAfterWait[0]?.taskId === b1.taskId &&
        JSON.stringify(waited) === JSON.stringify(['waiting:agent_busy']) &&
        a1Looks.length === 1 &&
        a1Look?.data.expectedRunId === a1.runId &&
        a1Look.data.taskId === a1.taskId &&
        a1Look.data.agentId === worker &&
        a1Look.data.agentBusyWaits === 1 &&
        a1Look.waitSeconds >= 60 &&
        a1Look.waitSeconds <= 3_600 &&
        agentAfterWait !== agentBeforeWait &&
        (await refusalsOf(a1.taskId)).length === 0,
      `B=${b1.outcome} A runs=${describeRuns(a1Runs)} (want failed/delegated) live in the workspace=${JSON.stringify(liveAfterWait)} (want B alone) log=${JSON.stringify(waited)} looks=${JSON.stringify(a1Looks)} (want one, agentBusyWaits 1, a wait of minutes) agent row written=${agentAfterWait !== agentBeforeWait} refusals=${(await refusalsOf(a1.taskId)).length}`,
    );

    // ---- the workspace settles: the next look starts the retry ---------
    await free(worker);
    const started =
      a1Look === undefined ? ['no look'] : await deliver(a1Look.data);
    const a1After = await runsOf(sql, a1.taskId);
    const retry = a1After[1];
    const retryState =
      retry === undefined ? undefined : await retryFacts(retry.id);
    const hourly = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.project_agent_runs
      WHERE task_id = ${a1.taskId} AND started_via IS NOT NULL
    `;
    record(
      'busy retry: once the run holding the workspace settles, the waiting retry starts on its next look — the same chain’s automatic retry (its starter, delegated provenance, standing workspace) at its first attempt, the wait having spent nothing',
      started.length === 0 &&
        describeRuns(a1After) === 'failed/delegated,queued/auto_retry' &&
        retry?.startedBy === editor &&
        retry.startedVia === 'agent' &&
        retry.viaRunId === managerRun &&
        retry.viaAgentId === manager &&
        retry.sessionId === standing &&
        retryState?.attempt === 1 &&
        hourly[0]?.count === 2 &&
        (await looksOf(a1.runId)).length === 1,
      `log=${JSON.stringify(started)} runs=${describeRuns(a1After)} retry=${JSON.stringify(retry)} attempt=${retryState?.attempt} (want 1) automated starts=${hourly[0]?.count} (want 2)`,
    );
    await free(worker);

    // ---- the retry first: the manager's next start answers busy --------
    const a2 = await failedDelegation('Retried at once');
    const kicked = await deliver(a2.payload);
    const b2Task = await fx.insertTask({
      projectId: projectA,
      title: 'Asked for while the retry runs',
    });
    const b2 = await delegate(b2Task, { agentId: worker });
    const liveAfterRetry = await liveIn(standing);
    record(
      'busy retry: a retry that finds the workspace free starts, and the manager’s start of that agent on another task then answers agent_busy — one live run',
      kicked.length === 0 &&
        b2.outcome === 'agent_busy' &&
        b2.busyTaskId === a2.taskId &&
        liveAfterRetry.length === 1 &&
        liveAfterRetry[0]?.taskId === a2.taskId &&
        liveAfterRetry[0].trigger === 'auto_retry',
      `log=${JSON.stringify(kicked)} B=${JSON.stringify(b2)} live=${JSON.stringify(liveAfterRetry)}`,
    );
    await free(worker);

    // ---- racing, the delegated start holds the agent row first ---------
    {
      const a = await failedDelegation('Race: retry second');
      const bTask = await fx.insertTask({
        projectId: projectA,
        title: 'Race: delegated first',
      });
      const at = gate();
      let bPid = 0;
      const bStart = delegate(
        bTask,
        { agentId: worker },
        traced(sql, {
          onAttempt: (pid) => {
            bPid = pid;
          },
          hold: { after: 'UPDATE app.project_agents', at },
        }),
      );
      const bHolds = await reachedWithin(at, BLOCK_WAIT_MS);
      let retryPid = 0;
      const retryDelivery = deliver(
        a.payload,
        traced(sql, {
          onAttempt: (pid) => {
            retryPid = pid;
          },
        }),
      );
      const retryQueued = await blockedBy(
        () => retryPid,
        () => bPid,
      );
      const taskFree = await taskLockable(a.taskId);
      at.release();
      const [bResult, retryResult] = await Promise.allSettled([
        bStart,
        retryDelivery,
      ]);
      const live = await liveIn(standing);
      const aRuns = await runsOf(sql, a.taskId);
      const b =
        bResult.status === 'fulfilled' ? bResult.value : outcomeOf(bResult);
      const log =
        retryResult.status === 'fulfilled'
          ? retryResult.value
          : [outcomeOf(retryResult)];
      record(
        'busy retry, racing: while a delegated start holds the agent row, the retry queues on it holding no task lock, then sees the committed start and waits — one live run',
        bHolds &&
          retryQueued &&
          taskFree &&
          typeof b === 'object' &&
          b.outcome === 'started' &&
          JSON.stringify(log) === JSON.stringify(['waiting:agent_busy']) &&
          describeRuns(aRuns) === 'failed/delegated' &&
          live.length === 1 &&
          live[0]?.taskId === bTask,
        `start held the agent row=${bHolds} retry queued behind it=${retryQueued} task row free meanwhile=${taskFree} start=${JSON.stringify(b)} retry log=${JSON.stringify(log)} A runs=${describeRuns(aRuns)} live=${JSON.stringify(live)}`,
      );
      await free(worker);
    }

    // ---- racing, the retry holds the agent row first --------------------
    {
      const a = await failedDelegation('Race: retry first');
      const bTask = await fx.insertTask({
        projectId: projectA,
        title: 'Race: delegated second',
      });
      const at = gate();
      let retryPid = 0;
      const retryDelivery = deliver(
        a.payload,
        traced(sql, {
          onAttempt: (pid) => {
            retryPid = pid;
          },
          hold: { after: 'UPDATE app.project_agents', at },
        }),
      );
      const retryHolds = await reachedWithin(at, BLOCK_WAIT_MS);
      const agentHeld = retryHolds && !(await agentLockable(worker));
      const taskFree = await taskLockable(a.taskId);
      let bPid = 0;
      let attempts = 0;
      const bErrors: string[] = [];
      const bStart = delegate(
        bTask,
        { agentId: worker },
        traced(sql, {
          onAttempt: (pid) => {
            bPid = pid;
            attempts += 1;
          },
          onError: (code) => bErrors.push(code),
        }),
      );
      const bQueued = retryHolds
        ? await blockedBy(
            () => bPid,
            () => retryPid,
          )
        : false;
      at.release();
      const [retryResult, bResult] = await Promise.allSettled([
        retryDelivery,
        bStart,
      ]);
      const live = await liveIn(standing);
      const b =
        bResult.status === 'fulfilled' ? bResult.value : outcomeOf(bResult);
      const log =
        retryResult.status === 'fulfilled'
          ? retryResult.value
          : [outcomeOf(retryResult)];
      record(
        'busy retry, racing: the retry takes the agent row before the task row; the delegated start queued on it fails its first serializable attempt on that write and, on a fresh snapshot, answers agent_busy — one live run',
        retryHolds &&
          agentHeld &&
          taskFree &&
          bQueued &&
          log.length === 0 &&
          typeof b === 'object' &&
          b.outcome === 'agent_busy' &&
          b.busyTaskId === a.taskId &&
          attempts >= 2 &&
          bErrors[0] === '40001' &&
          live.length === 1 &&
          live[0]?.taskId === a.taskId,
        `retry held the agent row=${retryHolds}/${agentHeld} task row free meanwhile=${taskFree} start queued behind it=${bQueued} retry log=${JSON.stringify(log)} start=${JSON.stringify(b)} start attempts=${attempts} (want ≥ 2) failed with=${JSON.stringify(bErrors)} (want 40001 first) live=${JSON.stringify(live)}`,
      );
      await free(worker);
    }

    // ---- racing, unordered ---------------------------------------------
    {
      const rounds: string[] = [];
      let allOne = true;
      for (let round = 1; round <= 3; round++) {
        const a = await failedDelegation(`Unordered race ${round}: retry`);
        const bTask = await fx.insertTask({
          projectId: projectA,
          title: `Unordered race ${round}: delegated`,
        });
        let attempts = 0;
        const errors: string[] = [];
        const [log, b] = await Promise.all([
          deliver(a.payload),
          delegate(
            bTask,
            { agentId: worker },
            traced(sql, {
              onAttempt: () => {
                attempts += 1;
              },
              onError: (code) => errors.push(code),
            }),
          ),
        ]);
        const live = await liveIn(standing);
        const retryWon =
          log.length === 0 &&
          b.outcome === 'agent_busy' &&
          live[0]?.taskId === a.taskId;
        const startWon =
          JSON.stringify(log) === JSON.stringify(['waiting:agent_busy']) &&
          b.outcome === 'started' &&
          live[0]?.taskId === bTask;
        if (live.length !== 1 || !(retryWon || startWon)) allOne = false;
        // The raw outcome of the round: who won, what each side answered,
        // how many serializable attempts the start took and what failed
        // them, and every live run of the workspace by its trigger.
        rounds.push(
          `${round}: winner=${retryWon ? 'retry' : startWon ? 'start' : 'none'} retry=${JSON.stringify(log)} start=${b.outcome} start attempts=${attempts} failed with=${JSON.stringify(errors)} live=${JSON.stringify(live.map((run) => `${run.trigger ?? 'manual'}@${run.taskId === a.taskId ? 'retry task' : run.taskId === bTask ? 'start task' : run.taskId}`))}`,
        );
        await free(worker);
      }
      record(
        'busy retry, racing unordered: in three rounds of a retry and a delegated start sent together for one free agent, each round leaves one live run, and the loser waits or answers agent_busy',
        allOne,
        rounds.join('; '),
      );
    }

    // ---- lock order: task before agent would deadlock -------------------
    {
      // The manager restarts task X (agent row, then the task row) while a
      // transaction holds X and then wants the agent: the order the retry
      // must never take.
      const x = await failedDelegation('Lock order: the task first');
      const at = gate();
      let restartPid = 0;
      const restartErrors: string[] = [];
      const restart = delegate(
        x.taskId,
        {},
        traced(sql, {
          onAttempt: (pid) => {
            restartPid = pid;
          },
          onError: (code) => restartErrors.push(code),
          hold: { after: 'UPDATE app.project_agents', at },
        }),
      );
      const restartHolds = await reachedWithin(at, BLOCK_WAIT_MS);
      let invertedPid = 0;
      const inverted = sql.begin(async (tx) => {
        const pid = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        invertedPid = pid[0]?.pid ?? 0;
        await tx`SELECT id FROM app.tasks WHERE id = ${x.taskId} FOR UPDATE`;
        await tx`
          UPDATE app.project_agents SET updated_at_ms = updated_at_ms
          WHERE id = ${worker}
        `;
      });
      const invertedQueued = await blockedBy(
        () => invertedPid,
        () => restartPid,
      );
      at.release();
      const [invertedResult, restartResult] = await Promise.allSettled([
        inverted,
        restart,
      ]);
      await free(worker);

      // The real retry in the same interleaving.
      const y = await failedDelegation('Lock order: the real retry');
      const at2 = gate();
      let restart2Pid = 0;
      const restart2 = delegate(
        y.taskId,
        {},
        traced(sql, {
          onAttempt: (pid) => {
            restart2Pid = pid;
          },
          hold: { after: 'UPDATE app.project_agents', at: at2 },
        }),
      );
      const restart2Holds = await reachedWithin(at2, BLOCK_WAIT_MS);
      let retryPid = 0;
      const retryDelivery = deliver(
        y.payload,
        traced(sql, {
          onAttempt: (pid) => {
            retryPid = pid;
          },
        }),
      );
      const retryQueued = await blockedBy(
        () => retryPid,
        () => restart2Pid,
      );
      const taskFree = await taskLockable(y.taskId);
      at2.release();
      const [retryResult, restart2Result] = await Promise.allSettled([
        retryDelivery,
        restart2,
      ]);
      const yRuns = await runsOf(sql, y.taskId);
      const restarted =
        restart2Result.status === 'fulfilled'
          ? restart2Result.value.outcome
          : outcomeOf(restart2Result);
      const log =
        retryResult.status === 'fulfilled'
          ? retryResult.value
          : [outcomeOf(retryResult)];
      record(
        'busy retry, lock order: a transaction that holds the task and then wants the agent deadlocks beside the manager restarting that task (40P01) — the order the retry avoids',
        restartHolds &&
          invertedQueued &&
          (outcomeOf(invertedResult) === '40P01' ||
            restartErrors.includes('40P01')),
        `restart held the agent row=${restartHolds} task-first transaction queued behind it=${invertedQueued} and ended ${outcomeOf(invertedResult)} restart attempts failed with=${JSON.stringify(restartErrors)} restart=${restartResult.status === 'fulfilled' ? restartResult.value.outcome : outcomeOf(restartResult)}`,
      );
      record(
        'busy retry, lock order: in the same interleaving the retry queues on the agent row holding no task lock — no deadlock — and, once the restart commits, stands down as superseded',
        restart2Holds &&
          retryQueued &&
          taskFree &&
          restarted === 'started' &&
          JSON.stringify(log) === JSON.stringify(['skipped:superseded']) &&
          describeRuns(yRuns) === 'failed/delegated,queued/delegated',
        `restart held the agent row=${restart2Holds} retry queued behind it=${retryQueued} task row free meanwhile=${taskFree} restart=${restarted} retry log=${JSON.stringify(log)} runs=${describeRuns(yRuns)}`,
      );
      await free(worker);
    }

    // ---- standing roles: a To do card waits for its next occurrence -----
    {
      const role = await failedDelegation('Standing report', {
        moveToInProgress: false,
      });
      const busy = await occupy('Work while the role waits');
      const log = await deliver(role.payload);
      const card = await sql<{ status: string }[]>`
        SELECT status FROM app.tasks WHERE id = ${role.taskId}
      `;
      record(
        'busy retry: a To do standing card’s failed in-place run is still not retried, busy agent or not — it waits for its next occurrence, and no later look is sent',
        busy.outcome === 'started' &&
          JSON.stringify(log) === JSON.stringify(['skipped:task_moved']) &&
          card[0]?.status === 'todo' &&
          (await looksOf(role.runId)).length === 0 &&
          (await runsOf(sql, role.taskId)).length === 1,
        `busy=${busy.outcome} log=${JSON.stringify(log)} card=${card[0]?.status} looks=${(await looksOf(role.runId)).length}`,
      );
      await free(worker);

      // A person picked the role card up while its run was live: its retry
      // waits like any other and keeps the in-place intent when it starts.
      const pickedTask = await fx.insertTask({
        projectId: projectA,
        title: 'Standing role a person picked up',
      });
      const pickedStart = await delegate(pickedTask, {
        agentId: worker,
        moveToInProgress: false,
      });
      await sql.begin(async (tx) =>
        updateTaskStatus(tx, await editorAuth(), pickedTask, 'in_progress'),
      );
      const picked = await failNewest(pickedTask);
      const pickedBusy = await occupy('Work while the picked-up role waits');
      const pickedWait = await deliver(picked.payload);
      await free(worker);
      const pickedLook = (await looksOf(picked.runId))[0];
      const pickedLog =
        pickedLook === undefined ? ['no look'] : await deliver(pickedLook.data);
      const pickedRuns = await runsOf(sql, pickedTask);
      const pickedRetry = pickedRuns[1];
      const pickedFacts =
        pickedRetry === undefined
          ? undefined
          : await retryFacts(pickedRetry.id);
      record(
        'busy retry: a standing role card a person moved to In progress waits for the busy agent like any other, and its retry keeps the start’s in-place intent',
        pickedStart.outcome === 'started' &&
          pickedBusy.outcome === 'started' &&
          JSON.stringify(pickedWait) ===
            JSON.stringify(['waiting:agent_busy']) &&
          pickedLog.length === 0 &&
          describeRuns(pickedRuns) === 'failed/delegated,queued/auto_retry' &&
          pickedFacts?.inPlace === true,
        `start=${pickedStart.outcome} busy=${pickedBusy.outcome} wait=${JSON.stringify(pickedWait)} look=${JSON.stringify(pickedLog)} runs=${describeRuns(pickedRuns)} inPlace=${pickedFacts?.inPlace}`,
      );
      await free(worker);
    }

    // ---- the wait is bounded --------------------------------------------
    {
      const spent = await failedDelegation('Waits past its looks');
      const old = await failedDelegation('Waits past its age');
      await sql`
        UPDATE app.project_agent_runs
        SET settled_at_ms = settled_at_ms - ${30 * 24 * 60 * 60 * 1000}
        WHERE id = ${old.runId}
      `;
      const busy = await occupy('Long work');
      const pastLooks = await deliver({
        ...spent.payload,
        agentBusyWaits: 10_000,
      });
      const again = await deliver({ ...spent.payload, agentBusyWaits: 10_000 });
      const spentRefusals = await refusalsOf(spent.taskId);
      const pastAge = await deliver(old.payload);
      const oldRefusals = await refusalsOf(old.taskId);
      const spentRuns = await runsOf(sql, spent.taskId);
      await free(worker);
      // Nothing is queued behind the refusal: the manager decides again.
      const reconsidered = await delegate(spent.taskId);
      record(
        'busy retry: a retry past its looks, or past its age, is refused once on the task’s timeline as the agent (agent_run.refused, agent_busy) and retired on its failed run, sends no further look and starts nothing; a repeated delivery stands down on the retirement and adds no second refusal, and the manager’s next start of the task runs',
        busy.outcome === 'started' &&
          JSON.stringify(pastLooks) ===
            JSON.stringify(['skipped:agent_busy']) &&
          JSON.stringify(again) === JSON.stringify(['skipped:retry_refused']) &&
          (await retiredAt(spent.runId)) !== null &&
          (await retiredAt(old.runId)) !== null &&
          spentRefusals.length === 1 &&
          spentRefusals[0]?.toValue === 'agent_busy' &&
          spentRefusals[0].actorId === worker &&
          JSON.stringify(pastAge) === JSON.stringify(['skipped:agent_busy']) &&
          oldRefusals.length === 1 &&
          oldRefusals[0]?.toValue === 'agent_busy' &&
          (await looksOf(spent.runId)).length === 0 &&
          (await looksOf(old.runId)).length === 0 &&
          describeRuns(spentRuns) === 'failed/delegated' &&
          reconsidered.outcome === 'started',
        `past looks=${JSON.stringify(pastLooks)} again=${JSON.stringify(again)} (want retry_refused) retired=${await retiredAt(spent.runId)}/${await retiredAt(old.runId)} refusals=${JSON.stringify(spentRefusals)} past age=${JSON.stringify(pastAge)} refusals=${JSON.stringify(oldRefusals)} runs=${describeRuns(spentRuns)} manager restart=${reconsidered.outcome}`,
      );
      await free(worker);
    }

    // ---- one future check per failed run, however it is delivered ------
    {
      const replayed = await failedDelegation('Replayed while busy');
      const doubled = await failedDelegation('Delivered twice at once');
      const expired = await failedDelegation('Its check expires unacked');
      const busy = await occupy('Work that outlasts the duplicates');
      rawSince();
      // The arm delivered again after its commit, before its ack (pg-boss
      // redelivers what it never saw completed), its first check queued.
      const firstArm = await deliver(replayed.payload);
      const replayArm = await deliver(replayed.payload);
      const afterReplay = await queuedChecksOf(replayed.runId);
      // A worker takes that check, and the arm arrives once more meanwhile:
      // the replay may queue the next check, and the taken one, run, finds
      // it queued.
      const taken = afterReplay[0];
      if (taken !== undefined) await fetchJob(taken.id);
      const lateArm = await deliver(replayed.payload);
      const takenRun =
        taken === undefined
          ? ['no check']
          : await deliver(taken.data, sql, taken.name);
      if (taken !== undefined) await completeJob(taken.id);
      const afterLate = await queuedChecksOf(replayed.runId);
      // The same arm twice at once.
      const doubledRuns = await Promise.all([
        deliver(doubled.payload),
        deliver(doubled.payload),
      ]);
      const afterDouble = await queuedChecksOf(doubled.runId);
      // A check whose worker died after its handler committed: pg-boss
      // expires it, queues it for its retry, and a worker takes it again.
      await deliver(expired.payload);
      const check = (await queuedChecksOf(expired.runId))[0];
      const expiredRuns: string[] = [];
      if (check !== undefined) {
        await fetchJob(check.id);
        expiredRuns.push(...(await deliver(check.data, sql, check.name)));
        await expireJob(check.id);
        await fetchJob(check.id);
        expiredRuns.push(...(await deliver(check.data, sql, check.name)));
        await completeJob(check.id);
      }
      const afterExpiry = await queuedChecksOf(expired.runId);
      // The one chain still moves on: its queued check, run, queues the
      // next, a delay later and one look further.
      const next = afterExpiry[0];
      const nextRun = next === undefined ? ['no check'] : await runJob(next);
      const afterNext = await queuedChecksOf(expired.runId);
      const lines = rawSince();
      const runs = [
        ...(await runsOf(sql, replayed.taskId)),
        ...(await runsOf(sql, doubled.taskId)),
        ...(await runsOf(sql, expired.taskId)),
      ];
      const live = await liveIn(standing);
      const shape = (jobs: RetryJob[]) =>
        jobs.map((job) => `${job.name}#${String(job.data.agentBusyWaits)}`);
      record(
        'busy retry, replayed: a failed run has at most one future check queued — its arm delivered again before the ack, again after a worker took the queued check, twice at once, and a check that expired unacknowledged and was taken again all collapse onto one — while the one chain still moves on, and nothing starts beside the busy agent',
        busy.outcome === 'started' &&
          JSON.stringify(firstArm) === JSON.stringify(['waiting:agent_busy']) &&
          JSON.stringify(replayArm) ===
            JSON.stringify(['waiting:agent_busy']) &&
          afterReplay.length === 1 &&
          JSON.stringify(lateArm) === JSON.stringify(['waiting:agent_busy']) &&
          JSON.stringify(takenRun) === JSON.stringify(['waiting:agent_busy']) &&
          afterLate.length === 1 &&
          afterLate[0]?.id !== taken?.id &&
          doubledRuns.every(
            (run) =>
              JSON.stringify(run) === JSON.stringify(['waiting:agent_busy']),
          ) &&
          afterDouble.length === 1 &&
          check !== undefined &&
          JSON.stringify(expiredRuns) ===
            JSON.stringify(['waiting:agent_busy', 'waiting:agent_busy']) &&
          afterExpiry.length === 1 &&
          JSON.stringify(nextRun) === JSON.stringify(['waiting:agent_busy']) &&
          afterNext.length === 1 &&
          afterNext[0]?.id !== next?.id &&
          afterNext[0]?.data.agentBusyWaits ===
            Number(next?.data.agentBusyWaits) + 1 &&
          afterNext[0].waitSeconds >= 60 &&
          runs.every((run) => run.status === 'failed') &&
          live.length === 1 &&
          live[0]?.taskId === busy.taskId,
        `queued after the replayed arm=${JSON.stringify(shape(afterReplay))} after the late arm and the taken check=${JSON.stringify(shape(afterLate))} after the double delivery=${JSON.stringify(shape(afterDouble))} after the expired check ran twice=${JSON.stringify(shape(afterExpiry))} after the chain moved on=${JSON.stringify(shape(afterNext))} (want one each time) runs=${runs.map((run) => `${run.status}/${run.trigger ?? 'manual'}`).join(',')} live=${JSON.stringify(live.map((run) => run.trigger))} worker said=${JSON.stringify(lines)}`,
      );
      await free(worker);
    }

    // ---- a refused retry stays refused, busy or free ---------------------
    {
      const refused = await failedDelegation('Refused, then replayed free');
      const person = await failedDelegation(
        'Refused, then started by a person',
      );
      const busy = await occupy('Work that outlasts every check');
      rawSince();
      // A check queued before the refusal, then the check that ends the wait.
      await deliver(refused.payload);
      const pending = (await queuedChecksOf(refused.runId))[0];
      const lastCheck = { ...refused.payload, agentBusyWaits: 10_000 };
      const refusal = await deliver(lastCheck);
      const retired = await retiredAt(refused.runId);
      await deliver({ ...person.payload, agentBusyWaits: 10_000 });
      await free(worker);
      // The agent is free; the same jobs arrive again.
      const replayLast = await deliver(lastCheck);
      const replayArm = await deliver(refused.payload);
      const replayPending =
        pending === undefined ? ['no check'] : await runJob(pending);
      const lines = rawSince();
      const refusedRuns = await runsOf(sql, refused.taskId);
      const refusals = await refusalsOf(refused.taskId);
      const queued = await queuedChecksOf(refused.runId);
      record(
        'busy retry, refused: once refused, the failed run’s automatic retry stays retired — the identical last check, the arm and a check queued before the refusal, delivered again after the agent is free, start nothing and queue nothing, and the refusal stays one row',
        busy.outcome === 'started' &&
          JSON.stringify(refusal) === JSON.stringify(['skipped:agent_busy']) &&
          retired !== null &&
          pending !== undefined &&
          JSON.stringify(replayLast) ===
            JSON.stringify(['skipped:retry_refused']) &&
          JSON.stringify(replayArm) ===
            JSON.stringify(['skipped:retry_refused']) &&
          JSON.stringify(replayPending) ===
            JSON.stringify(['skipped:retry_refused']) &&
          describeRuns(refusedRuns) === 'failed/delegated' &&
          refusals.length === 1 &&
          queued.length === 0 &&
          (await liveIn(standing)).length === 0,
        `refusal=${JSON.stringify(refusal)} retired=${retired} replays last/arm/queued-before=${JSON.stringify([replayLast, replayArm, replayPending])} (want retry_refused each) runs=${describeRuns(refusedRuns)} refusals=${refusals.length} queued checks=${queued.length} worker said=${JSON.stringify(lines)}`,
      );

      // A newer decision still starts: the manager restarts the task, and
      // the failure of that run retries on its own; a person's Start on the
      // other refused task starts too.
      const restart = await delegate(refused.taskId);
      const newer = await failNewest(refused.taskId);
      const newerRetry = await deliver(newer.payload);
      const newerRuns = await runsOf(sql, refused.taskId);
      await free(worker);
      const personStart = await fetch(
        `${base}/api/app/tasks/${person.taskId}/agent-runs/start?orgId=${orgId}`,
        { method: 'POST', headers: { cookie: ctx.cookie, origin: base } },
      );
      const personRuns = await runsOf(sql, person.taskId);
      record(
        'busy retry, refused: a newer decision still starts — the manager’s restart of the refused task runs, that run’s own failure retries as usual, and a person’s Start of another refused task runs',
        restart.outcome === 'started' &&
          newerRetry.length === 0 &&
          describeRuns(newerRuns) ===
            'failed/delegated,failed/delegated,queued/auto_retry' &&
          (await retiredAt(newer.runId)) === null &&
          personStart.status === 200 &&
          describeRuns(personRuns) === 'failed/delegated,queued/manual',
        `restart=${restart.outcome} newer retry=${JSON.stringify(newerRetry)} runs=${describeRuns(newerRuns)} person start=${personStart.status} runs=${describeRuns(personRuns)}`,
      );
      await free(worker);
    }

    // ---- a refusal is one transaction, delivered twice at once -----------
    {
      const twice = await failedDelegation('Refused twice at once');
      const busy = await occupy('Work that outlasts both refusals');
      rawSince();
      // The check that ends the wait and its replay, at once: one of them
      // writes the mark and the timeline row together, the other finds the
      // mark once the agent row is its turn.
      const lastCheck = { ...twice.payload, agentBusyWaits: 10_000 };
      const both = await Promise.all([deliver(lastCheck), deliver(lastCheck)]);
      const lines = rawSince();
      const outcomes = both.map((run) => JSON.stringify(run)).sort();
      const refusals = await refusalsOf(twice.taskId);
      const retired = await retiredAt(twice.runId);
      const looks = await looksOf(twice.runId);
      const twiceRuns = await runsOf(sql, twice.taskId);
      const live = await liveIn(standing);
      // The mark is the migration's column: nullable epoch millis, applied
      // once.
      const column = await sql<{ type: string; nullable: string }[]>`
        SELECT data_type AS type, is_nullable AS nullable
        FROM information_schema.columns
        WHERE table_schema = 'app' AND table_name = 'project_agent_runs'
          AND column_name = 'auto_retry_refused_at_ms'
      `;
      const applied = await sql<{ name: string }[]>`
        SELECT name FROM app_migrations
        WHERE name LIKE ${'%_project_agent_runs_auto_retry_refused.sql'}
      `;
      record(
        'busy retry, refused at once: the check that ends the wait, delivered twice at once, retires the retry once — one refusal on the timeline and one mark on the failed run, written together, while the other delivery stands down on the mark — and the mark is the migration’s nullable column',
        busy.outcome === 'started' &&
          JSON.stringify(outcomes) ===
            JSON.stringify([
              JSON.stringify(['skipped:agent_busy']),
              JSON.stringify(['skipped:retry_refused']),
            ]) &&
          refusals.length === 1 &&
          refusals[0]?.toValue === 'agent_busy' &&
          refusals[0].actorId === worker &&
          retired !== null &&
          looks.length === 0 &&
          describeRuns(twiceRuns) === 'failed/delegated' &&
          live.length === 1 &&
          live[0]?.taskId === busy.taskId &&
          column[0]?.type === 'bigint' &&
          column[0].nullable === 'YES' &&
          applied.length === 1,
        `deliveries=${JSON.stringify(outcomes)} (want one agent_busy, one retry_refused) refusals=${JSON.stringify(refusals)} retired=${retired} looks=${looks.length} runs=${describeRuns(twiceRuns)} live=${JSON.stringify(live.map((run) => run.trigger))} column=${JSON.stringify(column)} migration=${JSON.stringify(applied.map((row) => row.name))} worker said=${JSON.stringify(lines)}`,
      );
      await free(worker);
    }

    // ---- what holds nothing ---------------------------------------------
    {
      // Another agent at work.
      const a = await failedDelegation('Independent agents');
      const otherTask = await fx.insertTask({
        projectId: projectA,
        title: 'The second implementer’s work',
      });
      const otherStart = await delegate(otherTask, { agentId: other });
      const log = await deliver(a.payload);
      const aRuns = await runsOf(sql, a.taskId);
      record(
        'busy retry: another agent’s run holds nothing — the retry starts beside it',
        otherStart.outcome === 'started' &&
          log.length === 0 &&
          describeRuns(aRuns) === 'failed/delegated,queued/auto_retry',
        `other=${otherStart.outcome} log=${JSON.stringify(log)} runs=${describeRuns(aRuns)}`,
      );
      await free(worker);
      await free(other);

      // The same agent at work in a member's own workspace.
      const memberSession = memberSessionIdForProjectAgent(worker, 'someone');
      const memberTask = await fx.insertTask({
        projectId: projectA,
        title: 'A member’s own run',
        status: 'in_progress',
        agentId: worker,
      });
      await sql`
        INSERT INTO app.project_agent_runs (
          org_id, project_id, task_id, agent_id, exec_id, session_id, status,
          harness, model, trigger, started_by, started_at_ms, launched_at_ms,
          deadline_at_ms, updated_at_ms
        ) VALUES (
          ${orgId}, ${projectA}, ${memberTask}, ${worker},
          ${`exec-${randomUUID().slice(0, 12)}`}, ${memberSession}, 'running',
          'claude-code', 'itest-model', 'manual', 'someone',
          ${Date.now() - 2_000}, ${Date.now() - 1_000},
          ${Date.now() + 3_600_000}, ${Date.now()}
        )
      `;
      const b = await failedDelegation('Standing work beside a member run');
      const memberLog = await deliver(b.payload);
      const bRuns = await runsOf(sql, b.taskId);
      record(
        'busy retry: the agent’s run in a member’s own workspace holds nothing in its standing workspace — the retry starts there',
        memberLog.length === 0 &&
          describeRuns(bRuns) === 'failed/delegated,queued/auto_retry' &&
          bRuns[1]?.sessionId === standing,
        `log=${JSON.stringify(memberLog)} runs=${describeRuns(bRuns)} session=${bRuns[1]?.sessionId}`,
      );
      await free(worker);

      // A confined retry: the chain's person lost the Editor role but the
      // task is their own, so the retry works in their own workspace — and
      // looks there, not in the standing one.
      const ownTask = randomUUID();
      await sql`
        INSERT INTO app.tasks (id, org_id, project_id, title, status, rank,
          assignee_type, assignee_id, created_by, created_by_type,
          created_at_ms, updated_at_ms)
        VALUES (${ownTask}, ${orgId}, ${projectA}, 'The editor’s own task',
          'todo', ${`z${suffix}own`}, 'agent', ${worker}, ${editor}, 'user',
          ${Date.now()}, ${Date.now()})
      `;
      const ownStart = await delegate(ownTask);
      const own = await failNewest(ownTask);
      const standingBusy = await occupy('Standing work while confined');
      const confinedSession = memberSessionIdForProjectAgent(worker, editor);
      await fx.setRole(editor, 'member');
      const confinedLog = await deliver(own.payload);
      const ownRuns = await runsOf(sql, ownTask);
      // A second failure of that confined run, now with a run of the
      // agent's in the member's own workspace: the retry waits there.
      const ownRetry = ownRuns[1];
      const busyOwnTask = randomUUID();
      await sql`
        INSERT INTO app.tasks (id, org_id, project_id, title, status, rank,
          assignee_type, assignee_id, created_by, created_by_type,
          created_at_ms, updated_at_ms)
        VALUES (${busyOwnTask}, ${orgId}, ${projectA}, 'Another own task',
          'in_progress', ${`z${suffix}own2`}, 'agent', ${worker}, ${editor},
          'user', ${Date.now()}, ${Date.now()})
      `;
      let ownAgain: { runId: string; payload: Record<string, unknown> } | null =
        null;
      let confinedWait: string[] = ['not reached'];
      if (ownRetry !== undefined && ownRetry.sessionId === confinedSession) {
        ownAgain = await failNewest(ownTask);
        await sql`
          INSERT INTO app.project_agent_runs (
            org_id, project_id, task_id, agent_id, exec_id, session_id,
            status, harness, model, trigger, started_by, started_at_ms,
            launched_at_ms, deadline_at_ms, updated_at_ms
          ) VALUES (
            ${orgId}, ${projectA}, ${busyOwnTask}, ${worker},
            ${`exec-${randomUUID().slice(0, 12)}`}, ${confinedSession},
            'running', 'claude-code', 'itest-model', 'manual', ${editor},
            ${Date.now() - 2_000}, ${Date.now() - 1_000},
            ${Date.now() + 3_600_000}, ${Date.now()}
          )
        `;
        confinedWait = await deliver(ownAgain.payload);
      }
      await fx.setRole(editor, 'editor');
      record(
        'busy retry: a confined retry looks in the member’s own workspace it joins — a standing run holds nothing there, and a run in that workspace makes it wait',
        ownStart.outcome === 'started' &&
          standingBusy.outcome === 'started' &&
          confinedLog.length === 0 &&
          ownRetry?.trigger === 'auto_retry' &&
          ownRetry.sessionId === confinedSession &&
          JSON.stringify(confinedWait) ===
            JSON.stringify(['waiting:agent_busy']) &&
          (await runsOf(sql, ownTask)).length === 2,
        `start=${ownStart.outcome} standing busy=${standingBusy.outcome} first log=${JSON.stringify(confinedLog)} retry=${ownRetry?.trigger}@${ownRetry?.sessionId === confinedSession ? 'member workspace' : ownRetry?.sessionId} second log=${JSON.stringify(confinedWait)} runs=${describeRuns(await runsOf(sql, ownTask))}`,
      );
      await free(worker);
    }

    // ---- other tenants ---------------------------------------------------
    {
      const foreignTask = randomUUID();
      await sql`
        INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms,
                                  updated_at_ms)
        VALUES (${foreignProject}, ${foreignOrg}, 'Other tenant', ${userId},
                ${Date.now()}, ${Date.now()})
      `;
      await sql`
        INSERT INTO app.tasks (id, org_id, project_id, title, status, rank,
          created_by, created_by_type, created_at_ms, updated_at_ms)
        VALUES (${foreignTask}, ${foreignOrg}, ${foreignProject},
          'Other tenant work', 'in_progress', 'a0', ${userId}, 'user',
          ${Date.now()}, ${Date.now()})
      `;
      // A live run of another organization forged onto this agent's id and
      // standing session id.
      await sql`
        INSERT INTO app.project_agent_runs (
          org_id, project_id, task_id, agent_id, exec_id, session_id, status,
          harness, model, trigger, started_by, started_at_ms, launched_at_ms,
          deadline_at_ms, updated_at_ms
        ) VALUES (
          ${foreignOrg}, ${foreignProject}, ${foreignTask}, ${worker},
          ${`exec-${randomUUID().slice(0, 12)}`}, ${standing}, 'running',
          'claude-code', 'itest-model', 'manual', 'foreign-user',
          ${Date.now() - 2_000}, ${Date.now() - 1_000},
          ${Date.now() + 3_600_000}, ${Date.now()}
        )
      `;
      const a = await failedDelegation('Beside another tenant');
      // A retry job naming the other organization for this tenant's task.
      const versionBefore = await agentVersion(worker);
      const forged = await deliver({
        ...a.payload,
        organizationId: foreignOrg,
      });
      const versionAfter = await agentVersion(worker);
      const forgedRuns = await runsOf(sql, a.taskId);
      const log = await deliver(a.payload);
      const aRuns = await runsOf(sql, a.taskId);
      record(
        'busy retry: tenants stay apart — a retry job naming another organization locks nothing of this one and starts nothing, and another organization’s live run on a colliding agent and session id holds nothing',
        JSON.stringify(forged) ===
          JSON.stringify(['skipped:task_unavailable']) &&
          versionAfter === versionBefore &&
          describeRuns(forgedRuns) === 'failed/delegated' &&
          log.length === 0 &&
          describeRuns(aRuns) === 'failed/delegated,queued/auto_retry',
        `forged=${JSON.stringify(forged)} agent row untouched=${versionAfter === versionBefore} runs after=${describeRuns(forgedRuns)} real=${JSON.stringify(log)} runs=${describeRuns(aRuns)}`,
      );
      await sql`
        UPDATE app.project_agent_runs SET status = 'cancelled',
          settled_at_ms = ${Date.now()}, updated_at_ms = ${Date.now()}
        WHERE org_id = ${foreignOrg} AND status IN ('queued', 'running')
      `;
      await free(worker);
    }

    // ---- a person's run and its retry are left as they were -------------
    {
      const busy = await occupy('Delegated work beside a person’s run');
      const personTask = await fx.insertTask({
        projectId: projectA,
        title: 'A person starts the busy agent',
        status: 'in_progress',
        agentId: worker,
      });
      const personStart = await fetch(
        `${base}/api/app/tasks/${personTask}/agent-runs/start?orgId=${orgId}`,
        {
          method: 'POST',
          headers: { cookie: ctx.cookie, origin: base },
        },
      );
      const person = await failNewest(personTask);
      const versionBefore = await agentVersion(worker);
      const log = await deliver(person.payload);
      const versionAfter = await agentVersion(worker);
      const personRuns = await runsOf(sql, personTask);
      record(
        'busy retry: the retry of a person’s run is judged as before — no agent-row lock, no look at the workspace (every door’s admission is TALE-386’s)',
        busy.outcome === 'started' &&
          personStart.status === 200 &&
          log.length === 0 &&
          versionAfter === versionBefore &&
          describeRuns(personRuns) === 'failed/manual,queued/auto_retry' &&
          personRuns[1]?.startedBy === userId &&
          personRuns[1].startedVia === null,
        `busy=${busy.outcome} start=${personStart.status} log=${JSON.stringify(log)} agent row untouched=${versionAfter === versionBefore} runs=${describeRuns(personRuns)}`,
      );
      await free(worker);
    }

    // ---- every look re-reads the task and the starter -------------------
    {
      const moved = await failedDelegation('A person moves it back');
      const reassigned = await failedDelegation('A person takes it over');
      const archived = await failedDelegation('Archived while waiting');
      const demoted = await failedDelegation('Its starter is demoted');
      const project = await failedDelegation('Its project is archived');
      const plain = await failedDelegation('Nothing changes');
      const busy = await occupy('Work that holds the workspace');
      const waits: string[] = [];
      for (const failed of [
        moved,
        reassigned,
        archived,
        demoted,
        project,
        plain,
      ]) {
        waits.push(...(await deliver(failed.payload)));
      }
      const auth = await editorAuth();
      const changeErrors: string[] = [];
      const change = async (label: string, work: () => Promise<unknown>) => {
        try {
          await work();
        } catch (error) {
          changeErrors.push(`${label}: ${codeOf(error)}`);
        }
      };
      await change('move', () =>
        sql.begin((tx) => updateTaskStatus(tx, auth, moved.taskId, 'todo')),
      );
      await change('reassign', () =>
        sql.begin((tx) =>
          assignTask(tx, auth, {
            taskId: reassigned.taskId,
            assigneeType: 'user',
            assigneeId: editor,
          }),
        ),
      );
      await change('archive', () =>
        sql.begin((tx) => archiveTask(tx, owner, archived.taskId)),
      );
      await free(worker);
      /** The waiting retry's next look, delivered. */
      const look = async (runId: string): Promise<string[]> => {
        const next = (await looksOf(runId))[0];
        return next === undefined ? ['no look'] : deliver(next.data);
      };
      const reasons: Record<string, string[]> = {};
      reasons.moved = await look(moved.runId);
      reasons.reassigned = await look(reassigned.runId);
      reasons.archived = await look(archived.runId);
      await fx.setRole(editor, 'member');
      reasons.demoted = await look(demoted.runId);
      await fx.setRole(editor, 'editor');
      reasons.plain = await look(plain.runId);
      await sql.begin((tx) => archiveProject(tx, owner, projectA));
      reasons.project = await look(project.runId);
      await sql.begin((tx) => restoreProject(tx, owner, projectA));
      const counts = async (failed: { taskId: string; runId: string }) =>
        `${(await runsOf(sql, failed.taskId)).length}/${(await looksOf(failed.runId)).length}`;
      const shape: Record<string, string> = {
        moved: await counts(moved),
        reassigned: await counts(reassigned),
        archived: await counts(archived),
        demoted: await counts(demoted),
        project: await counts(project),
        plain: await counts(plain),
      };
      record(
        'busy retry: every look re-reads the task and its starter — a person’s move, a reassignment, an archived task, a demoted starter and an archived project each end the wait with nothing started and no further look, while an unchanged task starts',
        busy.outcome === 'started' &&
          changeErrors.length === 0 &&
          waits.length === 6 &&
          waits.every((line) => line === 'waiting:agent_busy') &&
          JSON.stringify(reasons) ===
            JSON.stringify({
              moved: ['skipped:task_moved'],
              reassigned: ['skipped:reassigned'],
              archived: ['skipped:task_unavailable'],
              demoted: ['skipped:not_permitted'],
              plain: [],
              project: ['skipped:project_archived'],
            }) &&
          JSON.stringify(shape) ===
            JSON.stringify({
              moved: '1/1',
              reassigned: '1/1',
              archived: '1/1',
              demoted: '1/1',
              project: '1/1',
              plain: '2/1',
            }),
        `busy=${busy.outcome} changes refused=${JSON.stringify(changeErrors)} waits=${JSON.stringify(waits)} reasons=${JSON.stringify(reasons)} runs/looks=${JSON.stringify(shape)}`,
      );
      await free(worker);
    }
  } finally {
    console.log = consoleLog;
    await release();
    await sql`
      DELETE FROM app.projects WHERE id IN (${projectA}, ${foreignProject})
    `;
    await fx.teardownUsers();
  }
}
