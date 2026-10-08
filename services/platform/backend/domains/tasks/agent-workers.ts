import { randomUUID } from 'node:crypto';

import type { Sql, TransactionSql } from 'postgres';

import {
  isAgentRunWaitingReason,
  type AgentRunWaitingReason,
} from '../../../lib/shared/agent-run-waiting.ts';
import {
  SANDBOX_SESSION_LIVE_STATUSES,
  TASK_AGENT_OP_KIND,
} from '../../core/sandbox/session_constants.ts';
import {
  projectAgentWorker,
  workerSessionId,
} from '../../core/sandbox/session_naming.ts';
import { isUniqueViolation } from '../../db/sql.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { sessionDestroyStates } from '../sandbox/destroy-schedule.ts';
import { projectSessionRoom } from '../sandbox/sessions.ts';
import { emitTaskRunHint, TASK_AGENT_RUN_DEADLINE_MS } from './agent-runs.ts';
import { sessionIdForAgentRun } from './run-authority.ts';

/**
 * Agent workers: every run of a project agent that works at the same time
 * as another works in a sandbox of its own. A worker is one of the agent's
 * workspaces — worker 1 is the family's own id (`pa-<agent>`, or one
 * member's `pa-<agent>-m<hash>`), worker n >= 2 appends `-w<n>`
 * (`core/sandbox/session_naming.ts`). The kick writes the family's first
 * worker as the run's provisional session; the run's turn job CLAIMS a
 * worker right before it starts ({@link claimAgentWorker}), so a run that
 * waited takes whichever worker frees first. Each worker is one slot of the
 * organization's agent-worker budget (`maxSessionsPerOrg`), which a run
 * that finds none free waits for, parked with its reason.
 */

/** How long a worker whose run failed or was cancelled after launch is kept
 * for that run's task, so its retry (or a person's Retry) finds the
 * conversation and the unpublished files it left there. Other runs take it
 * only when nothing else is free. */
const WORKER_TASK_HOLD_MS = 15 * 60 * 1000;

/** A run's working time can reach at most this long after its kick, however
 * long it waited for a worker (`agentRunWorkDeadline`). */
const AGENT_RUN_MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** One worker of the run's family that has a live session row. */
export interface FamilyWorker {
  sessionId: string;
  worker: number;
  /** Starting in it takes no new slot: it is creating, active or degraded,
   * or pinned (a resume of those never re-counts the budget). */
  warm: boolean;
  /** An administrator's Destroy of it is queued or running. */
  destroyPending: boolean;
}

/** What a worker claim decides on. */
export interface WorkerFacts {
  agentId: string;
  taskId: string;
  /** The family's first worker: the agent's standing id, or one member's. */
  base: string;
  /** The worker this run already holds a claim on (a recovered start). */
  claimed?: string;
  /** Workers another live run names, or a process of an ended run of
   * another task still runs in. */
  occupied: ReadonlySet<string>;
  /** The family's workers that have a live session row. */
  workers: readonly FamilyWorker[];
  /** The worker of the task's latest launched run of this agent. */
  previous?: string;
  /** Workers kept for another task (`WORKER_TASK_HOLD_MS`), by session id. */
  heldFor: ReadonlyMap<string, string>;
  /** Agent-worker slots the organization has left for this run. */
  room: number;
}

export type WorkerChoice =
  | { sessionId: string; worker: number }
  | { wait: Extract<AgentRunWaitingReason, 'org_limit' | 'destroy_pending'> };

