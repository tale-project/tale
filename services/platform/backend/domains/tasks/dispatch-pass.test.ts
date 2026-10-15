import { describe, expect, it, vi } from 'vitest';

import {
  startPicks,
  type DispatchStopReason,
  type HostVerdict,
  type PickEffects,
} from './dispatch-pass.ts';
import { PASS_BUDGET_MS, type DispatchPick } from './dispatch-plan.ts';

const ADMIT: HostVerdict = {
  admitted: true,
  retryAfterMs: null,
  reason: null,
  evidence: { stand_in: 'admit' },
};
const PRESSURE: HostVerdict = {
  admitted: false,
  retryAfterMs: null,
  reason: 'pressure',
  evidence: { stand_in: 'memory pressure' },
};

function picks(count: number): DispatchPick[] {
  return Array.from({ length: count }, (_, index) => ({
    taskId: `task-${index}`,
    agentId: 'coder',
    via: 'assigned' as const,
  }));
}

/** A stand-in world: a clock each start moves on by `startMs`, a host
 * answering `host`, and starts that all succeed unless `refuse` names the
 * task. */
function world(
  options: {
    clock?: number;
    startMs?: number;
    host?: HostVerdict;
    refuse?: string;
  } = {},
) {
  let clock = options.clock ?? 0;
  const effects = {
    now: vi.fn(() => clock),
    askHost: vi.fn(() => Promise.resolve(options.host ?? ADMIT)),
    start: vi.fn((pick: DispatchPick) => {
      clock += options.startMs ?? 1_000;
      return Promise.resolve(
        pick.taskId === options.refuse
          ? { started: false as const, reason: 'paused', retryAfter: 9 }
          : { started: true as const, runId: `run-${pick.taskId}` },
      );
    }),
    noteStart: vi.fn((_pick: DispatchPick, _at: number) => Promise.resolve()),
  } satisfies PickEffects;
  return { effects, now: () => clock };
}

function run(
  effects: PickEffects,
  args: Partial<Parameters<typeof startPicks>[0]> & { picks: DispatchPick[] },
) {
  return startPicks(
    {
      stop: 'held' satisfies DispatchStopReason,
      startedAt: 0,
      budgetMs: PASS_BUDGET_MS,
      spacingMs: 0,
      recheckSeconds: [60, 120, 240],
      lastStartAt: null,
      recheckIndex: 0,
      rampUntil: null,
      ...args,
    },
    effects,
  );
}

describe('a pass starts work for two minutes at most, and the next goes on at once [TASK-R63]', () => {
  it('starts every pick the host admits while its time lasts', async () => {
    const { effects } = world();
    const result = await run(effects, { picks: picks(3) });
    expect(result).toMatchObject({ stop: 'started', nextPassAt: null });
    expect(result.started.map((start) => start.runId)).toEqual([
      'run-task-0',
      'run-task-1',
      'run-task-2',
    ]);
    expect(effects.noteStart).toHaveBeenCalledTimes(3);
  });

  it('stops once its time ran out, before asking the host again, and the next pass goes on at once', async () => {
    // Each start takes the host and the transaction 61 seconds.
    const { effects } = world({ startMs: 61_000 });
    const result = await run(effects, { picks: picks(5) });
    expect(result.started.map((start) => start.taskId)).toEqual([
      'task-0',
      'task-1',
    ]);
    expect(result.stop).toBe('budget');
    expect(result.nextPassAt).toBe(122_000);
    expect(effects.askHost).toHaveBeenCalledTimes(2);
    expect(effects.start).toHaveBeenCalledTimes(2);
  });

  it('always tries its first pick, however long it took to get there', async () => {
    const { effects } = world({ clock: 4 * 60_000 });
    const result = await run(effects, { picks: picks(3) });
    expect(result.started).toHaveLength(1);
    expect(result).toMatchObject({
      stop: 'budget',
      nextPassAt: 4 * 60_000 + 1_000,
    });
  });

  it('with no time to start in, makes its one first start and leaves the rest to the next pass', async () => {
    const { effects } = world();
    const result = await run(effects, { picks: picks(3), budgetMs: 0 });
    expect(result.started).toHaveLength(1);
    expect(result).toMatchObject({ stop: 'budget', nextPassAt: 1_000 });
  });

  it('holds a pick the start refuses and goes on with the next', async () => {
    const { effects } = world({ refuse: 'task-0' });
    const result = await run(effects, { picks: picks(2) });
    expect(result.held).toEqual([
      { taskId: 'task-0', agentId: 'coder', reason: 'paused', retryAfter: 9 },
    ]);
    expect(result.started.map((start) => start.taskId)).toEqual(['task-1']);
    expect(result.stop).toBe('started');
  });
});

