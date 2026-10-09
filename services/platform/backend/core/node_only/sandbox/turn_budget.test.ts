import { describe, expect, it } from 'vitest';

import { readReserveTurnBudgetResult } from './turn_budget';

describe('readReserveTurnBudgetResult', () => {
  it('accepts a zero-cost subscription turn when the caller opts in', () => {
    expect(
      readReserveTurnBudgetResult(
        { allowed: true, budgetCents: 0 },
        { allowZero: true },
      ),
    ).toEqual({ allowed: true, budgetCents: 0 });
  });

  it('refuses a zero allowance for a paid gateway key', () => {
    expect(() =>
      readReserveTurnBudgetResult({ allowed: true, budgetCents: 0 }),
    ).toThrow(/unexpected shape/);
  });

  it('rejects negative allowances, opted in or not', () => {
    expect(() =>
      readReserveTurnBudgetResult({ allowed: true, budgetCents: -1 }),
    ).toThrow(/unexpected shape/);
    expect(() =>
      readReserveTurnBudgetResult(
        { allowed: true, budgetCents: -1 },
        { allowZero: true },
      ),
    ).toThrow(/unexpected shape/);
  });

  it('passes a refusal through with its reason', () => {
    expect(
      readReserveTurnBudgetResult({ allowed: false, reason: 'cap reached' }),
    ).toEqual({ allowed: false, reason: 'cap reached' });
  });
});
