// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { classifyChatErrorCode } from '../../../lib/shared/chat-errors';
import {
  readEvent,
  readStreamFailure,
  type StreamDecodeState,
} from './stream_decode';
import { createStallGuard, type StallGuard } from './stream_stall';
import { chatToolContextForTurn, streamSse } from './turn_action';

/**
 * The tools' scope boundary comes from the THREAD, never from the
 * access-gated prompt block: a project thread hands the executor its project
 * id whether or not the user may still read it (the executor then degrades
 * to the organization hub rather than widening to every project), and a
 * personal thread hands it null. The full turn cannot be driven here — model
 * resolution walks the provider catalog on disk — so the invariant is pinned
 * at the seam the turn builds the executor through.
 */
describe('chatToolContextForTurn — the executor’s scope boundary', () => {
  const who = {
    organizationId: 'org_1',
    userId: 'user_1',
    threadIds: ['thread_root', 'thread_sibling'],
  };

  it('pins a project thread to its project id, access or not', () => {
    expect(chatToolContextForTurn({ ...who, projectId: 'project_1' })).toEqual({
      ...who,
      projectId: 'project_1',
    });
  });

  it('pins a personal thread to null, never to undefined', () => {
    const context = chatToolContextForTurn({ ...who, projectId: null });
    expect(context.projectId).toBeNull();
    expect(Object.keys(context)).toContain('projectId');
  });
});

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
    // Anthropic reports the prompt in parts — read fresh, read from the
    // cache, written to it — and bills all of them: the prompt is the sum,
    // the cache read its cached share.
    const read = readEvent(
      'anthropic',
      {
        type: 'message_start',
        message: {
          usage: {
            input_tokens: 2711,
            cache_read_input_tokens: 512,
            cache_creation_input_tokens: 100,
          },
        },
      },
      decodeState(),
    );
    expect(read).toEqual({
      text: '',
      usage: {
        inputTokens: 3323,
        outputTokens: 0,
        totalTokens: 3323,
        cachedInputTokens: 512,
      },
    });
  });

  it('takes the prompt from the closing Anthropic delta when a server reports it there', () => {
    // A gateway converting another dialect's stream puts its whole usage on
    // the closing delta; the counts there are cumulative.
    const state = decodeState();
    readEvent('anthropic', { type: 'message_start', message: {} }, state);
    const read = readEvent(
      'anthropic',
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { input_tokens: 900, output_tokens: 40 },
      },
      state,
    );
    expect(read.usage).toMatchObject({
      inputTokens: 900,
      outputTokens: 40,
      totalTokens: 940,
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

/**
 * A stream's HTTP status is sent before the model writes a token, so an
 * upstream rate limit, overload or disconnect after that arrives as an event
 * on a `200` stream. Read as an ordinary event it carried no text, and the
 * round settled as a completed reply with nothing in it: the chat kept
 * "thinking" over a turn that had already failed, and the provider's words
 * were lost.
 */
describe('readStreamFailure — a failure reported on the stream', () => {
  it('reads the mid-stream error OpenRouter sends beside a choice that finished in error', () => {
    expect(
      readStreamFailure('openai', {
        object: 'chat.completion.chunk',
        provider: 'OpenAI',
        error: {
          code: 429,
          message: 'Rate limit exceeded upstream',
          metadata: { error_type: 'rate_limit' },
        },
        choices: [{ index: 0, delta: { content: '' }, finish_reason: 'error' }],
      }),
    ).toEqual({
      message: 'Rate limit exceeded upstream',
      code: '429',
      status: 429,
    });
  });

  it('reads the bare error object an OpenAI-compatible server sends', () => {
    expect(
      readStreamFailure('openai', {
        error: {
          message: 'The server had an error while processing your request.',
          type: 'server_error',
          code: null,
        },
      }),
    ).toEqual({
      message: 'The server had an error while processing your request.',
      code: 'server_error',
    });
    expect(readStreamFailure('openai', { error: 'upstream closed' })).toEqual({
      message: 'upstream closed',
    });
  });

  it('reads a choice that finished in error with no body', () => {
    expect(
      readStreamFailure('openai', {
        choices: [{ index: 0, delta: {}, finish_reason: 'error' }],
      }),
    ).toEqual({ message: '' });
  });

  it('reads the Anthropic error event', () => {
    expect(
      readStreamFailure('anthropic', {
        type: 'error',
        error: { type: 'overloaded_error', message: 'Overloaded' },
      }),
    ).toEqual({ message: 'Overloaded', code: 'overloaded_error' });
  });

  it('reads no failure from an ordinary event', () => {
    // Some servers stamp `"error": null`, or an empty object, on every chunk.
    for (const error of [null, {}]) {
      expect(
        readStreamFailure('openai', {
          error,
          choices: [{ index: 0, delta: { content: 'x' }, finish_reason: null }],
        }),
      ).toBeUndefined();
    }
    expect(
      readStreamFailure('openai', {
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      }),
    ).toBeUndefined();
    expect(
      readStreamFailure('anthropic', {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'error' },
      }),
    ).toBeUndefined();
  });
});

describe('streamSse — a failure reported on the stream ends the round', () => {
  it('throws the provider’s words and status instead of settling an empty reply', async () => {
    const stream = chunksOf(
      sseResponse([
        {
          error: { code: 429, message: 'Rate limit exceeded upstream' },
          choices: [
            { index: 0, delta: { content: '' }, finish_reason: 'error' },
          ],
        },
      ]),
      'openai',
    );
    const error: unknown = await stream.then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      message:
        'The model provider ended the reply with an error: Rate limit exceeded upstream (429)',
      status: 429,
    });
    // The same bucket the failure gets when it arrives as an HTTP status.
    expect(classifyChatErrorCode(error)).toBe('rate_limited');
  });

  it('yields what streamed before the failure, then throws', async () => {
    const texts: string[] = [];
    const read = async (): Promise<void> => {
      for await (const chunk of streamSse(
        sseResponse([
          {
            choices: [
              {
                index: 0,
                delta: { content: 'The first half ' },
                finish_reason: null,
              },
            ],
          },
          {
            error: { code: 502, message: 'Provider disconnected unexpectedly' },
            choices: [
              { index: 0, delta: { content: '' }, finish_reason: 'error' },
            ],
          },
        ]),
        'openai',
      )) {
        texts.push(chunk.text);
      }
    };
    await expect(read()).rejects.toThrow(/Provider disconnected unexpectedly/);
    expect(texts).toEqual(['The first half ']);
  });

  it('ends an Anthropic stream on its error event, classified as provider trouble', async () => {
    const error: unknown = await chunksOf(
      sseResponse([
        { type: 'message_start', message: { usage: { input_tokens: 900 } } },
        {
          type: 'error',
          error: { type: 'overloaded_error', message: 'Overloaded' },
        },
      ]),
      'anthropic',
    ).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(error).toMatchObject({
      message:
        'The model provider ended the reply with an error: Overloaded (overloaded_error)',
    });
    expect(classifyChatErrorCode(error)).toBe('provider_error');
  });

  it('says so when the provider named no reason', async () => {
    await expect(
      chunksOf(
        sseResponse([
          { choices: [{ index: 0, delta: {}, finish_reason: 'error' }] },
        ]),
        'openai',
      ),
    ).rejects.toThrow(
      'The model provider ended the reply with an error and gave no reason.',
    );
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
