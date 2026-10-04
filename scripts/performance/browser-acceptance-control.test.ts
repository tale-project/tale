import { expect, test } from 'bun:test';

import {
  assertAcceptanceFrame,
  assertResourceCheckpoint,
  hostQuiet,
  waitForQuietHost,
} from './browser/acceptance-control.ts';

const pressure = (value: number) =>
  `some avg10=${value} avg60=0.00 avg300=0.00 total=10\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n`;
test('host gate requires both strict thresholds, independent of cgroup throttling', () => {
  expect(
    hostQuiet({ at: 1, load: [2.49, 0, 0], cpuPressure: pressure(19.99) })
      .quiet,
  ).toBe(true);
  expect(
    hostQuiet({ at: 1, load: [2.5, 0, 0], cpuPressure: pressure(0) }).quiet,
  ).toBe(false);
  expect(
    hostQuiet({ at: 1, load: [0, 0, 0], cpuPressure: pressure(20) }).quiet,
  ).toBe(false);
  expect(() =>
    hostQuiet({ at: 1, load: [0, 0, 0], cpuPressure: '' }),
  ).toThrow();
});
test('quiet wait never runs after its 120-second limit or remaining campaign deadline', async () => {
  for (const budget of [120_000, 12_000]) {
    let clock = 0;
    const saved: unknown[] = [];
    const waits: number[] = [];
    await expect(
      waitForQuietHost(
        {
          now: () => clock,
          sample: async () => ({
            at: clock,
            load: [3, 0, 0],
            cpuPressure: pressure(0),
          }),
          save: async (rows) => {
            saved.push([...rows]);
          },
          wait: async (ms) => {
            waits.push(ms);
            clock += ms;
          },
        },
        budget,
      ),
    ).rejects.toThrow('fixed load/PSI');
    expect(clock).toBe(budget);
    expect(Math.max(...waits)).toBe(5000);
    expect(saved.length).toBe(Math.ceil(budget / 5000));
  }
});
test('quiet wait retains each failed gate observation and accepts the first valid one without retrying an action', async () => {
  let clock = 0;
  const rows = await waitForQuietHost(
    {
      now: () => clock,
      sample: async () => ({
        at: clock,
        load: [clock ? 0 : 3, 0, 0],
        cpuPressure: pressure(0),
      }),
      save: async () => {},
      wait: async (ms) => {
        clock += ms;
      },
    },
    60_000,
  );
  expect(rows.map((row) => row.quiet)).toEqual([false, true]);
});
test('resource checkpoints reject stale, failed, missing and nonzero OOM evidence', () => {
  const valid = {
    at: 100,
    valid: true,
    counters: {
      'memory.events': 'low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\n',
      'cpu.stat': 'nr_throttled 500\n',
    },
    membership: { db: 'owned', browser: 'owned' },
  };
  expect(assertResourceCheckpoint(valid, 101)).toBe(valid);
  expect(() => assertResourceCheckpoint(valid, 10_101)).toThrow('stale');
  expect(() =>
    assertResourceCheckpoint(
      { ...valid, valid: false, error: 'quota changed' },
      101,
    ),
  ).toThrow('quota changed');
  expect(() =>
    assertResourceCheckpoint({ ...valid, membership: undefined }, 101),
  ).toThrow('membership');
  expect(() =>
    assertResourceCheckpoint(
      { ...valid, counters: { 'memory.events': 'oom 1\noom_kill 0' } },
      101,
    ),
  ).toThrow('OOM');
});

test('frame stamps and count milestones must use finite ordered clocks from the observed page', () => {
  const frame = {
    tDom: 10,
    tRaf: 20,
    tFrame: 21,
    countFrame: { tDom: 1, tRaf: 2, tFrame: 3 },
  };
  const clock = { timeOrigin: 1000, performanceNow: 22 };
  expect(assertAcceptanceFrame(frame, clock)).toBe(frame);
  expect(() => assertAcceptanceFrame({ ...frame, tDom: 25 }, clock)).toThrow(
    'out of order',
  );
  expect(() =>
    assertAcceptanceFrame(frame, { ...clock, performanceNow: 20 }),
  ).toThrow('out of order');
  expect(() =>
    assertAcceptanceFrame(
      { ...frame, countFrame: { tDom: -1, tRaf: 2, tFrame: 3 } },
      clock,
    ),
  ).toThrow('Invalid frame');
  expect(() =>
    assertAcceptanceFrame(frame, { ...clock, timeOrigin: NaN }),
  ).toThrow('Invalid page clock');
});
