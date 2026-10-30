// @vitest-environment node

import { modelCatalogEntrySchema } from '@tale/shared/schemas/providers';
import { describe, expect, it, vi } from 'vitest';

import type {
  ChatToolExecutor,
  ToolCallRequest,
} from '../../../lib/chat/tools';
import {
  runTurn,
  type ModelCall,
  type ModelStreamChunk,
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
  readServedBy,
  readServedByHeaders,
  readStreamFailure,
  type StreamDecodeState,
  type StreamDialect,
} from './stream_decode';
import { createStallGuard, type StallGuard } from './stream_stall';
import {
  chatToolContextForTurn,
  streamProviderAnswer,
  streamSse,
  workToolsSetup,
  type TurnWorkTools,
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
describe('workToolsSetup — what a turn learns of its work tools [CHAT-R28]', () => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the setup only hands the tools on
  const tools = { loadout: { createFile: true } } as unknown as TurnWorkTools;

  it('takes the tools a host offers as they are', () => {
    expect(workToolsSetup(tools)).toEqual({ tools });
    expect(workToolsSetup(undefined)).toEqual({});
  });

  it('keeps why tools are missing beside what is still offered', () => {
    expect(workToolsSetup({ unavailable: 'policy_unreadable', tools })).toEqual(
      { tools, unavailable: 'policy_unreadable' },
    );
    expect(workToolsSetup({ unavailable: 'setup_failed' })).toEqual({
      unavailable: 'setup_failed',
    });
  });
});

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

  it('hands the tools the turn’s embedding meter, and none when the host has none', () => {
    const meter = { open: vi.fn(), settle: vi.fn(), release: vi.fn() };
    expect(
      chatToolContextForTurn({ ...who, projectId: null, embeddingMeter: meter })
        .embeddingMeter,
    ).toBe(meter);
    expect(
      chatToolContextForTurn({ ...who, projectId: null }),
    ).not.toHaveProperty('embeddingMeter');
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

/** A whole tool call in one OpenAI-compatible frame, the turn ending on it:
 * the provider's id, the tool's name, its arguments. */
const TOOL_CALL = {
  choices: [
    {
      index: 0,
      delta: {
        tool_calls: [
          {
            index: 0,
            id: 'call_1',
            type: 'function',
            function: { name: 'lookup', arguments: '{"query":"returns"}' },
          },
        ],
      },
      finish_reason: 'tool_calls',
    },
  ],
};

/** The rate limit each dialect reports on a stream it already opened. */
const RATE_LIMIT_ON_STREAM = {
  openai: { error: { code: 429, message: 'Rate limit exceeded upstream' } },
  anthropic: {
    type: 'error',
    error: { type: 'rate_limit_error', message: 'Rate limit exceeded' },
  },
  'openai-responses': {
    type: 'error',
    code: 'rate_limit_exceeded',
    message: 'Rate limit exceeded',
  },
} as const;

/** Frames that carry nothing the model wrote: control events, and tool-call
 * fragments with only the provider's bookkeeping in them. */
const NO_ANSWER_FRAMES = [
  [
    'an empty role',
    'openai',
    {
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: '' },
          finish_reason: null,
        },
      ],
    },
  ],
  [
    'empty metadata',
    'openai',
    { id: 'gen-1', object: 'chat.completion.chunk', choices: [] },
  ],
  [
    'a finish reason alone',
    'openai',
    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
  ],
  [
    'a call fragment with only its id',
    'openai',
    {
      choices: [
        {
          index: 0,
          delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function' }] },
        },
      ],
    },
  ],
  [
    'an empty call fragment',
    'openai',
    {
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [{ index: 0, function: { name: '', arguments: '' } }],
          },
        },
      ],
    },
  ],
  [
    'call fragments that are no objects',
    'openai',
    { choices: [{ index: 0, delta: { tool_calls: ['lookup', null, 7] } }] },
  ],
  [
    'a tool_use block with no name',
    'anthropic',
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'toolu_1', name: '', input: {} },
    },
  ],
  [
    'an empty text block',
    'anthropic',
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    },
  ],
  [
    'a function call item with no name',
    'openai-responses',
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: {
        type: 'function_call',
        id: 'fc_1',
        call_id: 'call_1',
        arguments: '',
      },
    },
  ],
] as const;

