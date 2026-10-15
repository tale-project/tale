import { randomUUID } from 'node:crypto';

import { transactSerializable } from '@tale/shared/db/serializable';
import {
  DISPATCH_RUNS_MAX,
  dispatchAdmission,
  type DispatchAdmissionPreset,
  type DispatchStatus,
  type ProjectDispatch,
  type ProjectDispatchRole,
} from '@tale/shared/schemas/project-dispatch';
import type { Sql, TransactionSql } from 'postgres';

import { dispatchRunStarter } from '../../../lib/shared/run-starter.ts';
import {
  sandboxAdmission,
  type SandboxAdmission,
} from '../../core/node_only/sandbox/helpers/session_client.ts';
import { toJson } from '../../db/sql.ts';
import { projectSessionRoom } from '../sandbox/sessions.ts';
import { startDelegatedAgentRun } from './delegated-start.ts';
import {
  gateCandidates,
  gateGoverns,
  noteGatedStart,
  readGateStates,
  type GateState,
} from './dispatch-gates.ts';
import {
  hostRecheckAt,
  PASS_BUDGET_MS,
  PASS_LEASE_MS,
  passOutOfTime,
  planDispatch,
  rankCandidates,
  startPacedUntil,
  type DispatchAgent,
  type DispatchCandidate,
  type DispatchModelRamp,
  type DispatchPick,
} from './dispatch-plan.ts';
import {
  judgeDispatchSources,
  sourceStatuses,
  type JudgedSource,
} from './dispatch-reach.ts';
import {
  requestDispatchPassInTx,
  type DispatchPassTrigger,
} from './dispatch-requests.ts';
import {
  dueRoleOccurrences,
  roleOccurrenceFeedback,
  roleOccurrenceId,
} from './dispatch-roles.ts';
import { readStoredDispatch } from './dispatch-store.ts';
import { TaskError } from './errors.ts';
import {
  modelCapacityKey,
  readModelCapacityRamps,
} from './model-capacity-holds.ts';
import { assertTaskAutomationEnabled } from './run-start.ts';

/**
 * One pass of a project's dispatch (migration 0206): its standing roles
 * that are due, then its ready work — on its own board and every source it
 * reaches now (`dispatch-reach.ts`), one order across them — on the idle
 * agents of its pool, one start at a time. A source it no longer reaches is
 * skipped and recorded as held with why (`source_missing`,
 * `source_archived`, `source_no_authority`). A pass is asked for when a run of the project ends, when
 * a model its agents wait on answers again, when the dispatch is saved, at
 * the time a held or paced pass named, and by the minute scan.
 *
 * One pass runs per project at a time (a lease on its state row); a pass
 * asked for meanwhile runs after it. Every start goes through the same
 * admission as an automation's or a manager agent's
 * (`startDelegatedAgentRun`): dependencies, the task's hourly limit, one live
 * run per task. Before each start of ready work the sandbox host is asked
 * whether it admits another (`GET /v1/admission`, with the dispatch's preset);
 * a hold ends the pass and the next one comes after the dispatch's recheck
 * delays. Starts are spaced by `startSpacingSeconds`: with a spacing, a pass
 * makes one start of ready work and the next pass comes that much later, so
 * a pool of N runs fills in (N - 1) times the spacing. Without one, a pass
 * starts every pick the host admits, for at most `PASS_BUDGET_MS`; a pass
 * that runs out of time asks for the next at once. A model that answered
 * again after it was at capacity takes no more new runs than its ramp lets
 * through (`readModelCapacityRamps`); a pass it held asks for the next at
 * the ramp's next wave. What the pass saw and did is recorded
 * (`project_dispatch_passes`): the readback of why an agent is idle.
 */

/** When a pass finds another under way, it asks again this much later. */
const BUSY_RETRY_MS = 15_000;
/** Ready tasks one pass reads, best-ranked first, across every board it
 * serves: as many runs as a pool may ever hold, so one pass can fill the
 * largest pool. */
const CANDIDATES_PER_PASS = DISPATCH_RUNS_MAX;
/** Holds one pass records, so a big backlog keeps the record small. */
const HOLDS_RECORDED = 50;
/** Pass records are kept this long. */
const PASS_RETENTION_MS = 7 * 24 * 60 * 60_000;

export type DispatchStopReason =
  | 'disabled'
  | 'automation_disabled'
  | 'pool_full'
  | 'org_limit'
  | 'no_ready_work'
  | 'agents_busy'
  | 'model_capacity'
  | 'host_pressure'
  | 'pacing'
  | 'gated'
  /** The pass started work for as long as it may; the next goes on at
   * once. */
  | 'budget'
  /** A model that answered again took as many new runs as its ramp lets
   * through for now; the next pass comes at its next wave. */
  | 'model_ramp'
  | 'started'
  | 'held';

export interface DispatchStart {
  taskId: string;
  agentId: string;
  runId: string;
  via: DispatchPick['via'] | 'standing_role';
  role?: string;
  occurrence?: string;
  /** The sandbox host's verdict the pass read right before this start —
   * the readings it admitted on, kept with the run's ledger entry. */
  admission?: HostVerdict['evidence'];
}

