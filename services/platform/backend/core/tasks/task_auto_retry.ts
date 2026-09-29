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
  | 'agent_model_missing'
  /** A skill the agent equips does not exist or is not shared with the
   * run's scope — configuration, not a fault: nothing about a retry
   * changes it (2026-09-26 evaluation, C-09). */
  | 'equipment_missing'
  /** The org's spend cap refused the start — the cap only moves with the
   * period or an admin, so a retry would only be refused again. */
  | 'budget_exceeded'
  /** The vendor answered 401 to a turn the subscription broker served: the
   * broker refreshed the account under the running turn, and the refresh
   * revoked the token the turn was started with. The account is healthy and
   * holds a fresh token, so the retry vends again and resumes the
   * conversation — the first {@link CREDENTIAL_ROTATION_FREE_RETRIES} in a
   * row outside the crash-loop budget and without burning the account
   * ({@link freeCredentialRotations}). */
  | 'credential_rotated'
  /** The start met a subscription broker whose every account was cooling
   * down after a rate limit, so nothing ran. The retry's start waits until
   * the first account is back; when the run it retried ended on a 429 —
   * the rate limit that cooled the pool — the wait spends no attempt
   * ({@link freeCooldownWaits}). */
  | 'credential_cooldown';

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
  'equipment_missing',
  'budget_exceeded',
] satisfies TaskRunFailureCode[]);

export function isAutoRetryableFailure(code: string | undefined): boolean {
  return code === undefined || !NO_RETRY_FAILURE_CODES.has(code);
}

/** An attempt that EXECUTED at least this long is progress: the streak (and
 * budget) resets at it. 15 minutes, per the product decision. */
export const AUTO_RETRY_PROGRESS_MS = 15 * 60 * 1000;

/** Credential rotations in a row that resume for free — outside
 * `AUTO_RETRY_MAX_ATTEMPTS`, and without excluding the account from the
 * next vend. A token revoked under a turn is the broker's routine refresh,
 * not a fault of the run or the account; but a grant that is truly dead
 * answers 401 on every vend, and the third rotation in a row takes the
 * ordinary path (counted, account excluded), so it cannot loop. */
export const CREDENTIAL_ROTATION_FREE_RETRIES = 2;

/** Whether an errored turn's end is the broker's token rotating under it:
 * the vendor answered 401 (`api_error_status`) and the turn was served from
 * a subscription broker — the one lane whose token the platform does not
 * own and a refresh elsewhere revokes. A 401 on a static subscription key
 * or on the managed gateway is a credential fault, not a rotation. */
export function isCredentialRotation(end: {
  apiErrorStatus?: number | undefined;
  brokerServed: boolean;
}): boolean {
  return end.brokerServed && end.apiErrorStatus === 401;
}

/** How many run rows the retry decision reads, newest first: enough to see
 * one attempt past the budget even when every counted failure sits behind a
 * full allowance of free rotations and a free cooldown wait. */
export const AUTO_RETRY_HISTORY_LIMIT =
  (AUTO_RETRY_MAX_ATTEMPTS + 1) * (CREDENTIAL_ROTATION_FREE_RETRIES + 2) + 1;

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
  /** The producer's failure code (`project_agent_runs.failure_code`);
   * absent on rows failed before the column, which read as ordinary. */
  readonly failureCode?: string | undefined;
  /** The vendor's HTTP status on a turn-ending API error (429, 401, …). */
  readonly apiErrorStatus?: number | undefined;
  /** The attempt the run's card showed (`auto_retry_attempt`); absent on a
   * run a person or a mention started. */
  readonly autoRetryAttempt?: number | undefined;
}

export interface AutoRetryBudget {
  /** Whether the just-failed run may be auto-retried. */
  readonly retry: boolean;
  /** The retry run's display stamp: the attempt of the budget it spends,
   * 1-based. A free retry spends none and shows what the run it replaces
   * showed — 0 when that run showed no attempt or refreshed the budget by
   * its own progress, which the task card reads as a resume after a token
   * refresh. */
  readonly attempt: number;
}

/** Execution time of a terminal run — 0 when it never launched. */
function executedMs(run: AutoRetryRunFacts): number {
  if (run.launchedAt === undefined || run.settledAt === undefined) return 0;
  return Math.max(0, run.settledAt - run.launchedAt);
}

