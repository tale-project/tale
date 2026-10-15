import {
  DISPATCH_RUNS_MAX,
  type ProjectDispatch,
} from '@tale/shared/schemas/project-dispatch';
import { describe, expect, it } from 'vitest';

import {
  hostRecheckAt,
  PASS_BUDGET_MS,
  PASS_LEASE_MS,
  passOutOfTime,
  planDispatch,
  rankCandidates,
  recheckDelaySeconds,
  startPacedUntil,
  type DispatchAgent,
  type DispatchCandidate,
} from './dispatch-plan.ts';

const base: ProjectDispatch = {
  enabled: true,
  agents: ['scribe', 'lector'],
  maxConcurrentRuns: 2,
  statuses: ['todo'],
  assignment: 'assigned',
};

function task(
  taskId: string,
  fields: Partial<DispatchCandidate> = {},
): DispatchCandidate {
  return {
    taskId,
    status: 'todo',
    priority: null,
    rank: 'm',
    createdAt: 1_000,
    assigneeAgentId: null,
    hasRuns: false,
    labelIds: [],
    ...fields,
  };
}

function agent(agentId: string, fields: Partial<DispatchAgent> = {}) {
  return { agentId, live: 0, modelHeld: false, ...fields };
}

describe('ready work is ranked by column, priority, board order and age [TASK-R41]', () => {
  it('takes To do before Backlog, then the higher priority, then the board order, then the oldest', () => {
    const ranked = rankCandidates(
      [
        task('backlog-p0', { status: 'backlog', priority: 'p0' }),
        task('todo-none', { priority: null }),
        task('todo-p1-late', { priority: 'p1', rank: 'z' }),
        task('todo-p1-early', { priority: 'p1', rank: 'a' }),
        task('todo-p2-old', { priority: 'p2', rank: 'q', createdAt: 1 }),
        task('todo-p2-new', { priority: 'p2', rank: 'q', createdAt: 2 }),
      ],
      ['todo', 'backlog'],
    );
    expect(ranked.map((candidate) => candidate.taskId)).toEqual([
      'todo-p1-early',
      'todo-p1-late',
      'todo-p2-old',
      'todo-p2-new',
      'todo-none',
      'backlog-p0',
    ]);
  });
});

describe('dispatch keeps each agent of the pool busy and no busier [TASK-R41]', () => {
  it('starts a task on its own idle agent of the pool', () => {
    const plan = planDispatch({
      config: base,
      agents: [agent('scribe'), agent('lector')],
      candidates: [task('changelog', { assigneeAgentId: 'scribe' })],
      workerRoom: null,
    });
    expect(plan.stop).toBe('picked');
    expect(plan.picks).toEqual([
      { taskId: 'changelog', agentId: 'scribe', via: 'assigned' },
    ]);
  });

  it('gives an agent one run at a time by default, and holds the rest for it', () => {
    const plan = planDispatch({
      config: { ...base, maxConcurrentRuns: 5 },
      agents: [agent('scribe'), agent('lector')],
      candidates: [
        task('first', { assigneeAgentId: 'scribe', rank: 'a' }),
        task('second', { assigneeAgentId: 'scribe', rank: 'b' }),
      ],
      workerRoom: null,
    });
    expect(plan.picks.map((pick) => pick.taskId)).toEqual(['first']);
    expect(plan.holds).toEqual([
      { taskId: 'second', agentId: 'scribe', reason: 'agent_busy' },
    ]);
  });

  it('lets an agent hold as many runs as perAgentConcurrency allows', () => {
    const plan = planDispatch({
      config: { ...base, maxConcurrentRuns: 5, perAgentConcurrency: 2 },
      agents: [agent('scribe'), agent('lector')],
      candidates: [
        task('first', { assigneeAgentId: 'scribe', rank: 'a' }),
        task('second', { assigneeAgentId: 'scribe', rank: 'b' }),
      ],
      workerRoom: null,
    });
    expect(plan.picks.map((pick) => pick.taskId)).toEqual(['first', 'second']);
  });

  it('starts nothing when the pool already holds maxConcurrentRuns, whoever started them', () => {
    const plan = planDispatch({
      config: base,
      agents: [agent('scribe', { live: 1 }), agent('lector', { live: 1 })],
      candidates: [task('changelog', { assigneeAgentId: 'scribe' })],
      workerRoom: null,
    });
    expect(plan).toMatchObject({ stop: 'pool_full', occupied: 2, picks: [] });
  });

  it("starts nothing when the organization's agent workers are all in use", () => {
    const plan = planDispatch({
      config: base,
      agents: [agent('scribe'), agent('lector')],
      candidates: [task('changelog', { assigneeAgentId: 'scribe' })],
      workerRoom: 0,
    });
    expect(plan.stop).toBe('org_limit');
  });

  it('starts no more than the agent workers left', () => {
    const plan = planDispatch({
      config: { ...base, maxConcurrentRuns: 5 },
      agents: [agent('scribe'), agent('lector')],
      candidates: [
        task('first', { assigneeAgentId: 'scribe' }),
        task('second', { assigneeAgentId: 'lector' }),
      ],
      workerRoom: 1,
    });
    expect(plan.picks).toHaveLength(1);
  });

  it('says when nothing is ready', () => {
    expect(
      planDispatch({
        config: base,
        agents: [agent('scribe'), agent('lector')],
        candidates: [],
        workerRoom: null,
      }).stop,
    ).toBe('no_ready_work');
  });
});

