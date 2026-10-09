import { describe, expect, it } from 'vitest';

import { readReserveTurnBudgetResult } from './turn_budget';

describe('readReserveTurnBudgetResult', () => {
  it('accepts a zero-cost subscription turn', () => {
    expect(
      readReserveTurnBudgetResult({ allowed: true, budgetCents: 0 }),
    ).toEqual({ allowed: true, budgetCents: 0 });
  });

  it('rejects negative allowances', () => {
    expect(() =>
      readReserveTurnBudgetResult({ allowed: true, budgetCents: -1 }),
    ).toThrow(/unexpected shape/);
  });
});
