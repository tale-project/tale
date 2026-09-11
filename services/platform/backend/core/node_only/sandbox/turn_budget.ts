/**
 * The org spend cap's answer to a managed turn's start: the allowance the
 * turn's gateway key may be minted with, or a refusal naming the cap. The
 * hosts (task runs, automation agent nodes) ask through the ctx shim's
 * `sandbox/session_mutations:reserveTurnBudget` — the PG side takes the org
 * admission lock, evaluates the budget policy against the ledger PLUS every
 * unsettled turn's reservation, and records this turn's reservation on its
 * op row — so the sum of what is in flight can never exceed what remains.
 */

export type ReserveTurnBudgetResult =
  | { allowed: true; budgetCents: number }
  | { allowed: false; reason: string };

/** A start refused by the org's spend cap. Not retryable: the cap only
 * moves when the period rolls over or an admin raises it. */
export class TurnBudgetExceededError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = 'TurnBudgetExceededError';
    this.reason = reason;
  }
}

export function isTurnBudgetExceededError(
  error: unknown,
): error is TurnBudgetExceededError {
  return error instanceof TurnBudgetExceededError;
}

/** Narrow the shim's answer — a foreign shape (an older backend, a test
 * stub) must never read as an allowance. */
export function readReserveTurnBudgetResult(
  value: unknown,
): ReserveTurnBudgetResult {
  if (typeof value === 'object' && value !== null) {
    const record = value as {
      allowed?: unknown;
      budgetCents?: unknown;
      reason?: unknown;
    };
    if (
      record.allowed === true &&
      typeof record.budgetCents === 'number' &&
      Number.isFinite(record.budgetCents) &&
      record.budgetCents > 0
    ) {
      return { allowed: true, budgetCents: record.budgetCents };
    }
    if (record.allowed === false && typeof record.reason === 'string') {
      return { allowed: false, reason: record.reason };
    }
  }
  throw new Error(
    'reserveTurnBudget answered with an unexpected shape — the turn cannot be sized',
  );
}
