// @vitest-environment node

/**
 * A gateway — an OpenAI-format provider that lists the vendor models it
 * routes from its own models endpoint — is asked on its Responses API for an
 * OpenAI model whose vendor serves tools only there: its own translation back
 * into Chat Completions can lose a call's arguments, which the Responses API
 * delivers whole on the events that close the call. A gateway that refuses
 * is asked on Chat Completions in the same round; a Chat Completions round
 * that loses a call's arguments sends the model's later rounds to the
 * Responses API. Driven against a stubbed gateway: its model listing, its
 * Responses API and its Chat Completions.
 */

import { providerDefinitionSchema } from '@tale/shared/schemas/providers';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';

import type {
  ModelCallRequest,
  ModelStreamChunk,
} from '../../../lib/chat/turn';
import { setSafeFetchResolverForTests } from '../../../lib/net/safe-fetch';
import type { ActionCtx } from '../lib/ctx';
import { loadProviderDefinitions } from '../lib/providers/load_system_config';
import { forgetGatewayWires } from './gateway_wire';
import { createDirectModelCall, type DirectWire } from './turn_action';

const BASE_URL = 'https://gateway.example.com/v1';

const gateway = providerDefinitionSchema.parse({
  name: 'awl-gateway',
  displayName: 'Gateway',
  apiFormat: 'openai',
  baseUrl: BASE_URL,
  catalog: { source: 'models-endpoint' },
  embedding: 'unknown',
  auth: [{ method: 'api-key' }],
});

const wire: DirectWire = {
  apiFormat: 'openai',
  baseUrl: BASE_URL,
  apiKey: 'sk-gateway',
  attribution: {},
};

/** The gateway's listing: vendor models by id, window and price only, the
 * way Bifrost publishes them. */
const LISTING = {
  data: [
    'openai/gpt-5.6-luna',
    'openai/gpt-5.6-sol',
    'openai/gpt-6.1-sol',
    'openai/gpt-5.3-chat-latest',
    'acme/house-model',
  ].map((id) => ({
    id,
    object: 'model',
    context_length: 400000,
    pricing: { prompt: '0.0000002', completion: '0.0000012' },
  })),
};

/** The call reads nothing off the context unless a message carries an
 * attachment to inline. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- unread without attachments
const ctx = {} as ActionCtx;

const WEB_FETCH = {
  name: 'web_fetch',
  description: 'Read a web page.',
  parameters: {
    type: 'object',
    properties: { url: { type: 'string' } },
    required: ['url'],
  },
};
const LIST_SKILLS = {
  name: 'list_skills',
  description: 'List the skills.',
  parameters: { type: 'object', properties: {} },
};

function request(overrides: Partial<ModelCallRequest>): ModelCallRequest {
  return {
    organizationId: 'org_a',
    model: 'openai/gpt-5.6-luna',
    providerSlug: 'awl-gateway',
    system: 'GUIDE',
    messages: [
      {
        role: 'user',
        parts: [{ type: 'text', text: 'Read https://example.com/notes' }],
      },
    ],
    tools: [WEB_FETCH, LIST_SKILLS],
    execution: { mode: 'direct' },
    sampling: {
      maxTokens: 4096,
      temperature: 0.7,
      reasoning: { kind: 'effort', value: 'medium' },
    },
    ...overrides,
  };
}

/** A Responses API stream: an `event:` line naming each event, then its
 * `data:` line. */