/**
 * Which worker a run starts in. Pure: the claim reads the facts under the
 * agent's lock. A worker is free when no other live run names it; one that
 * takes no new slot is warm. In order:
 *
 * 0. the worker the run already claimed, when it is still free;
 * 1. the task's previous worker, which keeps its conversation and files;
 * 2. a warm free worker, lowest number first;
 * 3. a stopped free worker, lowest number first, while a slot is left —
 *    reuse before create keeps the workspaces on disk few;
 * 4. none of those, but a free worker an administrator is destroying: the
 *    run waits for the Destroy rather than opening a worker beside it;
 * 5. a new worker, the lowest number that names no live workspace, while a
 *    slot is left;
 * 6. a warm worker kept for another task's retry, as the last resort.
 *
 * Otherwise the run waits for a slot (`org_limit`). A worker kept for
 * another task is skipped by 2 and 3.
 */
export function chooseWorker(facts: WorkerFacts): WorkerChoice {
  const byNumber = [...facts.workers].sort((a, b) => a.worker - b.worker);
  const known = new Map(byNumber.map((w) => [w.sessionId, w]));
  const free = byNumber.filter((w) => !facts.occupied.has(w.sessionId));
  const startable = (w: FamilyWorker) =>
    !w.destroyPending && (w.warm || facts.room > 0);
  const kept = (w: FamilyWorker) => {
    const task = facts.heldFor.get(w.sessionId);
    return task !== undefined && task !== facts.taskId;
  };
  const pick = (w: { sessionId: string; worker: number }) => ({
    sessionId: w.sessionId,
    worker: w.worker,
  });

  for (const sessionId of [facts.claimed, facts.previous]) {
    if (sessionId === undefined || facts.occupied.has(sessionId)) continue;
    const worker = known.get(sessionId);
    if (worker !== undefined) {
      if (startable(worker) && (sessionId === facts.claimed || !kept(worker))) {
        return pick(worker);
      }
      continue;
    }
    // A worker with no live row (never created, or destroyed since) is
    // opened again under the same id, which takes a slot.
    const number = projectAgentWorker(facts.agentId, sessionId);
    if (number?.base === facts.base && facts.room > 0) {
      return { sessionId, worker: number.worker };
    }
  }
  const warm = free.find((w) => w.warm && !w.destroyPending && !kept(w));
  if (warm !== undefined) return pick(warm);
  if (facts.room > 0) {
    const stopped = free.find((w) => !w.destroyPending && !kept(w));
    if (stopped !== undefined) return pick(stopped);
  }
  if (free.some((w) => w.destroyPending)) return { wait: 'destroy_pending' };
  if (facts.room > 0) {
    for (let worker = 1; ; worker += 1) {
      const sessionId = workerSessionId(facts.agentId, facts.base, worker);
      if (!known.has(sessionId) && !facts.occupied.has(sessionId)) {
        return { sessionId, worker };
      }
    }
  }
  const lastResort = free.find((w) => w.warm && !w.destroyPending);
  if (lastResort !== undefined) return pick(lastResort);
  return { wait: 'org_limit' };
}

/** What a claim did: the run holds a worker now (`moved` when it left the
 * session it named before, which may leave that one idle), or it was parked
 * to wait for one. */
export type WorkerClaim =
  | { sessionId: string; worker: number; moved: boolean }
  | {
      parked: Extract<AgentRunWaitingReason, 'org_limit' | 'destroy_pending'>;
    };

interface ClaimedRun {
  agentId: string;
  taskId: string;
  projectId: string;
  startedBy: string;
  sessionId: string;
  claimedAt: number | null;
}

/**
 * Claim the worker a queued run starts in — the `task.agent_turn` job's
 * step before its resume plan, so the kick, every wake, the retry and the
 * stranded-start recovery all choose through it. One transaction under the
 * agent's lock (every claim of one agent, both families, runs one at a time)
 * and the organization's admission lock (the budget it counts is the one
 * reserves and releases count), then the run's row:
 *
 * - the run's family is re-checked by its starter's rights now: a run whose
 *   starter lost the Editor role while it waited moves into the member's own
 *   family, never the other way round;
 * - a worker is chosen ({@link chooseWorker}) and written into the run's
 *   `session_id` with the claim stamp; or
 * - the run is parked with its reason when no worker can take it — never a
 *   refusal: it starts on its own when one frees.
 *
 * Null when the run is no longer queued under this exec, or is parked: the
 * job stands down. A second claimed live run on one worker is refused by the
 * schema (`project_agent_runs_one_per_worker`); the claim reads again on
 * that, three times at most.
 */
