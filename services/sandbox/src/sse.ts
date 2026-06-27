// SSE response builder shared by /v1/execute and /v1/sessions/:id/exec.
//
// Wraps the ReadableStream + keepalive + enqueue-after-close handling that
// previously lived inline in server.ts:handleExecute. The handler receives a
// `send(event, data)` function and runs to completion; the helper owns the
// keepalive timer (Bun's per-connection idleTimeout maxes at 255 s — a
// comment line every 20 s resets the idle clock through silent stretches
// like `pip install` or a thinking agent) and always closes the stream.

interface SseHandle {
  send: (event: string, data: unknown) => void;
}

const SSE_KEEPALIVE_INTERVAL_MS = 20_000;

export function sseResponse(
  run: (handle: SseHandle) => Promise<void>,
  extraHeaders?: Record<string, string>,
): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch (err) {
          // Stream already closed — common when the caller aborted; the
          // handler keeps draining so its cleanup paths run.
          console.warn('[sandbox] SSE enqueue after close:', err);
        }
      };
      const sendKeepalive = () => {
        try {
          controller.enqueue(enc.encode(`: keepalive\n\n`));
        } catch (err) {
          console.warn('[sandbox] SSE keepalive enqueue after close:', err);
        }
      };
      const keepalive = setInterval(sendKeepalive, SSE_KEEPALIVE_INTERVAL_MS);
      try {
        await run({ send });
      } finally {
        clearInterval(keepalive);
        try {
          controller.close();
        } catch (err) {
          console.warn('[sandbox] SSE close failed:', err);
        }
      }
    },
  });
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
