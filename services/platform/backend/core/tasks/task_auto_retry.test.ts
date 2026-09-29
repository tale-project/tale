import { describe, expect, it } from 'vitest';

import {
  AUTO_RETRY_HISTORY_LIMIT,
  AUTO_RETRY_MAX_ATTEMPTS,
  CREDENTIAL_ROTATION_FREE_RETRIES,
  freeCredentialRotations,
  isAutoRetryableFailure,
  isCredentialRotation,
  resolveAutoRetryBudget,
  type AutoRetryRunFacts,
} from './task_auto_retry';

describe('isAutoRetryableFailure', () => {
  it('retries faults by default, an absent code included', () => {
    for (const code of [
      undefined,
      'harness_error',
      'turn_crashed',
      'session_gone',
      'start_failed',
      'harvest_failed',
      'empty_turn',
      'credential_rotated',
      'something_new',
    ]) {
      expect(isAutoRetryableFailure(code), String(code)).toBe(true);
    }
  });

  it('never retries what a retry cannot change — a burned window, a gone agent, a missing skill, a cap', () => {
    // A skill the run cannot reach is the agent's configuration: the retry
    // budget used to burn three runs on it before the author could act
    // (2026-09-26 evaluation, C-09).
    for (const code of [
      'deadline',
      'park_deadline',
      'agent_deleted',
      'agent_model_missing',
      'equipment_missing',
      'budget_exceeded',
    ]) {
      expect(isAutoRetryableFailure(code), code).toBe(false);
    }
  });
});

describe('isCredentialRotation', () => {
  it('is a 401 on a turn the subscription broker served, and nothing else', () => {
    expect(
      isCredentialRotation({ apiErrorStatus: 401, brokerServed: true }),
    ).toBe(true);
    // A static key or the managed gateway: a credential fault, no rotation.
    expect(
      isCredentialRotation({ apiErrorStatus: 401, brokerServed: false }),
    ).toBe(false);
    expect(
      isCredentialRotation({ apiErrorStatus: 429, brokerServed: true }),
    ).toBe(false);
    expect(
      isCredentialRotation({ apiErrorStatus: undefined, brokerServed: true }),
    ).toBe(false);
  });
});

/** A failed attempt that executed one minute — short, in budget terms. */
function failed(overrides: Partial<AutoRetryRunFacts> = {}): AutoRetryRunFacts {
  return {
    agentId: 'alice',
    status: 'failed',
    launchedAt: 0,
    settledAt: 60_000,
    failureCode: 'harness_error',
    ...overrides,
  };
}

/** A short attempt the broker's refresh cut. */
function rotated(
  overrides: Partial<AutoRetryRunFacts> = {},
): AutoRetryRunFacts {
  return failed({ failureCode: 'credential_rotated', ...overrides });
}

/** An attempt that worked past the progress threshold before it failed. */
const LONG = { launchedAt: 0, settledAt: 20 * 60_000 };