describe('dispatch asks the sandbox host before each start and spaces its starts [TASK-R44]', () => {
  it('ends the pass when the host holds, and asks again after the next recheck delay', async () => {
    const { effects } = world({ host: PRESSURE, clock: 10_000 });
    const result = await run(effects, { picks: picks(2), recheckIndex: 1 });
    expect(result).toMatchObject({
      stop: 'host_pressure',
      nextPassAt: 10_000 + 120_000,
      recheckIndex: 2,
      started: [],
      hostEvidence: PRESSURE.evidence,
    });
    expect(result.held).toEqual([
      {
        taskId: 'task-0',
        agentId: 'coder',
        reason: 'host_pressure',
        retryAfter: 130_000,
      },
    ]);
  });

  it('with a spacing, makes one start and comes back a spacing later', async () => {
    const { effects } = world();
    const result = await run(effects, { picks: picks(3), spacingMs: 30_000 });
    expect(result.started).toHaveLength(1);
    expect(result).toMatchObject({
      stop: 'pacing',
      lastStartAt: 1_000,
      nextPassAt: 31_000,
      recheckIndex: 0,
    });
    expect(effects.noteStart).toHaveBeenCalledWith(picks(1)[0], 1_000);
  });

  it('starts nothing before the spacing since the last start has passed', async () => {
    const { effects } = world({ clock: 10_000 });
    const result = await run(effects, {
      picks: picks(1),
      spacingMs: 30_000,
      lastStartAt: 0,
    });
    expect(result).toMatchObject({ stop: 'pacing', nextPassAt: 30_000 });
    expect(effects.askHost).not.toHaveBeenCalled();
  });
});

describe('a model that answers again takes new work only as its ramp lets it through [TASK-R43]', () => {
  it('having started what the ramp let through, asks again at its next wave', async () => {
    const { effects } = world();
    const result = await run(effects, { picks: picks(1), rampUntil: 15_000 });
    expect(result).toMatchObject({ stop: 'model_ramp', nextPassAt: 15_000 });
    expect(result.started).toHaveLength(1);
  });

  it('asks again at the next wave when the ramp let nothing through', async () => {
    const { effects } = world();
    const result = await run(effects, {
      picks: [],
      stop: 'model_ramp',
      rampUntil: 15_000,
    });
    expect(result).toMatchObject({ stop: 'model_ramp', nextPassAt: 15_000 });
  });

  it('keeps a held host, a spacing and a pass out of time before the next wave', async () => {
    const held = await run(world({ host: PRESSURE }).effects, {
      picks: picks(1),
      rampUntil: 15_000,
    });
    expect(held).toMatchObject({ stop: 'host_pressure', nextPassAt: 60_000 });
    const paced = await run(world().effects, {
      picks: picks(2),
      spacingMs: 30_000,
      rampUntil: 15_000,
    });
    expect(paced).toMatchObject({ stop: 'pacing', nextPassAt: 31_000 });
    const outOfTime = await run(world().effects, {
      picks: picks(2),
      budgetMs: 0,
      rampUntil: 15_000,
    });
    expect(outOfTime).toMatchObject({ stop: 'budget', nextPassAt: 1_000 });
  });
});
