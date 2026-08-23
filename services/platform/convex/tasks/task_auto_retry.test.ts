/**
 * Pure-function tests for the auto-retry budget. The convex-test halves —
 * scheduling from the failed mark, the kick guards, and the broker-hash
 * exclusion threading — live in task_agent_runs.test.ts.
 */

import { describe, expect, it } from 'vitest';

import {
  AUTO_RETRY_MAX_ATTEMPTS,
  AUTO_RETRY_PROGRESS_MS,
  resolveAutoRetryBudget,
  type AutoRetryRunFacts,
} from './task_auto_retry';

const AGENT = 'agent_a';
const T0 = 1_700_000_000_000;

/** A short-lived failure: launched and settled within a minute. */
function shortFail(
  overrides: Partial<AutoRetryRunFacts> = {},
): AutoRetryRunFacts {
  return {
    agentId: AGENT,
    status: 'failed',
    launchedAt: T0,
    settledAt: T0 + 60_000,
    ...overrides,
  };
}

/** A failure that executed past the progress threshold. */
function longFail(
  overrides: Partial<AutoRetryRunFacts> = {},
): AutoRetryRunFacts {
  return {
    agentId: AGENT,
    status: 'failed',
    launchedAt: T0,
    settledAt: T0 + AUTO_RETRY_PROGRESS_MS,
    ...overrides,
  };
}

describe('resolveAutoRetryBudget', () => {
  it('retries the first failure as attempt 1', () => {
    expect(resolveAutoRetryBudget([shortFail()])).toEqual({
      retry: true,
      attempt: 1,
    });
  });

  it('numbers consecutive short failures up to the budget', () => {
    expect(resolveAutoRetryBudget([shortFail(), shortFail()])).toEqual({
      retry: true,
      attempt: 2,
    });
    expect(
      resolveAutoRetryBudget([shortFail(), shortFail(), shortFail()]),
    ).toEqual({ retry: true, attempt: AUTO_RETRY_MAX_ATTEMPTS });
  });

  it('stops at the fourth consecutive short failure', () => {
    const rows = [shortFail(), shortFail(), shortFail(), shortFail()];
    expect(resolveAutoRetryBudget(rows).retry).toBe(false);
  });

  it('a long-running failure resets the budget for itself', () => {
    // The just-failed run executed past the threshold: prior short failures
    // do not count against it.
    const rows = [longFail(), shortFail(), shortFail(), shortFail()];
    expect(resolveAutoRetryBudget(rows)).toEqual({ retry: true, attempt: 1 });
  });

  it('a long-running failure deeper in the streak caps the count there', () => {
    const rows = [shortFail(), longFail(), shortFail(), shortFail()];
    expect(resolveAutoRetryBudget(rows)).toEqual({ retry: true, attempt: 1 });
  });

  it('a never-launched failure counts as zero progress, never as a long run', () => {
    // A capacity-parked run that timed out spans ~12h between kick and
    // settle but never executed — it must consume budget, not reset it.
    const parkedOut: AutoRetryRunFacts = {
      agentId: AGENT,
      status: 'failed',
      settledAt: T0 + 12 * 60 * 60 * 1000,
    };
    const rows = [shortFail(), parkedOut, shortFail(), shortFail()];
    expect(resolveAutoRetryBudget(rows).retry).toBe(false);
  });

  it('a cancelled run breaks the streak — a person intervened', () => {
    const rows = [
      shortFail(),
      shortFail({ status: 'cancelled' }),
      shortFail(),
      shortFail(),
    ];
    expect(resolveAutoRetryBudget(rows)).toEqual({ retry: true, attempt: 1 });
  });

  it('a settled run breaks the streak', () => {
    const rows = [shortFail(), shortFail({ status: 'settled' }), shortFail()];
    expect(resolveAutoRetryBudget(rows)).toEqual({ retry: true, attempt: 1 });
  });

  it("another agent's rows are a reassignment boundary", () => {
    const rows = [
      shortFail(),
      shortFail({ agentId: 'agent_b' }),
      shortFail({ agentId: 'agent_b' }),
      shortFail({ agentId: 'agent_b' }),
    ];
    expect(resolveAutoRetryBudget(rows)).toEqual({ retry: true, attempt: 1 });
  });

  it('missing settledAt reads as zero duration', () => {
    const rows = [shortFail({ settledAt: undefined })];
    expect(resolveAutoRetryBudget(rows)).toEqual({ retry: true, attempt: 1 });
  });
});
