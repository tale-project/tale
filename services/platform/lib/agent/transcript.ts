/**
 * A native run's transcript, in the shape a run's log renders.
 *
 * A native run writes what it said and did as the parts of a chat reply — text,
 * tool calls and their results — while the run card reads the entries of a
 * harness's live transcript (`lib/harnesses/timeline.ts`): text blocks, and
 * tool entries that move from their input to their output. One mapping
 * carries the first into the second, so the same card shows both engines'
 * runs and neither has a log of its own.
 *
 * Layer A: pure data.
 */

import type { MessagePart } from '../chat/types';
import type { TimelinePart } from '../harnesses/timeline';

/** The statuses a work tool answers a call it could not carry out with
 * (`agent_tools/scope.ts`). A result carrying one is an error entry. */
const FAILURE_STATUSES: ReadonlySet<string> = new Set([
  'invalid_args',
  'not_found',
  'unavailable',
  'busy',
  'error',
]);

/** The error a tool result states, or `undefined` when it is not one. */
function resultError(output: unknown): string | undefined {
  if (output === null || typeof output !== 'object') return undefined;
  const { status, message } = output as { status?: unknown; message?: unknown };
  if (typeof status !== 'string' || !FAILURE_STATUSES.has(status)) {
    return undefined;
  }
  return typeof message === 'string' && message !== ''
    ? message
    : `The call failed (${status}).`;
}

/**
 * The run's log from a reply's parts, in the order they were authored:
 * text as text blocks, each tool call as one entry that carries its result
 * once it has one. Reasoning and the file parts are not entries: the files
 * are the run's deliverables, shown beside the log.
 */
export function messagePartsToTimeline(
  parts: readonly MessagePart[],
): TimelinePart[] {
  const timeline: TimelinePart[] = [];
  const entryOfCall = new Map<string, number>();
  for (const part of parts) {
    if (part.type === 'text') {
      if (part.text.trim() !== '')
        timeline.push({ type: 'text', text: part.text });
    } else if (part.type === 'tool-call') {
      entryOfCall.set(part.callId, timeline.length);
      timeline.push({
        type: `tool-${part.capabilityId}`,
        state: 'input-available',
        toolCallId: part.callId,
        ...(part.input !== undefined ? { input: part.input } : {}),
      });
    } else if (part.type === 'tool-result') {
      const at = entryOfCall.get(part.callId);
      const call = at === undefined ? undefined : timeline[at];
      if (at === undefined || call === undefined) continue;
      const error = resultError(part.output);
      timeline[at] =
        error !== undefined
          ? { ...call, state: 'output-error', errorText: error }
          : { ...call, state: 'output-available', output: part.output };
    }
  }
  return timeline;
}