export interface DispatchHeld {
  taskId: string | null;
  agentId: string | null;
  reason: string;
  retryAfter?: number;
  role?: string;
  /** A source the pass skipped (`reason` `source_<why>`), or the board a
   * held task is on when it is not the dispatch's own. */
  projectId?: string;
}

export interface DispatchPassResult {
  passId: string;
  stop: DispatchStopReason;
  started: DispatchStart[];
  held: DispatchHeld[];
  nextPassAt: number | null;
}

/** Take the project's pass lease; false while another pass holds it. */
async function takeLease(
  sql: Sql,
  args: { organizationId: string; projectId: string; now: number },
): Promise<boolean> {
  const rows = await sql<{ projectId: string }[]>`
    INSERT INTO app.project_dispatch_state (
      project_id, org_id, pass_lease_until_ms, updated_at_ms
    ) VALUES (
      ${args.projectId}, ${args.organizationId},
      ${args.now + PASS_LEASE_MS}, ${args.now}
    )
    ON CONFLICT (project_id) DO UPDATE SET
      pass_lease_until_ms = EXCLUDED.pass_lease_until_ms,
      updated_at_ms = EXCLUDED.updated_at_ms
    WHERE app.project_dispatch_state.pass_lease_until_ms IS NULL
       OR app.project_dispatch_state.pass_lease_until_ms < ${args.now}
    RETURNING project_id AS "projectId"
  `;
  return rows.length > 0;
}

interface DispatchState {
  lastStartAt: number | null;
  recheckIndex: number;
}

async function readState(sql: Sql, projectId: string): Promise<DispatchState> {
  const rows = await sql<
    { lastStartAt: number | null; recheckIndex: number }[]
  >`
    SELECT last_start_at_ms::float8 AS "lastStartAt",
           recheck_index AS "recheckIndex"
    FROM app.project_dispatch_state WHERE project_id = ${projectId}
  `;
  return rows[0] ?? { lastStartAt: null, recheckIndex: 0 };
}

/** One board a pass takes ready work from: the dispatch's own, or a source
 * it reaches now, with the columns and labels that select its ready work. */
export interface DispatchBoard {
  projectId: string;
  statuses: readonly DispatchStatus[];
  labels: ProjectDispatch['labels'];
}

/** The boards a pass takes ready work from: its own first, then every
 * source it reaches, in the order the dispatch lists them. */
export function dispatchBoards(
  projectId: string,
  config: ProjectDispatch,
  reachable: readonly JudgedSource[],
): DispatchBoard[] {
  return [
    { projectId, statuses: config.statuses, labels: config.labels },
    ...reachable.map((judged) => ({
      projectId: judged.projectId,
      statuses: sourceStatuses(config, judged.source),
      labels: judged.source.labels,
    })),
  ];
}

/** The pool's occupancy, its agents' models on hold or ramping up after
 * one, the organization's agent-worker room and the ready work on every
 * board the dispatch serves, as one pass sees them. An agent's occupancy
 * counts every live run it holds, on whichever board. */
async function readDispatchFacts(
  sql: Sql,
  args: {
    organizationId: string;
    config: ProjectDispatch;
    boards: readonly DispatchBoard[];
    now: number;
  },
): Promise<{
  agents: DispatchAgent[];
  candidates: DispatchCandidate[];
  workerRoom: number;
  modelRamps: Map<string, DispatchModelRamp>;
}> {
  const { organizationId, config } = args;
  const pool = config.agents;
  const occupancy =
    pool.length === 0
      ? []
      : await sql<{ agentId: string; live: number }[]>`
          SELECT agent_id AS "agentId", count(*)::int AS live
          FROM app.project_agent_runs r
          WHERE r.org_id = ${organizationId}
            AND r.agent_id = ANY(${pool})
            AND (r.status IN ('queued', 'running')
              -- A failed run whose automatic retry is armed holds its agent:
              -- the retry starts on it.
              OR (r.status = 'failed'
                AND r.auto_retry_armed_at_ms IS NOT NULL
                AND r.auto_retry_refused_at_ms IS NULL
                AND NOT EXISTS (
                  SELECT 1 FROM app.project_agent_runs later
                  WHERE later.task_id = r.task_id AND later.seq > r.seq
                )))
          GROUP BY agent_id
        `;
  const live = new Map(occupancy.map((row) => [row.agentId, row.live]));
  const models =
    pool.length === 0
      ? []
      : await sql<
          {
            agentId: string;
            modelProvider: string | null;
            model: string;
            held: boolean;
          }[]
        >`
          SELECT a.id AS "agentId", a.model_provider AS "modelProvider",
                 a.model,
                 EXISTS (
                   SELECT 1 FROM app.model_capacity_holds h
                   WHERE h.org_id = a.org_id
                     AND h.model_provider = coalesce(a.model_provider, '')
                     AND h.model = a.model
                     AND (h.held_until_ms > ${args.now}
                       OR h.probe_run_id IS NOT NULL)
                 ) AS held
          FROM app.project_agents a
          WHERE a.org_id = ${organizationId} AND a.id = ANY(${pool})
        `;
  const modelOf = new Map(models.map((row) => [row.agentId, row]));
  const agents: DispatchAgent[] = pool.map((agentId) => {
    const model = modelOf.get(agentId);
    return {
      agentId,
      live: live.get(agentId) ?? 0,
      modelHeld: model?.held === true,
      ...(model === undefined ? {} : { modelKey: modelCapacityKey(model) }),
    };
  });
  const modelRamps =
    pool.length === 0
      ? new Map<string, DispatchModelRamp>()
      : await readModelCapacityRamps(sql, { organizationId, now: args.now });

  const { cap, inFlight } = await projectSessionRoom(sql, organizationId);
  const pending = await sql<{ queued: number }[]>`
    SELECT count(*)::int AS queued FROM app.project_agent_runs
    WHERE org_id = ${organizationId} AND status = 'queued'
      AND waiting_for_capacity_at_ms IS NULL AND engine = 'harness'
  `;
  const workerRoom = cap - inFlight - (pending[0]?.queued ?? 0);

  const roleTasks = (config.standingRoles ?? []).map((role) => role.taskId);
  const candidates: DispatchCandidate[] = [];
  if (pool.length > 0) {
    for (const board of args.boards) {
      candidates.push(
        ...(await readBoardCandidates(sql, {
          organizationId,
          board,
          pool,
          poolMode: config.assignment === 'pool',
          roleTasks,
        })),
      );
    }
  }
  // One order across every board: the column a task waits in (by its own
  // board's preference), its priority, its place on its board and its age.
  // A pass reads no more than it could start.
  const ranked = rankCandidates(candidates, config.statuses).slice(
    0,
    CANDIDATES_PER_PASS,
  );
  return { agents, candidates: ranked, workerRoom, modelRamps };
}

