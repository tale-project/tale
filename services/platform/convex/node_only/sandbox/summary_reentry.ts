/**
 * Pure decision for the one-shot "write your summary.md" re-entry the sandbox
 * step does before teardown (see workflow_sandbox_exec). Isolated here so the
 * gating logic is unit-testable without importing the node-only run module.
 */

/** Corrective prompt: a clean run that skipped the mandated handoff writes it. */
export const SUMMARY_REENTRY_PROMPT = [
  'You finished WITHOUT writing the mandated handoff file at /agent/output/summary.md.',
  'Write it now — the ABSOLUTE path /agent/output/summary.md — covering (1) what you',
  'did, (2) every file you produced (path + purpose), (3) the final result/state,',
  'and (4) what is next. Then stop. Do nothing else.',
].join('\n');

// The corrective re-entry gets a tight budget — it is one short write, not more
// work — so it never extends a run meaningfully or loops.
export const SUMMARY_REENTRY_WINDOW_MS = 90 * 1000;
export const SUMMARY_REENTRY_MAX_TURNS = 6;

/**
 * Whether to fire the one-shot "write your summary.md" re-entry before teardown.
 * Only for a run that COMPLETED cleanly yet produced no real summary, while the
 * session is still resumable, there is budget left, and a managed run still has
 * a gateway token (BYO needs none). Never loops — the caller guards it to a
 * single attempt.
 *
 * Skips outright when the run carried a terminal API error (`isError`): the
 * "completed" status is the laundered-401 lie, so re-entering would just re-hit
 * the dead token and waste the budget — that case is routed to the retryable
 * execution-error throw instead (see `isRetryableExecutionError`).
 */
export function shouldForceSummaryReentry(input: {
  terminalStatus: string;
  summaryWritten: boolean;
  agentSessionId: string | undefined;
  now: number;
  hardDeadlineMs: number;
  byo: boolean;
  gatewayToken: string | null;
  /** The terminal result's `is_error` flag — a laundered API error masquerading
   * as `completed`. A doomed re-entry against the same credential is skipped. */
  isError?: boolean;
}): boolean {
  if (input.isError === true) return false;
  return (
    input.terminalStatus === 'completed' &&
    !input.summaryWritten &&
    input.agentSessionId !== undefined &&
    input.now < input.hardDeadlineMs &&
    (input.byo || input.gatewayToken !== null)
  );
}
