/**
 * Pure auto-retry budget for task-agent runs. Isolated like
 * `task_kick_resume.ts` so the gating logic is unit-testable without a
 * database; the orchestration (collect → decide → kick) lives in
 * `tasks/mutations.ts` (`kickAutoRetryRun`).
 *
 * Semantics (2026-08-20): a failed run auto-retries immediately — no
 * backoff, the harness already backed off per-request — unless the task is
 * in a rapid crash loop. The loop detector is a CONSECUTIVE-failure budget
 * with a progress reset, not a sliding window: a sliding window plus any
 * retry spacing lets a deterministically-broken task drip retries forever,
 * while a streak terminates it and still refreshes the budget whenever an
 * attempt proves real progress by executing long enough.
 */

export const AUTO_RETRY_MAX_ATTEMPTS = 3;

/** Producer-side failure classification, stamped where each failure is
 * PRODUCED (`settleTaskAgentTurn` callers, the park watchdog, the capacity
 * wake) — never regex-derived from the free-text reason. */
export type TaskRunFailureCode =
  | 'harness_error'
  | 'turn_crashed'
  | 'session_gone'
  | 'start_failed'
  | 'harvest_failed'
  | 'steer_restart_failed'
  /** A SUCCESSFUL harness end with no final text — the model emitted a bare
   * end-of-turn mid-work, so there is no report and the work is not done.
   * Retryable: the retry resumes the conversation and asks it to continue. */
  | 'empty_turn'
  | 'deadline'
  | 'park_deadline'
  | 'agent_deleted'
  | 'agent_model_missing';

/** Failures where a retry is pure waste: the run burned its 12h window
 * (either executing or parked), or the agent configuration itself is gone.
 * Everything else — provider errors, crashes, vanished sessions, harvest
 * hiccups — retries by DEFAULT, including an absent code, so a future
 * failure producer inherits the retry posture without opting in. */
const NO_RETRY_FAILURE_CODES: ReadonlySet<string> = new Set([
  'deadline',
  'park_deadline',
  'agent_deleted',
  'agent_model_missing',
] satisfies TaskRunFailureCode[]);

export function isAutoRetryableFailure(code: string | undefined): boolean {
  return code === undefined || !NO_RETRY_FAILURE_CODES.has(code);
}

/** An attempt that EXECUTED at least this long is progress: the streak (and
 * budget) resets at it. 15 minutes, per the product decision. */
export const AUTO_RETRY_PROGRESS_MS = 15 * 60 * 1000;

/** The run-row facts the budget walk reads, newest-first; element 0 is the
 * run that just failed. */
export interface AutoRetryRunFacts {
  readonly agentId: string;
  readonly status: 'queued' | 'running' | 'settled' | 'failed' | 'cancelled';
  /** Stamped at actual launch (`setTaskAgentRunRunning`). Absent ⇒ the run
   * never executed — that reads as ZERO duration, never as a long run:
   * `startedAt` is kick time and includes capacity-parked waiting, so a
   * parked-out run would otherwise masquerade as 12h of progress and re-arm
   * the budget on every park timeout. */
  readonly launchedAt?: number | undefined;
  readonly settledAt?: number | undefined;
}

export interface AutoRetryBudget {
  /** Whether the just-failed run may be auto-retried. */
  readonly retry: boolean;
  /** 1-based attempt number for the retry run's display stamp. */
  readonly attempt: number;
}

/** Execution time of a terminal run — 0 when it never launched. */
function executedMs(run: AutoRetryRunFacts): number {
  if (run.launchedAt === undefined || run.settledAt === undefined) return 0;
  return Math.max(0, run.settledAt - run.launchedAt);
}

/**
 * Count the streak of consecutive short-lived failures ending at `rows[0]`
 * (the run that just failed) and decide whether one more auto-retry fits the
 * budget. The walk stops — resetting the budget — at the first row that is
 * not a failure of the same agent (human cancel, a settled run, or a
 * reassignment boundary all count as intervention/progress), or whose
 * attempt executed ≥ the progress threshold.
 */
export function resolveAutoRetryBudget(
  rows: readonly AutoRetryRunFacts[],
): AutoRetryBudget {
  const agentId = rows[0]?.agentId;
  let shortStreak = 0;
  for (const row of rows) {
    if (row.agentId !== agentId) break;
    if (row.status !== 'failed') break;
    if (executedMs(row) >= AUTO_RETRY_PROGRESS_MS) break;
    shortStreak += 1;
    // One past the budget already decides — no need to walk the whole tail.
    if (shortStreak > AUTO_RETRY_MAX_ATTEMPTS) break;
  }
  return {
    retry: shortStreak <= AUTO_RETRY_MAX_ATTEMPTS,
    attempt: Math.max(shortStreak, 1),
  };
}