export async function claimAgentWorker(
  sql: Sql,
  args: { organizationId: string; runId: string; execId: string },
): Promise<WorkerClaim | null> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await sql.begin((tx) => claimInTx(tx, args));
    } catch (error) {
      if (!isUniqueViolation(error) || attempt >= 3) throw error;
      console.warn(
        `[task-agent] worker claim for ${args.execId} met a held worker — reading again`,
      );
    }
  }
}

async function claimInTx(
  tx: TransactionSql,
  args: { organizationId: string; runId: string; execId: string },
): Promise<WorkerClaim | null> {
  const agents = await tx<{ agentId: string }[]>`
    SELECT agent_id AS "agentId" FROM app.project_agent_runs
    WHERE id = ${args.runId} AND org_id = ${args.organizationId}
  `;
  const agentId = agents[0]?.agentId;
  if (agentId === undefined) return null;
  await tx`
    SELECT pg_advisory_xact_lock(hashtextextended('agent-workers:' || ${agentId}, 0))
  `;
  // The same lock as every reserve, resume and release of the organization:
  // the slots counted below cannot change until this claim commits.
  await tx`
    SELECT pg_advisory_xact_lock(hashtextextended('sandbox:' || ${args.organizationId}, 0))
  `;
  const runs = await tx<ClaimedRun[]>`
    SELECT agent_id AS "agentId", task_id AS "taskId",
           project_id AS "projectId", started_by AS "startedBy",
           session_id AS "sessionId",
           session_claimed_at_ms::float8 AS "claimedAt"
    FROM app.project_agent_runs
    WHERE id = ${args.runId} AND org_id = ${args.organizationId}
      AND status = 'queued' AND exec_id = ${args.execId}
      AND waiting_for_capacity_at_ms IS NULL
    FOR UPDATE
  `;
  const run = runs[0];
  if (run === undefined) return null;

  const base = await runFamilyBase(tx, args.organizationId, run);
  const facts = await readWorkerFacts(tx, {
    organizationId: args.organizationId,
    runId: args.runId,
    base,
    run,
  });
  const choice = chooseWorker(facts);
  if ('wait' in choice) {
    await parkAgentRunInTx(tx, {
      runId: args.runId,
      execId: args.execId,
      reason: choice.wait,
    });
    return { parked: choice.wait };
  }
  const now = Date.now();
  await tx`
    UPDATE app.project_agent_runs SET
      session_id = ${choice.sessionId}, session_claimed_at_ms = ${now},
      waiting_reason = NULL, updated_at_ms = ${now}
    WHERE id = ${args.runId}
  `;
  const moved = choice.sessionId !== run.sessionId;
  if (moved) {
    // The run's card names its worker.
    await emitTaskRunHint(tx, {
      organizationId: args.organizationId,
      taskId: run.taskId,
    });
  }
  return { ...choice, moved };
}

/**
 * Why a run that has not started yet waits for a worker, or will when it
 * starts, as far as can be told now: its park's reason once it is parked,
 * else what its claim would decide if it ran now (no worker free and no
 * slot left, or only a worker being destroyed). Null when it is working or
 * would find a worker. A read that locks and claims nothing, made after the
 * start commits: an automation or a manager agent that started the run
 * learns it is not working yet, while the run's own claim decides when it
 * starts.
 */
