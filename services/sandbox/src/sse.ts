// SSE response builder shared by the session exec and attach routes.
//
// The handler receives `send(event, data)` and a signal to stop reading from
// runnerd when its consumer disconnects or falls behind. The helper owns the
// keepalive timer (Bun's per-connection idleTimeout maxes at 255 s — a
// comment line every 20 s resets the idle clock through silent stretches
// like `pip install` or a thinking agent) and bounds the buffered bytes.

import { RUNNERD_CONSUMER_BUFFER_MAX_BYTES } from './session/runnerd-protocol.ts';

interface SseHandle {
  send: (event: string, data: unknown) => void | Promise<void>;
  signal: AbortSignal;
}

const SSE_KEEPALIVE_INTERVAL_MS = 20_000;
const SSE_DRAIN_TIMEOUT_MS = 2_000;

export function sseResponse(
  run: (handle: SseHandle) => Promise<void>,
  extraHeaders?: Record<string, string>,
): Response {
  const consumer = new AbortController();
  let closed = false;
  let keepalive: ReturnType<typeof setInterval> | undefined;
  let drained: (() => void) | undefined;
  let drainTimer: ReturnType<typeof setTimeout> | undefined;
  const releaseDrain = () => {
    clearTimeout(drainTimer);
    drainTimer = undefined;
    const resolve = drained;
    drained = undefined;
    resolve?.();
  };
  const stop = () => {
    closed = true;
    clearInterval(keepalive);
    releaseDrain();
  };
  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        const enc = new TextEncoder();
        const fail = (error: unknown) => {
          if (closed) return;
          stop();
          controller.error(error);
          consumer.abort(error);
        };
        const canSend = () => {
          if (closed) return false;
          // Permit one-event overshoot: a terminal collected-output result can
          // exceed 8 MiB on its own. The next enqueue disconnects a consumer
          // that still has not drained it, without cutting that result in half.
          if ((controller.desiredSize ?? 0) <= 0) {
            fail(new Error('SSE consumer exceeded its buffered output limit'));
            return false;
          }
          return true;
        };
        const send = (event: string, data: unknown) => {
          if (!canSend()) return;
          controller.enqueue(
            enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
          // Cooperative producers pause before reading more runnerd frames.
          // Ignoring this promise still trips canSend's hard byte ceiling on
          // the next event. Resolve on cancellation: the shared signal owns
          // stopping the producer, without unhandled promise rejections from
          // legacy synchronous callers.
          if ((controller.desiredSize ?? 0) <= 0) {
            return new Promise<void>((resolve) => {
              drained = resolve;
              drainTimer = setTimeout(
                () => fail(new Error('SSE consumer stalled while draining')),
                SSE_DRAIN_TIMEOUT_MS,
              );
            });
          }
        };
        const sendKeepalive = () => {
          if (drained !== undefined) return;
          if (canSend()) controller.enqueue(enc.encode(`: keepalive\n\n`));
        };
        keepalive = setInterval(sendKeepalive, SSE_KEEPALIVE_INTERVAL_MS);
        try {
          // start must return immediately: a pending producer must not block
          // ReadableStream.cancel from detaching it. Own both promise outcomes.
          void run({ send, signal: consumer.signal }).then(() => {
            if (!closed) {
              stop();
              controller.close();
            }
            return undefined;
          }, fail);
        } catch (error) {
          fail(error);
        }
      },
      pull(controller) {
        if ((controller.desiredSize ?? 0) > 0) releaseDrain();
      },
      cancel(reason) {
        stop();
        consumer.abort(reason);
      },
    },
    {
      highWaterMark: RUNNERD_CONSUMER_BUFFER_MAX_BYTES,
      size: (chunk) => chunk?.byteLength ?? 0,
    },
  );
  return new Response(stream, {
    status: 200,
    // Core SSE headers spread LAST so a caller's `extraHeaders` can add fields
    // but never clobber the content-type / cache-control / buffering headers
    // streaming depends on.
    headers: {
      ...extraHeaders,
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}