/** The ready work of one board, best-ranked first: tasks in its columns
 * that its labels select, assigned to an agent of the pool (or nobody's,
 * when the pool takes unassigned work), with no live run, no armed retry
 * and no open blocker. */
async function readBoardCandidates(
  sql: Sql,
  args: {
    organizationId: string;
    board: DispatchBoard;
    pool: readonly string[];
    poolMode: boolean;
    roleTasks: readonly string[];
  },
): Promise<DispatchCandidate[]> {
  const { organizationId, board, pool, poolMode, roleTasks } = args;
  const projectId = board.projectId;
  const labels = await labelIdsByName(sql, {
    organizationId,
    projectIds: [projectId],
    names: [...(board.labels?.include ?? []), ...(board.labels?.exclude ?? [])],
  });
  const include =
    board.labels?.include === undefined
      ? null
      : board.labels.include.flatMap(
          (name) => labels.get(name.toLowerCase()) ?? [],
        );
  const exclude =
    board.labels?.exclude === undefined
      ? null
      : board.labels.exclude.flatMap(
          (name) => labels.get(name.toLowerCase()) ?? [],
        );
  const statuses = [...board.statuses];
  const rows = await sql<Omit<DispatchCandidate, 'projectId' | 'column'>[]>`
          SELECT t.id AS "taskId", t.status, t.priority, t.rank,
                 t.created_at_ms::float8 AS "createdAt",
                 CASE WHEN t.assignee_type = 'agent' THEN t.assignee_id END
                   AS "assigneeAgentId",
                 coalesce(t.label_ids, '{}') AS "labelIds",
                 EXISTS (
                   SELECT 1 FROM app.project_agent_runs r WHERE r.task_id = t.id
                 ) AS "hasRuns"
          FROM app.tasks t
          WHERE t.org_id = ${organizationId} AND t.project_id = ${projectId}
            AND t.status = ANY(${statuses})
            AND t.archived_at_ms IS NULL
            AND ((t.assignee_type = 'agent' AND t.assignee_id = ANY(${pool}))
              OR (${poolMode} AND t.assignee_id IS NULL))
            AND NOT (t.id = ANY(${roleTasks}))
            AND NOT EXISTS (
              SELECT 1 FROM app.project_agent_runs r
              WHERE r.task_id = t.id AND r.status IN ('queued', 'running')
            )
            -- A failed run whose automatic retry is armed starts again on
            -- its own, after the wait its failure called for.
            AND NOT EXISTS (
              SELECT 1 FROM app.project_agent_runs r
              WHERE r.task_id = t.id AND r.status = 'failed'
                AND r.auto_retry_armed_at_ms IS NOT NULL
                AND r.auto_retry_refused_at_ms IS NULL
                AND NOT EXISTS (
                  SELECT 1 FROM app.project_agent_runs later
                  WHERE later.task_id = r.task_id AND later.seq > r.seq
                )
            )
            AND NOT EXISTS (
              SELECT 1 FROM app.task_dependencies d
              JOIN app.tasks b ON b.id = d.blocker_task_id
              WHERE d.blocked_task_id = t.id
                AND b.status NOT IN ('done', 'cancelled')
            )
            AND (${include === null} OR t.label_ids && ${include ?? []}::text[])
            AND (${exclude === null}
              OR NOT (t.label_ids && ${exclude ?? []}::text[]))
          ORDER BY array_position(${statuses}::text[], t.status),
                   CASE t.priority WHEN 'p0' THEN 0 WHEN 'p1' THEN 1
                     WHEN 'p2' THEN 2 WHEN 'p3' THEN 3 ELSE 4 END,
                   t.rank, t.created_at_ms, t.id
          LIMIT ${CANDIDATES_PER_PASS}
        `;
  return rows.map((row) =>
    Object.assign(row, { projectId, column: statuses.indexOf(row.status) }),
  );
}

