import { describe, expect, test } from 'bun:test';

import {
  type RunRow,
  type TaskTrack,
  closeStretch,
  isTerminal,
  newRunTrack,
  newestRun,
  observeRun,
  observeTask,
  parseRunRows,
  placeOf,
} from '../../src/burst/runs.ts';

function row(overrides: Partial<RunRow> = {}): RunRow {
  return {
    id: 'run-1',
    status: 'queued',
    agentId: 'agent-1',
    sessionId: 'session-1',
    trigger: 'assignment',
    failureCode: null,
    error: null,
    resultText: null,
    waitingForCapacityAt: null,
    waitingReason: null,
    sessionClaimedAt: null,
    startedAt: 1_000,
    launchedAt: null,
    settledAt: null,
    ...overrides,
  };
}

function task(createdAtMs = 0): TaskTrack {
  return {
    taskId: 'task-1',
    title: 'Burst run 1',
    agentIndex: 0,
    createdAtMs,
    runs: [],
    doneAtMs: null,
    longestWithoutRunMs: 0,
  };
}

describe('placeOf', () => {
  test('tells the three places of a queued run apart', () => {
    expect(placeOf(row())).toBe('pending');
    expect(placeOf(row({ sessionClaimedAt: 1_100 }))).toBe('starting');
    expect(
      placeOf(row({ waitingForCapacityAt: 1_200, sessionClaimedAt: 1_100 })),
    ).toBe('parked');
  });

  test('passes the other statuses through', () => {
    for (const status of [
      'running',
      'settled',
      'failed',
      'cancelled',
    ] as const) {
      expect(placeOf(row({ status }))).toBe(status);
    }
    expect(placeOf(row({ status: 'paused' }))).toBe('other');
    expect(isTerminal('settled')).toBe(true);
    expect(isTerminal('parked')).toBe(false);
  });
});

describe('parseRunRows', () => {
  test('reads the run list door and skips rows without an id', () => {
    const rows = parseRunRows({
      runs: [
        {
          id: 'run-2',
          status: 'queued',
          agentId: 'agent-1',
          waitingForCapacityAt: 5_000,
          waitingReason: 'host',
          startedAt: 4_000,
          worker: 2,
        },
        { status: 'settled' },
      ],
    });
    expect(rows).toEqual([
      row({
        id: 'run-2',
        sessionId: null,
        trigger: null,
        waitingForCapacityAt: 5_000,
        waitingReason: 'host',
        startedAt: 4_000,
      }),
    ]);
  });

  test('keeps what a run answered at its end', () => {
    const [settled] = parseRunRows({
      runs: [{ id: 'run-3', status: 'settled', resultText: 'Done.' }],
    });
    expect(settled?.resultText).toBe('Done.');
  });
});

describe('run tracking', () => {
  test('folds polls into the waits a person saw', () => {
    // First seen pending at 1500: it has waited since its kick at 1000.
    const track = newRunTrack('task-1', row(), 1_500);
    expect(track.place).toBe('pending');
    expect(track.longestPendingMs).toBe(500);

    observeRun(
      track,
      row({ waitingForCapacityAt: 2_500, waitingReason: 'host' }),
      3_000,
    );
    expect(track.place).toBe('parked');
    expect(track.longestPendingMs).toBe(2_000);

    observeRun(
      track,
      row({ waitingForCapacityAt: 2_500, waitingReason: 'host' }),
      5_000,
    );
    observeRun(track, row({ status: 'running', launchedAt: 5_800 }), 6_000);
    expect(track.place).toBe('running');
    expect(track.parkedMs).toBe(3_000);
    expect(track.reasons).toEqual(['host']);
    expect(track.parkedWithoutReason).toBe(0);

    observeRun(
      track,
      row({
        status: 'settled',
        launchedAt: 5_800,
        settledAt: 8_900,
        resultText: 'Done.',
      }),
      9_000,
    );
    expect(track.place).toBe('settled');
    expect(track.launchedAt).toBe(5_800);
    expect(track.settledAt).toBe(8_900);
    expect(track.resultText).toBe('Done.');
  });

  test('counts the polls that saw a park without a reason', () => {
    const parked = row({ waitingForCapacityAt: 1_200 });
    const track = newRunTrack('task-1', parked, 1_500);
    observeRun(track, parked, 2_500);
    expect(track.parkedWithoutReason).toBe(2);
    // Seen parked since 1200 (its park), not since the first poll.
    expect(track.parkedMs).toBe(1_300);
  });

  test('closes the stretch of a run no later poll saw move', () => {
    const track = newRunTrack('task-1', row(), 1_500);
    closeStretch(track, 90_000);
    expect(track.longestPendingMs).toBe(89_000);
  });

  test('keeps the failure the last poll saw', () => {
    const track = newRunTrack('task-1', row({ status: 'running' }), 1_500);
    observeRun(
      track,
      row({
        status: 'failed',
        failureCode: 'park_deadline',
        error: 'no room',
      }),
      2_000,
    );
    expect(track.place).toBe('failed');
    expect(track.failureCode).toBe('park_deadline');
    expect(track.error).toBe('no room');
  });
});

describe('observeTask', () => {
  test('measures how long a task showed no run', () => {
    const tracked = task(1_000);
    observeTask(tracked, [], 4_000);
    observeTask(tracked, [], 3_000);
    expect(tracked.longestWithoutRunMs).toBe(3_000);
    expect(newestRun(tracked)).toBeNull();
  });

  test('keeps the runs in kick order, the door lists them newest first', () => {
    const tracked = task();
    observeTask(
      tracked,
      [
        row({ id: 'run-2', startedAt: 2_000 }),
        row({ id: 'run-1', status: 'failed', failureCode: 'harness_error' }),
      ],
      3_000,
    );
    expect(tracked.runs.map((run) => run.id)).toEqual(['run-1', 'run-2']);
    observeTask(
      tracked,
      [
        row({ id: 'run-2', status: 'running' }),
        row({ id: 'run-1', status: 'failed' }),
      ],
      4_000,
    );
    expect(tracked.runs).toHaveLength(2);
    expect(newestRun(tracked)?.place).toBe('running');
  });
});