/**
 * A tool call reaches the turn whole, on the settle chunk. That the model
 * began one is said at once — on the event that gave it a name or argument
 * bytes, and only once — so a failure that ends the stream before its settle
 * cannot leave the round looking unanswered.
 */
describe('streamSse — a tool call the model began', () => {
  it('says so once, and hands the call on only at the settle', async () => {
    const chunks = await chunksOf(
      sseResponse([
        {
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'lookup', arguments: '' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, function: { arguments: '{"query":' } },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, function: { arguments: '"returns"}' } },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        },
      ]),
      'openai',
    );
    expect(chunks).toEqual([
      { text: '', toolCallStarted: true },
      {
        text: '',
        finishReason: 'tool-calls',
        toolCalls: [
          { id: 'call_1', name: 'lookup', input: { query: 'returns' } },
        ],
      },
    ]);
  });

  it('says so on the Anthropic block that names the tool', async () => {
    const chunks = await chunksOf(
      sseResponse([
        { type: 'message_start', message: { usage: { input_tokens: 100 } } },
        {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'lookup',
            input: {},
          },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"query":' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '"returns"}' },
        },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'tool_use' },
          usage: { output_tokens: 12 },
        },
      ]),
      'anthropic',
    );
    const usage = { inputTokens: 100, outputTokens: 12, totalTokens: 112 };
    expect(chunks).toEqual([
      {
        text: '',
        usage: { inputTokens: 100, outputTokens: 0, totalTokens: 100 },
      },
      { text: '', toolCallStarted: true },
      { text: '', usage },
      {
        text: '',
        usage,
        finishReason: 'tool-calls',
        toolCalls: [
          { id: 'toolu_1', name: 'lookup', input: { query: 'returns' } },
        ],
      },
    ]);
  });

  it('hands on no call when the stream fails after the call began', async () => {
    const chunks: ModelStreamChunk[] = [];
    const read = async (): Promise<void> => {
      for await (const chunk of streamSse(
        sseResponse([TOOL_CALL, RATE_LIMIT_ON_STREAM.openai]),
        'openai',
      )) {
        chunks.push(chunk);
      }
    };
    await expect(read()).rejects.toMatchObject({ status: 429 });
    expect(chunks).toEqual([{ text: '', toolCallStarted: true }]);
  });

  it('counts no fragment the failure event itself carries', async () => {
    const chunks: ModelStreamChunk[] = [];
    const read = async (): Promise<void> => {
      for await (const chunk of streamSse(
        sseResponse([{ ...TOOL_CALL, ...RATE_LIMIT_ON_STREAM.openai }]),
        'openai',
      )) {
        chunks.push(chunk);
      }
    };
    await expect(read()).rejects.toMatchObject({ status: 429 });
    expect(chunks).toEqual([]);
  });

  it.each(NO_ANSWER_FRAMES)(
    'says nothing of %s',
    async (_name, dialect, noAnswer) => {
      const chunks: ModelStreamChunk[] = [];
      for await (const chunk of streamSse(sseResponse([noAnswer]), dialect)) {
        chunks.push(chunk);
      }
      expect(chunks.filter((chunk) => chunk.toolCallStarted === true)).toEqual(
        [],
      );
      expect(chunks.filter((chunk) => chunk.toolCalls !== undefined)).toEqual(
        [],
      );
    },
  );
});

/** One Chat Completions frame carrying one tool-call fragment. */
function toolCallFrame(fragment: Record<string, unknown>): unknown {
  return { choices: [{ index: 0, delta: { tool_calls: [fragment] } }] };
}