/** The labels of the named projects by lower-cased name: a name a board
 * shows twice in different case, or two boards each show, matches every
 * one. */
async function labelIdsByName(
  sql: Sql,
  args: { organizationId: string; projectIds: string[]; names: string[] },
): Promise<Map<string, string[]>> {
  if (args.names.length === 0 || args.projectIds.length === 0) {
    return new Map();
  }
  const rows = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM app.task_labels
    WHERE org_id = ${args.organizationId}
      AND project_id = ANY(${args.projectIds})
      AND lower(name) = ANY(${args.names.map((name) => name.toLowerCase())})
  `;
  const byName = new Map<string, string[]>();
  for (const row of rows) {
    const key = row.name.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), row.id]);
  }
  return byName;
}

/** Whether the sandbox host admits another start now. An unreachable or
 * older spawner is unknown: the deployment's own thresholds start anyway
 * (its session admission still decides), a stricter preset holds. */
/** The sandbox host's verdict on one more start, as a pass reads it. */
export interface HostVerdict {
  admitted: boolean;
  retryAfterMs: number | null;
  reason: string | null;
  evidence:
    | SandboxAdmission
    | { unavailable: string }
    | Record<string, unknown>;
}

/** Who a pass asks about the host: the spawner, or a stand-in a test hands
 * the pass to put the host under pressure. */
export type HostAsker = (
  organizationId: string,
  preset: DispatchAdmissionPreset,
) => Promise<HostVerdict>;

async function askHost(
  organizationId: string,
  preset: DispatchAdmissionPreset,
): Promise<HostVerdict> {
  let answer: SandboxAdmission | null;
  try {
    answer = await sandboxAdmission(organizationId, { kind: 'start', preset });
  } catch (error) {
    console.warn(
      '[dispatch] the sandbox host did not answer admission:',
      error,
    );
    answer = null;
  }
  if (answer === null) {
    return {
      admitted: preset === 'default',
      retryAfterMs: null,
      reason: preset === 'default' ? null : 'unavailable',
      evidence: { unavailable: 'the sandbox host did not answer' },
    };
  }
  return {
    admitted: answer.verdict === 'admit',
    retryAfterMs: answer.retryAfterMs,
    reason: answer.reason,
    evidence: answer,
  };
}

/** Start one pick, the way an automation or a manager agent would. A
 * refusal the start answers (a task that took its hourly starts, an open
 * blocker, a run already working) holds the pick, with why. */
async function startPick(
  sql: Sql,
  args: {
    organizationId: string;
    projectId: string;
    /** The boards the dispatch serves now: its own and the sources it
     * reaches. */
    scopeProjectIds: readonly string[];
    passId: string;
    pick: { taskId: string; agentId: string };
    feedback?: string;
  },
): Promise<
  | { started: true; runId: string }
  | { started: false; reason: string; retryAfter?: number; runId?: string }
> {
  try {
    const result = await transactSerializable(sql, (tx) =>
      startDelegatedAgentRun(tx, {
        organizationId: args.organizationId,
        scopeProjectIds: args.scopeProjectIds,
        taskId: args.pick.taskId,
        startedBy: dispatchRunStarter(args.projectId),
        via: { kind: 'dispatch', runId: args.passId },
        agentId: args.pick.agentId,
        moveToInProgress: true,
        ...(args.feedback !== undefined ? { feedback: args.feedback } : {}),
      }),
    );
    switch (result.outcome) {
      case 'started':
        return { started: true, runId: result.runId };
      case 'already_running':
        return {
          started: false,
          reason: 'already_running',
          runId: result.runId,
        };
      case 'paused':
        return {
          started: false,
          reason: 'paused',
          retryAfter: result.retryAfter,
        };
      default:
        return { started: false, reason: result.outcome };
    }
  } catch (error) {
    if (error instanceof TaskError) {
      return { started: false, reason: error.code };
    }
    console.error(
      `[dispatch] starting task ${args.pick.taskId} on ${args.pick.agentId} failed:`,
      error,
    );
    return { started: false, reason: 'error' };
  }
}

/**
 * Decide the standing roles that are due and start each one's agent on its
 * task. The occurrence's row is claimed in the transaction that starts the
 * run, so an occurrence decided twice starts once.
 */
async function runStandingRoles(
  sql: Sql,
  args: {
    organizationId: string;
    projectId: string;
    roles: readonly ProjectDispatchRole[];
    since: number;
    now: number;
  },
): Promise<{ started: DispatchStart[]; held: DispatchHeld[] }> {
  const started: DispatchStart[] = [];
  const held: DispatchHeld[] = [];
  const handledRows = await sql<{ key: string; at: number }[]>`
    SELECT role_key AS key, max(occurrence_at_ms)::float8 AS at
    FROM app.project_standing_role_occurrences
    WHERE project_id = ${args.projectId}
    GROUP BY role_key
  `;
  const handled = new Map(handledRows.map((row) => [row.key, row.at]));
  const due = dueRoleOccurrences(args.roles, {
    handled,
    since: args.since,
    now: args.now,
  });
  for (const occurrence of due) {
    const { role } = occurrence;
    const occurrenceId = roleOccurrenceId(role.key, occurrence.occurrenceAt);
    let outcome:
      | { kind: 'started'; runId: string }
      | { kind: 'coalesced'; runId: string }
      | { kind: 'refused'; reason: string; retryAfter?: number }
      | { kind: 'claimed_elsewhere' };
    try {
      outcome = await transactSerializable(sql, async (tx) => {
        const claimed = await tx<{ roleKey: string }[]>`
          INSERT INTO app.project_standing_role_occurrences (
            org_id, project_id, role_key, occurrence_at_ms, label, outcome,
            recorded_at_ms
          ) VALUES (
            ${args.organizationId}, ${args.projectId}, ${role.key},
            ${occurrence.occurrenceAt}, ${occurrence.label}, 'refused',
            ${Date.now()}
          )
          ON CONFLICT (project_id, role_key, occurrence_at_ms) DO NOTHING
          RETURNING role_key AS "roleKey"
        `;
        if (claimed.length === 0) return { kind: 'claimed_elsewhere' as const };
        const result = await startDelegatedAgentRun(tx, {
          organizationId: args.organizationId,
          scopeProjectIds: [args.projectId],
          taskId: role.taskId,
          startedBy: dispatchRunStarter(args.projectId),
          via: { kind: 'dispatch', runId: occurrenceId },
          agentId: role.agentId,
          moveToInProgress: true,
          feedback: roleOccurrenceFeedback(role, occurrence.label),
        });
        const decided =
          result.outcome === 'started'
            ? { kind: 'started' as const, runId: result.runId }
            : result.outcome === 'already_running'
              ? { kind: 'coalesced' as const, runId: result.runId }
              : {
                  kind: 'refused' as const,
                  reason: result.outcome,
                  ...(result.outcome === 'paused'
                    ? { retryAfter: result.retryAfter }
                    : {}),
                };
        await recordOccurrenceInTx(tx, {
          projectId: args.projectId,
          roleKey: role.key,
          occurrenceAt: occurrence.occurrenceAt,
          outcome: decided.kind,
          runId: decided.kind === 'refused' ? null : decided.runId,
          reason: decided.kind === 'refused' ? decided.reason : null,
          retryAfter:
            decided.kind === 'refused' ? (decided.retryAfter ?? null) : null,
        });
        return decided;
      });
    } catch (error) {
      const reason = error instanceof TaskError ? error.code : 'error';
      if (!(error instanceof TaskError)) {
        console.error(
          `[dispatch] standing role ${role.key} of ${args.projectId} failed to start:`,
          error,
        );
      }
      // The start rolled back with its claim: record the refusal on its own,
      // so the occurrence is decided once and says why.
      await sql.begin(async (tx) => {
        await tx`
          INSERT INTO app.project_standing_role_occurrences (
            org_id, project_id, role_key, occurrence_at_ms, label, outcome,
            reason, recorded_at_ms
          ) VALUES (
            ${args.organizationId}, ${args.projectId}, ${role.key},
            ${occurrence.occurrenceAt}, ${occurrence.label}, 'refused',
            ${reason}, ${Date.now()}
          )
          ON CONFLICT (project_id, role_key, occurrence_at_ms) DO NOTHING
        `;
      });
      outcome = { kind: 'refused', reason };
    }
    if (outcome.kind === 'started') {
      started.push({
        taskId: role.taskId,
        agentId: role.agentId,
        runId: outcome.runId,
        via: 'standing_role',
        role: role.key,
        occurrence: occurrence.label,
      });
    } else if (outcome.kind === 'coalesced') {
      held.push({
        taskId: role.taskId,
        agentId: role.agentId,
        reason: 'coalesced',
        role: role.key,
      });
    } else if (outcome.kind === 'refused') {
      held.push({
        taskId: role.taskId,
        agentId: role.agentId,
        reason: outcome.reason,
        role: role.key,
        ...(outcome.retryAfter !== undefined
          ? { retryAfter: outcome.retryAfter }
          : {}),
      });
    }
  }
  return { started, held };
}

async function recordOccurrenceInTx(
  tx: TransactionSql,
  args: {
    projectId: string;
    roleKey: string;
    occurrenceAt: number;
    outcome: 'started' | 'coalesced' | 'refused';
    runId: string | null;
    reason: string | null;
    retryAfter: number | null;
  },
): Promise<void> {
  await tx`
    UPDATE app.project_standing_role_occurrences SET
      outcome = ${args.outcome}, run_id = ${args.runId},
      reason = ${args.reason}, retry_after_ms = ${args.retryAfter},
      recorded_at_ms = ${Date.now()}
    WHERE project_id = ${args.projectId} AND role_key = ${args.roleKey}
      AND occurrence_at_ms = ${args.occurrenceAt}
  `;
}

/** Record the pass, settle the project's state and free its lease; ask for
 * the next pass when this one named a time. */
async function finishPass(
  sql: Sql,
  args: {
    organizationId: string;
    projectId: string;
    trigger: DispatchPassTrigger;
    passId: string;
    startedAt: number;
    occupied: number;
    capacity: number;
    result: DispatchPassResult;
    admission: unknown;
    lastStartAt: number | null;
    recheckIndex: number;
  },
): Promise<void> {
  const now = Date.now();
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO app.project_dispatch_passes (
        id, org_id, project_id, trigger, started_at_ms, finished_at_ms,
        occupied, capacity, started, held, stop_reason, admission,
        next_pass_at_ms
      ) VALUES (
        ${args.passId}, ${args.organizationId}, ${args.projectId},
        ${args.trigger}, ${args.startedAt}, ${now}, ${args.occupied},
        ${args.capacity}, ${tx.json(toJson(args.result.started))},
        ${tx.json(toJson(args.result.held.slice(0, HOLDS_RECORDED)))},
        ${args.result.stop},
        ${args.admission === null ? null : tx.json(toJson(args.admission))},
        ${args.result.nextPassAt}
      )
    `;
    await tx`
      UPDATE app.project_dispatch_state SET
        pass_lease_until_ms = NULL,
        last_pass_id = ${args.passId},
        last_pass_at_ms = ${now},
        last_start_at_ms = ${args.lastStartAt},
        next_pass_at_ms = ${args.result.nextPassAt},
        last_stop_reason = ${args.result.stop},
        recheck_index = ${args.recheckIndex},
        updated_at_ms = ${now}
      WHERE project_id = ${args.projectId}
    `;
    if (args.result.nextPassAt !== null) {
      await requestDispatchPassInTx(tx, {
        organizationId: args.organizationId,
        projectId: args.projectId,
        trigger: 'recheck',
        startAfterMs: args.result.nextPassAt,
      });
    }
  });
}

