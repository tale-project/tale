import { describe, expect, it } from 'vitest';

import {
  AGENT_BUSY_RETRY_DELAY_MS,
  AGENT_BUSY_RETRY_MAX_WAIT_MS,
  AGENT_BUSY_RETRY_MAX_WAITS,
  AUTO_RETRY_HISTORY_LIMIT,
  AUTO_RETRY_MAX_ATTEMPTS,
  CREDENTIAL_ROTATION_FREE_RETRIES,
  freeCooldownWaits,
  freeCredentialRotations,
  isAutoRetryableFailure,
  isCredentialRotation,
  planAgentBusyWait,
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

  it('never retries what a retry cannot change — a burned window, a gone agent, a missing skill, a gone attachment, a cap', () => {
    // A skill the run cannot reach is the agent's configuration: the retry
    // budget used to burn three runs on it before the author could act
    // (2026-09-26 evaluation, C-09). An attachment whose bytes left the
    // store is the same posture: three retries met the same 404 (2026-10-02).
    for (const code of [
      'deadline',
      'park_deadline',
      'agent_deleted',
      'agent_model_missing',
      'equipment_missing',
      'input_missing',
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

/** A short attempt that ended on the vendor's rate limit. */
function limited(
  overrides: Partial<AutoRetryRunFacts> = {},
): AutoRetryRunFacts {
  return failed({ apiErrorStatus: 429, ...overrides });
}

/** A start the broker refused while every account cooled down: it never
 * launched. */
function cooled(overrides: Partial<AutoRetryRunFacts> = {}): AutoRetryRunFacts {
  return failed({
    failureCode: 'credential_cooldown',
    launchedAt: undefined,
    settledAt: 1_000,
    ...overrides,
  });
}

describe('resolveAutoRetryBudget', () => {
  it('counts model capacity normally and never turns its wait into a free account cooldown', () => {
    const capacity = failed({ failureCode: 'model_capacity' });
    expect(resolveAutoRetryBudget([capacity])).toEqual({
      retry: true,
      attempt: 1,
    });
    expect(
      resolveAutoRetryBudget([capacity, capacity, capacity, capacity]).retry,
    ).toBe(false);
    expect(freeCooldownWaits([cooled(), capacity])).toEqual([false, false]);
    expect(freeCredentialRotations([capacity])).toEqual([false]);
  });

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
      resolveAutoRetryBudget([
        rotated({ autoRetryAttempt: 3 }),
        failed({ autoRetryAttempt: 2 }),
        failed({ autoRetryAttempt: 1 }),
        failed(),
      ]),
    ).toEqual({ retry: true, attempt: AUTO_RETRY_MAX_ATTEMPTS });
    // Behind a later failure it is not counted either.
    expect(
      resolveAutoRetryBudget([failed(), rotated(), failed(), failed()]),
    ).toEqual({ retry: true, attempt: AUTO_RETRY_MAX_ATTEMPTS });
  });

  it('stamps a free rotation with what the cut run showed — no attempt after a run nothing retried', () => {
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
    expect(
      resolveAutoRetryBudget([rotated({ autoRetryAttempt: 1 }), failed()]),
    ).toEqual({ retry: true, attempt: 1 });
    // A retry after a quarter of an hour of work showed "1 of 3"; cut by a
    // refresh, its own retry keeps showing it — the count does not advance,
    // and it does not fall back either.
    expect(
      resolveAutoRetryBudget([rotated({ autoRetryAttempt: 1 }), failed(LONG)]),
    ).toEqual({ retry: true, attempt: 1 });
    // A person's Retry after the budget ran out showed no count.
    expect(
      resolveAutoRetryBudget([
        rotated(),
        failed({ autoRetryAttempt: 3 }),
        failed({ autoRetryAttempt: 2 }),
        failed({ autoRetryAttempt: 1 }),
        failed(),
      ]),
    ).toEqual({ retry: true, attempt: 0 });
  });

  it('shows no count after a rotation that cut a quarter of an hour of work, whatever the cut run showed', () => {
    // The last try of a spent budget worked twenty minutes before the
    // refresh cut it: that progress refreshed the budget, so its retry is
    // no "3 of 3" — the card reads "resumed after a token refresh", as the
    // automation lane's stamp does.
    const cut = rotated({ autoRetryAttempt: 3, ...LONG });
    expect(
      resolveAutoRetryBudget([
        cut,
        failed({ autoRetryAttempt: 2 }),
        failed({ autoRetryAttempt: 1 }),
        failed(),
      ]),
    ).toEqual({ retry: true, attempt: 0 });
    // The next ordinary failure is the first attempt of the fresh budget.
    expect(
      resolveAutoRetryBudget([failed({ autoRetryAttempt: 0 }), cut]),
    ).toEqual({ retry: true, attempt: 1 });
  });

  it('spends no attempt waiting out the cooldown of the 429 it retried', () => {
    // A lone account answered 429 and cooled down; the retry's start was
    // refused at once. That is one event, not two attempts.
    expect(
      resolveAutoRetryBudget([cooled({ autoRetryAttempt: 1 }), limited()]),
    ).toEqual({ retry: true, attempt: 1 });
    // Four 429s, each followed by a free wait: the fifth decides, as four
    // plain failures would.
    const pairs = (count: number) =>
      Array.from({ length: count }, () => [cooled(), limited()]).flat();
    expect(resolveAutoRetryBudget(pairs(3)).retry).toBe(true);
    expect(resolveAutoRetryBudget([limited(), ...pairs(3)]).retry).toBe(false);
    // The budget behind a free wait may already be spent; the wait is
    // retried anyway, showing the count its 429 reached.
    expect(
      resolveAutoRetryBudget([
        cooled({ autoRetryAttempt: 3 }),
        limited({ autoRetryAttempt: 2 }),
        failed({ autoRetryAttempt: 1 }),
        failed(),
      ]),
    ).toEqual({ retry: true, attempt: AUTO_RETRY_MAX_ATTEMPTS });
  });

  it('counts a refused start that did not follow its own 429', () => {
    // Another run cooled the pool, or the pool is still cooling after the
    // wait: waiting again spends an attempt, so it cannot loop.
    expect(resolveAutoRetryBudget([cooled(), failed()])).toEqual({
      retry: true,
      attempt: 2,
    });
    expect(resolveAutoRetryBudget([cooled(), cooled(), limited()])).toEqual({
      retry: true,
      attempt: 2,
    });
    expect(resolveAutoRetryBudget([cooled()])).toEqual({
      retry: true,
      attempt: 1,
    });
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

  it('reads enough history to see past a budget hidden behind free rotations and waits', () => {
    // Each counted 429 behind a full allowance of free rotations and a free
    // wait: the walk needs every row of the window to find the one past the
    // budget.
    const rows = Array.from({ length: AUTO_RETRY_MAX_ATTEMPTS + 1 }, () => [
      limited(),
      rotated(),
      rotated(),
      cooled(),
    ]).flat();
    expect(rows.length).toBeLessThanOrEqual(AUTO_RETRY_HISTORY_LIMIT);
    expect(resolveAutoRetryBudget(rows).retry).toBe(false);
    expect(resolveAutoRetryBudget(rows.slice(1)).retry).toBe(true);
  });
});

describe('freeCooldownWaits', () => {
  it('frees a refused start only right behind a 429 of the same agent', () => {
    expect(
      freeCooldownWaits([
        cooled(),
        limited(),
        cooled(),
        failed(),
        cooled(),
        limited({ agentId: 'bob' }),
        cooled(),
        limited({ status: 'settled' }),
      ]),
    ).toEqual([true, false, false, false, false, false, false, false]);
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

describe('planAgentBusyWait', () => {
  const now = 1_800_000_000_000;

  it('looks again minutes later, never at once, and counts the look', () => {
    expect(planAgentBusyWait({ waits: 0, failedAt: now - 1_000, now })).toEqual(
      { wait: true, waits: 1, lookAt: now + AGENT_BUSY_RETRY_DELAY_MS },
    );
    expect(AGENT_BUSY_RETRY_DELAY_MS).toBeGreaterThanOrEqual(60_000);
  });

  it('takes a bounded number of looks', () => {
    expect(
      planAgentBusyWait({
        waits: AGENT_BUSY_RETRY_MAX_WAITS - 1,
        failedAt: undefined,
        now,
      }),
    ).toMatchObject({ wait: true, waits: AGENT_BUSY_RETRY_MAX_WAITS });
    expect(
      planAgentBusyWait({
        waits: AGENT_BUSY_RETRY_MAX_WAITS,
        failedAt: undefined,
        now,
      }),
    ).toEqual({ wait: false });
    expect(Number.isInteger(AGENT_BUSY_RETRY_MAX_WAITS)).toBe(true);
  });

  it('sends no look for past the longest wait after the failure', () => {
    const lastLook =
      now + AGENT_BUSY_RETRY_DELAY_MS - AGENT_BUSY_RETRY_MAX_WAIT_MS;
    expect(
      planAgentBusyWait({ waits: 3, failedAt: lastLook, now }),
    ).toMatchObject({ wait: true });
    expect(
      planAgentBusyWait({ waits: 3, failedAt: lastLook - 1, now }),
    ).toEqual({
      wait: false,
    });
  });

  it('takes as many looks as the wait’s age allows, so both bounds end it together', () => {
    const failedAt = now;
    let waits = 0;
    let at = now;
    for (;;) {
      const next = planAgentBusyWait({ waits, failedAt, now: at });
      if (!next.wait) break;
      waits = next.waits;
      at = next.lookAt;
    }
    expect(waits).toBe(AGENT_BUSY_RETRY_MAX_WAITS);
    expect(at - failedAt).toBe(AGENT_BUSY_RETRY_MAX_WAIT_MS);
  });
});
