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
  // For artifact_create only — captures the outcome of `beginCreateStream`
  // so `execute()` knows whether to finalize the placeholder, hand off to
  // the existing `createArtifact` mutation (collision), or return a
  // type-mismatch error without further DB writes.
  createOutcome?: 'placeholder' | 'collision' | 'type_mismatch';
  typeMismatchInfo?: {
    existingArtifactId: Id<'artifacts'>;
    existingType: string;
    message: string;
  };
  // Last title / language values written to the row so we don't issue a
  // mutation on every delta when nothing changed.
  lastFlushedTitle?: string;
  lastFlushedLanguage?: string;
  // Stable signature of the last `streamingPatches` flushed (for patch
  // mode). JSON-encoded so equal pairs always compare equal cheaply.
  lastFlushedPatchesKey?: string;
  lastPatchesFlushAt: number;
  // Byte length of the existing artifact content at edit time. Set during
  // artifact_edit preflight; used to slow down the patch-stream flush rate
  // for large sources, where each tick forces the client to re-render a
  // diff overlay that spans tens of KB. Unset for artifact_create.
  baseContentLength?: number;
  // Length of the accumulator at the last `parsePartialJson` call, plus
  // the wall-clock timestamp. Used by `shouldParse` to amortise the
  // O(n)-per-delta parse cost on large accumulators — without this gate
  // a fast stream re-parses several KB on every ~50-byte delta and the
  // agent action's event loop stalls, making the flush throttle coarser
  // than its configured interval.
  lastParsedLength: number;
  lastParsedAt: number;
  // Coalesced fire-and-forget flush state. Streaming flushes (the
  // `updateStreamingContent` mutation) are NOT awaited inside
  // `onInputDelta` because a 30 KB+ payload roundtrip blocks the AI SDK's
  // event loop, builds buffer pressure, and produces a "wait several
  // seconds, then dump a big chunk" cadence on screen. Instead we keep
  // at most one mutation in flight; subsequent flush requests overwrite
  // `pendingFlush` with the latest payload, and the in-flight callback's
  // `.finally` drains it. Final consistency is guaranteed by the canonical
  // settle in `execute()`, which clears streaming flags atomically.
  flushInFlight: boolean;
  pendingFlush?: () => Promise<unknown>;
}

export interface StreamingPatchPair {
  readonly search: string;
  readonly replace: string;
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
    lastPatchesFlushAt: 0,
    lastParsedLength: 0,
    lastParsedAt: 0,
    rowInitialized: false,
    flushInFlight: false,
  };
  STATE.set(toolCallId, next);
  return next;
}

/**
 * Hand a streaming-flush mutation off to the background. At most one flush
 * is in flight at a time; if another request arrives while one is running,
 * the previous queued payload is replaced (we always want the latest).
 * The in-flight callback's `.finally` drains any payload that was queued
 * during its run.
 *
 * `runMutation` is a closure provided by the caller — keeping the Convex
 * api reference out of this module so this file stays import-light.
 */
export function scheduleStreamingFlush(
  state: ArtifactStreamState,
  runMutation: () => Promise<unknown>,
): void {
  state.pendingFlush = runMutation;
  if (state.flushInFlight) return;
  drainFlush(state);
}

function drainFlush(state: ArtifactStreamState): void {
  if (state.flushInFlight || !state.pendingFlush) return;
  const next = state.pendingFlush;
  state.pendingFlush = undefined;
  state.flushInFlight = true;
  void next()
    .catch((err) => {
      console.error('[artifact streaming] flush failed:', err);
    })
    .finally(() => {
      state.flushInFlight = false;
      drainFlush(state);
    });
}

export function getState(toolCallId: string): ArtifactStreamState | undefined {
  return STATE.get(toolCallId);
}

export function clearState(toolCallId: string): void {
  STATE.delete(toolCallId);
}

/** Minimum elapsed time before another DB write during streaming. */
export const STREAM_FLUSH_INTERVAL_MS = 100;

/** Minimum content delta (bytes) before a non-time-based flush. */
export const STREAM_FLUSH_DELTA_BYTES = 200;

/** Minimum accumulator growth (bytes) before re-parsing the partial JSON
 * after the row is initialised. Below this we skip the parse to avoid
 * O(n²) work over the stream lifetime. */
export const STREAM_PARSE_DELTA_BYTES = 50;

/** Minimum elapsed time between `parsePartialJson` calls after the row
 * is initialised. Pairs with `STREAM_PARSE_DELTA_BYTES` so we re-parse
 * either when enough new bytes have arrived or when enough time has
 * passed (whichever comes first), but not on every delta. */
export const STREAM_PARSE_INTERVAL_MS = 40;

/** Above this byte threshold, every DB-write tick triggers a client-side
 * O(n) render pass (full-document diff overlay, full-string text node
 * rebuild). Stretch the flush window for large content so the client gets
 * a smaller number of bigger updates instead of a flood of small ones. */
const STREAM_LARGE_CONTENT_BYTES = 8192;

