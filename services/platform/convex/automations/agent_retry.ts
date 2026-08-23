/**
 * Pure auto-retry gating for the automation `agent` node. Isolated like
 * `tasks/task_auto_retry.ts` so the logic is unit-testable without a
 * database; the orchestration (consume the errored settle → decide → re-kick
 * in place) lives in `stepper.ts` (`stepAgentNode`).
 *
 * Semantics (2026-08-23, parity with the task lane): a failed turn re-kicks
 * immediately — no backoff, the harness already backed off per-request —
 * under a fixed in-node budget. Unlike the task lane there is no run-history
 * walk: the attempt counter lives on the agent cursor and dies with the node
 * execution, so only the progress reset survives from the streak semantics.
 */

import {
  AUTO_RETRY_MAX_ATTEMPTS,
  AUTO_RETRY_PROGRESS_MS,
} from '../tasks/task_auto_retry';

export { AUTO_RETRY_MAX_ATTEMPTS, AUTO_RETRY_PROGRESS_MS };

/** Producer-side failure classification, stamped where each failure is
 * PRODUCED (the `agent_host.ts` settle sites) — never regex-derived from the
 * free-text reason. */
export type WorkflowAgentFailureCode =
  | 'harness_error'
  | 'turn_crashed'
  | 'session_gone'
  | 'start_failed'
  | 'harvest_failed'
  | 'resume_failed'
  | 'deadline'
  | 'ask_expired';

/** Failures where a retry is pure waste: the turn burned its 12h window, or
 * the operator ignored the agent's question for the whole ask TTL — a fresh
 * turn would only ask again. Everything else — provider errors, crashes,
 * vanished sessions, harvest hiccups — retries by DEFAULT, including an
 * absent code, so a future failure producer inherits the retry posture
 * without opting in. */
const NO_RETRY_FAILURE_CODES: ReadonlySet<string> = new Set([
  'deadline',
  'ask_expired',
] satisfies WorkflowAgentFailureCode[]);

export function isWorkflowAgentRetryable(code: string | undefined): boolean {
  return code === undefined || !NO_RETRY_FAILURE_CODES.has(code);
}

/** Execution time of the settled attempt — 0 when it never launched.
 * `launchedAt` is stamped only after the start action's mint succeeds, so a
 * turn that died before actually running reads as ZERO duration, never as
 * progress (the stamp racing the kick-side cursor commit loses the same
 * way, deliberately: a missing stamp must undercount, not reset). */
export function executedMsOf(
  launchedAt: number | undefined,
  now: number,
): number {
  if (launchedAt === undefined) return 0;
  return Math.max(0, now - launchedAt);
}

/** The attempt number the re-kick parks under: an attempt that executed past
 * the progress threshold proved the failure is not a rapid crash loop, so
 * the budget refreshes instead of counting toward exhaustion. */
export function nextAttempt(prev: number, executedMs: number): number {
  return executedMs >= AUTO_RETRY_PROGRESS_MS ? 1 : prev + 1;
}

/** The burned-hash list is bounded because progress resets can stretch one
 * node execution past the nominal 4 attempts; the exclusion is soft (the
 * credential resolve falls back to the full pool when it would empty it),
 * so dropping the oldest entries only widens rotation, never starves it. */
export const MAX_BURNED_BROKER_HASHES = 8;

/** Fold the settled attempt's broker-token hash into the carried exclusion
 * list: deduped, most recent last, oldest dropped past the cap. */
export function mergeBurnedHashes(
  prev: readonly string[] | undefined,
  current: string | undefined,
): string[] {
  const merged: string[] = [];
  for (const hash of [
    ...(prev ?? []),
    ...(current === undefined ? [] : [current]),
  ]) {
    const existing = merged.indexOf(hash);
    if (existing !== -1) merged.splice(existing, 1);
    merged.push(hash);
  }
  return merged.slice(-MAX_BURNED_BROKER_HASHES);
}
