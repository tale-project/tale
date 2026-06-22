/**
 * Pure detection for a surfaced terminal API/stream failure in a coding agent's
 * stream-json output — the input to the stalled-turn watchdog in run_agent.ts.
 *
 * Isolated here (no 'use node', no convex-server imports) so the heuristic is
 * unit-testable without importing the node-only run module — mirrors
 * `agent_run_outcome.ts`.
 */

import type { AgentEvent } from '../../../lib/agent-adapters/events';

/**
 * Does this stream text look like the CLI surfacing a terminal API/stream failure
 * (a gateway's stream-idle abort, a connection drop, an upstream 5xx) rather than
 * the agent merely narrating about one? Matched broadly because the CLI's
 * stream-json shape for a mid-stream error is not fixed. The watchdog that consumes
 * this ALSO requires no result + nothing in flight + sustained silence, so a stray
 * match in narration cannot trip it while the turn is healthy.
 */
export function looksLikeApiError(text: string): boolean {
  return /\bAPI Error\b|Error reading stream|stream idle timeout/i.test(text);
}

/**
 * Candidate text to scan for a surfaced API/stream failure: main-agent text (a
 * sub-agent's transient error isn't the main turn dying) plus unmapped `raw`
 * events EXCEPT `api_retry` — that is the SDK's own recoverable pre-response retry
 * (it auto-retries those), so it must NOT arm the stalled-turn watchdog.
 */
export function errorTextFromEvent(e: AgentEvent): string | undefined {
  if ((e.type === 'text' || e.type === 'text-delta') && !e.parentToolUseId) {
    return e.text;
  }
  if (e.type === 'raw') {
    const p = e.payload;
    if (typeof p === 'object' && p !== null && 'subtype' in p) {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      const subtype = (p as { subtype?: unknown }).subtype;
      if (subtype === 'api_retry') return undefined;
    }
    try {
      return JSON.stringify(e.payload);
    } catch {
      return undefined;
    }
  }
  return undefined;
}
