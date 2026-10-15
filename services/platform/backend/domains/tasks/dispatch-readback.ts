import {
  DISPATCH_DEFAULTS,
  DISPATCH_RUNS_LISTED,
  type DispatchAgentRun,
  type DispatchAgentRunCounts,
  type DispatchIdleReason,
  type ProjectDispatchStatus,
} from '@tale/shared/schemas/project-dispatch';
import type { Sql } from 'postgres';

import { isAgentRunWaitingReason } from '../../../lib/shared/agent-run-waiting.ts';
import { managedConfigurationHash } from '../../core/lib/config_store/value_hash.ts';
import {
  assertReadable,
  checkProjectAdministrable,
  loadProjectOrThrow,
  type ProjectAuthContext,
} from '../projects/service.ts';
import { projectSessionRoom } from '../sandbox/sessions.ts';
import {
  gateRecoverBelow,
  judgeGate,
  readGateStates,
  type GateState,
} from './dispatch-gates.ts';
import { nextRoleOccurrence } from './dispatch-roles.ts';
import {
  dispatchConfigurationValue,
  readDispatchRow,
} from './dispatch-store.ts';
import { listModelCapacityHolds } from './model-capacity-holds.ts';

/**
 * What a project's dispatch is doing, for the people who read the project:
 * every agent of its pool with how many runs it holds by what they do, the
 * oldest of them (at most `DISPATCH_RUNS_LISTED`), or why it is idle, its
 * standing roles with their next and last occurrence, the models it waits
 * on, the organization's agent workers against the pool, and its recent
 * passes. The answer to "why is this agent idle" is read here, from the run
 * ledger and the passes, never from where the cards stand on the board.
 */

/** Why an agent of the pool works on nothing now. */
export type DispatchAgentIdleReason = DispatchIdleReason;
export type DispatchPoolAgent = ProjectDispatchStatus['pool'][number];
export type { DispatchAgentRun, ProjectDispatchStatus };

const PASSES_SHOWN = 20;