function responsesStream(events: readonly Record<string, unknown>[]): Response {
  return new Response(
    events
      .map(
        (event) =>
          `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`,
      )
      .join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

/** A Chat Completions stream of `chunks`, closed by `[DONE]`. */
function chatStream(chunks: readonly Record<string, unknown>[]): Response {
  return new Response(
    `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`,
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

/** One `web_fetch` call whose arguments arrive only on the events that close
 * it — no argument delta at all, as the OpenAI Codex backend sends them. */
const ARGUMENTS_ONLY_ON_CLOSE = [
  { type: 'response.created', response: { model: 'gpt-5.6-luna' } },
  {
    type: 'response.output_item.added',
    output_index: 0,
    item: {
      type: 'function_call',
      id: 'fc_1',
      call_id: 'call_notes',
      name: 'web_fetch',
      arguments: '',
    },
  },
  {
    type: 'response.function_call_arguments.done',
    output_index: 0,
    item_id: 'fc_1',
    arguments: '{"url":"https://example.com/notes"}',
  },
  {
    type: 'response.output_item.done',
    output_index: 0,
    item: {
      type: 'function_call',
      id: 'fc_1',
      call_id: 'call_notes',
      name: 'web_fetch',
      arguments: '{"url":"https://example.com/notes"}',
    },
  },
  {
    type: 'response.completed',
    response: {
      model: 'gpt-5.6-luna',
      usage: { input_tokens: 40, output_tokens: 12 },
    },
  },
];

/** The same call as a converter that reads only deltas hands it on: named,
 * with no argument bytes. */
const CALL_WITHOUT_ARGUMENTS = [
  {
    choices: [
      {
        index: 0,
        delta: {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'call_notes',
              type: 'function',
              function: { name: 'web_fetch', arguments: '' },
            },
          ],
        },
      },
    ],
  },
  { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
];

const TEXT_REPLY = [
  { choices: [{ index: 0, delta: { content: 'Hi.' }, finish_reason: 'stop' }] },
];

interface Seen {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

function urlOf(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  throw new Error('fetch was called with no URL');
}

/** Stub the gateway: its listing answers on `/models`, and each model
 * request — recorded — gets the next answer for its endpoint. */
function stubGateway(answers: {
  responses?: Array<() => Response>;
  chat?: Array<() => Response>;
}): Seen[] {
  const seen: Seen[] = [];
  const queues = {
    responses: [...(answers.responses ?? [])],
    chat: [...(answers.chat ?? [])],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = urlOf(input);
      if (url === `${BASE_URL}/models`) return Response.json(LISTING);
      const body: unknown =
        typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      seen.push({
        url,
        body: typeof body === 'object' && body !== null ? { ...body } : {},
      });
      const queue = url.endsWith('/responses')
        ? queues.responses
        : url.endsWith('/chat/completions')
          ? queues.chat
          : undefined;
      const answer = queue?.shift();
      if (answer === undefined) {
        throw new Error(`the stub gateway has no answer left for ${url}`);
      }
      return answer();
    }),
  );
  return seen;
}

async function run(
  call: ReturnType<typeof createDirectModelCall>,
  overrides: Partial<ModelCallRequest> = {},
): Promise<ModelStreamChunk[]> {
  const chunks: ModelStreamChunk[] = [];
  for await (const chunk of call(request(overrides))) chunks.push(chunk);
  return chunks;
}

describe('createDirectModelCall — an OpenAI model on a gateway', () => {
  let warn: MockInstance<typeof console.warn>;

  beforeEach(() => {
    forgetGatewayWires();
    setSafeFetchResolverForTests(() =>
      Promise.resolve([{ address: '93.184.216.34', family: 4 }]),
    );
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    forgetGatewayWires();
    setSafeFetchResolverForTests(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ['with any reasoning effort (GPT-5.6 Luna)', 'openai/gpt-5.6-luna'],
    ['at all (GPT-6.1 Sol)', 'openai/gpt-6.1-sol'],
  ])(
    'asks the Responses API for a model whose vendor serves its tools only there %s, and reads arguments sent only on the closing events',
    async (_label, model) => {
      const seen = stubGateway({
        responses: [() => responsesStream(ARGUMENTS_ONLY_ON_CLOSE)],
      });
      const chunks = await run(
        createDirectModelCall(ctx, 'org_a', gateway, wire),
        { model },
      );
      expect(seen.map((sent) => sent.url)).toEqual([`${BASE_URL}/responses`]);
      expect(seen[0]?.body).toMatchObject({
        model,
        instructions: 'GUIDE',
        max_output_tokens: 4096,
        reasoning: { effort: 'medium' },
        tools: [
          expect.objectContaining({ type: 'function', name: 'web_fetch' }),
          expect.objectContaining({ type: 'function', name: 'list_skills' }),
        ],
        store: false,
        stream: true,
      });
      // The listing row reads as reasoning through the vendor's entry, so the
      // platform's temperature stays off; the Responses API refuses the Chat
      // Completions usage option.
      expect(seen[0]?.body).not.toHaveProperty('temperature');
      expect(seen[0]?.body).not.toHaveProperty('stream_options');
      expect(chunks.at(-1)).toMatchObject({
        finishReason: 'tool-calls',
        toolCalls: [
          {
            id: 'call_notes',
            name: 'web_fetch',
            input: { url: 'https://example.com/notes' },
          },
        ],
      });
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'a model whose tools the vendor takes there too',
      'openai/gpt-5.3-chat-latest',
    ],
    ['a model the shipped catalogs do not know', 'acme/house-model'],
  ])('asks Chat Completions for %s', async (_label, model) => {
    const seen = stubGateway({ chat: [() => chatStream(TEXT_REPLY)] });
    const chunks = await run(
      createDirectModelCall(ctx, 'org_a', gateway, wire),
      { model },
    );
    expect(seen.map((sent) => sent.url)).toEqual([
      `${BASE_URL}/chat/completions`,
    ]);
    expect(seen[0]?.body).toMatchObject({
      model,
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(chunks.map((chunk) => chunk.text).join('')).toBe('Hi.');
  });

  it("leaves the vendor's own connector on its own wire", async () => {
    const openai = loadProviderDefinitions().find(
      (provider) => provider.name === 'openai',
    );
    if (openai === undefined)
      throw new Error('the shipped openai provider is gone');
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        seen.push(urlOf(input));
        return chatStream(TEXT_REPLY);
      }),
    );
    await run(
      createDirectModelCall(ctx, 'org_a', openai, {
        ...wire,
        wireDialect: 'openai-modern',
        baseUrl: 'https://api.openai.com/v1',
      }),
      { model: 'gpt-5.6-luna', providerSlug: 'openai' },
    );
    expect(seen).toEqual(['https://api.openai.com/v1/chat/completions']);
  });

  it.each([400, 401, 403, 404, 405, 415, 422, 501])(
    'asks Chat Completions in the same round when the gateway refuses the Responses API with %i, and goes there directly next time',
    async (status) => {
      const seen = stubGateway({
        responses: [
          () => new Response('{"error":"unknown route"}', { status }),
          () => responsesStream(ARGUMENTS_ONLY_ON_CLOSE),
        ],
        chat: [() => chatStream(TEXT_REPLY), () => chatStream(TEXT_REPLY)],
      });
      const call = createDirectModelCall(ctx, 'org_a', gateway, wire);
      const accepted = vi.fn();
      const first = await run(call, { onAccepted: accepted });
      expect(first.map((chunk) => chunk.text).join('')).toBe('Hi.');
      expect(seen.map((sent) => sent.url)).toEqual([
        `${BASE_URL}/responses`,
        `${BASE_URL}/chat/completions`,
      ]);
      // The refusal consumed nothing: only the answer the round reads says
      // the prompt was accepted.
      expect(accepted).toHaveBeenCalledTimes(1);
      expect(seen[1]?.body).toMatchObject({
        model: 'openai/gpt-5.6-luna',
        stream_options: { include_usage: true },
      });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          `[chat] provider "awl-gateway" refused the Responses API for model "openai/gpt-5.6-luna" (${status}: {"error":"unknown route"})`,
        ),
      );

      await run(call);
      expect(seen.map((sent) => sent.url).slice(2)).toEqual([
        `${BASE_URL}/chat/completions`,
      ]);
      // The refusal is the model's: another model on the gateway still asks.
      await run(call, { model: 'openai/gpt-5.6-sol' });
      expect(seen.map((sent) => sent.url).slice(3)).toEqual([
        `${BASE_URL}/responses`,
      ]);
    },
  );

  it("keeps one organization's refusal from another organization on the same gateway", async () => {
    const seen = stubGateway({
      responses: [
        () => new Response('{"error":"route not allowed"}', { status: 403 }),
        () => responsesStream(ARGUMENTS_ONLY_ON_CLOSE),
      ],
      chat: [() => chatStream(TEXT_REPLY)],
    });
    await run(createDirectModelCall(ctx, 'org_a', gateway, wire));
    const other = await run(createDirectModelCall(ctx, 'org_b', gateway, wire));
    expect(seen.map((sent) => sent.url)).toEqual([
      `${BASE_URL}/responses`,
      `${BASE_URL}/chat/completions`,
      `${BASE_URL}/responses`,
    ]);
    expect(other.at(-1)).toMatchObject({
      toolCalls: [{ input: { url: 'https://example.com/notes' } }],
    });
  });

  it.each([429, 500, 503])(
    'surfaces a %i on the Responses API as it is: Chat Completions would share it',
    async (status) => {
      const seen = stubGateway({
        responses: [() => new Response('{"error":"nope"}', { status })],
      });
      await expect(
        run(createDirectModelCall(ctx, 'org_a', gateway, wire)),
      ).rejects.toMatchObject({
        message: expect.stringContaining(
          `The model provider answered ${status}`,
        ),
        status,
      });
      expect(seen.map((sent) => sent.url)).toEqual([`${BASE_URL}/responses`]);
    },
  );

  it('surfaces the Chat Completions refusal of a request both wires refuse, and asks the Responses API again next time', async () => {
    const overWindow = () =>
      new Response('{"error":"the prompt is over the context window"}', {
        status: 400,
      });
    const seen = stubGateway({
      responses: [overWindow, () => responsesStream(ARGUMENTS_ONLY_ON_CLOSE)],
      chat: [overWindow],
    });
    const call = createDirectModelCall(ctx, 'org_a', gateway, wire);
    await expect(run(call)).rejects.toMatchObject({
      message: expect.stringContaining('The model provider answered 400'),
      status: 400,
    });
    // The request failed for itself, not for the wire: the next round asks
    // the Responses API again, and its arguments arrive whole.
    const next = await run(call);
    expect(seen.map((sent) => sent.url)).toEqual([
      `${BASE_URL}/responses`,
      `${BASE_URL}/chat/completions`,
      `${BASE_URL}/responses`,
    ]);
    expect(next.at(-1)).toMatchObject({
      toolCalls: [{ input: { url: 'https://example.com/notes' } }],
    });
  });

  it("sends a model's later rounds to the Responses API once a Chat Completions round loses a call's arguments", async () => {
    const seen = stubGateway({
      chat: [() => chatStream(CALL_WITHOUT_ARGUMENTS)],
      responses: [() => responsesStream(ARGUMENTS_ONLY_ON_CLOSE)],
    });
    const call = createDirectModelCall(ctx, 'org_a', gateway, wire);
    const first = await run(call, { model: 'acme/house-model' });
    // The round's call runs as it came: its tool asks for the input it
    // lacks, and the model calls again.
    expect(first.at(-1)).toMatchObject({
      toolCalls: [{ id: 'call_notes', name: 'web_fetch', input: {} }],
    });
    expect(warn).toHaveBeenCalledWith(
      `[chat] provider "awl-gateway" streamed a "web_fetch" call from model "acme/house-model" without its arguments on Chat Completions; later rounds ask its Responses API`,
    );
    const second = await run(call, { model: 'acme/house-model' });
    expect(seen.map((sent) => sent.url)).toEqual([
      `${BASE_URL}/chat/completions`,
      `${BASE_URL}/responses`,
    ]);
    expect(second.at(-1)).toMatchObject({
      toolCalls: [{ input: { url: 'https://example.com/notes' } }],
    });
  });

  it.each([
    ['a tool that takes no input, called with nothing', 'list_skills', ''],
    ['a call whose model sent an empty object', 'web_fetch', '{}'],
  ])('reads no loss into %s', async (_label, name, args) => {
    const seen = stubGateway({
      chat: [
        () =>
          chatStream([
            {
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_1',
                        type: 'function',
                        function: { name, arguments: args },
                      },
                    ],
                  },
                  finish_reason: 'tool_calls',
                },
              ],
            },
          ]),
        () => chatStream(TEXT_REPLY),
      ],
    });
    const call = createDirectModelCall(ctx, 'org_a', gateway, wire);
    await run(call, { model: 'acme/house-model' });
    await run(call, { model: 'acme/house-model' });
    expect(seen.map((sent) => sent.url)).toEqual([
      `${BASE_URL}/chat/completions`,
      `${BASE_URL}/chat/completions`,
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps Chat Completions when the gateway refused the Responses API, whatever is lost there', async () => {
    const seen = stubGateway({
      responses: [() => new Response('Not Found', { status: 404 })],
      chat: [
        () => chatStream(CALL_WITHOUT_ARGUMENTS),
        () => chatStream(TEXT_REPLY),
      ],
    });
    const call = createDirectModelCall(ctx, 'org_a', gateway, wire);
    await run(call);
    expect(warn).toHaveBeenLastCalledWith(
      `[chat] provider "awl-gateway" streamed a "web_fetch" call from model "openai/gpt-5.6-luna" without its arguments on Chat Completions; it refused the Responses API, so later rounds stay on Chat Completions`,
    );
    await run(call);
    expect(seen.map((sent) => sent.url)).toEqual([
      `${BASE_URL}/responses`,
      `${BASE_URL}/chat/completions`,
      `${BASE_URL}/chat/completions`,
    ]);
  });

  it.each([
    ['the top step', 'max'],
    ['the step below it', 'extra'],
  ] as const)(
    'asks the gateway for xhigh where the user chose %s: GPT-5.5 and 5.6 take no max',
    async (_label, value) => {
      const seen = stubGateway({
        responses: [() => responsesStream(ARGUMENTS_ONLY_ON_CLOSE)],
      });
      await run(createDirectModelCall(ctx, 'org_a', gateway, wire), {
        sampling: {
          maxTokens: 4096,
          reasoning: { kind: 'effort', value },
        },
      });
      expect(seen[0]?.body).toMatchObject({ reasoning: { effort: 'xhigh' } });
    },
  );

  it("keeps the vendor's Responses-only model at its own top step, and never falls back for it", async () => {
    const openai = loadProviderDefinitions().find(
      (provider) => provider.name === 'openai',
    );
    if (openai === undefined)
      throw new Error('the shipped openai provider is gone');
    const seen: Seen[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const body: unknown =
          typeof init?.body === 'string' ? JSON.parse(init.body) : {};
        seen.push({
          url: urlOf(input),
          body: typeof body === 'object' && body !== null ? { ...body } : {},
        });
        return new Response('Not Found', { status: 404 });
      }),
    );
    await expect(
      run(
        createDirectModelCall(ctx, 'org_a', openai, {
          ...wire,
          wireDialect: 'openai-modern',
          baseUrl: 'https://api.openai.com/v1',
        }),
        {
          model: 'gpt-6.1-sol',
          providerSlug: 'openai',
          toolCallingApi: 'responses',
          sampling: {
            maxTokens: 4096,
            reasoning: { kind: 'effort', value: 'max' },
          },
        },
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(seen.map((sent) => sent.url)).toEqual([
      'https://api.openai.com/v1/responses',
    ]);
    expect(seen[0]?.body).toMatchObject({ reasoning: { effort: 'max' } });
  });

  it('counts a custom provider with hand-entered model IDs as a gateway', async () => {
    const byHand = providerDefinitionSchema.parse({
      name: 'awl-by-hand',
      displayName: 'Gateway by hand',
      apiFormat: 'openai',
      baseUrl: BASE_URL,
      catalog: { source: 'none' },
      embedding: 'unknown',
      auth: [{ method: 'api-key' }],
    });
    const seen = stubGateway({
      responses: [() => responsesStream(ARGUMENTS_ONLY_ON_CLOSE)],
    });
    const chunks = await run(
      createDirectModelCall(ctx, 'org_a', byHand, wire),
      { providerSlug: 'awl-by-hand' },
    );
    expect(seen.map((sent) => sent.url)).toEqual([`${BASE_URL}/responses`]);
    expect(chunks.at(-1)).toMatchObject({
      toolCalls: [{ input: { url: 'https://example.com/notes' } }],
    });
  });

  it('leaves the shipped Azure provider, which serves its own deployments, on Chat Completions', async () => {
    const azure = loadProviderDefinitions().find(
      (provider) => provider.name === 'azure',
    );
    if (azure === undefined)
      throw new Error('the shipped azure provider is gone');
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        seen.push(urlOf(input));
        return chatStream(TEXT_REPLY);
      }),
    );
    const base = 'https://example-resource.openai.azure.com/openai/v1';
    await run(
      createDirectModelCall(ctx, 'org_a', azure, {
        ...wire,
        wireDialect: 'openai-modern',
        baseUrl: base,
      }),
      { model: 'gpt-5.6-luna', providerSlug: 'azure' },
    );
    expect(seen).toEqual([`${base}/chat/completions`]);
  });

  it('reads no loss into a reply the output cap cut right after naming its tool', async () => {
    const seen = stubGateway({
      chat: [
        () =>
          chatStream([
            {
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_cut',
                        type: 'function',
                        function: { name: 'web_fetch', arguments: '' },
                      },
                    ],
                  },
                  finish_reason: 'length',
                },
              ],
            },
          ]),
        () => chatStream(TEXT_REPLY),
      ],
    });
    const call = createDirectModelCall(ctx, 'org_a', gateway, wire);
    await run(call, { model: 'acme/house-model' });
    await run(call, { model: 'acme/house-model' });
    expect(seen.map((sent) => sent.url)).toEqual([
      `${BASE_URL}/chat/completions`,
      `${BASE_URL}/chat/completions`,
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('sends a model back to Chat Completions when a Responses round a lost call picked fails on the stream', async () => {
    const seen = stubGateway({
      chat: [
        () => chatStream(CALL_WITHOUT_ARGUMENTS),
        () => chatStream(TEXT_REPLY),
      ],
      responses: [
        () =>
          responsesStream([
            {
              type: 'response.failed',
              response: {
                error: {
                  code: 'model_not_supported',
                  message: 'acme/house-model takes no Responses requests',
                },
              },
            },
          ]),
      ],
    });
    const call = createDirectModelCall(ctx, 'org_a', gateway, wire);
    await run(call, { model: 'acme/house-model' });
    await expect(run(call, { model: 'acme/house-model' })).rejects.toThrow(
      'acme/house-model takes no Responses requests',
    );
    expect(warn).toHaveBeenLastCalledWith(
      expect.stringContaining(
        '[chat] provider "awl-gateway" failed a Responses API round for model "acme/house-model" after a lost call moved it there',
      ),
    );
    const third = await run(call, { model: 'acme/house-model' });
    expect(seen.map((sent) => sent.url)).toEqual([
      `${BASE_URL}/chat/completions`,
      `${BASE_URL}/responses`,
      `${BASE_URL}/chat/completions`,
    ]);
    expect(third.map((chunk) => chunk.text).join('')).toBe('Hi.');
  });
});
