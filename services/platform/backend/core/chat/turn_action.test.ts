// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { createStallGuard, type StallGuard } from './stream_stall';
import { streamSse } from './turn_action';

/**
 * The provider stream's one clock is a silence clock: a reply that keeps
 * arriving is never cut, however long it runs past what a fixed deadline
 * would have allowed, and only a provider that stops sending ends the round
 * — with a failure that names the stall, not a generic abort.
 */

function frame(text: string): string {
  return `data: ${JSON.stringify({
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  })}\n\n`;
}

/** An SSE body that emits `count` frames `everyMs` apart and then closes —
 * or, with `hang`, goes silent forever after the last one. */
function drippingResponse(options: {
  count: number;
  everyMs: number;
  hang?: boolean;
}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let sent = 0;
      const tick = (): void => {
        sent += 1;
        controller.enqueue(encoder.encode(frame(`tick${sent} `)));
        if (sent < options.count) setTimeout(tick, options.everyMs);
        else if (options.hang !== true) controller.close();
      };
      setTimeout(tick, options.everyMs);
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function collect(response: Response, guard: StallGuard): Promise<string> {
  const texts: string[] = [];
  for await (const chunk of streamSse(response, 'openai', guard)) {
    texts.push(chunk.text);
  }
  return texts.join('');
}

describe('streamSse under the stall guard', () => {
  it('keeps a healthy stream alive far past the silence window', async () => {
    const guard = createStallGuard(150);
    // 30 frames 15ms apart: ~450ms of streaming against a 150ms window — a
    // fixed deadline of the window's length would have cut this reply at
    // frame ten.
    const text = await collect(
      drippingResponse({ count: 30, everyMs: 15 }),
      guard,
    );
    guard.dispose();
    expect(text.startsWith('tick1 tick2 ')).toBe(true);
    expect(text.endsWith('tick30 ')).toBe(true);
    expect(guard.stalled).toBe(false);
  });

  it('ends a stream whose provider goes silent, naming the stall', async () => {
    const guard = createStallGuard(100);
    await expect(
      collect(drippingResponse({ count: 2, everyMs: 10, hang: true }), guard),
    ).rejects.toThrow(/timed out after \d+ seconds of silence/);
    guard.dispose();
    expect(guard.stalled).toBe(true);
  });

  it('lets a user cancel riding the same fetch through as itself, not as a stall', async () => {
    const guard = createStallGuard(1_000);
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        setTimeout(() => controller.error(abort), 5);
      },
    });
    await expect(collect(new Response(stream), guard)).rejects.toBe(abort);
    guard.dispose();
    expect(guard.stalled).toBe(false);
  });
});
