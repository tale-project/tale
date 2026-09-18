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
  | 'ask_expired'
  /** The org's spend cap refused the start — the cap only moves with the
   * period or an admin, so a retry would only be refused again. */
  | 'budget_exceeded';

/** Failures where a retry is pure waste: the turn burned its 12h window, or
 * the operator ignored the agent's question for the whole ask TTL — a fresh
 * turn would only ask again. Everything else — provider errors, crashes,
 * vanished sessions, harvest hiccups — retries by DEFAULT, including an
 * absent code, so a future failure producer inherits the retry posture
 * without opting in. */
const NO_RETRY_FAILURE_CODES: ReadonlySet<string> = new Set([
  'deadline',
  'ask_expired',
  'budget_exceeded',
] satisfies WorkflowAgentFailureCode[]);

export function isWorkflowAgentRetryable(code: string | undefined): boolean {
  return code === undefined || !NO_RETRY_FAILURE_CODES.has(code);
}

/** What a re-kick continues: the failed turn's conversation, and why it
 * ended — the words the resumed agent is told. */
export interface WorkflowAgentRetryResume {
  agentSessionId: string;
  reason: string;
}

/** Failures that leave no conversation to continue: the sandbox session is
 * gone with its transcript, or the turn never launched at all. Everything
 * else — a provider error mid-answer, a truncated stream, a harness crash —
 * cut a conversation that is still on disk, so the retry picks it up. */
const NO_RESUME_FAILURE_CODES: ReadonlySet<string> = new Set([
  'session_gone',
  'start_failed',
] satisfies WorkflowAgentFailureCode[]);

/**
 * The resume a retry of this settle should carry, or undefined when the
 * re-kick must be a fresh conversation: no handle announced (a harness that
 * died before its init line), or a failure class with nothing to resume.
 */
export function workflowAgentRetryResume(
  settled: { failureCode?: string; agentSessionId?: string },
  reason: string,
): WorkflowAgentRetryResume | undefined {
  if (settled.agentSessionId === undefined) return undefined;
  if (
    settled.failureCode !== undefined &&
    NO_RESUME_FAILURE_CODES.has(settled.failureCode)
  ) {
    return undefined;
  }
  return { agentSessionId: settled.agentSessionId, reason };
}

/** The message a resumed conversation opens with: the cut was the
 * platform's, the work stands, carry on — never a second copy of the node
 * prompt, which the conversation already holds. */
export function retryResumePrompt(reason: string): string {
  return [
    `Your previous turn on this task was cut short by an infrastructure failure, not by anything you did: ${reason}.`,
    '',
    'Continue the task from where you left off. The workspace and /agent/output are exactly as you left them — do not redo work that is already done, and do not ask the operator again what they have already answered.',
  ].join('\n');
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
