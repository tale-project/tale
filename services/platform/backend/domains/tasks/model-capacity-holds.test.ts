import { describe, expect, it } from 'vitest';

import {
  MODEL_CAPACITY_MAX_WAIT_MS,
  MODEL_CAPACITY_PROBE_PROOF_MS,
  MODEL_CAPACITY_WAKE_SPACING_MS,
  modelCapacityBackoffMs,
  modelCapacityWakeDelaysMs,
} from './model-capacity-holds.ts';

describe('the wait a model at capacity imposes [TASK-R40]', () => {
  it('waits 1, 2, 4, 8, then 15 minutes as the refusals go on', () => {
    const middle = () => 0.5;
    expect(
      [1, 2, 3, 4, 5, 6, 20].map((n) => modelCapacityBackoffMs(n, middle)),
    ).toEqual([60_000, 120_000, 240_000, 480_000, 900_000, 900_000, 900_000]);
  });

  it('spreads the runs it parks over ±10 % so they do not wake in lockstep', () => {
    expect(modelCapacityBackoffMs(1, () => 0)).toBe(54_000);
    expect(modelCapacityBackoffMs(1, () => 1)).toBe(66_000);
  });

  it('reads a malformed count as the first refusal', () => {
    expect(modelCapacityBackoffMs(0, () => 0.5)).toBe(60_000);
    expect(modelCapacityBackoffMs(Number.NaN, () => 0.5)).toBe(60_000);
  });

  it('lets a probe prove the model in two minutes and gives up after twelve hours', () => {
    expect(MODEL_CAPACITY_PROBE_PROOF_MS).toBe(2 * 60_000);
    expect(MODEL_CAPACITY_MAX_WAIT_MS).toBe(12 * 60 * 60_000);
  });
});

describe('a model that answers again wakes its waiters in waves [TASK-R40]', () => {
  /** How many runs start at each delay, in order. */
  function waves(count: number): number[] {
    const sizes = new Map<number, number>();
    for (const delay of modelCapacityWakeDelaysMs(count)) {
      sizes.set(delay, (sizes.get(delay) ?? 0) + 1);
    }
    return [...sizes.values()];
  }

  it('wakes a few waiters one at a time, 15 seconds apart', () => {
    expect(modelCapacityWakeDelaysMs(0)).toEqual([]);
    expect(modelCapacityWakeDelaysMs(1)).toEqual([0]);
    expect(modelCapacityWakeDelaysMs(4)).toEqual([0, 15_000, 30_000, 45_000]);
    expect(waves(16)).toEqual(Array.from({ length: 16 }, () => 1));
    expect(MODEL_CAPACITY_WAKE_SPACING_MS).toBe(15_000);
  });

  it('starts many with one run, then twice as many each wave, up to a sixteenth of them', () => {
    expect(waves(256)).toEqual([
      1, 2, 4, 8, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 1,
    ]);
    expect(Math.max(...waves(500))).toBe(32);
  });

  it('wakes them oldest park first, every one within five minutes', () => {
    for (const count of [17, 64, 256, 500]) {
      const delays = modelCapacityWakeDelaysMs(count);
      expect(delays).toHaveLength(count);
      expect(delays).toEqual([...delays].sort((a, b) => a - b));
      expect(delays.at(-1)).toBeLessThanOrEqual(5 * 60_000);
    }
    // 256 waiters: the last of 20 waves, where one at a time took 63:45.
    expect(modelCapacityWakeDelaysMs(256).at(-1)).toBe(19 * 15_000);
  });

  it('reads a malformed count as none', () => {
    expect(modelCapacityWakeDelaysMs(Number.NaN)).toEqual([]);
    expect(modelCapacityWakeDelaysMs(-3)).toEqual([]);
  });
});
