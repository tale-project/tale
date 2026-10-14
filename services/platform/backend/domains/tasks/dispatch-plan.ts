import {
  DISPATCH_DEFAULTS,
  type DispatchStatus,
  type ProjectDispatch,
} from '@tale/shared/schemas/project-dispatch';

/**
 * Which ready tasks a dispatch pass starts on which agents — pure, so every
 * rule of the pairing is a unit test. The pass (`dispatch-pass.ts`) reads
 * the facts and then starts the picks one at a time, asking the sandbox
 * host before each.
 *
 * Ready work is ranked by the column it waits in (the order the dispatch
 * lists them), then by priority, then by its place on the board, then by
 * age: ranking is what people and their manager agents decide, by setting
 * priorities, ordering the board and moving work between columns.
 *
 * An agent of the pool works at most `perAgentConcurrency` runs at once,
 * and the pool at most `maxConcurrentRuns`. A task assigned to an agent of
 * the pool waits for that agent; with `rebalance`, a task that never started
 * moves to the idle agent that has the most room. With `assignment: pool`, a
 * task nobody is assigned goes to that agent too. An agent whose model the
 * provider called at capacity takes nothing until the model answers again.
 */

export interface DispatchCandidate {
  taskId: string;
  status: DispatchStatus;
  priority: string | null;
  /** The board order within its column (LexoRank). */
  rank: string;
  createdAt: number;
  /** The agent the task is assigned to, or null when nobody is. */
  assigneeAgentId: string | null;
  /** The task has had a run of any agent: a rebalance never moves it, so
   * the conversation and files of its earlier work stay with its agent. */
  hasRuns: boolean;
  /** The task's labels, by id: which of the dispatch's gates govern it. */
  labelIds: string[];
}

export interface DispatchAgent {
  agentId: string;
  /** Live runs (queued, waiting or running) the agent holds in the project,
   * whoever started them. */
  live: number;
  /** The provider called the agent's model at capacity: it takes nothing. */
  modelHeld: boolean;
}

export interface DispatchPick {
  taskId: string;
  agentId: string;
  /** Why this agent: the task's own assignee, an unassigned task handed to
   * the pool, or a task moved from a busy agent of the pool. */
  via: 'assigned' | 'pool' | 'rebalance';
}

export type DispatchHoldReason = 'agent_busy' | 'model_capacity' | 'no_agent';

export interface DispatchHold {
  taskId: string;
  agentId: string | null;
  reason: DispatchHoldReason;
}

export type DispatchPlanStop =
  /** Picks were made; the pass starts them. */
  | 'picked'
  /** The pool holds as many runs as it may. */
  | 'pool_full'
  /** The organization's agent workers are all in use. */
  | 'org_limit'
  /** No task is ready. */
  | 'no_ready_work'
  /** Ready tasks wait for agents that are all busy. */
  | 'agents_busy'
  /** Ready tasks wait for agents whose model is at capacity. */
  | 'model_capacity';

export interface DispatchPlan {
  /** The runs the pool may hold now. */
  capacity: number;
  /** Runs it holds. */
  occupied: number;
  picks: DispatchPick[];
  holds: DispatchHold[];
  stop: DispatchPlanStop;
}

const PRIORITY_ORDER: Record<string, number> = { p0: 0, p1: 1, p2: 2, p3: 3 };

function priorityOrder(priority: string | null): number {
  return priority === null ? 4 : (PRIORITY_ORDER[priority] ?? 4);
}

/** Ready work in the order a dispatch takes it. */
export function rankCandidates(
  candidates: readonly DispatchCandidate[],
  statuses: readonly DispatchStatus[],
): DispatchCandidate[] {
  const column = (status: DispatchStatus) => {
    const index = statuses.indexOf(status);
    return index === -1 ? statuses.length : index;
  };
  return [...candidates].sort(
    (a, b) =>
      column(a.status) - column(b.status) ||
      priorityOrder(a.priority) - priorityOrder(b.priority) ||
      (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0) ||
      a.createdAt - b.createdAt ||
      (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0),
  );
}

