import { expect, test } from 'bun:test';

import {
  benchmarkMode,
  measurementPlan,
  sharedBudgetMs,
} from './browser/mode.mjs';
import { fillProtocolBuffer, protocolPlan } from './browser/protocol-plan.ts';

test('mode admission refuses absent, ambiguous and foreign choices', () => {
  const pr = (labels: string[]) => ({
    BENCH_EVENT_NAME: 'pull_request',
    BENCH_LABELS: JSON.stringify(labels),
  });
  expect(benchmarkMode(pr(['benchmark:browser-protocol']))).toBe('protocol');
  expect(benchmarkMode(pr(['benchmark:task-board']))).toBe('diagnostic');
  expect(() => benchmarkMode(pr([]))).toThrow('Exactly one');
  expect(() =>
    benchmarkMode(pr(['benchmark:browser-protocol', 'benchmark:task-board'])),
  ).toThrow('Exactly one');
  expect(() =>
    benchmarkMode({ BENCH_EVENT_NAME: 'pull_request_target' }),
  ).toThrow();
  expect(() =>
    benchmarkMode({
      BENCH_EVENT_NAME: 'workflow_dispatch',
      BENCH_REQUESTED_MODE: 'unknown',
    }),
  ).toThrow();
});
test('fixed high-volume control stops at first matching occupancy and retains every batch', async () => {
  let clock = 0;
  const batches: number[] = [];
  const checkpoints: unknown[] = [];
  const usage = [0.3, 0.6, 0.91];
  const result = await fillProtocolBuffer({
    now: () => clock,
    emitBatch: async (index) => {
      batches.push(index);
      clock += 1000;
    },
    nextUsage: async () => usage.shift()!,
    checkpoint: async (value) => {
      checkpoints.push(value);
    },
  });
  expect(result).toEqual({ batches: 3, occupancy: 0.91 });
  expect(batches).toEqual([0, 1, 2]);
  expect(checkpoints).toHaveLength(3);
  expect(protocolPlan.completionMs).toBe(15_000);
});
test('an overshot or unmatched control fails without a replacement attempt', async () => {
  for (const occupancy of [0.99, Number.NaN])
    await expect(
      fillProtocolBuffer({
        now: () => 1,
        emitBatch: async () => {},
        nextUsage: async () => occupancy,
        checkpoint: async () => {},
      }),
    ).rejects.toThrow();
  let clock = 0;
  let batches = 0;
  await expect(
    fillProtocolBuffer({
      now: () => clock,
      emitBatch: async () => {
        clock += 45_000;
        batches += 1;
      },
      nextUsage: async () => 0.5,
      checkpoint: async () => {},
    }),
  ).rejects.toThrow('45seconds');
  expect(batches).toBe(1);
});

test('protocol admission cannot seed tasks or select app measurement entrypoint', () => {
  expect(measurementPlan('protocol')).toEqual({
    seedTasks: false,
    script: 'protocol.ts',
    timeoutMs: 180_000,
  });
  expect(measurementPlan('diagnostic')).toEqual({
    seedTasks: true,
    script: 'capture.ts',
    timeoutMs: 600_000,
  });
  expect(() => measurementPlan(undefined)).toThrow('Unknown');
  expect(measurementPlan('acceptance')).toEqual({
    seedTasks: true,
    script: 'acceptance.ts',
    timeoutMs: 60 * 60_000,
  });
});

test('acceptance admission is exclusive and only it receives the predeclared longer shared budget', () => {
  const pr = (labels: string[]) => ({
    BENCH_EVENT_NAME: 'pull_request',
    BENCH_LABELS: JSON.stringify(labels),
  });
  expect(benchmarkMode(pr(['benchmark:task-board-acceptance']))).toBe(
    'acceptance',
  );
  for (const label of ['benchmark:browser-protocol', 'benchmark:task-board'])
    expect(() =>
      benchmarkMode(pr([label, 'benchmark:task-board-acceptance'])),
    ).toThrow('Exactly one');
  expect(sharedBudgetMs('acceptance')).toBe(75 * 60_000);
  expect(sharedBudgetMs('diagnostic')).toBe(32 * 60_000);
  expect(sharedBudgetMs('protocol')).toBe(32 * 60_000);
  expect(() => sharedBudgetMs('other')).toThrow('Unknown');
});
