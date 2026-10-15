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
 * lists them, or a source lists its own), then by priority, then by its
 * place on the board, then by age, in one order across every board the
 * dispatch serves: ranking is what people and their manager agents decide,
 * by setting priorities, ordering the board and moving work between
 * columns.
 *
 * An agent of the pool works at most `perAgentConcurrency` runs at once,
 * and the pool at most `maxConcurrentRuns`, counting its runs on every
 * board. A task assigned to an agent of
 * the pool waits for that agent; with `rebalance`, a task that never started
 * moves to the idle agent that has the most room. With `assignment: pool`, a
 * task nobody is assigned goes to that agent too. An agent whose model the
 * provider called at capacity takes nothing until the model answers again,
 * and then no more than the model's ramp lets through: the agents on one
 * model share it.
 */

export interface DispatchCandidate {
  taskId: string;
  /** The board the task is on: the dispatch's own, or a source it serves. */
  projectId: string;
  status: DispatchStatus;
  /** Where its status stands among its board's columns, in the order the
   * dispatch prefers them there: the first ranking key across boards. Absent,
   * the dispatch's own `statuses` order it. */
  column?: number;
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
  /** Live runs (queued, waiting or running) the agent holds, on whichever
   * board, whoever started them. */
  live: number;
  /** The provider called the agent's model at capacity: it takes nothing. */
  modelHeld: boolean;
  /** The agent's model, keyed as the plan's `modelRamps` are: the agents on
   * one model share its ramp. */
  modelKey?: string;
}

/** A model that answered again after it was at capacity and still ramps
 * up: dispatch starts at most `room` more runs on it now, and may start
 * more once its next wave comes. */
export interface DispatchModelRamp {
  room: number;
  nextWaveAtMs: number;
}

export interface DispatchPick {
  taskId: string;
  agentId: string;
  /** Why this agent: the task's own assignee, an unassigned task handed to
   * the pool, or a task moved from a busy agent of the pool. */
  via: 'assigned' | 'pool' | 'rebalance';
}

export type DispatchHoldReason =
  | 'agent_busy'
  | 'model_capacity'
  /** The agent's model answered again and has taken as many new runs as
   * its ramp lets through for now. */
  | 'model_ramp'
  | 'no_agent';

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
  | 'model_capacity'
  /** Ready tasks wait for the next wave of a model that answered again (or
   * for one at capacity). */
  | 'model_ramp';

export interface DispatchPlan {
  /** The runs the pool may hold now. */
  capacity: number;
  /** Runs it holds. */
  occupied: number;
  picks: DispatchPick[];
  holds: DispatchHold[];
  stop: DispatchPlanStop;
  /** When the earliest model whose ramp held work back lets its next wave
   * through: the pass asks again then. Null when no ramp held anything. */
  rampUntil: number | null;
}

const PRIORITY_ORDER: Record<string, number> = { p0: 0, p1: 1, p2: 2, p3: 3 };

function priorityOrder(priority: string | null): number {
  return priority === null ? 4 : (PRIORITY_ORDER[priority] ?? 4);
}

/** Ready work in the order a dispatch takes it, across every board it
 * serves: by the column a task waits in (its own board's order of
 * preference), then priority, board order and age. */
