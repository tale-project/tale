import {
  DISPATCH_DEFAULTS,
  type ProjectDispatch,
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
  dispatchConfigurationValue,
  readStoredDispatch,
} from './dispatch-config.ts';
import { nextRoleOccurrence } from './dispatch-roles.ts';
import { listModelCapacityHolds } from './model-capacity-holds.ts';

/**
 * What a project's dispatch is doing, for the people who read the project:
 * every agent of its pool with what it works on or why it is idle, its
 * standing roles with their next and last occurrence, the models it waits
 * on, the organization's agent workers against the pool, and its recent
 * passes. The answer to "why is this agent idle" is read here, from the run
 * ledger and the passes, never from where the cards stand on the board.
 */

/** Why an agent of the pool works on nothing now. */
export type DispatchAgentIdleReason =
  /** Ready work waits only for agents whose model is at capacity. */
  | 'model_capacity'
  /** The sandbox host held the last start. */
  | 'host_pressure'
  /** The organization's agent workers are all in use. */
  | 'org_limit'
  /** The last pass started a run and waits before the next. */
  | 'pacing'
  /** No task is ready for it. */
  | 'no_ready_work'
  /** Dispatch is switched off, or task automation for the organization. */
  | 'disabled'
  /** No pass has run since it joined the pool. */
  | 'unknown';

export interface DispatchAgentRun {
  runId: string;
  taskId: string;
  taskNumber: number | null;
  taskTitle: string;
  status: 'queued' | 'running';
  /** Why the run waits instead of working, while it does. */
  waitingReason: string | null;
}

export interface DispatchPoolAgent {
  agentId: string;
  name: string;
  model: string;
  modelProvider: string | null;
  runs: DispatchAgentRun[];
  /** Runs it may hold at once. */
  capacity: number;
  /** Its model is at capacity until then. */
  modelHeldUntil: number | null;
  idle: DispatchAgentIdleReason | null;
}

export interface ProjectDispatchStatus {
  configured: boolean;
  config: ProjectDispatch | null;
  /** The managed configuration hash of the stored document. */
  hash: string | null;
  canEdit: boolean;
  state: {
    lastPassAt: number | null;
    lastStartAt: number | null;
    nextPassAt: number | null;
    lastStopReason: string | null;
  } | null;
  pool: DispatchPoolAgent[];
  standingRoles: Array<{
    key: string;
    agentId: string;
    taskId: string;
    taskTitle: string | null;
    mode: string | null;
    cron: string;
    timezone: string;
    nextAt: number | null;
    last: {
      label: string;
      outcome: string;
      runId: string | null;
      reason: string | null;
      at: number;
    } | null;
  }>;
  holds: Array<{
    modelProvider: string;
    model: string;
    heldUntil: number;
    consecutive: number;
    firstRefusedAt: number;
  }>;
  workers: { limit: number; inUse: number };
  /** The pool can hold more runs at once than the organization has agent
   * workers: the rest of its runs would wait for one. */
  poolExceedsWorkers: boolean;
  passes: Array<{
    id: string;
    trigger: string;
    startedAt: number;
    stopReason: string;
    started: number;
    held: number;
    nextPassAt: number | null;
  }>;
}

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
  const stored = await readStoredDispatch(sql, organizationId, projectId);
  const { cap, inFlight } = await projectSessionRoom(sql, organizationId);
  const holds = await listModelCapacityHolds(sql, organizationId);
  const now = Date.now();
  const activeHolds = holds.filter((hold) => hold.heldUntilMs > now);
  if (stored === null) {
    return {
      configured: false,
      config: null,
      hash: null,
      canEdit,
      state: null,
      pool: [],
      standingRoles: [],
      holds: activeHolds.map(holdView),
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
  const runs =
    agentIds.length === 0
      ? []
      : await sql<
          (DispatchAgentRun & {
            agentId: string;
            parked: boolean;
            reason: string | null;
          })[]
        >`
          SELECT r.id AS "runId", r.task_id AS "taskId", r.agent_id AS "agentId",
                 t.number AS "taskNumber", t.title AS "taskTitle", r.status,
                 r.waiting_for_capacity_at_ms IS NOT NULL AS parked,
                 r.waiting_reason AS reason
          FROM app.project_agent_runs r
          JOIN app.tasks t ON t.id = r.task_id
          WHERE r.org_id = ${organizationId} AND r.project_id = ${projectId}
            AND r.agent_id = ANY(${agentIds})
            AND r.status IN ('queued', 'running')
          ORDER BY r.started_at_ms
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
      waitingReason:
        run.parked && isAgentRunWaitingReason(run.reason)
          ? run.reason
          : run.parked
            ? 'unknown'
            : null,
    });
    runsByAgent.set(run.agentId, list);
  }
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
    const heldUntil = heldUntilOf(agent);
    return [
      {
        agentId,
        name: agent.name,
        model: agent.model,
        modelProvider: agent.modelProvider,
        runs: agentRuns,
        capacity: perAgent,
        modelHeldUntil: heldUntil,
        idle:
          agentRuns.length > 0
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
  const configValue = dispatchConfigurationValue(projectId, config);
  return {
    configured: true,
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
    case 'pacing':
      return 'pacing';
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
