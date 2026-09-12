// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { createStallGuard, type StallGuard } from './stream_stall';
import { readEvent, streamSse, type StreamDecodeState } from './turn_action';

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

/** A whole SSE body from its frames, closed after the last one. */
function sseResponse(frames: readonly unknown[]): Response {
  const body = frames
    .map((payload) => `data: ${JSON.stringify(payload)}\n\n`)
    .join('');
  return new Response(`${body}data: [DONE]\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function chunksOf(response: Response, apiFormat: 'openai' | 'anthropic') {
  const chunks = [];
  for await (const chunk of streamSse(response, apiFormat)) chunks.push(chunk);
  return chunks;
}

function decodeState(): StreamDecodeState {
  return { running: { input: 0, output: 0 }, drafts: new Map() };
}

/**
 * The reason a reply stopped never left the decoder: a reply the output cap
 * cut short settled `complete` with nothing marking it. Both dialects say
 * why, in their own words — folded onto one vocabulary here and carried on
 * the settle chunk.
 */
describe('readEvent — the finish reason, both dialects', () => {
  it.each([
    ['stop', 'stop'],
    ['length', 'length'],
    ['tool_calls', 'tool-calls'],
    ['function_call', 'tool-calls'],
    ['content_filter', 'content-filter'],
    ['something_new', 'other'],
  ])('folds the OpenAI finish_reason %s onto %s', (wire, folded) => {
    const read = readEvent(
      'openai',
      { choices: [{ index: 0, delta: {}, finish_reason: wire }] },
      decodeState(),
    );
    expect(read.finishReason).toBe(folded);
  });

  it('reads no reason from the null every earlier OpenAI delta carries', () => {
    const read = readEvent(
      'openai',
      { choices: [{ index: 0, delta: { content: 'x' }, finish_reason: null }] },
      decodeState(),
    );
    expect(read).toEqual({ text: 'x' });
  });

  it.each([
    ['end_turn', 'stop'],
    ['stop_sequence', 'stop'],
    ['max_tokens', 'length'],
    ['tool_use', 'tool-calls'],
    ['refusal', 'content-filter'],
    ['pause_turn', 'other'],
  ])('folds the Anthropic stop_reason %s onto %s', (wire, folded) => {
    const read = readEvent(
      'anthropic',
      {
        type: 'message_delta',
        delta: { stop_reason: wire },
        usage: { output_tokens: 12 },
      },
      decodeState(),
    );
    expect(read.finishReason).toBe(folded);
    expect(read.usage).toMatchObject({ outputTokens: 12 });
  });

  it('surfaces the Anthropic message_start input count at once, cache read included', () => {
    // The prompt is billed before the first output token; a cancel that
    // aborts the fetch before the closing delta used to lose this count.
    const read = readEvent(
      'anthropic',
      {
        type: 'message_start',
        message: {
          usage: { input_tokens: 2711, cache_read_input_tokens: 512 },
        },
      },
      decodeState(),
    );
    expect(read).toEqual({
      text: '',
      usage: {
        inputTokens: 2711,
        outputTokens: 0,
        totalTokens: 2711,
        cachedInputTokens: 512,
      },
    });
  });
});

describe('streamSse — usage and finish reason on the wire', () => {
  it('carries the OpenAI finish reason and final usage on the settle chunk', async () => {
    const chunks = await chunksOf(
      sseResponse([
        {
          choices: [
            { index: 0, delta: { content: '1\n2\n' }, finish_reason: null },
          ],
        },
        { choices: [{ index: 0, delta: {}, finish_reason: 'length' }] },
        {
          choices: [],
          usage: { prompt_tokens: 2711, completion_tokens: 64 },
        },
      ]),
      'openai',
    );
    expect(chunks.at(-1)).toEqual({
      text: '',
      usage: { inputTokens: 2711, outputTokens: 64, totalTokens: 2775 },
      finishReason: 'length',
    });
    expect(chunks.map((chunk) => chunk.text).join('')).toBe('1\n2\n');
  });

  it('yields the Anthropic message_start usage as its own chunk, before any text', async () => {
    const chunks = await chunksOf(
      sseResponse([
        { type: 'message_start', message: { usage: { input_tokens: 900 } } },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'hello' },
        },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 3 },
        },
      ]),
      'anthropic',
    );
    expect(chunks[0]).toEqual({
      text: '',
      usage: { inputTokens: 900, outputTokens: 0, totalTokens: 900 },
    });
    expect(chunks.at(-1)).toEqual({
      text: '',
      usage: { inputTokens: 900, outputTokens: 3, totalTokens: 903 },
      finishReason: 'stop',
    });
  });
});

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
