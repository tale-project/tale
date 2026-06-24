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
 *
 * The `isError` gate is DELIBERATELY wider than `isRotatableApiError`: Claude
 * Code laundered a turn-terminating API error (401/403/429/5xx, a dropped
 * connection, or a malformed 200) into `subtype:'success'` → `agentResultStatus`
 * is the misleading `'completed'`, and ONLY `result.isError` exposes it. Such a
 * run with no handoff is retryable by a FRESH step (the work was never done)
 * even when it is not token-rotatable — whereas `isRotatableApiError` stays
 * narrow on `{401,403,429,529}` because only those warrant a credential swap.
 */
export function isRetryableExecutionError(input: {
  /** The agent's self-reported terminal verdict (`undefined` ⇒ no result event
   * was ever seen — the run died before reporting). */
  agentResultStatus: AgentResultStatus | undefined;
  /** The process-exit verdict: 'completed' | 'failed' | 'cancelled' | 'timeout'. */
  terminalStatus: string;
  /** Whether the agent wrote the mandated `output/summary.md` handoff. */
  summaryWritten: boolean;
  /** The terminal result's `is_error` flag. Claude Code leaves `subtype:'success'`
   * on an errored result, so this is the only honest signal that a "completed"
   * turn actually blew up at the API/transport layer (the laundered-401 bug). */
  isError?: boolean;
}): boolean {
  // A real handoff ⇒ the agent ran and produced an outcome; never retry it.
  if (input.summaryWritten) return false;
  // Budget/user outcomes are NOT execution errors — they beat the `isError`
  // gate below. Claude Code stamps `is_error:true` on an `error_max_turns`
  // result too, but a max-turns run hit its budget; retrying just burns the
  // same budget. A user `cancelled` must never resurrect itself either. (A
  // wall-clock `timeout` arrives via terminalStatus on an exhausted `running`
  // handoff — no terminal result event, so it carries no `isError` to gate on.)
  if (
    input.agentResultStatus === 'max-turns' ||
    input.agentResultStatus === 'cancelled'
  ) {
    return false;
  }
  // A mechanical API/transport error the agent reported on its terminal result
  // but with NO handoff — the laundered-401 case (see the header note on the
  // deliberate two-gate width difference vs `isRotatableApiError`).
  if (input.isError === true) return true;
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

/**
 * HTTP statuses that mean "this credential is healthy but throttled, or
 * forbidden/expired/revoked" — i.e. swapping to a DIFFERENT token may succeed.
 * 429 (rate limit) + 529 (overloaded) + 401/403 (auth: expired/revoked, or this
 * specific key forbidden — a sibling token from the pool may not share that
 * restriction). Must stay in lockstep with `AUTH_ABORT_STATUSES` (run_agent.ts):
 * every status we SIGTERM early "so a rotation can swap credentials" has to be
 * rotatable here, else the early-abort just degrades to a full-step retry.
 * 502/503/504 are upstream blips that rotating tokens won't fix, so they are
 * intentionally excluded. Local copy (not imported from `providers/errors.ts`)
 * to keep this sandbox classifier decoupled from the gateway-provider module.
 */
const ROTATABLE_API_STATUS: ReadonlySet<number> = new Set([401, 403, 429, 529]);

/**
 * True when a finished turn carries a token-rotation-worthy API error — the
 * gate for the token-source failover loop. Reads the terminal result's
 * `is_error` + `api_error_status` (Claude Code leaves `subtype:'success'` on an
 * errored result, so the status enum can't be trusted here), OR an early
 * `auth-abort` raised when the live `api_retry` stream showed a rotatable code
 * before the internal retry-storm finished.
 */
export function isRotatableApiError(input: {
  isError: boolean | undefined;
  apiErrorStatus: number | undefined;
  terminationReason?: string;
  /** The status captured by the early api_retry abort, when terminationReason is 'auth-abort'. */
  authAbortStatus?: number;
}): boolean {
  if (
    input.terminationReason === 'auth-abort' &&
    input.authAbortStatus !== undefined &&
    ROTATABLE_API_STATUS.has(input.authAbortStatus)
  ) {
    return true;
  }
  return (
    input.isError === true &&
    input.apiErrorStatus !== undefined &&
    ROTATABLE_API_STATUS.has(input.apiErrorStatus)
  );
}
