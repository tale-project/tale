import { describe, expect, it } from 'vitest';

import {
  MEMORY_BUDGET_BYTES,
  MEMORY_BUDGET_OVERLAP_BOUND_MIB,
  MEMORY_BUDGET_SHARES_MIB,
} from './memory-budget';

const MIB = 1024 ** 2;
const shares = Object.values(MEMORY_BUDGET_SHARES_MIB);

describe('the memory budget of tale-project/tale#4942', () => {
  it('is 500 MB, decimal, shared out in MiB as the decision has it', () => {
    expect(MEMORY_BUDGET_BYTES).toBe(500_000_000);
    expect(MEMORY_BUDGET_SHARES_MIB).toEqual({
      'app-tier': 256,
      postgres: 120,
      'object-store': 35,
      edge: 35,
      'spawner-egress': 30,
    });
  });

  it('holds the shares together within the limit', () => {
    const total = shares.reduce((sum, mib) => sum + mib, 0);
    expect(total).toBe(476);
    // 476 MiB is 499,122,176 bytes; the limit is 476.8 MiB.
    expect(total * MIB).toBeLessThanOrEqual(MEMORY_BUDGET_BYTES);
  });

  it('gives each part a whole number of MiB, the unit a reservation is written in', () => {
    expect(shares.every((mib) => Number.isInteger(mib) && mib > 0)).toBe(true);
  });

  it('bounds a blue/green overlap to one extra app-tier share', () => {
    expect(MEMORY_BUDGET_OVERLAP_BOUND_MIB).toBe(
      MEMORY_BUDGET_SHARES_MIB['app-tier'],
    );
    expect(MEMORY_BUDGET_OVERLAP_BOUND_MIB).toBe(256);
  });
});
