import { describe, expect, it } from 'vitest';

import {
  MODEL_CAPACITY_MAX_WAIT_MS,
  MODEL_CAPACITY_PROBE_PROOF_MS,
  modelCapacityBackoffMs,
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