async function releaseLease(sql: Sql, projectId: string): Promise<void> {
  await sql`
    UPDATE app.project_dispatch_state SET pass_lease_until_ms = NULL,
      updated_at_ms = ${Date.now()}
    WHERE project_id = ${projectId}
  `;
}

/** What starting a plan's picks reaches beyond the pass: the clock, the
 * sandbox host, the start itself, and what a start notes for the gates that
 * space it. The pass hands the real ones; a test hands stand-ins. */
export interface PickEffects {
  now: () => number;
  askHost: () => Promise<HostVerdict>;
  start: (pick: DispatchPick) => ReturnType<typeof startPick>;
  noteStart: (pick: DispatchPick, at: number) => Promise<void>;
}

/** What starting a plan's picks did, and when the next pass comes. */
export interface PickRun {
  stop: DispatchStopReason;
  nextPassAt: number | null;
  started: DispatchStart[];
  held: DispatchHeld[];
  lastStartAt: number | null;
  recheckIndex: number;
  /** The host's verdict on the last start asked about. */
  hostEvidence: unknown;
}

/**
 * Start a plan's picks in turn, asking the sandbox host before each. The
 * pass stops at the first of: its time for starting ready work running out
 * after its first pick (`budget`, the next pass at once); a start the
 * spacing does not allow yet (`pacing`, the next pass when it does); the
 * host holding (`host_pressure`, the next pass after the recheck delays);
 * a start made with a spacing to keep (`pacing`). A start the task refuses
 * is held and the next pick goes on. Having started every pick, a pass
 * whose plan held work for a model's ramp asks again at its next wave.
 */