export async function predictWorkerWait(
  sql: Sql | TransactionSql,
  args: { organizationId: string; runId: string },
): Promise<AgentRunWaitingReason | null> {
  const runs = await sql<
    (ClaimedRun & { status: string; parked: boolean; reason: string | null })[]
  >`
    SELECT agent_id AS "agentId", task_id AS "taskId",
           project_id AS "projectId", started_by AS "startedBy",
           session_id AS "sessionId",
           session_claimed_at_ms::float8 AS "claimedAt", status,
           waiting_for_capacity_at_ms IS NOT NULL AS parked,
           waiting_reason AS reason
    FROM app.project_agent_runs
    WHERE id = ${args.runId} AND org_id = ${args.organizationId}
  `;
  const run = runs[0];
  if (run === undefined || run.status !== 'queued') return null;
  if (run.parked) {
    return isAgentRunWaitingReason(run.reason) ? run.reason : null;
  }
  const base =
    projectAgentWorker(run.agentId, run.sessionId)?.base ?? run.sessionId;
  const choice = chooseWorker(
    await readWorkerFacts(sql, {
      organizationId: args.organizationId,
      runId: args.runId,
      base,
      run,
    }),
  );
  return 'wait' in choice ? choice.wait : null;
}

/** The family the run works in: the one its kick chose, unless its starter
 * may no longer edit the project — then that member's own, so what a
 * confined run leaves behind never reaches a standing worker. */
async function runFamilyBase(
  tx: Sql | TransactionSql,
  organizationId: string,
  run: ClaimedRun,
): Promise<string> {
  const current = projectAgentWorker(run.agentId, run.sessionId);
  if (current === null) return run.sessionId;
  if (current.scope === 'member') return current.base;
  return sessionIdForAgentRun(tx, {
    organizationId,
    projectId: run.projectId,
    agentId: run.agentId,
    startedBy: run.startedBy,
  });
}