describe('unassigned work goes to the pool only when the dispatch says so [TASK-R42]', () => {
  it('leaves an unassigned task alone with assignment "assigned"', () => {
    const plan = planDispatch({
      config: base,
      agents: [agent('scribe'), agent('lector')],
      candidates: [task('orphan')],
      workerRoom: null,
    });
    expect(plan).toMatchObject({ stop: 'no_ready_work', picks: [], holds: [] });
  });

  it('hands an unassigned task to the idle agent with the most room with assignment "pool"', () => {
    const plan = planDispatch({
      config: {
        ...base,
        assignment: 'pool',
        maxConcurrentRuns: 4,
        perAgentConcurrency: 2,
      },
      agents: [agent('scribe', { live: 1 }), agent('lector')],
      candidates: [task('orphan')],
      workerRoom: null,
    });
    expect(plan.picks).toEqual([
      { taskId: 'orphan', agentId: 'lector', via: 'pool' },
    ]);
  });

  it('moves a task that never started from a busy agent to an idle one with rebalance', () => {
    const plan = planDispatch({
      config: { ...base, rebalance: true },
      agents: [agent('scribe', { live: 1 }), agent('lector')],
      candidates: [task('waiting', { assigneeAgentId: 'scribe' })],
      workerRoom: null,
    });
    expect(plan.picks).toEqual([
      { taskId: 'waiting', agentId: 'lector', via: 'rebalance' },
    ]);
  });

  it('never moves a task that already ran, so its conversation stays with its agent', () => {
    const plan = planDispatch({
      config: { ...base, rebalance: true },
      agents: [agent('scribe', { live: 1 }), agent('lector')],
      candidates: [
        task('worked', { assigneeAgentId: 'scribe', hasRuns: true }),
      ],
      workerRoom: null,
    });
    expect(plan.picks).toEqual([]);
    expect(plan.holds).toEqual([
      { taskId: 'worked', agentId: 'scribe', reason: 'agent_busy' },
    ]);
  });
});

describe('an agent whose model is at capacity takes nothing [TASK-R43]', () => {
  it('holds its work, and hands unassigned work to an agent whose model answers', () => {
    const plan = planDispatch({
      config: { ...base, assignment: 'pool', maxConcurrentRuns: 4 },
      agents: [agent('scribe', { modelHeld: true }), agent('lector')],
      candidates: [
        task('assigned', { assigneeAgentId: 'scribe', rank: 'a' }),
        task('orphan', { rank: 'b' }),
      ],
      workerRoom: null,
    });
    expect(plan.picks).toEqual([
      { taskId: 'orphan', agentId: 'lector', via: 'pool' },
    ]);
    expect(plan.holds).toEqual([
      { taskId: 'assigned', agentId: 'scribe', reason: 'model_capacity' },
    ]);
  });

  it('says the model holds everything back when every agent waits on it', () => {
    const plan = planDispatch({
      config: base,
      agents: [
        agent('scribe', { modelHeld: true }),
        agent('lector', { modelHeld: true }),
      ],
      candidates: [task('assigned', { assigneeAgentId: 'scribe' })],
      workerRoom: null,
    });
    expect(plan.stop).toBe('model_capacity');
  });
});

describe('a host that holds starts is asked again after the recheck delays [TASK-R44]', () => {
  it('waits 60, 120, then 240 seconds, and keeps the last', () => {
    const delays = [60, 120, 240];
    expect([0, 1, 2, 3, 9].map((n) => recheckDelaySeconds(delays, n))).toEqual([
      60, 120, 240, 240, 240,
    ]);
  });
});

describe('dispatch spaces its starts and rechecks a held host on its delays [TASK-R44]', () => {
  it('starts at once with no spacing or no earlier start, else after the spacing', () => {
    expect(
      startPacedUntil({ spacingMs: 0, lastStartAt: 100, now: 101 }),
    ).toBeNull();
    expect(
      startPacedUntil({ spacingMs: 30_000, lastStartAt: null, now: 1 }),
    ).toBeNull();
    expect(
      startPacedUntil({ spacingMs: 30_000, lastStartAt: 1_000, now: 20_000 }),
    ).toBe(31_000);
    expect(
      startPacedUntil({ spacingMs: 30_000, lastStartAt: 1_000, now: 31_000 }),
    ).toBeNull();
  });

  it('asks a held host again after the next recheck delay, or when the host said', () => {
    expect(
      hostRecheckAt({
        now: 0,
        recheckSeconds: [60, 120, 240],
        recheckIndex: 1,
        retryAfterMs: 15_000,
      }),
    ).toBe(120_000);
    expect(
      hostRecheckAt({
        now: 0,
        recheckSeconds: [60],
        recheckIndex: 4,
        retryAfterMs: 300_000,
      }),
    ).toBe(300_000);
  });
});