export async function startPicks(
  args: {
    picks: readonly DispatchPick[];
    /** The plan's verdict, before any start: `held` while it has picks. */
    stop: DispatchStopReason;
    startedAt: number;
    budgetMs: number;
    spacingMs: number;
    recheckSeconds: readonly number[];
    lastStartAt: number | null;
    recheckIndex: number;
    /** The plan's `rampUntil`. */
    rampUntil: number | null;
  },
  effects: PickEffects,
): Promise<PickRun> {
  const started: DispatchStart[] = [];
  const held: DispatchHeld[] = [];
  let { stop, lastStartAt, recheckIndex } = args;
  let nextPassAt: number | null = null;
  let hostEvidence: unknown = null;
  for (const [index, pick] of args.picks.entries()) {
    const now = effects.now();
    if (
      passOutOfTime({
        startedAt: args.startedAt,
        now,
        tried: index,
        budgetMs: args.budgetMs,
      })
    ) {
      // The pass has gone on as long as it may: the next one starts the
      // rest at once, with the facts as they stand then.
      stop = 'budget';
      nextPassAt = now;
      break;
    }
    const pacedUntil = startPacedUntil({
      spacingMs: args.spacingMs,
      lastStartAt,
      now,
    });
    if (pacedUntil !== null) {
      stop = 'pacing';
      nextPassAt = pacedUntil;
      break;
    }
    const host = await effects.askHost();
    hostEvidence = host.evidence;
    if (!host.admitted) {
      stop = 'host_pressure';
      nextPassAt = hostRecheckAt({
        now,
        recheckSeconds: args.recheckSeconds,
        recheckIndex,
        retryAfterMs: host.retryAfterMs,
      });
      recheckIndex += 1;
      held.push({
        taskId: pick.taskId,
        agentId: pick.agentId,
        reason: `host_${host.reason ?? 'pressure'}`,
        retryAfter: nextPassAt,
      });
      break;
    }
    recheckIndex = 0;
    const outcome = await effects.start(pick);
    if (!outcome.started) {
      held.push({
        taskId: pick.taskId,
        agentId: pick.agentId,
        reason: outcome.reason,
        ...(outcome.retryAfter !== undefined
          ? { retryAfter: outcome.retryAfter }
          : {}),
      });
      continue;
    }
    lastStartAt = effects.now();
    await effects.noteStart(pick, lastStartAt);
    started.push({
      taskId: pick.taskId,
      agentId: pick.agentId,
      runId: outcome.runId,
      via: pick.via,
      admission: host.evidence,
    });
    stop = 'started';
    if (args.spacingMs > 0 && index < args.picks.length - 1) {
      stop = 'pacing';
      nextPassAt = lastStartAt + args.spacingMs;
      break;
    }
  }
  if (nextPassAt === null && args.rampUntil !== null) {
    // A model's ramp held work back: the next pass comes with its next wave.
    nextPassAt = args.rampUntil;
    if (stop === 'started') stop = 'model_ramp';
  }
  return {
    stop,
    nextPassAt,
    started,
    held,
    lastStartAt,
    recheckIndex,
    hostEvidence,
  };
}

