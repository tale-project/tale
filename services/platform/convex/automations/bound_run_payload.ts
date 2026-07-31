/**
 * Bound the DESCRIPTIVE parts of an `automationRuns` row before they are
 * stored.
 *
 * Why: a run document carries no size limit of any kind, and Convex refuses a
 * document over ~1 MiB — so an oversized run does not merely bloat the table,
 * its write FAILS and the run dies (possibly without even recording why). On
 * top of that the row is patched once per completed node and Convex retains
 * every revision, so each stored byte is paid for many times over. The retired
 * `wfExecutions` had an escape valve for this (payloads over 400 KB were
 * offloaded to file storage); the rewrite did not carry one over.
 *
 * **What is bounded, and what deliberately is not.** Only fields nothing reads
 * back are safe to shorten:
 *
 *  - `trace` / `checkpoint.trace` — pure diagnostics. Bounded.
 *  - `detail` — the operator-facing failure reason. Capped.
 *  - `checkpoint.output` — **NEVER**. `outputsFrom()` builds the executor's
 *    scope from it, so a later node reading `{{ nodes.x.output }}` would see a
 *    truncation marker instead of its data: that changes execution, not the log.
 *  - the run's `output` — **NEVER**. Returned to API callers.
 *  - `effects` — **NEVER**. The audit trail of real side effects (message sent,
 *    record written, model called); truncating it weakens auditability.
 *
 * This is why the change bounds the run log rather than the run: the functional
 * payload still needs the storage-offload valve the old engine had, which is a
 * larger change than this one.
 *
 * **Bound exactly once, at first write.** {@link boundJson} is deliberately not
 * idempotent — a second pass re-cuts its own marker and reports a smaller loss
 * than really occurred. So bound a value as it first enters the row and never
 * re-bound one read back out: `recordCheckpoint` bounds only the incoming
 * entry, never the already-stored `checkpoints.nodes` it merges into.
 *
 * No governance surface: nothing here deletes a row or drops a side effect, so
 * it needs no retention policy, legal-hold check, or operator opt-in — unlike
 * the retention sweep, which is off by default and therefore cannot be what
 * keeps a default install bounded.
 */

import type { NodeTrace } from '../../lib/engine/core/types';
import { boundJson } from '../../lib/shared/utils/bound-json';
import type { NodeCheckpoint } from './checkpoints';

/**
 * Shape limits for a trace entry's `input`/`output`. Generous next to the chat
 * tool loop's 400 characters: a person debugging a failed run needs the real
 * value and the real stack, not the gist.
 */
const TRACE_LIMITS = {
  maxString: 4096,
  maxItems: 50,
  maxDepth: 10,
} as const;

/**
 * Hard ceiling per trace field AFTER shape bounding. Shape limits alone cannot
 * bound a total (fifty 4 KB strings is still 200 KB), so anything past this is
 * replaced wholesale by {@link truncatedMarker} — that is what makes the bound a
 * guarantee rather than a tendency.
 */
export const MAX_TRACE_FIELD_CHARS = 32 * 1024;

/** Characters of `detail` kept, marker included. */
export const MAX_RUN_DETAIL_CHARS = 4096;

/** Stand-in for a value too large to keep, naming what was dropped. */
function truncatedMarker(chars: number): Record<string, unknown> {
  return {
    __truncated: true,
    chars,
    note: 'value exceeded the run-trace ceiling and was not stored',
  };
}

/** Shape-bound a trace field, then enforce the hard ceiling. */
function boundTraceField(value: unknown): unknown {
  if (value === undefined) return undefined;
  const shaped = boundJson(value, TRACE_LIMITS);
  const chars = JSON.stringify(shaped)?.length ?? 0;
  return chars <= MAX_TRACE_FIELD_CHARS ? shaped : truncatedMarker(chars);
}

/**
 * Cap `detail` to {@link MAX_RUN_DETAIL_CHARS} **including** the marker, so the
 * bound holds and re-capping an already-capped value is a no-op. The engine
 * interpolates whole resolved inputs into some error messages
 * (`execute/index.ts` :357, :95), which is how a 66 KB failure reason happens.
 */
export function truncateRunDetail(detail: string): string;
export function truncateRunDetail(detail: undefined): undefined;
export function truncateRunDetail(
  detail: string | undefined,
): string | undefined;
export function truncateRunDetail(
  detail: string | undefined,
): string | undefined {
  if (detail === undefined) return undefined;
  if (detail.length <= MAX_RUN_DETAIL_CHARS) return detail;
  // The marker names only the original length, so its width does not depend on
  // how much is kept (which would be circular).
  const marker = `\n… [truncated from ${detail.length} characters]`;
  return `${detail.slice(0, MAX_RUN_DETAIL_CHARS - marker.length)}${marker}`;
}

/** Bound one trace entry's descriptive fields, leaving its identity intact. */
export function boundNodeTrace(entry: NodeTrace): NodeTrace {
  const bounded: NodeTrace = { ...entry };
  if (entry.input !== undefined) bounded.input = boundTraceField(entry.input);
  if (entry.output !== undefined)
    bounded.output = boundTraceField(entry.output);
  if (entry.error !== undefined) bounded.error = truncateRunDetail(entry.error);
  return bounded;
}

/** Bound a whole run trace, in place-order. */
export function boundRunTrace(trace: readonly NodeTrace[]): NodeTrace[] {
  return trace.map(boundNodeTrace);
}

/**
 * Bound a checkpoint's `trace` ONLY. `output` and `effects` are passed through
 * untouched — see the header: one feeds the executor's scope, the other is the
 * audit trail.
 */
export function boundCheckpointTrace(
  checkpoint: NodeCheckpoint,
): NodeCheckpoint {
  return { ...checkpoint, trace: boundNodeTrace(checkpoint.trace) };
}