async function readWorkerFacts(
  tx: Sql | TransactionSql,
  args: {
    organizationId: string;
    runId: string;
    base: string;
    run: ClaimedRun;
  },
): Promise<WorkerFacts> {
  const { organizationId, runId, base, run } = args;
  const now = Date.now();
  const inFamily = (sessionId: string) =>
    projectAgentWorker(run.agentId, sessionId)?.base === base;

  const rows = await tx<
    { sessionId: string; status: string; pinned: boolean }[]
  >`
    SELECT DISTINCT ON (session_id) session_id AS "sessionId", status, pinned
    FROM app.sandbox_sessions
    WHERE org_id = ${organizationId} AND owner_type = 'project_agent'
      AND owner_id = ${run.agentId}
      AND status = ANY(${[...SANDBOX_SESSION_LIVE_STATUSES]})
    ORDER BY session_id, created_at_ms DESC
  `;
  const family = rows.filter((row) => inFamily(row.sessionId));
  const sessionIds = family.map((row) => row.sessionId);
  const destroys = await sessionDestroyStates(tx, organizationId, sessionIds);

  // Held by another live run of the agent: one working, one that claimed
  // it, or a kick that still names its family's first worker.
  const others = await tx<{ sessionId: string }[]>`
    SELECT session_id AS "sessionId" FROM app.project_agent_runs
    WHERE org_id = ${organizationId} AND agent_id = ${run.agentId}
      AND id <> ${runId}
      AND (status = 'running'
        OR (status = 'queued' AND waiting_for_capacity_at_ms IS NULL))
  `;
  // A process an ended run of another task left running there (its drain
  // died with the CLI alive): another task's run must not share the
  // worker's memory and files with it.
  const leftovers =
    sessionIds.length === 0
      ? []
      : await tx<{ sessionId: string }[]>`
          SELECT DISTINCT o.session_id AS "sessionId"
          FROM app.sandbox_session_ops o
          JOIN app.project_agent_runs r
            ON r.org_id = o.org_id AND r.session_id = o.session_id
           AND r.exec_id = o.exec_id
          WHERE o.org_id = ${organizationId}
            AND o.session_id = ANY(${sessionIds})
            AND o.kind = ${TASK_AGENT_OP_KIND} AND o.status = 'running'
            AND r.status IN ('settled', 'failed', 'cancelled')
            AND r.task_id <> ${run.taskId}
        `;

  const previous = await tx<{ sessionId: string }[]>`
    SELECT session_id AS "sessionId" FROM app.project_agent_runs
    WHERE org_id = ${organizationId} AND task_id = ${run.taskId}
      AND agent_id = ${run.agentId} AND id <> ${runId}
      AND launched_at_ms IS NOT NULL
    ORDER BY seq DESC
    LIMIT 1
  `;

  // Workers whose last launched run failed or was cancelled a short while
  // ago, while that run's task has launched none since: kept for its retry.
  const held = await tx<{ sessionId: string; taskId: string }[]>`
    SELECT r.session_id AS "sessionId", r.task_id AS "taskId"
    FROM app.project_agent_runs r
    WHERE r.org_id = ${organizationId} AND r.agent_id = ${run.agentId}
      AND r.started_at_ms > ${now - AGENT_RUN_MAX_LIFETIME_MS - WORKER_TASK_HOLD_MS}
      AND r.status IN ('failed', 'cancelled')
      AND r.launched_at_ms IS NOT NULL
      AND r.settled_at_ms > ${now - WORKER_TASK_HOLD_MS}
      AND NOT EXISTS (
        SELECT 1 FROM app.project_agent_runs later
        WHERE later.org_id = r.org_id AND later.session_id = r.session_id
          AND later.seq > r.seq AND later.launched_at_ms IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM app.project_agent_runs later
        WHERE later.task_id = r.task_id AND later.seq > r.seq
          AND later.launched_at_ms IS NOT NULL
      )
  `;

  const room = await workerRoom(tx, organizationId, runId);
  const previousSession = previous[0]?.sessionId;
  return {
    agentId: run.agentId,
    taskId: run.taskId,
    base,
    ...(run.claimedAt !== null && inFamily(run.sessionId)
      ? { claimed: run.sessionId }
      : {}),
    occupied: new Set([
      ...others.map((row) => row.sessionId),
      ...leftovers.map((row) => row.sessionId),
    ]),
    workers: family.map((row) => ({
      sessionId: row.sessionId,
      worker: projectAgentWorker(run.agentId, row.sessionId)?.worker ?? 1,
      warm:
        row.pinned ||
        row.status === 'creating' ||
        row.status === 'active' ||
        row.status === 'degraded',
      destroyPending: destroys.get(row.sessionId) === 'pending',
    })),
    ...(previousSession !== undefined && inFamily(previousSession)
      ? { previous: previousSession }
      : {}),
    heldFor: new Map(held.map((row) => [row.sessionId, row.taskId])),
    room,
  };
}

/** The agent-worker slots left for one claim: the budget's cap, less the
 * workers holding a slot, less the runs that have claimed a worker that
 * holds none yet (each takes one at its start). A claim never opens or
 * wakes a worker the organization has no slot for, so a burst of starts
 * opens no more workspaces than can run. */
async function workerRoom(
  tx: Sql | TransactionSql,
  organizationId: string,
  runId: string,
): Promise<number> {
  const { cap, inFlight } = await projectSessionRoom(tx, organizationId);
  const pending = await tx<{ count: number }[]>`
    SELECT count(*)::int AS count FROM app.project_agent_runs r
    WHERE r.org_id = ${organizationId} AND r.id <> ${runId}
      AND r.status = 'queued' AND r.waiting_for_capacity_at_ms IS NULL
      AND r.session_claimed_at_ms IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM app.sandbox_sessions s
        WHERE s.org_id = r.org_id AND s.session_id = r.session_id
          AND (s.status IN ('creating', 'active', 'degraded')
            OR (s.status = 'stopped' AND s.pinned))
      )
  `;
  return cap - inFlight - (pending[0]?.count ?? 0);
}