/** Run one pass of the project's dispatch. Null when another pass held the
 * lease (this one is asked for again shortly) or the project has no
 * switched-on dispatch. */
export async function runDispatchPass(
  sql: Sql,
  input: {
    organizationId: string;
    projectId: string;
    trigger: DispatchPassTrigger;
  },
  options: {
    askHost?: HostAsker;
    /** How long the pass starts ready work: {@link PASS_BUDGET_MS} unless a
     * test runs it out sooner. */
    budgetMs?: number;
  } = {},
): Promise<DispatchPassResult | null> {
  const ask = options.askHost ?? askHost;
  const startedAt = Date.now();
  const { trigger } = input;
  const stored = await readStoredDispatch(
    sql,
    input.organizationId,
    input.projectId,
  );
  if (stored === null || !stored.config.enabled) return null;
  if (!(await takeLease(sql, { ...input, now: startedAt }))) {
    await sql.begin((tx) =>
      requestDispatchPassInTx(tx, {
        organizationId: input.organizationId,
        projectId: input.projectId,
        trigger,
        startAfterMs: startedAt + BUSY_RETRY_MS,
      }),
    );
    return null;
  }
  const passId = randomUUID();
  const config = stored.config;
  const admission = dispatchAdmission(config);
  const state = await readState(sql, input.projectId);
  let lastStartAt = state.lastStartAt;
  let recheckIndex = state.recheckIndex;
  const started: DispatchStart[] = [];
  const held: DispatchHeld[] = [];
  try {
    try {
      await sql.begin((tx) =>
        assertTaskAutomationEnabled(tx, input.organizationId),
      );
    } catch (error) {
      if (!(error instanceof TaskError)) throw error;
      const result: DispatchPassResult = {
        passId,
        stop: 'automation_disabled',
        started,
        held,
        nextPassAt: null,
      };
      await finishPass(sql, {
        ...input,
        trigger,
        passId,
        startedAt,
        occupied: 0,
        capacity: config.maxConcurrentRuns,
        result,
        admission: null,
        lastStartAt,
        recheckIndex,
      });
      return result;
    }

    const roles = config.standingRoles ?? [];
    if (roles.length > 0) {
      const outcome = await runStandingRoles(sql, {
        ...input,
        roles,
        since: stored.updatedAt,
        now: startedAt,
      });
      started.push(...outcome.started);
      held.push(...outcome.held);
    }

    // The other boards it serves, judged now: one it no longer reaches is
    // skipped, and the pass says why.
    const sources = await judgeDispatchSources(sql, {
      organizationId: input.organizationId,
      sources: config.sources ?? [],
      authorityUserId: stored.updatedBy,
    });
    for (const source of sources) {
      if (source.skipped === null) continue;
      held.push({
        taskId: null,
        agentId: null,
        reason: `source_${source.skipped}`,
        projectId: source.projectId,
      });
    }
    const boards = dispatchBoards(
      input.projectId,
      config,
      sources.filter((source) => source.skipped === null),
    );
    const boardIds = boards.map((board) => board.projectId);
    const facts = await readDispatchFacts(sql, {
      organizationId: input.organizationId,
      config,
      boards,
      now: Date.now(),
    });
    // The gates: ready work a held gate governs waits, the rest goes on. A
    // gate governs by label name across every board the dispatch serves.
    const gates = config.gates ?? [];
    const gateStates =
      gates.length === 0
        ? new Map<string, GateState>()
        : await readGateStates(sql, input.projectId);
    const gateLabels = await labelIdsByName(sql, {
      organizationId: input.organizationId,
      projectIds: boardIds,
      names: gates.flatMap((gate) => gate.labels ?? []),
    });
    const gateLabelIds = new Map(
      gates.map((gate) => [
        gate.key,
        (gate.labels ?? []).flatMap(
          (name) => gateLabels.get(name.toLowerCase()) ?? [],
        ),
      ]),
    );
    const governing = (labelIds: readonly string[]) =>
      gates.filter((gate) =>
        gateGoverns(gate, gateLabelIds.get(gate.key) ?? [], labelIds),
      );
    const gated = gateCandidates({
      gates,
      states: gateStates,
      gateLabelIds,
      candidates: facts.candidates,
      now: Date.now(),
    });
    const open = gated.open;
    const gatedCount = gated.held.length;
    held.push(...gated.held);
    const labelsOf = new Map(
      facts.candidates.map((candidate) => [
        candidate.taskId,
        candidate.labelIds,
      ]),
    );
    const plan = planDispatch({
      config,
      agents: facts.agents,
      candidates: open,
      workerRoom: facts.workerRoom,
      modelRamps: facts.modelRamps,
    });
    const boardOf = new Map(
      facts.candidates.map((candidate) => [
        candidate.taskId,
        candidate.projectId,
      ]),
    );
    for (const hold of plan.holds) {
      const board = boardOf.get(hold.taskId);
      held.push({
        taskId: hold.taskId,
        agentId: hold.agentId,
        reason: hold.reason,
        ...(board !== undefined && board !== input.projectId
          ? { projectId: board }
          : {}),
      });
    }
    const run = await startPicks(
      {
        picks: plan.picks,
        stop:
          plan.stop === 'picked'
            ? 'held'
            : plan.stop === 'no_ready_work' && gatedCount > 0
              ? 'gated'
              : plan.stop,
        startedAt,
        budgetMs: options.budgetMs ?? PASS_BUDGET_MS,
        spacingMs: admission.startSpacingSeconds * 1000,
        recheckSeconds: admission.recheckSeconds,
        lastStartAt,
        recheckIndex,
        rampUntil: plan.rampUntil,
      },
      {
        now: () => Date.now(),
        askHost: () => ask(input.organizationId, admission.preset),
        start: (pick) =>
          startPick(sql, {
            ...input,
            scopeProjectIds: boardIds,
            passId,
            pick,
          }),
        noteStart: (pick, at) =>
          noteGatedStart(sql, {
            organizationId: input.organizationId,
            projectId: input.projectId,
            keys: governing(labelsOf.get(pick.taskId) ?? [])
              .filter((gate) => (gate.startSpacingSeconds ?? 0) > 0)
              .map((gate) => gate.key),
            at,
          }),
      },
    );
    started.push(...run.started);
    held.push(...run.held);
    lastStartAt = run.lastStartAt;
    recheckIndex = run.recheckIndex;
    const { stop, nextPassAt, hostEvidence } = run;
    const result: DispatchPassResult = {
      passId,
      stop: started.length > 0 && stop === 'held' ? 'started' : stop,
      started,
      held,
      nextPassAt,
    };
    await finishPass(sql, {
      ...input,
      trigger,
      passId,
      startedAt,
      occupied: plan.occupied,
      capacity: plan.capacity,
      result,
      admission: hostEvidence,
      lastStartAt,
      recheckIndex,
    });
    return result;
  } catch (error) {
    await releaseLease(sql, input.projectId).catch((releaseError: unknown) => {
      console.error(
        `[dispatch] releasing the lease of ${input.projectId} failed:`,
        releaseError,
      );
    });
    throw error;
  }
}