/** The tool calls a stream settles with. */
async function settledCalls(frames: readonly unknown[]) {
  const chunks = await chunksOf(sseResponse(frames), 'openai');
  return chunks.find((chunk) => chunk.toolCalls !== undefined)?.toolCalls;
}

const NOTES = 'https://www.mozilla.org/en-US/firefox/notes/';
const CALENDAR = 'https://wiki.mozilla.org/Release_Management/Calendar';
const TRAINS = 'https://whattrainisitnow.com/calendar';

/**
 * Parallel calls on the Chat Completions wire. A gateway that answers it
 * from the Responses API (Bifrost, for an OpenAI model it routes there)
 * numbers each call `output_index - 1`, so when nothing comes before the
 * calls the first two both arrive as index 0, each with its own id.
 */
describe('streamSse — parallel tool calls sharing an index', () => {
  it('keeps calls a gateway gave the same index apart, each with its own arguments', async () => {
    const announce = (index: number, id: string) =>
      toolCallFrame({
        index,
        id,
        type: 'function',
        function: { name: 'web_fetch', arguments: '' },
      });
    const args = (index: number, url: string) =>
      toolCallFrame({
        index,
        function: { name: null, arguments: JSON.stringify({ url }) },
      });
    // What the gateway sends for the closing events of each call: no delta.
    const closing = { choices: [{ index: 0, delta: {} }] };

    const calls = await settledCalls([
      announce(0, 'call_notes'),
      args(0, NOTES),
      closing,
      announce(0, 'call_calendar'),
      args(0, CALENDAR),
      closing,
      announce(1, 'call_trains'),
      args(1, TRAINS),
      closing,
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ]);

    expect(calls).toEqual([
      { id: 'call_notes', name: 'web_fetch', input: { url: NOTES } },
      { id: 'call_calendar', name: 'web_fetch', input: { url: CALENDAR } },
      { id: 'call_trains', name: 'web_fetch', input: { url: TRAINS } },
    ]);
  });

  it('keeps calls apart that each arrive whole at index 0', async () => {
    const whole = (id: string, url: string) =>
      toolCallFrame({
        index: 0,
        id,
        type: 'function',
        function: { name: 'web_fetch', arguments: JSON.stringify({ url }) },
      });

    const calls = await settledCalls([
      whole('call_notes', NOTES),
      whole('call_calendar', CALENDAR),
    ]);

    expect(calls?.map((call) => call.input)).toEqual([
      { url: NOTES },
      { url: CALENDAR },
    ]);
  });

  it('reads a call whose every fragment repeats its id as one call', async () => {
    const calls = await settledCalls([
      toolCallFrame({
        index: 0,
        id: 'call_notes',
        type: 'function',
        function: { name: 'web_fetch', arguments: '{"url":' },
      }),
      toolCallFrame({
        index: 0,
        id: 'call_notes',
        function: { arguments: JSON.stringify(NOTES) },
      }),
      toolCallFrame({
        index: 0,
        id: 'call_notes',
        function: { arguments: '}' },
      }),
    ]);

    expect(calls).toEqual([
      { id: 'call_notes', name: 'web_fetch', input: { url: NOTES } },
    ]);
  });

  it('reads fragments that bring a new id but no function name as the same call', async () => {
    // A server may stamp each fragment with an id of its own; only a
    // fragment that names a function announces a call.
    const calls = await settledCalls([
      toolCallFrame({
        index: 0,
        id: 'call_a1',
        type: 'function',
        function: { name: 'web_fetch', arguments: '{"url":' },
      }),
      toolCallFrame({
        index: 0,
        id: 'call_a2',
        function: { arguments: JSON.stringify(NOTES) },
      }),
      toolCallFrame({ index: 0, id: 'call_a3', function: { arguments: '}' } }),
    ]);

    expect(calls).toHaveLength(1);
    expect(calls?.[0]).toMatchObject({
      name: 'web_fetch',
      input: { url: NOTES },
    });
  });

  it('keeps the calls in the order they were announced, interleaved fragments included', async () => {
    const calls = await settledCalls([
      toolCallFrame({
        index: 0,
        id: 'call_notes',
        function: { name: 'web_fetch', arguments: '' },
      }),
      toolCallFrame({
        index: 1,
        id: 'call_calendar',
        function: { name: 'web_fetch', arguments: '' },
      }),
      toolCallFrame({
        index: 1,
        function: { arguments: JSON.stringify({ url: CALENDAR }) },
      }),
      toolCallFrame({
        index: 0,
        function: { arguments: JSON.stringify({ url: NOTES }) },
      }),
    ]);

    expect(calls?.map((call) => call.id)).toEqual([
      'call_notes',
      'call_calendar',
    ]);
    expect(calls?.map((call) => call.input)).toEqual([
      { url: NOTES },
      { url: CALENDAR },
    ]);
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

  /** The direct model call's read of a provider answer, minus the fetch:
   * `respond` answers round `round` (counted from 1) and is handed the
   * round's abort signal, which a real fetch ends its body on. */
  function providerModel(
    respond: (round: number, signal?: AbortSignal) => Response,
    dialect: StreamDialect,
  ): ModelCall {
    let round = 0;
    return async function* stream(call) {
      round += 1;
      const stall = createStallGuard();
      try {
        yield* streamProviderAnswer(
          respond(round, call.signal),
          dialect,
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

  /** An SSE body that sends `body`, then stays open — a provider between
   * two bytes — until the request is aborted. */
  function openSse(body: string, signal?: AbortSignal): Response {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        signal?.addEventListener(
          'abort',
          () => controller.error(signal.reason),
          { once: true },
        );
      },
    });
    return new Response(stream, {
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
    options: { cancelOnProgress?: boolean; tools?: boolean } = {},
  ) {
    const booked: UsageLedgerEntry[] = [];
    const settled: Array<Record<string, unknown>> = [];
    /** Every call the turn asked its tools to run. */
    const executed: ToolCallRequest[] = [];
    const tools: ChatToolExecutor = {
      wireTools: [
        {
          name: 'lookup',
          description: 'Look up a fact.',
          parameters: { type: 'object' },
        },
      ],
      execute(call) {
        executed.push(call);
        return Promise.resolve({ status: 'ok', results: [] });
      },
    };
    const deps: TurnDeps = {
      harnesses: buildHarnessTable([]),
      model,
      ...(options.tools === true ? { tools } : {}),
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
    return { outcome, booked, settled: settled.at(-1), executed };
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

  it.each([
    ['anthropic', 'rate_limit_error'],
    ['anthropic', 'invalid_request_error'],
    ['openai', 'rate_limit_exceeded'],
    ['openai', 'insufficient_quota'],
  ] as const)(
    'books nothing for a pre-answer %s %s refusal after a keep-alive',
    async (adapter, code) => {
      const failure =
        adapter === 'anthropic'
          ? { type: 'error', error: { type: code, message: 'Request refused' } }
          : { error: { code, message: 'Request refused' } };
      const { outcome, booked, settled } = await turnOver(
        providerModel(() => rawSse(frames({ type: 'ping' }, failure)), adapter),
      );
      expect(outcome).toMatchObject({ status: 'refused', step: 'stream' });
      expect(booked).toEqual([]);
      expect(settled).not.toHaveProperty('usage');
    },
  );

  it('books nothing for slow_down even when a broader error type is present', async () => {
    const { outcome, booked, settled } = await turnOver(
      providerModel(
        () =>
          rawSse(
            frames(
              { type: 'ping' },
              {
                error: {
                  code: 'slow_down',
                  type: 'rate_limit_error',
                  message: 'Request refused',
                },
              },
            ),
          ),
        'openai',
      ),
    );
    expect(outcome).toMatchObject({ status: 'refused', step: 'stream' });
    expect(booked).toEqual([]);
    expect(settled).not.toHaveProperty('usage');
  });

  it.each(['rate_limit_exceeded', 'slow_down'])(
    'keeps positive usage billable through a later %s request refusal',
    async (code) => {
      const { outcome, booked } = await turnOver(
        providerModel(
          () =>
            rawSse(
              frames(USAGE, {
                error: {
                  code,
                  message: 'Request refused',
                },
              }),
            ),
          'openai',
        ),
      );
      expect(outcome.status).toBe('refused');
      expect(booked).toMatchObject([
        { inputTokens: 100, outputTokens: 5, totalTokens: 105 },
      ]);
    },
  );

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

  /**
   * A tool call reaches the turn only when its stream settles, whole. A
   * refusal the provider reported while the model was writing one used to
   * read as a refusal before any answer and booked nothing, although the
   * provider had read the prompt and the model had written. The round is
   * booked the way every failed round is; the call it began never runs.
   */
  describe('after the model began a tool call', () => {
    it('books the round of a later refusal as a provider fault there books it, and runs no call', async () => {
      const refused = await turnOver(
        providerModel(
          () => rawSse(frames(TOOL_CALL, RATE_LIMIT_ON_STREAM.openai)),
          'openai',
        ),
        { tools: true },
      );
      expect(refused.outcome).toMatchObject({
        status: 'refused',
        step: 'stream',
      });
      expect(refused.booked).toHaveLength(1);
      const [booked] = refused.booked;
      expect(booked?.inputTokens).toBeGreaterThan(0);
      expect(booked?.outputTokens).toBe(0);
      expect(refused.settled?.usage).toEqual({
        inputTokens: booked?.inputTokens,
        outputTokens: 0,
        totalTokens: booked?.inputTokens,
        estimated: true,
      });
      expect(decodeChatError(refused.settled?.error as string).code).toBe(
        'rate_limited',
      );
      expect(refused.executed).toEqual([]);

      // The failed-round accounting every round shares: a provider fault at
      // the same point books the same round.
      const fault = await turnOver(
        providerModel(
          () => rawSse(frames(TOOL_CALL, OPENROUTER_ERROR)),
          'openai',
        ),
        { tools: true },
      );
      expect(refused.booked).toEqual(fault.booked);
      expect(refused.settled?.usage).toEqual(fault.settled?.usage);
      expect(fault.executed).toEqual([]);
    });

    it.each([
      [
        'an OpenAI-compatible call whose arguments follow its name',
        'openai',
        [
          {
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_1',
                      type: 'function',
                      function: { name: 'lookup', arguments: '' },
                    },
                  ],
                },
              },
            ],
          },
          {
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    { index: 0, function: { arguments: '{"query":' } },
                  ],
                },
              },
            ],
          },
        ],
      ],
      [
        'an Anthropic tool_use block after a message_start of nothing',
        'anthropic',
        [
          {
            type: 'message_start',
            message: { usage: { input_tokens: 0, output_tokens: 0 } },
          },
          {
            type: 'content_block_start',
            index: 0,
            content_block: {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'lookup',
              input: {},
            },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: '{"query":' },
          },
        ],
      ],
      [
        'a Responses API function call',
        'openai-responses',
        [
          {
            type: 'response.output_item.added',
            output_index: 0,
            item: {
              type: 'function_call',
              id: 'fc_1',
              call_id: 'call_1',
              name: 'lookup',
              arguments: '',
            },
          },
          {
            type: 'response.function_call_arguments.delta',
            output_index: 0,
            item_id: 'fc_1',
            delta: '{"query":',
          },
        ],
      ],
    ] as const)(
      'books the round once when a refusal cuts %s',
      async (_name, dialect, events) => {
        const { outcome, booked, settled, executed } = await turnOver(
          providerModel(
            () => rawSse(frames(...events, RATE_LIMIT_ON_STREAM[dialect])),
            dialect,
          ),
          { tools: true },
        );
        expect(outcome).toMatchObject({ status: 'refused', step: 'stream' });
        expect(booked).toHaveLength(1);
        expect(booked[0]?.inputTokens).toBeGreaterThan(0);
        expect(booked[0]?.outputTokens).toBe(0);
        expect(settled?.usage).toMatchObject({
          inputTokens: booked[0]?.inputTokens,
          estimated: true,
        });
        expect(executed).toEqual([]);
      },
    );

    it('takes the call, not a zero-count frame before it, for the answer', async () => {
      const afterZero = await turnOver(
        providerModel(
          () =>
            rawSse(frames(ZERO_USAGE, TOOL_CALL, RATE_LIMIT_ON_STREAM.openai)),
          'openai',
        ),
        { tools: true },
      );
      const alone = await turnOver(
        providerModel(
          () => rawSse(frames(TOOL_CALL, RATE_LIMIT_ON_STREAM.openai)),
          'openai',
        ),
        { tools: true },
      );
      expect(afterZero.booked).toHaveLength(1);
      expect(afterZero.booked).toEqual(alone.booked);
      expect(afterZero.settled?.usage).toEqual(alone.settled?.usage);
      expect(afterZero.executed).toEqual([]);
    });

    it.each(NO_ANSWER_FRAMES)(
      'books nothing for a refusal after %s',
      async (_name, dialect, noAnswer) => {
        // A keep-alive comment and a frame cut mid-JSON ride along: neither
        // is an answer either.
        const { outcome, booked, settled, executed } = await turnOver(
          providerModel(
            () =>
              rawSse(
                `: keep-alive\n\ndata: {"choices":[{"delta":{"tool_calls":[\n\n${frames(noAnswer, RATE_LIMIT_ON_STREAM[dialect])}`,
              ),
            dialect,
          ),
          { tools: true },
        );
        expect(outcome).toMatchObject({ status: 'refused', step: 'stream' });
        expect(booked).toEqual([]);
        expect(settled).not.toHaveProperty('usage');
        expect(executed).toEqual([]);
      },
    );

    it('books the usage the failure reports itself, once, as reported', async () => {
      const { booked, settled, executed } = await turnOver(
        providerModel(
          () =>
            rawSse(
              frames(TOOL_CALL, {
                ...RATE_LIMITED,
                usage: { prompt_tokens: 100, completion_tokens: 5 },
              }),
            ),
          'openai',
        ),
        { tools: true },
      );
      expect(booked).toMatchObject([
        { inputTokens: 100, outputTokens: 5, totalTokens: 105 },
      ]);
      expect(settled?.usage).toEqual({
        inputTokens: 100,
        outputTokens: 5,
        totalTokens: 105,
      });
      expect(executed).toEqual([]);
    });

    it('keeps the input an Anthropic message_start reported, and estimates the rest', async () => {
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
                  type: 'content_block_start',
                  index: 0,
                  content_block: {
                    type: 'tool_use',
                    id: 'toolu_1',
                    name: 'lookup',
                    input: {},
                  },
                },
                RATE_LIMIT_ON_STREAM.anthropic,
              ),
            ),
          'anthropic',
        ),
        { tools: true },
      );
      expect(booked).toMatchObject([
        { inputTokens: 100, outputTokens: 0, totalTokens: 100 },
      ]);
      expect(settled?.usage).toMatchObject({
        inputTokens: 100,
        outputTokens: 0,
        estimated: true,
      });
    });

    it('counts the text before the call as the output, and the call as nothing', async () => {
      const withCall = await turnOver(
        providerModel(
          () => rawSse(frames(TEXT, TOOL_CALL, RATE_LIMIT_ON_STREAM.openai)),
          'openai',
        ),
        { tools: true },
      );
      const textOnly = await turnOver(
        providerModel(
          () => rawSse(frames(TEXT, RATE_LIMIT_ON_STREAM.openai)),
          'openai',
        ),
        { tools: true },
      );
      expect(withCall.booked).toHaveLength(1);
      expect(withCall.booked[0]?.outputTokens).toBeGreaterThan(0);
      expect(withCall.booked).toEqual(textOnly.booked);
      expect(withCall.executed).toEqual([]);
    });

    it('books a call the user stopped mid-arguments once, and never runs it', async () => {
      // The model is still writing the call when the user stops the reply:
      // the store reports the Stop on its next poll, and the abort ends the
      // body the way it ends a real fetch.
      const partial = {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'lookup', arguments: '{"query":"ret' },
                },
              ],
            },
          },
        ],
      };
      const { outcome, booked, settled, executed } = await turnOver(
        providerModel(
          (_round, signal) => openSse(frames(partial), signal),
          'openai',
        ),
        { tools: true, cancelOnProgress: true },
      );
      expect(outcome).toMatchObject({ status: 'completed', cancelled: true });
      expect(booked).toHaveLength(1);
      expect(booked[0]?.inputTokens).toBeGreaterThan(0);
      expect(booked[0]?.outputTokens).toBe(0);
      expect(settled?.usage).toMatchObject({
        finishReason: 'cancelled',
        estimated: true,
      });
      expect(settled?.parts).toEqual([]);
      expect(executed).toEqual([]);
    }, 10_000);

    describe('after a finished tool round', () => {
      /** Round 1 calls the tool and reports 80 in, 20 out; its call runs. */
      const FINISHED_ROUND = `${frames(TOOL_CALL, {
        choices: [],
        usage: { prompt_tokens: 80, completion_tokens: 20 },
      })}data: [DONE]\n\n`;
      const NEXT_CALL = {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_2',
                  type: 'function',
                  function: {
                    name: 'lookup',
                    arguments: '{"query":"refunds"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      };

      it('keeps the finished round alone when the next is refused before any answer', async () => {
        const { booked, settled, executed } = await turnOver(
          providerModel(
            (round) =>
              rawSse(
                round === 1
                  ? FINISHED_ROUND
                  : frames(RATE_LIMIT_ON_STREAM.openai),
              ),
            'openai',
          ),
          { tools: true },
        );
        expect(executed).toMatchObject([{ id: 'call_1' }]);
        expect(booked).toMatchObject([
          { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
        ]);
        expect(settled?.usage).toEqual({
          inputTokens: 80,
          outputTokens: 20,
          totalTokens: 100,
        });
      });

      it('adds the next round once when it is refused after the model began another call', async () => {
        const refused = await turnOver(
          providerModel(
            (round) =>
              rawSse(
                round === 1
                  ? FINISHED_ROUND
                  : frames(NEXT_CALL, RATE_LIMIT_ON_STREAM.openai),
              ),
            'openai',
          ),
          { tools: true },
        );
        // The finished round's call ran; the one the refusal cut never does.
        expect(refused.executed).toMatchObject([{ id: 'call_1' }]);
        expect(refused.booked).toHaveLength(1);
        expect(refused.booked[0]?.inputTokens).toBeGreaterThan(80);
        expect(refused.booked[0]?.outputTokens).toBe(20);
        expect(refused.settled?.usage).toMatchObject({ estimated: true });

        // Both rounds in one row, as a provider fault there books them.
        const fault = await turnOver(
          providerModel(
            (round) =>
              rawSse(
                round === 1
                  ? FINISHED_ROUND
                  : frames(NEXT_CALL, OPENROUTER_ERROR),
              ),
            'openai',
          ),
          { tools: true },
        );
        expect(refused.booked).toEqual(fault.booked);
        expect(refused.settled?.usage).toEqual(fault.settled?.usage);
      });
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

/**
 * Where a reply was served is what the provider's own response says: the
 * upstream OpenRouter names on its chunks, the model id a provider reports,
 * the inference geography Anthropic echoes, the region Azure names in a
 * header. Read only after the provider accepted the request, so a refusal
 * leaves nothing behind.
 */
describe('where a reply was served — the decoder and the wire', () => {
  it('reads OpenRouter’s upstream and the served model off a chunk', () => {
    expect(
      readServedBy('openai', {
        id: 'gen-1',
        provider: 'Google Vertex',
        model: 'anthropic/claude-4.6-sonnet-20260217',
        choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: null }],
      }),
    ).toEqual({
      provider: 'Google Vertex',
      model: 'anthropic/claude-4.6-sonnet-20260217',
    });
    expect(
      readServedBy('openai', { choices: [{ index: 0, delta: {} }] }),
    ).toBeUndefined();
  });

  it('reads the Anthropic model and inference geography', () => {
    expect(
      readServedBy('anthropic', {
        type: 'message_start',
        message: {
          model: 'claude-fable-5-20260115',
          usage: { input_tokens: 10, inference_geo: 'us' },
        },
      }),
    ).toEqual({ model: 'claude-fable-5-20260115', region: 'us' });
    expect(
      readServedBy('anthropic', {
        type: 'message_delta',
        usage: { output_tokens: 3, inference_geo: 'global' },
      }),
    ).toEqual({ region: 'global' });
    expect(
      readServedBy('anthropic', {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Hi' },
      }),
    ).toBeUndefined();
  });

  it('reads the model a Responses API response names', () => {
    expect(
      readServedBy('openai-responses', {
        type: 'response.created',
        response: { model: 'gpt-6.1-sol-2026-09-01' },
      }),
    ).toEqual({ model: 'gpt-6.1-sol-2026-09-01' });
    expect(
      readServedBy('openai-responses', {
        type: 'response.output_text.delta',
        delta: 'Hi',
      }),
    ).toBeUndefined();
  });

  it('reads the region Azure names in a header', () => {
    expect(
      readServedByHeaders(new Headers({ 'x-ms-region': 'Sweden Central' })),
    ).toEqual({ region: 'Sweden Central' });
    expect(readServedByHeaders(new Headers())).toBeUndefined();
  });

  it('reports a served fact once, not on every chunk that repeats it', async () => {
    const chunk = (content: string) => ({
      provider: 'Anthropic',
      model: 'anthropic/claude-4.6-sonnet-20260217',
      choices: [{ index: 0, delta: { content }, finish_reason: null }],
    });
    const chunks = await chunksOf(
      sseResponse([chunk('Return '), chunk('it '), chunk('today.')]),
      'openai',
    );
    expect(chunks.map((part) => part.text).join('')).toBe('Return it today.');
    expect(chunks.filter((part) => part.serving !== undefined)).toEqual([
      expect.objectContaining({
        text: 'Return ',
        serving: {
          provider: 'Anthropic',
          model: 'anthropic/claude-4.6-sonnet-20260217',
        },
      }),
    ]);
  });

  it('hands on the header and endpoint facts once the provider accepted', async () => {
    const response = sseResponse([
      { choices: [{ index: 0, delta: { content: 'Hi.' } }] },
    ]);
    const headers = new Headers(response.headers);
    headers.set('x-ms-region', 'Switzerland North');
    const stall = createStallGuard();
    const chunks = [];
    try {
      for await (const chunk of streamProviderAnswer(
        new Response(response.body, { headers }),
        'openai',
        stall,
        undefined,
        { endpoint: { host: 'eu.openrouter.ai', region: 'europe' } },
      )) {
        chunks.push(chunk);
      }
    } finally {
      stall.dispose();
    }
    expect(chunks[0]).toEqual({
      text: '',
      serving: {
        endpoint: { host: 'eu.openrouter.ai', region: 'europe' },
        region: 'Switzerland North',
      },
    });
  });

  it('names nothing for a request the provider refused', async () => {
    const stall = createStallGuard();
    const chunks: ModelStreamChunk[] = [];
    try {
      await expect(
        (async () => {
          for await (const chunk of streamProviderAnswer(
            new Response('{"error":"rate limited"}', {
              status: 429,
              headers: { 'x-ms-region': 'Sweden Central' },
            }),
            'openai',
            stall,
            undefined,
            { endpoint: { host: 'eu.openrouter.ai', region: 'europe' } },
          )) {
            chunks.push(chunk);
          }
        })(),
      ).rejects.toThrow(/answered 429/);
    } finally {
      stall.dispose();
    }
    expect(chunks).toEqual([]);
  });
});
