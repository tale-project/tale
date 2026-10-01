// @vitest-environment node

import { modelCatalogEntrySchema } from '@tale/shared/schemas/providers';
import { describe, expect, it } from 'vitest';

import {
  runTurn,
  type ModelCall,
  type TurnDeps,
  type UsageLedgerEntry,
} from '../../../lib/chat/turn';
import {
  classifyChatErrorCode,
  decodeChatError,
} from '../../../lib/shared/chat-errors';
import { buildHarnessTable } from '../../../lib/shared/providers/resolve_execution';
import {
  readEvent,
  readStreamFailure,
  type StreamDecodeState,
} from './stream_decode';
import { createStallGuard, type StallGuard } from './stream_stall';
import {
  chatToolContextForTurn,
  streamProviderAnswer,
  streamSse,
} from './turn_action';

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

  it('hands on the usage the failure event reports, but not a count of nothing', async () => {
    const usageOf = async (usage: unknown) => {
      const chunks: unknown[] = [];
      const read = async (): Promise<void> => {
        for await (const chunk of streamSse(
          sseResponse([
            {
              error: {
                code: 502,
                message: 'Provider disconnected unexpectedly',
              },
              choices: [
                { index: 0, delta: { content: '' }, finish_reason: 'error' },
              ],
              usage,
            },
          ]),
          'openai',
        )) {
          chunks.push(chunk);
        }
      };
      await expect(read()).rejects.toThrow(/Provider disconnected/);
      return chunks;
    };
    await expect(
      usageOf({ prompt_tokens: 100, completion_tokens: 5 }),
    ).resolves.toEqual([
      {
        text: '',
        usage: { inputTokens: 100, outputTokens: 5, totalTokens: 105 },
      },
    ]);
    await expect(
      usageOf({ prompt_tokens: 0, completion_tokens: 0 }),
    ).resolves.toEqual([]);
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

/**
 * What a failed reply books, with the real wire under the real turn: the
 * provider is a synthetic `Response` (no network, no store, no money), read
 * by the same `streamProviderAnswer` → `streamSse` the direct model call
 * uses, inside `runTurn` with an in-memory store and ledger. Reading an
 * in-stream error as a failure used to drop everything the round had
 * consumed: a reply that streamed text and reported its usage before the
 * error booked nothing, where the same stream read as an empty reply had
 * booked it. A refusal answered as an HTTP status consumed nothing, and
 * still books nothing.
 */
describe('a failed reply books what it consumed — the wire under the turn', () => {
  const MODEL = modelCatalogEntrySchema.parse({
    id: 'itest-chat',
    provider: 'openrouter',
    tags: ['chat'],
    supportsTools: false,
    supportsVision: false,
    contextWindow: 32_768,
  });

  /** The direct model call's read of a provider answer, minus the fetch. */
  function providerModel(
    respond: () => Response,
    apiFormat: 'openai' | 'anthropic',
  ): ModelCall {
    return async function* stream(call) {
      const stall = createStallGuard();
      try {
        yield* streamProviderAnswer(
          respond(),
          apiFormat,
          stall,
          call.onAccepted,
        );
      } finally {
        stall.dispose();
      }
    };
  }

  /** An SSE body exactly as written, ending without `[DONE]`. */
  function rawSse(body: string): Response {
    return new Response(body, {
      headers: { 'content-type': 'text/event-stream' },
    });
  }

  function frames(...payloads: readonly unknown[]): string {
    return payloads
      .map((payload) => `data: ${JSON.stringify(payload)}\n\n`)
      .join('');
  }

  async function turnOver(
    model: ModelCall,
    options: { cancelOnProgress?: boolean } = {},
  ) {
    const booked: UsageLedgerEntry[] = [];
    const settled: Array<Record<string, unknown>> = [];
    const deps: TurnDeps = {
      harnesses: buildHarnessTable([]),
      model,
      store: {
        beginTurn: () =>
          Promise.resolve({ assistantMessage: { id: 'msg_2', sequence: 2 } }),
        appendMessage: () => Promise.resolve({ id: 'msg_x', sequence: 9 }),
        streamProgress: () =>
          Promise.resolve({
            cancelRequested: options.cancelOnProgress === true,
          }),
        updateAssistantParts: () => Promise.resolve(),
        finalizeAssistantMessage(message) {
          settled.push(message);
          return Promise.resolve();
        },
        endGeneration: () => Promise.resolve(),
      },
      usage: {
        record(entry) {
          booked.push(entry);
          return Promise.resolve();
        },
      },
      now: () => new Date('2026-10-01T12:00:00.000Z'),
    };
    const outcome = await runTurn(
      {
        organizationId: 'org_1',
        userId: 'user_1',
        threadId: 'thread_1',
        userText: 'how do I return a printer?',
        history: [],
        locale: 'en',
        model: MODEL,
        credential: { authMethod: 'api-key' },
        executionMode: 'direct',
      },
      deps,
    );
    return { outcome, booked, settled: settled.at(-1) };
  }

  const TEXT = {
    choices: [
      {
        index: 0,
        delta: { content: 'Return it within ' },
        finish_reason: null,
      },
    ],
  };
  const USAGE = {
    choices: [],
    usage: { prompt_tokens: 100, completion_tokens: 5 },
  };
  const ZERO_USAGE = {
    choices: [],
    usage: { prompt_tokens: 0, completion_tokens: 0 },
  };
  const RATE_LIMITED = {
    error: { code: 429, message: 'Rate limit exceeded upstream' },
    choices: [{ index: 0, delta: { content: '' }, finish_reason: 'error' }],
  };
  const OPENROUTER_ERROR = {
    error: { code: 502, message: 'Provider disconnected unexpectedly' },
    choices: [{ index: 0, delta: { content: '' }, finish_reason: 'error' }],
  };

  it('books a healthy reply at what the provider reported (the control)', async () => {
    const { outcome, booked } = await turnOver(
      providerModel(() => sseResponse([TEXT, USAGE]), 'openai'),
    );
    expect(outcome.status).toBe('completed');
    expect(booked).toMatchObject([
      { inputTokens: 100, outputTokens: 5, totalTokens: 105 },
    ]);
  });

  it('books the same reply when an error event ends its stream', async () => {
    const { outcome, booked, settled } = await turnOver(
      providerModel(
        () => rawSse(frames(TEXT, USAGE, OPENROUTER_ERROR)),
        'openai',
      ),
    );
    expect(outcome).toMatchObject({ status: 'refused', step: 'stream' });
    expect(booked).toMatchObject([
      { inputTokens: 100, outputTokens: 5, totalTokens: 105 },
    ]);
    expect(settled?.usage).toEqual({
      inputTokens: 100,
      outputTokens: 5,
      totalTokens: 105,
    });
    expect(decodeChatError(settled?.error as string).raw).toMatch(
      /Provider disconnected unexpectedly/,
    );
  });

  it('books the input an Anthropic message_start reported before its error event', async () => {
    const { booked, settled } = await turnOver(
      providerModel(
        () =>
          rawSse(
            frames(
              {
                type: 'message_start',
                message: { usage: { input_tokens: 100 } },
              },
              {
                type: 'error',
                error: { type: 'overloaded_error', message: 'Overloaded' },
              },
            ),
          ),
        'anthropic',
      ),
    );
    expect(booked).toMatchObject([
      { inputTokens: 100, outputTokens: 0, totalTokens: 100 },
    ]);
    // The output side was never reported: the figure says it is estimated.
    expect(settled?.usage).toMatchObject({ inputTokens: 100, estimated: true });
  });

  it('books the prompt of a stream that failed before it said anything', async () => {
    // OpenRouter commits the 200 and sends keep-alives while a reasoning
    // model thinks; the upstream then fails. The prompt was read.
    const { booked, settled } = await turnOver(
      providerModel(
        () => rawSse(`: OPENROUTER PROCESSING\n\n${frames(OPENROUTER_ERROR)}`),
        'openai',
      ),
    );
    expect(booked).toHaveLength(1);
    expect(booked[0]?.inputTokens).toBeGreaterThan(0);
    expect(booked[0]?.outputTokens).toBe(0);
    expect(settled?.usage).toMatchObject({ estimated: true });
  });

  it('books nothing for a rate limit OpenRouter reports on its stream before any answer', async () => {
    // The same refusal as an HTTP 429, from a provider that committed its
    // 200 early: nothing was consumed.
    const { outcome, booked, settled } = await turnOver(
      providerModel(
        () =>
          rawSse(
            `: OPENROUTER PROCESSING\n\n${frames({
              error: { code: 429, message: 'Rate limit exceeded upstream' },
              choices: [
                { index: 0, delta: { content: '' }, finish_reason: 'error' },
              ],
            })}`,
          ),
        'openai',
      ),
    );
    expect(outcome).toMatchObject({ status: 'refused', step: 'stream' });
    expect(booked).toEqual([]);
    expect(settled).not.toHaveProperty('usage');
    expect(decodeChatError(settled?.error as string).code).toBe('rate_limited');
  });

  it('books the usage an error event reports itself', async () => {
    const { booked, settled } = await turnOver(
      providerModel(
        () =>
          rawSse(
            frames({
              ...OPENROUTER_ERROR,
              usage: { prompt_tokens: 100, completion_tokens: 5 },
            }),
          ),
        'openai',
      ),
    );
    expect(booked).toMatchObject([
      { inputTokens: 100, outputTokens: 5, totalTokens: 105 },
    ]);
    expect(settled?.usage).toEqual({
      inputTokens: 100,
      outputTokens: 5,
      totalTokens: 105,
    });
  });

  it('books nothing when zero-count metadata precedes a pre-answer rate limit', async () => {
    const { outcome, booked, settled } = await turnOver(
      providerModel(() => rawSse(frames(ZERO_USAGE, RATE_LIMITED)), 'openai'),
    );
    expect(outcome).toMatchObject({ status: 'refused', step: 'stream' });
    expect(booked).toEqual([]);
    expect(settled).not.toHaveProperty('usage');
  });

  it('keeps a healthy empty stream’s reported zero counts', async () => {
    const { outcome, booked, settled } = await turnOver(
      providerModel(() => rawSse(frames(ZERO_USAGE)), 'openai'),
    );
    expect(outcome.status).toBe('completed');
    expect(booked).toMatchObject([
      { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    ]);
    expect(settled?.usage).not.toHaveProperty('estimated');
  });

  it('keeps reported consumption billable through a later rate limit', async () => {
    const { outcome, booked } = await turnOver(
      providerModel(
        () => rawSse(frames(ZERO_USAGE, USAGE, RATE_LIMITED)),
        'openai',
      ),
    );
    expect(outcome.status).toBe('refused');
    expect(booked).toMatchObject([
      { inputTokens: 100, outputTokens: 5, totalTokens: 105 },
    ]);
  });

  it.each(['content', 'reasoning'])(
    'keeps consumed %s billable when zero-count metadata follows it',
    async (field) => {
      const answer = {
        choices: [{ index: 0, delta: { [field]: 'x'.repeat(40) } }],
      };
      const { outcome, booked, settled } = await turnOver(
        providerModel(
          () => rawSse(frames(answer, ZERO_USAGE, RATE_LIMITED)),
          'openai',
        ),
      );
      expect(outcome.status).toBe('refused');
      expect(booked).toHaveLength(1);
      expect(booked[0]?.inputTokens).toBeGreaterThan(0);
      expect(booked[0]?.outputTokens).toBe(10);
      expect(settled?.usage).toMatchObject({ estimated: true });
    },
  );

  it('keeps cancellation accounting after a zero-count frame', async () => {
    const { outcome, booked, settled } = await turnOver(
      providerModel(
        () => rawSse(frames(ZERO_USAGE, TEXT, RATE_LIMITED)),
        'openai',
      ),
      { cancelOnProgress: true },
    );
    expect(outcome).toMatchObject({ status: 'completed', cancelled: true });
    expect(booked).toHaveLength(1);
    expect(booked[0]?.inputTokens).toBeGreaterThan(0);
    expect(booked[0]?.outputTokens).toBeGreaterThan(0);
    expect(settled?.usage).toMatchObject({
      finishReason: 'cancelled',
      estimated: true,
    });
  });

  it('books nothing for a refusal answered as an HTTP status (the control)', async () => {
    const { outcome, booked, settled } = await turnOver(
      providerModel(
        () =>
          Response.json(
            { error: { message: 'Rate limit exceeded' } },
            { status: 429 },
          ),
        'openai',
      ),
    );
    expect(outcome).toMatchObject({ status: 'refused', step: 'stream' });
    expect(booked).toEqual([]);
    expect(settled).not.toHaveProperty('usage');
    expect(decodeChatError(settled?.error as string).code).toBe('rate_limited');
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
