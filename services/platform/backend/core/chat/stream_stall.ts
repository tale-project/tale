/**
 * The silence clock for a streaming model round.
 *
 * A model round used to run under ONE fixed wall-clock abort on the fetch —
 * a cap that could not tell a reply still streaming healthily at minute four
 * from a connection that died at minute one, so every long reply (a high
 * reasoning effort, a large output ceiling) was cut mid-sentence at exactly
 * the deadline and surfaced as a generic provider error. This guard measures
 * SILENCE instead: its clock restarts on every byte the provider sends, so a
 * stream that keeps producing is never aborted however long it runs, and only
 * a provider that stops sending for the whole window ends the round. The
 * first byte gets the same allowance — a slow-thinking model is not a hung
 * one.
 */

/** How long the provider may stay silent — measured BETWEEN bytes, never
 * from the request start — before the round is abandoned as stalled. */
export const STREAM_STALL_TIMEOUT_MS = 180_000;

export interface StallGuard {
  /** Aborts once the provider has been silent for the whole window. Attach
   * it to the fetch alongside the turn's own cancel signal. */
  readonly signal: AbortSignal;
  /** True once THIS guard aborted the signal — a stall, as opposed to a user
   * cancel riding the same fetch. */
  readonly stalled: boolean;
  /** Bytes arrived: restart the silence clock. */
  touch(): void;
  /** The round ended (either way): stop the clock so nothing fires late. */
  dispose(): void;
  /** The failure to surface for a stall, in the user's face. "timed out"
   * lands it in the chat-error classifier's transient bucket. */
  error(cause?: unknown): Error;
}

export function stallMessage(timeoutMs: number): string {
  return `The model provider stopped sending data — the reply timed out after ${Math.round(timeoutMs / 1000)} seconds of silence.`;
}

export function createStallGuard(
  timeoutMs: number = STREAM_STALL_TIMEOUT_MS,
): StallGuard {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stalled = false;
  let disposed = false;
  const clear = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const error = (cause?: unknown): Error =>
    new Error(
      stallMessage(timeoutMs),
      cause === undefined ? undefined : { cause },
    );
  const arm = (): void => {
    clear();
    timer = setTimeout(() => {
      timer = undefined;
      stalled = true;
      controller.abort(error());
    }, timeoutMs);
  };
  arm();
  return {
    signal: controller.signal,
    get stalled() {
      return stalled;
    },
    touch() {
      if (!disposed && !stalled) arm();
    },
    dispose() {
      disposed = true;
      clear();
    },
    error,
  };
}