/**
 * The minute scan: ask for a pass of every switched-on dispatch whose next
 * pass is due (or was never named), and drop pass records older than a
 * week. A pass asked for while one waits is the same pass.
 */
export async function scanProjectDispatches(sql: Sql): Promise<number> {
  const now = Date.now();
  const due = await sql<{ projectId: string; organizationId: string }[]>`
    SELECT d.project_id AS "projectId", d.org_id AS "organizationId"
    FROM app.project_dispatch d
    LEFT JOIN app.project_dispatch_state s ON s.project_id = d.project_id
    WHERE d.enabled = true
      AND (s.next_pass_at_ms IS NULL OR s.next_pass_at_ms <= ${now})
    ORDER BY coalesce(s.last_pass_at_ms, 0)
    LIMIT 1000
  `;
  for (const row of due) {
    try {
      await sql.begin((tx) =>
        requestDispatchPassInTx(tx, { ...row, trigger: 'scan' }),
      );
    } catch (error) {
      console.error(
        `[dispatch] asking for a pass of ${row.projectId} failed:`,
        error,
      );
    }
  }
  await sql`
    DELETE FROM app.project_dispatch_passes
    WHERE id IN (
      SELECT id FROM app.project_dispatch_passes
      WHERE started_at_ms < ${now - PASS_RETENTION_MS}
      LIMIT 5000
    )
  `;
  return due.length;
}
