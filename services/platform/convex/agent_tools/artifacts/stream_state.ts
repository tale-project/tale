/**
 * Per-tool-call streaming state for the artifact tools.
 *
 * Both `artifact_create` and `artifact_edit` use the AI SDK / @convex-dev
 * /agent createTool hooks (`onInputStart`, `onInputDelta`, `execute`).
 * These run sequentially within a single agent action invocation, in the
 * same Node process, so a module-level Map keyed by `toolCallId` is a
 * safe place to thread state between hooks.
 *
 * Each tool's `execute` clears its entry in a finally block. The Convex
 * `cleanupStaleStreams` janitor catches the rest if the action crashes.
 */
import type { Id } from '../../_generated/dataModel';

export interface ArtifactStreamState {
  toolCallId: string;
  toolName: 'artifact_create' | 'artifact_edit';
  accumulator: string;
  artifactId?: Id<'artifacts'>;
  // Last byte length of the parsed `content` value flushed to the row.
  // Used to throttle DB writes during create / rewrite streaming.
  lastFlushedContentLength: number;
  lastFlushAt: number;
  // Set once the parser has seen enough JSON to know the streaming mode
  // (only relevant for artifact_edit which carries `mode` in its input).
  resolvedMode?: 'create' | 'rewrite' | 'patch';
  // True once we have either inserted the placeholder (create) or marked
  // the existing row (edit). Avoids double-init on rapid deltas.
  rowInitialized: boolean;
  // Last title / language values written to the row so we don't issue a
  // mutation on every delta when nothing changed.
  lastFlushedTitle?: string;
  lastFlushedLanguage?: string;
}

const STATE = new Map<string, ArtifactStreamState>();

export function initState(
  toolCallId: string,
  toolName: ArtifactStreamState['toolName'],
): ArtifactStreamState {
  const next: ArtifactStreamState = {
    toolCallId,
    toolName,
    accumulator: '',
    lastFlushedContentLength: 0,
    lastFlushAt: 0,
    rowInitialized: false,
  };
  STATE.set(toolCallId, next);
  return next;
}

export function getState(toolCallId: string): ArtifactStreamState | undefined {
  return STATE.get(toolCallId);
}

export function clearState(toolCallId: string): void {
  STATE.delete(toolCallId);
}

/** Minimum elapsed time before another DB write during streaming. */
export const STREAM_FLUSH_INTERVAL_MS = 250;

/** Minimum content delta (bytes) before a non-time-based flush. */
export const STREAM_FLUSH_DELTA_BYTES = 400;

export function shouldFlush(
  state: ArtifactStreamState,
  nextContentLength: number,
): boolean {
  const now = Date.now();
  const grew = nextContentLength - state.lastFlushedContentLength;
  if (grew <= 0) return false;
  if (grew >= STREAM_FLUSH_DELTA_BYTES) return true;
  return now - state.lastFlushAt >= STREAM_FLUSH_INTERVAL_MS;
}

export function markFlushed(
  state: ArtifactStreamState,
  contentLength: number,
): void {
  state.lastFlushedContentLength = contentLength;
  state.lastFlushAt = Date.now();
}
