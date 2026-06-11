/**
 * Debug-mode pause gate shared between the workflow engine (awaitEvent side),
 * the resume mutation (sendEvent side) and the UI (waitingFor detection).
 *
 * A debug pause is encoded on the execution row as
 * `waitingFor = 'debug:<pauseIndex>:<stepSlug>'` while `status` stays
 * 'running' — the same convention human-input approvals use, so the
 * stuck-execution watchdog, status filters and metrics need no changes. The
 * matching workflow event is named `debug:<pauseIndex>`; indexing each pause
 * prevents a double-clicked "Step" from queueing a second event that would
 * silently skip the next pause.
 */

import { v } from 'convex/values';

export const DEBUG_WAITING_PREFIX = 'debug:';

export type DebugResumeAction = 'step' | 'continue';

export const debugResumeEventValidator = v.object({
  action: v.union(v.literal('step'), v.literal('continue')),
});

export function debugEventName(pauseIndex: number): string {
  return `${DEBUG_WAITING_PREFIX}${pauseIndex}`;
}

export function buildDebugWaitingFor(
  pauseIndex: number,
  stepSlug: string,
): string {
  return `${DEBUG_WAITING_PREFIX}${pauseIndex}:${stepSlug}`;
}

export interface DebugPause {
  pauseIndex: number;
  stepSlug: string;
}

/**
 * Parse a `waitingFor` value into its debug-pause parts, or `null` when the
 * execution is not paused in debug mode (no value, approval id, malformed).
 */
export function parseDebugWaitingFor(
  waitingFor: string | undefined,
): DebugPause | null {
  if (!waitingFor || !waitingFor.startsWith(DEBUG_WAITING_PREFIX)) return null;
  const rest = waitingFor.slice(DEBUG_WAITING_PREFIX.length);
  const separator = rest.indexOf(':');
  if (separator <= 0) return null;
  const pauseIndex = Number(rest.slice(0, separator));
  const stepSlug = rest.slice(separator + 1);
  if (!Number.isInteger(pauseIndex) || pauseIndex < 1 || !stepSlug) return null;
  return { pauseIndex, stepSlug };
}
