import type { SSEStreamingApi } from 'hono/streaming';

/**
 * The write side every process-shared SSE hub uses: one ordered write queue
 * per open stream, a ceiling on how far a stream may fall behind, and one
 * heartbeat timer for all of a hub's streams.
 *
 * A hub delivers to thousands of streams from one loop, so it must never
 * `await` a single stream's write: a client that stopped reading (a laptop
 * lid closed mid-stream) holds its write open until its socket times out,
 * and an awaited write would stall delivery to every other stream behind
 * it. Writes are chained per stream instead, and a stream whose backlog
 * grows past `maxPendingWrites` writes or `maxPendingBytes` is aborted — its
 * client reconnects and resumes from its `Last-Event-ID`, which costs one
 * reconnect instead of the process's memory. A caller hands a whole batch
 * (a replay, a page of hints) over as ONE write, so the ceiling counts what
 * a slow client has not taken yet, never the size of one delivery: only a
 * backlog already past the ceiling refuses the next write.
 */

/** Writes a stream may have queued before it is treated as gone. */
const DEFAULT_MAX_PENDING_WRITES = 256;
/** Characters a stream may have queued before it is treated as gone. */
const DEFAULT_MAX_PENDING_BYTES = 1024 * 1024;

export interface FanoutStream {
  /** The underlying Hono SSE stream. */
  readonly stream: SSEStreamingApi;
  /** When the stream was last written to (heartbeats key off this). */
  lastWriteAt: number;
  /** Set once the stream ended; no further write is queued. */
  ended: boolean;
}

export interface StreamWriter {
  /** Queue raw SSE text (already framed, ending in a blank line). */
  write: (text: string) => void;
  /** Resolves once every write queued so far has been handed to the
   * stream — what a terminal event waits for before the response ends. */
  flushed: () => Promise<void>;
  /** Writes queued and not yet handed over. */
  pending: () => number;
}

/** Frame one SSE event. `data` is written as one `data:` line per line. */
export function frameEvent(event: {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
}): string {
  const lines: string[] = [];
  if (event.event !== undefined) lines.push(`event: ${event.event}`);
  for (const line of event.data.split(/\r\n|\r|\n/)) {
    lines.push(`data: ${line}`);
  }
  if (event.id !== undefined) lines.push(`id: ${event.id}`);
  if (event.retry !== undefined) lines.push(`retry: ${event.retry}`);
  return `${lines.join('\n')}\n\n`;
}

/**
 * The per-stream ordered writer. `onOverflow` runs once when the queue
 * passes the ceiling; the caller aborts the stream there.
 */
export function createStreamWriter(
  target: FanoutStream,
  options: {
    maxPendingWrites?: number;
    maxPendingBytes?: number;
    now?: () => number;
    onOverflow: () => void;
  },
): StreamWriter {
  const maxPending = options.maxPendingWrites ?? DEFAULT_MAX_PENDING_WRITES;
  const maxBytes = options.maxPendingBytes ?? DEFAULT_MAX_PENDING_BYTES;
  const now = options.now ?? Date.now;
  let tail: Promise<void> = Promise.resolve();
  let pending = 0;
  let pendingBytes = 0;
  let overflowed = false;
  return {
    write(text) {
      if (target.ended || target.stream.aborted) return;
      // The backlog already queued decides, never the size of the write
      // being added: a big delivery is not a stalled client.
      if (pending > 0 && (pending >= maxPending || pendingBytes > maxBytes)) {
        if (!overflowed) {
          overflowed = true;
          options.onOverflow();
        }
        return;
      }
      pending += 1;
      pendingBytes += text.length;
      target.lastWriteAt = now();
      // The chain never rejects: a failed write is logged and the next one
      // still runs, so one broken write cannot silence the stream for good.
      tail = tail
        .then(() => target.stream.write(text))
        .then(
          () => undefined,
          (error: unknown) => {
            console.warn('[backend] sse write failed:', error);
          },
        )
        .finally(() => {
          pending -= 1;
          pendingBytes -= text.length;
        });
    },
    flushed: () => tail,
    pending: () => pending,
  };
}

/**
 * One timer that heartbeats every idle stream of a hub. A stream that has
 * not been written to for `intervalMs` gets a `heartbeat` event, so an idle
 * lane still hears from the server before a proxy's idle timeout cuts it.
 * The timer runs only while `streams()` is non-empty is the caller's
 * concern: `start`/`stop` are idempotent.
 */
export function createHeartbeat(options: {
  intervalMs: number;
  streams: () => Iterable<{ target: FanoutStream; writer: StreamWriter }>;
  now?: () => number;
}): { start: () => void; stop: () => void } {
  const now = options.now ?? Date.now;
  const frame = frameEvent({ event: 'heartbeat', data: '' });
  // Check several times per interval so a heartbeat lands at most a fraction
  // of an interval late, but never more often than every 5 ms.
  const tickMs = Math.max(
    5,
    Math.min(1_000, Math.floor(options.intervalMs / 3)),
  );
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    start() {
      if (timer !== undefined) return;
      timer = setInterval(() => {
        const at = now();
        for (const { target, writer } of options.streams()) {
          if (target.ended) continue;
          if (at - target.lastWriteAt >= options.intervalMs) {
            writer.write(frame);
          }
        }
      }, tickMs);
    },
    stop() {
      if (timer === undefined) return;
      clearInterval(timer);
      timer = undefined;
    },
  };
}

/**
 * A reconnect delay to hand a browser in the stream's opening `retry:`
 * field: spread between `minMs` and `maxMs`, so the streams a deploy ends
 * together do not all come back in the same second. EventSource reconnects
 * on its own after a stream ends, waiting exactly the last `retry:` value it
 * was given.
 */
export function jitteredRetryMs(
  minMs = 1_000,
  maxMs = 10_000,
  random: () => number = Math.random,
): number {
  return Math.round(minMs + random() * (maxMs - minMs));
}