/** Multiplier applied to the flush interval once content crosses the
 * "large" threshold. 2.5× was chosen empirically to keep 30 KB+ artifacts
 * smooth on mid-range hardware while still feeling responsive (~250 ms
 * inter-tick latency at the cap, which is well below the perception of
 * "stuck"). */
const STREAM_LARGE_CONTENT_FLUSH_MULTIPLIER = 2.5;

function flushIntervalFor(sizeHint: number): number {
  if (sizeHint > STREAM_LARGE_CONTENT_BYTES) {
    return Math.round(
      STREAM_FLUSH_INTERVAL_MS * STREAM_LARGE_CONTENT_FLUSH_MULTIPLIER,
    );
  }
  return STREAM_FLUSH_INTERVAL_MS;
}

/**
 * Adaptive parse-gate. `parsePartialJson` is `JSON.parse(fixJson(text))` —
 * O(N) per call where N is the accumulator size. Calling it on every
 * 50-byte delta makes the streaming hot path O(N²) over the lifetime of the
 * stream, so for a 100 KB artifact the action ends up CPU-bound on
 * re-parsing and the AI SDK queues incoming deltas, which the user
 * perceives as "wait several seconds, then a big chunk lands" jank.
 *
 * Scaling both the byte-delta requirement AND the time interval with
 * accumulator size keeps total parse work linear in stream size. The cost:
 * at very large content the UI updates 2-4× per second instead of 25×, but
 * those updates are smooth and predictable rather than bursty.
 *
 * Returned tuple: `[byteDelta, minIntervalMs]`. shouldParse fires only if
 * BOTH thresholds are met, same as before.
 */
function parseGateFor(accumulatorLength: number): [number, number] {
  if (accumulatorLength > 100_000) return [5_000, 500];
  if (accumulatorLength > 30_000) return [1_000, 250];
  if (accumulatorLength > STREAM_LARGE_CONTENT_BYTES) return [200, 100];
  return [STREAM_PARSE_DELTA_BYTES, STREAM_PARSE_INTERVAL_MS];
}

export function shouldFlush(
  state: ArtifactStreamState,
  nextContentLength: number,
): boolean {
  const now = Date.now();
  const grew = nextContentLength - state.lastFlushedContentLength;
  if (grew <= 0) return false;
  if (grew >= STREAM_FLUSH_DELTA_BYTES) return true;
  return now - state.lastFlushAt >= flushIntervalFor(nextContentLength);
}

export function markFlushed(
  state: ArtifactStreamState,
  contentLength: number,
): void {
  state.lastFlushedContentLength = contentLength;
  state.lastFlushAt = Date.now();
}

/** Decide whether to call `parsePartialJson(state.accumulator)` for this
 * delta. Until the placeholder row has been inserted we always parse —
 * field order from the model isn't guaranteed and we cannot delay seeing
 * `title`/`mode`/`type`. Once initialised, the byte-delta and time
 * interval thresholds both scale with accumulator size (see
 * `parseGateFor`) so a 100 KB+ stream doesn't pay O(N²) parse cost. */
export function shouldParse(
  state: ArtifactStreamState,
  accumulatorLength: number,
): boolean {
  if (!state.rowInitialized) return true;
  const grew = accumulatorLength - state.lastParsedLength;
  const [byteDelta, minIntervalMs] = parseGateFor(accumulatorLength);
  if (grew < byteDelta) return false;
  return Date.now() - state.lastParsedAt >= minIntervalMs;
}

export function markParsed(
  state: ArtifactStreamState,
  accumulatorLength: number,
): void {
  state.lastParsedLength = accumulatorLength;
  state.lastParsedAt = Date.now();
}

/** Stable change-detection signature for a streaming patches list. JSON
 * encoding sidesteps any in-content separator hazards (control characters,
 * multi-line search/replace blocks, etc.) without us having to reason about
 * which byte is safe. Throwaway string — only `===` comparison, never
 * persisted. */
export function streamingPatchesKey(
  patches: readonly StreamingPatchPair[],
): string {
  return JSON.stringify(patches);
}

/** Flush only when the patches list has changed AND the throttle window has
 * elapsed. The list grows / mutates slowly during a patch stream (one
 * patch entry per ~hundreds of ms), so we don't need a byte-delta gate.
 * Throttle scales with the underlying source size: each flush forces the
 * client to recompute a diff overlay that spans the whole base content,
 * so a 30 KB source benefits from a slower tick rate. */
export function shouldFlushStreamingPatches(
  state: ArtifactStreamState,
  patches: readonly StreamingPatchPair[],
): boolean {
  const key = streamingPatchesKey(patches);
  if (state.lastFlushedPatchesKey === key) return false;
  return (
    Date.now() - state.lastPatchesFlushAt >=
    flushIntervalFor(state.baseContentLength ?? 0)
  );
}

export function markFlushedStreamingPatches(
  state: ArtifactStreamState,
  patches: readonly StreamingPatchPair[],
): void {
  state.lastFlushedPatchesKey = streamingPatchesKey(patches);
  state.lastPatchesFlushAt = Date.now();
}