export async function readProjectDispatchStatus(
  sql: Sql,
  auth: ProjectAuthContext,
  projectId: string,
): Promise<ProjectDispatchStatus> {
  const project = await loadProjectOrThrow(sql, projectId);
  assertReadable(project, auth);
  const organizationId = auth.organizationId;
  const canEdit = checkProjectAdministrable(project, auth);
  // A dispatch a newer version stored in a shape this one cannot read is
  // there, starts nothing and is kept: the readback says so instead of
  // offering to set one up over it.
  const storedRow = await readDispatchRow(sql, organizationId, projectId);
  const unreadable = storedRow === 'unreadable';
  const stored = unreadable ? null : storedRow;
  const { cap, inFlight } = await projectSessionRoom(sql, organizationId);
  const holds = await listModelCapacityHolds(sql, organizationId);
  const now = Date.now();
  const activeHolds = holds.filter((hold) => hold.heldUntilMs > now);
  if (stored === null) {
    return {
      configured: unreadable,
      unreadable,
      config: null,
      hash: null,
      canEdit,
      state: null,
      pool: [],
      standingRoles: [],
      holds: activeHolds.map(holdView),
      gates: [],
      workers: { limit: cap, inUse: inFlight },
      poolExceedsWorkers: false,
      passes: [],
    };
  }
  const config = stored.config;
  const states = await sql<
    {
      lastPassAt: number | null;
      lastStartAt: number | null;
      nextPassAt: number | null;
      lastStopReason: string | null;
    }[]
  >`
    SELECT last_pass_at_ms::float8 AS "lastPassAt",
           last_start_at_ms::float8 AS "lastStartAt",
           next_pass_at_ms::float8 AS "nextPassAt",
           last_stop_reason AS "lastStopReason"
    FROM app.project_dispatch_state WHERE project_id = ${projectId}
  `;
  const state = states[0] ?? null;
  const roles = config.standingRoles ?? [];
  const agentIds = [
    ...new Set([...config.agents, ...roles.map((role) => role.agentId)]),
  ];
  const agents =
    agentIds.length === 0
      ? []
      : await sql<
          {
            id: string;
            name: string;
            model: string;
            modelProvider: string | null;
          }[]
        >`
          SELECT id, name, model, model_provider AS "modelProvider"
          FROM app.project_agents
          WHERE org_id = ${organizationId} AND project_id = ${projectId}
            AND id = ANY(${agentIds})
        `;
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  // Every live run of the agents, counted by what it does; and the oldest
  // of each agent's, listed: an agent kept on hundreds of tasks reads in one
  // small answer.
  const tallies =
    agentIds.length === 0
      ? []
      : await sql<RunTally[]>`
          SELECT r.agent_id AS "agentId", r.status,
                 r.waiting_for_capacity_at_ms IS NOT NULL AS parked,
                 r.waiting_reason AS reason, count(*)::int AS count
          FROM app.project_agent_runs r
          WHERE r.org_id = ${organizationId} AND r.project_id = ${projectId}
            AND r.agent_id = ANY(${agentIds})
            AND r.status IN ('queued', 'running')
          GROUP BY r.agent_id, r.status, parked, r.waiting_reason
        `;
  const runs =
    agentIds.length === 0
      ? []
      : await sql<
          (Omit<DispatchAgentRun, 'waitingReason'> & {
            agentId: string;
            parked: boolean;
            reason: string | null;
          })[]
        >`
          SELECT listed."runId", listed."taskId", listed."agentId",
                 t.number AS "taskNumber", t.title AS "taskTitle",
                 listed.status, listed.parked, listed.reason
          FROM (
            SELECT r.id AS "runId", r.task_id AS "taskId",
                   r.agent_id AS "agentId", r.status,
                   r.waiting_for_capacity_at_ms IS NOT NULL AS parked,
                   r.waiting_reason AS reason,
                   row_number() OVER (
                     PARTITION BY r.agent_id ORDER BY r.started_at_ms, r.id
                   ) AS place
            FROM app.project_agent_runs r
            WHERE r.org_id = ${organizationId} AND r.project_id = ${projectId}
              AND r.agent_id = ANY(${agentIds})
              AND r.status IN ('queued', 'running')
          ) listed
          JOIN app.tasks t ON t.id = listed."taskId"
          WHERE listed.place <= ${DISPATCH_RUNS_LISTED}
          ORDER BY listed."agentId", listed.place
        `;
  const runsByAgent = new Map<string, DispatchAgentRun[]>();
  for (const run of runs) {
    const list = runsByAgent.get(run.agentId) ?? [];
    list.push({
      runId: run.runId,
      taskId: run.taskId,
      taskNumber: run.taskNumber,
      taskTitle: run.taskTitle,
      status: run.status,
      waitingReason: runWaitingReason(run),
    });
    runsByAgent.set(run.agentId, list);
  }
  const countsByAgent = countRunsByAgent(tallies);
  const heldUntilOf = (agent: {
    model: string;
    modelProvider: string | null;
  }): number | null =>
    activeHolds.find(
      (hold) =>
        hold.model === agent.model &&
        hold.modelProvider === (agent.modelProvider ?? ''),
    )?.heldUntilMs ?? null;
  const perAgent =
    config.perAgentConcurrency ?? DISPATCH_DEFAULTS.perAgentConcurrency;
  const pool: DispatchPoolAgent[] = config.agents.flatMap((agentId) => {
    const agent = agentById.get(agentId);
    if (agent === undefined) return [];
    const agentRuns = runsByAgent.get(agentId) ?? [];
    const runCounts = countsByAgent.get(agentId) ?? emptyRunCounts();
    const heldUntil = heldUntilOf(agent);
    return [
      {
        agentId,
        name: agent.name,
        model: agent.model,
        modelProvider: agent.modelProvider,
        runs: agentRuns,
        runCounts,
        capacity: perAgent,
        modelHeldUntil: heldUntil,
        idle:
          runCounts.total > 0
            ? null
            : idleReason({
                enabled: config.enabled,
                heldUntil,
                lastStopReason: state?.lastStopReason ?? null,
              }),
      },
    ];
  });
  const roleTaskIds = [...new Set(roles.map((role) => role.taskId))];
  const roleTasks =
    roleTaskIds.length === 0
      ? []
      : await sql<{ id: string; title: string }[]>`
          SELECT id, title FROM app.tasks
          WHERE org_id = ${organizationId} AND id = ANY(${roleTaskIds})
        `;
  const titleOf = new Map(roleTasks.map((task) => [task.id, task.title]));
  const lastOccurrences =
    roles.length === 0
      ? []
      : await sql<
          {
            key: string;
            label: string;
            outcome: string;
            runId: string | null;
            reason: string | null;
            at: number;
          }[]
        >`
          SELECT DISTINCT ON (role_key) role_key AS key, label, outcome,
                 run_id AS "runId", reason,
                 occurrence_at_ms::float8 AS at
          FROM app.project_standing_role_occurrences
          WHERE project_id = ${projectId}
          ORDER BY role_key, occurrence_at_ms DESC
        `;
  const lastOf = new Map(lastOccurrences.map((row) => [row.key, row]));
  const passes = await sql<
    {
      id: string;
      trigger: string;
      startedAt: number;
      stopReason: string;
      started: number;
      held: number;
      nextPassAt: number | null;
    }[]
  >`
    SELECT id, trigger, started_at_ms::float8 AS "startedAt",
           stop_reason AS "stopReason",
           jsonb_array_length(started)::int AS started,
           jsonb_array_length(held)::int AS held,
           next_pass_at_ms::float8 AS "nextPassAt"
    FROM app.project_dispatch_passes
    WHERE project_id = ${projectId}
    ORDER BY started_at_ms DESC
    LIMIT ${PASSES_SHOWN}
  `;
  const gateStates =
    (config.gates ?? []).length === 0
      ? new Map<string, GateState>()
      : await readGateStates(sql, projectId);
  const gates = (config.gates ?? []).map((gate) => {
    const gateState = gateStates.get(gate.key);
    const verdict = judgeGate(gate, gateState, now);
    return {
      key: gate.key,
      labels: gate.labels ?? null,
      held: verdict.held,
      stale: verdict.stale,
      holdAt: gate.holdAt ?? null,
      recoverBelow: gateRecoverBelow(gate),
      whenStale: gate.whenStale ?? DISPATCH_DEFAULTS.gateWhenStale,
      value: gateState?.value ?? null,
      reason: gateState?.reason ?? null,
      reportedAt: gateState?.reportedAt ?? null,
      reportedBy: gateState?.reportedBy ?? null,
      spacedUntil: verdict.spacedUntil,
    };
  });
  const configValue = dispatchConfigurationValue(projectId, config);
  return {
    configured: true,
    unreadable: false,
    config,
    hash: managedConfigurationHash(configValue),
    canEdit,
    state,
    pool,
    standingRoles: roles.map((role) => {
      const last = lastOf.get(role.key);
      return {
        key: role.key,
        agentId: role.agentId,
        taskId: role.taskId,
        taskTitle: titleOf.get(role.taskId) ?? null,
        mode: role.mode ?? null,
        cron: role.cron,
        timezone: role.timezone,
        nextAt: nextRoleOccurrence(role, now),
        last:
          last === undefined
            ? null
            : {
                label: last.label,
                outcome: last.outcome,
                runId: last.runId,
                reason: last.reason,
                at: last.at,
              },
      };
    }),
    holds: activeHolds.map(holdView),
    gates,
    workers: { limit: cap, inUse: inFlight },
    poolExceedsWorkers:
      config.enabled &&
      Math.min(config.maxConcurrentRuns, config.agents.length * perAgent) > cap,
    passes,
  };
}