export function rankCandidates(
  candidates: readonly DispatchCandidate[],
  statuses: readonly DispatchStatus[],
): DispatchCandidate[] {
  const column = (candidate: DispatchCandidate) => {
    if (candidate.column !== undefined && candidate.column >= 0) {
      return candidate.column;
    }
    const index = statuses.indexOf(candidate.status);
    return index === -1 ? statuses.length : index;
  };
  return [...candidates].sort(
    (a, b) =>
      column(a) - column(b) ||
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
  /** The models of the pool that still ramp up after a hold, by
   * `modelKey`; a model missing here takes any number of runs. */
  modelRamps?: ReadonlyMap<string, DispatchModelRamp>;
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
    return {
      capacity,
      occupied,
      picks,
      holds,
      stop: 'pool_full',
      rampUntil: null,
    };
  }
  if (input.workerRoom !== null) {
    if (input.workerRoom <= 0) {
      return {
        capacity,
        occupied,
        picks,
        holds,
        stop: 'org_limit',
        rampUntil: null,
      };
    }
    free = Math.min(free, input.workerRoom);
  }
  const ranked = rankCandidates(input.candidates, config.statuses);
  if (ranked.length === 0) {
    return {
      capacity,
      occupied,
      picks,
      holds,
      stop: 'no_ready_work',
      rampUntil: null,
    };
  }
  const room = new Map(
    agents.map((agent) => [agent.agentId, perAgent - agent.live]),
  );
  const held = new Set(
    agents.filter((agent) => agent.modelHeld).map((agent) => agent.agentId),
  );
  const modelOf = new Map(
    agents.flatMap((agent) =>
      agent.modelKey === undefined ? [] : [[agent.agentId, agent.modelKey]],
    ),
  );
  // What each ramping model may still take in this plan; the models whose
  // ramp held work back.
  const rampRoom = new Map(
    [...(input.modelRamps ?? [])].map(([key, ramp]) => [
      key,
      Math.max(0, ramp.room),
    ]),
  );
  const rampHeld = new Set<string>();
  /** The agent's model has taken all its ramp lets through for now. */
  const ramped = (agentId: string): boolean => {
    const key = modelOf.get(agentId);
    return key !== undefined && rampRoom.get(key) === 0;
  };
  const noteRamped = (agentId: string) => {
    const key = modelOf.get(agentId);
    if (key !== undefined) rampHeld.add(key);
  };
  // The idle agent with the most room, in pool order among equals.
  const roomiest = (): string | null => {
    let best: string | null = null;
    let bestRoom = 0;
    for (const agentId of config.agents) {
      if (held.has(agentId) || ramped(agentId)) continue;
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
    const key = modelOf.get(agentId);
    const left = key === undefined ? undefined : rampRoom.get(key);
    if (key !== undefined && left !== undefined) rampRoom.set(key, left - 1);
    free -= 1;
  };
  for (const candidate of ranked) {
    if (free === 0) break;
    const own = candidate.assigneeAgentId;
    if (own !== null && pool.has(own)) {
      if (!held.has(own) && !ramped(own) && (room.get(own) ?? 0) > 0) {
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
      const reason: DispatchHoldReason = held.has(own)
        ? 'model_capacity'
        : (room.get(own) ?? 0) > 0
          ? 'model_ramp'
          : 'agent_busy';
      if (reason === 'model_ramp') noteRamped(own);
      holds.push({ taskId: candidate.taskId, agentId: own, reason });
      continue;
    }
    if (own === null && config.assignment === 'pool') {
      const other = roomiest();
      if (other !== null) {
        take(candidate.taskId, other, 'pool');
        continue;
      }
      // Nobody took it: agents with room left wait only for their model's
      // ramp; else every agent whose model answers is busy.
      const answering = agents.filter((agent) => !held.has(agent.agentId));
      const waitingForRamp = answering.filter(
        (agent) => (room.get(agent.agentId) ?? 0) > 0,
      );
      for (const agent of waitingForRamp) noteRamped(agent.agentId);
      holds.push({
        taskId: candidate.taskId,
        agentId: null,
        reason:
          agents.length === 0
            ? 'no_agent'
            : answering.length === 0
              ? 'model_capacity'
              : waitingForRamp.length > 0
                ? 'model_ramp'
                : 'agent_busy',
      });
    }
  }
  const nextWaves = [...rampHeld].flatMap((key) => {
    const ramp = input.modelRamps?.get(key);
    return ramp === undefined ? [] : [ramp.nextWaveAtMs];
  });
  const rampUntil = nextWaves.length === 0 ? null : Math.min(...nextWaves);
  if (picks.length > 0) {
    return { capacity, occupied, picks, holds, stop: 'picked', rampUntil };
  }
  const waitsForModels = holds.every(
    (hold) => hold.reason === 'model_capacity' || hold.reason === 'model_ramp',
  );
  const stop: DispatchPlanStop =
    holds.length === 0
      ? 'no_ready_work'
      : holds.every((hold) => hold.reason === 'model_capacity')
        ? 'model_capacity'
        : waitsForModels
          ? 'model_ramp'
          : 'agents_busy';
  return { capacity, occupied, picks, holds, stop, rampUntil };
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

/** How long a pass goes on starting ready work. Well inside its lease
 * ({@link PASS_LEASE_MS}): the start under way when the time runs out (a host
 * admission asked for at most 10 seconds, then the start's transaction) ends
 * long before the lease lapses and a second pass could start on what this
 * one planned. */
export const PASS_BUDGET_MS = 2 * 60_000;

/** How long a pass may hold its project's lease: longer than it starts
 * ready work for ({@link PASS_BUDGET_MS}), with room for the start under way
 * when that time runs out. */
export const PASS_LEASE_MS = 5 * 60_000;

/** Whether a pass that began at `startedAt` has used its time for starting
 * ready work (`budgetMs`, {@link PASS_BUDGET_MS} unless a test names
 * another), with `tried` picks behind it: it then stops, and the next pass
 * goes on at once with the facts as they stand. Its first pick always goes
 * ahead, so a pass slowed before it (standing roles, a slow read) still
 * moves the pool on. */
export function passOutOfTime(args: {
  startedAt: number;
  now: number;
  tried: number;
  budgetMs?: number;
}): boolean {
  return (
    args.tried > 0 &&
    args.now - args.startedAt >= (args.budgetMs ?? PASS_BUDGET_MS)
  );
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