describe('one agent can be kept on hundreds of runs, within the pool and the agent workers [TASK-R62]', () => {
  /** Coder alone in the pool, with this many ready tasks of its own. */
  function fleet(ready: number, config: Partial<ProjectDispatch> = {}) {
    return {
      config: {
        ...base,
        agents: ['coder'],
        maxConcurrentRuns: 256,
        perAgentConcurrency: 256,
        assignment: 'pool' as const,
        ...config,
      },
      agents: [agent('coder')],
      candidates: Array.from({ length: ready }, (_, index) =>
        task(`task-${String(index).padStart(4, '0')}`, {
          rank: String(index).padStart(4, '0'),
          assigneeAgentId: index % 2 === 0 ? 'coder' : null,
        }),
      ),
    };
  }

  it('starts one agent on 256 ready tasks when the pool and the agent workers allow 256', () => {
    const plan = planDispatch({ ...fleet(300), workerRoom: 256 });
    expect(plan.stop).toBe('picked');
    expect(plan.picks).toHaveLength(256);
    expect(new Set(plan.picks.map((pick) => pick.agentId))).toEqual(
      new Set(['coder']),
    );
    // Best-ranked first, assigned and unassigned work alike.
    expect(plan.picks.slice(0, 3).map((pick) => pick.taskId)).toEqual([
      'task-0000',
      'task-0001',
      'task-0002',
    ]);
  });

  it('starts no more than the agent workers left, counting the runs it already holds', () => {
    expect(planDispatch({ ...fleet(300), workerRoom: 100 }).picks).toHaveLength(
      100,
    );
    const plan = planDispatch({
      ...fleet(300),
      agents: [agent('coder', { live: 200 })],
      workerRoom: 300,
    });
    expect(plan).toMatchObject({ occupied: 200, capacity: 256 });
    expect(plan.picks).toHaveLength(56);
  });

  it('holds the rest for the agent once it holds its runs per agent, whatever the pool allows', () => {
    const plan = planDispatch({
      ...fleet(300, { maxConcurrentRuns: DISPATCH_RUNS_MAX }),
      workerRoom: null,
    });
    expect(plan.picks).toHaveLength(256);
    expect(plan.holds.every((hold) => hold.reason === 'agent_busy')).toBe(true);
  });

  it('fills the largest pool the dispatch allows in one plan', () => {
    const plan = planDispatch({
      ...fleet(DISPATCH_RUNS_MAX, {
        maxConcurrentRuns: DISPATCH_RUNS_MAX,
        perAgentConcurrency: DISPATCH_RUNS_MAX,
      }),
      workerRoom: DISPATCH_RUNS_MAX,
    });
    expect(plan.picks).toHaveLength(DISPATCH_RUNS_MAX);
  });
});

describe('a pass starts work for two minutes at most, and the next goes on at once [TASK-R63]', () => {
  it('goes on starting for two minutes, then stops', () => {
    expect(PASS_BUDGET_MS).toBe(2 * 60_000);
    const tried = 40;
    expect(passOutOfTime({ startedAt: 1_000, now: 1_000, tried })).toBe(false);
    expect(passOutOfTime({ startedAt: 1_000, now: 120_999, tried })).toBe(
      false,
    );
    expect(passOutOfTime({ startedAt: 1_000, now: 121_000, tried })).toBe(true);
  });

  it('always tries its first pick, however long it took to get there', () => {
    expect(passOutOfTime({ startedAt: 0, now: 4 * 60_000, tried: 0 })).toBe(
      false,
    );
    expect(passOutOfTime({ startedAt: 0, now: 4 * 60_000, tried: 1 })).toBe(
      true,
    );
  });

  it('keeps its two minutes well inside the five-minute lease', () => {
    // The start under way when the time runs out asks the host for at most
    // ten seconds, then runs one transaction.
    expect(PASS_LEASE_MS).toBe(5 * 60_000);
    expect(PASS_BUDGET_MS + 60_000).toBeLessThan(PASS_LEASE_MS);
  });

  it('with a spacing, starts the 256th run 255 spacings after the first', () => {
    // Each pass makes one start; the next comes when the spacing allows.
    const spacingMs = 30_000;
    let now = 0;
    let lastStartAt: number | null = null;
    const starts: number[] = [];
    while (starts.length < 256) {
      const pacedUntil = startPacedUntil({ spacingMs, lastStartAt, now });
      if (pacedUntil !== null) {
        now = pacedUntil;
        continue;
      }
      starts.push(now);
      lastStartAt = now;
    }
    expect(starts.at(-1)).toBe(255 * 30_000);
    expect(starts.at(-1)).toBe(((2 * 60 + 7) * 60 + 30) * 1000);
  });
});