function holdView(hold: {
  modelProvider: string;
  model: string;
  heldUntilMs: number;
  consecutive: number;
  firstRefusedAtMs: number;
}) {
  return {
    modelProvider: hold.modelProvider,
    model: hold.model,
    heldUntil: hold.heldUntilMs,
    consecutive: hold.consecutive,
    firstRefusedAt: hold.firstRefusedAtMs,
  };
}

/** One group of an agent's live runs: its status, whether it waits, why,
 * and how many runs share all three. */
export interface RunTally {
  agentId: string;
  status: 'queued' | 'running';
  parked: boolean;
  reason: string | null;
  count: number;
}

/** Why a live run waits instead of working: null while it does not, its
 * stored reason when this version knows it, else `unknown`. */
function runWaitingReason(run: {
  parked: boolean;
  reason: string | null;
}): string | null {
  if (!run.parked) return null;
  return isAgentRunWaitingReason(run.reason) ? run.reason : 'unknown';
}

function emptyRunCounts(): DispatchAgentRunCounts {
  return { total: 0, running: 0, queued: 0, waiting: {} };
}

/** Each agent's live runs counted by what they do: working, queued to take
 * a worker, or waiting, by why — the same reason the listed run shows. */
export function countRunsByAgent(
  tallies: readonly RunTally[],
): Map<string, DispatchAgentRunCounts> {
  const counts = new Map<string, DispatchAgentRunCounts>();
  for (const tally of tallies) {
    const agent = counts.get(tally.agentId) ?? emptyRunCounts();
    agent.total += tally.count;
    const waiting = runWaitingReason(tally);
    if (tally.status === 'running') {
      agent.running += tally.count;
    } else if (waiting === null) {
      agent.queued += tally.count;
    } else {
      agent.waiting[waiting] = (agent.waiting[waiting] ?? 0) + tally.count;
    }
    counts.set(tally.agentId, agent);
  }
  return counts;
}

/** Why an agent with no run is idle, from its model's hold and the last
 * pass's stop. */
export function idleReason(args: {
  enabled: boolean;
  heldUntil: number | null;
  lastStopReason: string | null;
}): DispatchAgentIdleReason {
  if (!args.enabled) return 'disabled';
  if (args.heldUntil !== null) return 'model_capacity';
  switch (args.lastStopReason) {
    case 'host_pressure':
      return 'host_pressure';
    case 'org_limit':
      return 'org_limit';
    // Waiting for the next start: the spacing, or the pass that goes on at
    // once after one ran out of time.
    case 'pacing':
    case 'budget':
      return 'pacing';
    case 'gated':
      return 'gated';
    case 'automation_disabled':
    case 'disabled':
      return 'disabled';
    case 'model_capacity':
      return 'model_capacity';
    case null:
      return 'unknown';
    default:
      return 'no_ready_work';
  }
}