export function planDispatch(input: {
  config: ProjectDispatch;
  agents: readonly DispatchAgent[];
  candidates: readonly DispatchCandidate[];
  /** Agent-worker slots the organization has left; null when unknown. */
  workerRoom: number | null;
}): DispatchPlan {
  const { config } = input;
  const perAgent =
    config.perAgentConcurrency ?? DISPATCH_DEFAULTS.perAgentConcurrency;
  const pool = new Set(config.agents);
  const agents = input.agents.filter((agent) => pool.has(agent.agentId));
  const occupied = agents.reduce((sum, agent) => sum + agent.live, 0);
  const capacity = config.maxConcurrentRuns;
  const holds: DispatchHold[] = [];
  const picks: DispatchPick[] = [];
  let free = Math.max(0, capacity - occupied);
  if (free === 0) {
    return { capacity, occupied, picks, holds, stop: 'pool_full' };
  }
  if (input.workerRoom !== null) {
    if (input.workerRoom <= 0) {
      return { capacity, occupied, picks, holds, stop: 'org_limit' };
    }
    free = Math.min(free, input.workerRoom);
  }
  const ranked = rankCandidates(input.candidates, config.statuses);
  if (ranked.length === 0) {
    return { capacity, occupied, picks, holds, stop: 'no_ready_work' };
  }
  const room = new Map(
    agents.map((agent) => [agent.agentId, perAgent - agent.live]),
  );
  const held = new Set(
    agents.filter((agent) => agent.modelHeld).map((agent) => agent.agentId),
  );
  // The idle agent with the most room, in pool order among equals.
  const roomiest = (): string | null => {
    let best: string | null = null;
    let bestRoom = 0;
    for (const agentId of config.agents) {
      if (held.has(agentId)) continue;
      const left = room.get(agentId) ?? 0;
      if (left > bestRoom) {
        best = agentId;
        bestRoom = left;
      }
    }
    return best;
  };
  const take = (taskId: string, agentId: string, via: DispatchPick['via']) => {
    picks.push({ taskId, agentId, via });
    room.set(agentId, (room.get(agentId) ?? 0) - 1);
    free -= 1;
  };
  for (const candidate of ranked) {
    if (free === 0) break;
    const own = candidate.assigneeAgentId;
    if (own !== null && pool.has(own)) {
      if (!held.has(own) && (room.get(own) ?? 0) > 0) {
        take(candidate.taskId, own, 'assigned');
        continue;
      }
      if (config.rebalance === true && !candidate.hasRuns) {
        const other = roomiest();
        if (other !== null) {
          take(candidate.taskId, other, 'rebalance');
          continue;
        }
      }
      holds.push({
        taskId: candidate.taskId,
        agentId: own,
        reason: held.has(own) ? 'model_capacity' : 'agent_busy',
      });
      continue;
    }
    if (own === null && config.assignment === 'pool') {
      const other = roomiest();
      if (other !== null) {
        take(candidate.taskId, other, 'pool');
        continue;
      }
      holds.push({
        taskId: candidate.taskId,
        agentId: null,
        reason: agents.some((agent) => !agent.modelHeld)
          ? 'agent_busy'
          : agents.length === 0
            ? 'no_agent'
            : 'model_capacity',
      });
    }
  }
  if (picks.length > 0) {
    return { capacity, occupied, picks, holds, stop: 'picked' };
  }
  const stop: DispatchPlanStop =
    holds.length === 0
      ? 'no_ready_work'
      : holds.every((hold) => hold.reason === 'model_capacity')
        ? 'model_capacity'
        : 'agents_busy';
  return { capacity, occupied, picks, holds, stop };
}

/**
 * When the pass after a host hold asks again: the dispatch's recheck delays
 * in turn, then the last of them for as long as the host keeps holding.
 */
export function recheckDelaySeconds(
  recheckSeconds: readonly number[],
  index: number,
): number {
  const last = recheckSeconds.at(-1) ?? 240;
  return recheckSeconds[Math.max(0, index)] ?? last;
}

/** When the next start of ready work may happen: now (null), or the time
 * `startSpacingSeconds` after the last start. */
export function startPacedUntil(args: {
  spacingMs: number;
  lastStartAt: number | null;
  now: number;
}): number | null {
  if (args.spacingMs <= 0 || args.lastStartAt === null) return null;
  const until = args.lastStartAt + args.spacingMs;
  return args.now < until ? until : null;
}

/** When a pass the host held asks again: the dispatch's next recheck delay,
 * or later when the host itself named a later time. */
export function hostRecheckAt(args: {
  now: number;
  recheckSeconds: readonly number[];
  recheckIndex: number;
  retryAfterMs: number | null;
}): number {
  const delayMs =
    recheckDelaySeconds(args.recheckSeconds, args.recheckIndex) * 1000;
  return args.now + Math.max(delayMs, args.retryAfterMs ?? 0);
}