/**
 * Which rows of a task's newest-first run history are FREE credential
 * rotations: a `credential_rotated` failure that is at most the
 * {@link CREDENTIAL_ROTATION_FREE_RETRIES}-th of its agent's rotations in a
 * row, counted oldest first. Any other row ends a streak, and an attempt
 * that executed past the progress threshold before its 401 starts a new one
 * — a grant that served a quarter of an hour of work is not dead. The retry
 * budget and the kick plan's account exclusions read the same answer, so a
 * free rotation is neither counted nor burned in either.
 */
export function freeCredentialRotations(
  rows: readonly AutoRetryRunFacts[],
): boolean[] {
  const free = rows.map(() => false);
  let streak = 0;
  let streakAgent: string | undefined;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (
      row === undefined ||
      row.status !== 'failed' ||
      row.failureCode !== 'credential_rotated'
    ) {
      streak = 0;
      streakAgent = undefined;
      continue;
    }
    streak =
      row.agentId === streakAgent && executedMs(row) < AUTO_RETRY_PROGRESS_MS
        ? streak + 1
        : 1;
    streakAgent = row.agentId;
    free[index] = streak <= CREDENTIAL_ROTATION_FREE_RETRIES;
  }
  return free;
}

/**
 * Which rows of a task's newest-first run history are FREE cooldown waits:
 * a start the broker refused while every account cooled down
 * (`credential_cooldown`) whose run retried one that ended on a 429 — the
 * rate limit that cooled the pool. That failure already counted; the wait
 * for its cooldown is the same event, not a second attempt. Each free wait
 * needs a counted 429 of its own directly behind it, so waits cannot loop:
 * a second refusal in a row, or one that follows anything else, counts.
 */
export function freeCooldownWaits(
  rows: readonly AutoRetryRunFacts[],
): boolean[] {
  return rows.map((row, index) => {
    const retried = rows[index + 1];
    return (
      row.status === 'failed' &&
      row.failureCode === 'credential_cooldown' &&
      retried !== undefined &&
      retried.status === 'failed' &&
      retried.agentId === row.agentId &&
      retried.apiErrorStatus === 429
    );
  });
}

/**
 * Count the streak of consecutive short-lived failures ending at `rows[0]`
 * (the run that just failed) and decide whether one more auto-retry fits the
 * budget. The walk stops — resetting the budget — at the first row that is
 * not a failure of the same agent (human cancel, a settled run, or a
 * reassignment boundary all count as intervention/progress), or whose
 * attempt executed ≥ the progress threshold. A free credential rotation
 * ({@link freeCredentialRotations}) or cooldown wait
 * ({@link freeCooldownWaits}) is skipped — neither counted nor ending the
 * streak — and, when it is the run that just failed, is retried whatever
 * the streak behind it: the broker cut or held the turn, not a crash loop.
 */
export function resolveAutoRetryBudget(
  rows: readonly AutoRetryRunFacts[],
): AutoRetryBudget {
  const agentId = rows[0]?.agentId;
  const rotations = freeCredentialRotations(rows);
  const waits = freeCooldownWaits(rows);
  const free = rotations.map((rotation, index) => rotation || waits[index]);
  let shortStreak = 0;
  for (const [index, row] of rows.entries()) {
    if (row.agentId !== agentId) break;
    if (row.status !== 'failed') break;
    if (executedMs(row) >= AUTO_RETRY_PROGRESS_MS) break;
    if (free[index]) continue;
    shortStreak += 1;
    // One past the budget already decides — no need to walk the whole tail.
    if (shortStreak > AUTO_RETRY_MAX_ATTEMPTS) break;
  }
  return {
    retry: free[0] || shortStreak <= AUTO_RETRY_MAX_ATTEMPTS,
    // A free wait's run retried a counted 429, so it shows the count that
    // 429 reached, as an ordinary retry would.
    attempt: rotations[0]
      ? freeRotationAttempt(rows[0])
      : Math.min(Math.max(shortStreak, 1), AUTO_RETRY_MAX_ATTEMPTS),
  };
}

/** The attempt a free rotation's retry shows. It spends nothing, so it shows
 * what the cut run showed — no attempt (0) after a run nothing retried,
 * which is no "1 of 3" — unless the cut run worked past the progress
 * threshold: that refreshed the budget, so it shows none of it either (the
 * automation lane's `planWorkflowAgentRetry` stamps the same), and the next
 * counted failure is the first attempt of the fresh budget. */
function freeRotationAttempt(cut: AutoRetryRunFacts | undefined): number {
  if (cut === undefined || executedMs(cut) >= AUTO_RETRY_PROGRESS_MS) return 0;
  return cut.autoRetryAttempt ?? 0;
}