describe('resolveAutoRetryBudget', () => {
  it('counts consecutive short failures and stops one past the budget', () => {
    expect(resolveAutoRetryBudget([failed()])).toEqual({
      retry: true,
      attempt: 1,
    });
    expect(resolveAutoRetryBudget([failed(), failed(), failed()])).toEqual({
      retry: true,
      attempt: AUTO_RETRY_MAX_ATTEMPTS,
    });
    expect(
      resolveAutoRetryBudget([failed(), failed(), failed(), failed()]).retry,
    ).toBe(false);
  });

  it('refreshes the budget at an attempt that made progress, or at a person', () => {
    expect(
      resolveAutoRetryBudget([failed(), failed(LONG), failed(), failed()]),
    ).toEqual({ retry: true, attempt: 1 });
    expect(
      resolveAutoRetryBudget([
        failed(),
        failed({ status: 'cancelled' }),
        failed(),
        failed(),
        failed(),
      ]),
    ).toEqual({ retry: true, attempt: 1 });
  });

  it('resumes a credential rotation without spending the crash-loop budget', () => {
    // The budget behind it is spent; the run that just failed was cut by the
    // broker's refresh, not by a crash loop.
    expect(
      resolveAutoRetryBudget([rotated(), failed(), failed(), failed()]),
    ).toEqual({ retry: true, attempt: AUTO_RETRY_MAX_ATTEMPTS });
    // Behind a later failure it is not counted either.
    expect(
      resolveAutoRetryBudget([failed(), rotated(), failed(), failed()]),
    ).toEqual({ retry: true, attempt: AUTO_RETRY_MAX_ATTEMPTS });
  });

  it('stamps a free rotation with the attempts already spent — none after a clean run', () => {
    // The card reads 0 as "resumed after a token refresh", not "1 of 3";
    // the next counted failure is the first attempt.
    expect(resolveAutoRetryBudget([rotated()])).toEqual({
      retry: true,
      attempt: 0,
    });
    expect(resolveAutoRetryBudget([failed(), rotated()])).toEqual({
      retry: true,
      attempt: 1,
    });
    expect(resolveAutoRetryBudget([rotated(), failed()])).toEqual({
      retry: true,
      attempt: 1,
    });
    // Work past the progress threshold refreshed the budget: none spent.
    expect(resolveAutoRetryBudget([rotated(LONG), failed(), failed()])).toEqual(
      { retry: true, attempt: 0 },
    );
  });

  it('takes the third rotation in a row down the ordinary path, so a dead grant ends', () => {
    const streak = (length: number) => Array.from({ length }, () => rotated());
    expect(resolveAutoRetryBudget(streak(2))).toEqual({
      retry: true,
      attempt: 0,
    });
    // The third is counted, like any failure.
    expect(resolveAutoRetryBudget(streak(3))).toEqual({
      retry: true,
      attempt: 1,
    });
    // Every vend answers 401: the free allowance, then the budget, then stop.
    expect(
      resolveAutoRetryBudget(
        streak(CREDENTIAL_ROTATION_FREE_RETRIES + AUTO_RETRY_MAX_ATTEMPTS),
      ).retry,
    ).toBe(true);
    expect(
      resolveAutoRetryBudget(
        streak(CREDENTIAL_ROTATION_FREE_RETRIES + AUTO_RETRY_MAX_ATTEMPTS + 1),
      ).retry,
    ).toBe(false);
  });

  it('reads enough history to see past a budget hidden behind free rotations', () => {
    // Each counted failure behind a full allowance of free rotations: the
    // walk needs every row of the window to find the one past the budget.
    const rows = Array.from({ length: AUTO_RETRY_MAX_ATTEMPTS + 1 }, () => [
      failed(),
      rotated(),
      rotated(),
    ]).flat();
    expect(rows.length).toBeLessThanOrEqual(AUTO_RETRY_HISTORY_LIMIT);
    expect(resolveAutoRetryBudget(rows).retry).toBe(false);
    expect(resolveAutoRetryBudget(rows.slice(1)).retry).toBe(true);
  });
});

describe('freeCredentialRotations', () => {
  it('frees the first rotations of a streak, counted oldest first', () => {
    expect(freeCredentialRotations([rotated(), rotated(), rotated()])).toEqual([
      false,
      true,
      true,
    ]);
  });

  it('starts a new streak after any other row', () => {
    expect(
      freeCredentialRotations([
        rotated(),
        rotated(),
        failed(),
        rotated(),
        rotated(),
      ]),
    ).toEqual([true, true, false, true, true]);
  });

  it('starts a new streak at an attempt that worked a quarter of an hour', () => {
    // A grant that served real work before its 401 is not dead.
    expect(
      freeCredentialRotations([rotated(), rotated(LONG), rotated(), rotated()]),
    ).toEqual([true, true, true, true]);
  });

  it('never continues one agent’s streak with another’s rotation', () => {
    expect(
      freeCredentialRotations([
        rotated({ agentId: 'bob' }),
        rotated(),
        rotated(),
      ]),
    ).toEqual([true, true, true]);
  });

  it('reads rows failed before the code was kept as ordinary', () => {
    expect(
      freeCredentialRotations([failed({ failureCode: undefined })]),
    ).toEqual([false]);
  });
});