/** A parked run, as its park returns it. */
export interface ParkedAgentRun {
  organizationId: string;
  taskId: string;
  agentId: string;
  execId: string;
}

/**
 * Park a run that found no room: back to `queued`, stamped as waiting
 * (`waiting_for_capacity_at_ms`) with why (`waiting_reason`), until a wake
 * restarts it. Nothing is spent and no attempt is used. The run gives its
 * worker back in the same write: it names its family's first worker again
 * (the provisional workspace a kick writes) and holds no claim, so a
 * parked run never keeps a worker another run could use, and an image that
 * knows nothing of workers wakes it into the family's first workspace, as
 * it always did. Undefined when the run is no longer where the caller left
 * it (another exec, or another status).
 */
export async function parkAgentRunInTx(
  tx: TransactionSql,
  args: {
    runId: string;
    execId: string;
    /** The sandbox host said when the run's place in line comes up: it is
     * woken then rather than at the watchdog's next tick. */
    wakeAfterMs?: number;
    /** The run had launched and its workspace's runtime refused the exec
     * (`EXEC_LIMIT`): it goes back to `queued` without its launch stamp,
     * onto a fresh exec. */
    execRefused?: boolean;
    reason?: AgentRunWaitingReason;
  },
): Promise<ParkedAgentRun | undefined> {
  const now = Date.now();
  const execRefused = args.execRefused === true;
  const rows = await tx<(ParkedAgentRun & { sessionId: string })[]>`
    UPDATE app.project_agent_runs SET
      status = 'queued',
      exec_id = ${execRefused ? randomUUID() : args.execId},
      launched_at_ms = CASE WHEN ${execRefused}
        THEN NULL ELSE launched_at_ms END,
      waiting_for_capacity_at_ms = ${now},
      waiting_reason = ${args.reason ?? null},
      session_claimed_at_ms = NULL,
      updated_at_ms = ${now}
    WHERE id = ${args.runId} AND exec_id = ${args.execId}
      AND status = ${execRefused ? 'running' : 'queued'}
    RETURNING org_id AS "organizationId", task_id AS "taskId",
      agent_id AS "agentId", exec_id AS "execId", session_id AS "sessionId"
  `;
  const row = rows[0];
  if (row === undefined) return undefined;
  const base = projectAgentWorker(row.agentId, row.sessionId)?.base;
  if (base !== undefined && base !== row.sessionId) {
    await tx`
      UPDATE app.project_agent_runs SET session_id = ${base}
      WHERE id = ${args.runId}
    `;
  }
  // The card now reads why the run waits, not "Queued".
  await emitTaskRunHint(tx, row);
  if (args.wakeAfterMs !== undefined && args.wakeAfterMs > 0) {
    await addJobInTx(
      tx,
      'task.agent_park_wake',
      {
        organizationId: row.organizationId,
        runId: args.runId,
        execId: row.execId,
      },
      { startAfter: new Date(now + args.wakeAfterMs) },
    );
  }
  return {
    organizationId: row.organizationId,
    taskId: row.taskId,
    agentId: row.agentId,
    execId: row.execId,
  };
}

/**
 * The deadline a run works to once it launches. Waiting for a worker does
 * not use up its working time: a run that has never launched gets its full
 * working time from now — at most a day after its kick — while how long it
 * may wait stays bounded by its kick's deadline (a parked run past it fails
 * as having waited too long). A run that has launched keeps its deadline.
 */
export function agentRunWorkDeadline(
  run: { deadlineAt: number; startedAt: number; launchedAt: number | null },
  now: number,
): number {
  if (run.launchedAt !== null) return run.deadlineAt;
  return Math.max(
    run.deadlineAt,
    Math.min(
      now + TASK_AGENT_RUN_DEADLINE_MS,
      run.startedAt + AGENT_RUN_MAX_LIFETIME_MS,
    ),
  );
}
