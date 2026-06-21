/**
 * Pure decision for whether a finished sandbox AGENT run failed at the
 * infrastructure/execution layer (auth/gateway/connection/crash — the agent
 * never produced a legible outcome) vs. produced a genuine agent verdict.
 *
 * Isolated here so the gating logic is unit-testable without importing the
 * node-only run module (mirrors `summary_reentry.ts`).
 *
 * The sandbox-step caller (`runSandboxAgent`) THROWS on a retryable execution
 * error so the Convex workflow step retries (fresh session + re-minted VK) and,
 * if still failing, fails the workflow at that step — instead of laundering the
 * failure into a synthesized "success" summary that flows to the next step.
 *
 * Why key on `agentResultStatus` and NOT the process exit code: Claude Code can
 * exit 0 while reporting an `error` result (e.g. a 401 auth failure streams an
 * `is_error` result event, then the process exits cleanly). So `terminalStatus`
 * / `exitCode` is `completed`/`0` for that case and useless — only the agent's
 * self-reported verdict distinguishes a mechanical blow-up from a clean finish.
 */

import type { AgentResultStatus } from '../../../lib/agent-adapters/events';

/**
 * True when the run failed mechanically AND left no handoff — i.e. it never got
 * far enough to produce a legible outcome, so it should be retried/terminated
 * rather than treated as an agent verdict the workflow author branches on.
 *
 * Returns false for every genuine outcome/budget limit, which keep flowing
 * downstream as `{ok:false}`:
 *  - any run that wrote `output/summary.md` (it produced a real handoff);
 *  - `completed` (even with an unfavorable verdict in the summary);
 *  - `max-turns` / `cancelled` / a wall-clock `timeout` (budget/user outcomes —
 *    retrying just burns the same budget or re-cancels).
 */
export function isRetryableExecutionError(input: {
  /** The agent's self-reported terminal verdict (`undefined` ⇒ no result event
   * was ever seen — the run died before reporting). */
  agentResultStatus: AgentResultStatus | undefined;
  /** The process-exit verdict: 'completed' | 'failed' | 'cancelled' | 'timeout'. */
  terminalStatus: string;
  /** Whether the agent wrote the mandated `output/summary.md` handoff. */
  summaryWritten: boolean;
}): boolean {
  // A real handoff ⇒ the agent ran and produced an outcome; never retry it.
  if (input.summaryWritten) return false;
  // The agent itself reported a mechanical error (error_during_execution:
  // 401/403/429/5xx, connection failure, internal crash).
  if (input.agentResultStatus === 'error') return true;
  // No result event at all + a non-zero process exit ⇒ the run died before it
  // could report (e.g. the CLI couldn't start / authenticate pre-loop).
  if (
    input.agentResultStatus === undefined &&
    input.terminalStatus === 'failed'
  ) {
    return true;
  }
  return false;
}
