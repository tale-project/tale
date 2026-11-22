/**
 * The relay leg against a scripted provider, through the model relay's own
 * engine: what goes upstream (the provider's model id, the organization's
 * credential, the Anthropic version and betas — nothing else of the
 * caller's), what comes back in the caller's wire (passed through, or
 * translated) naming the model id the caller sent, the call booked on the
 * request's op before the request is closed — for a call that ended early,
 * even before its answer began, at the prompt the provider read and what was
 * received — and every refusal in the wire's shape with Tale's code, without
 * internal addresses.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
} from '@ai-sdk/provider';
import type { ModelCatalogEntry } from '@tale/shared/schemas/providers';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { estimateTokens } from '../../../lib/chat/types.ts';
import type { RelayConnector } from '../llm_relay/endpoint.ts';
import { estimatedPromptTokens } from '../llm_relay/estimate.ts';
import type { RelayGrant } from '../llm_relay/store.ts';
import { openAiChatAdapter } from '../llm_relay/translate/openai-chat.ts';
import type { RelayUsage } from '../llm_relay/usage.ts';
import {
  type ModelApiRelayDeps,
  type RelayArgs,
  relayModelApiCall,
  type RelayOutcome,
} from './relay.ts';
import { ModelApiRefusal } from './wire.ts';

const DEEPSEEK: RelayConnector = {
  name: 'deepseek',
  apiFormat: 'openai',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'sk-deepseek-org',
};

const ANTHROPIC: RelayConnector = {
  name: 'anthropic',
  apiFormat: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  apiKey: 'sk-ant-org',
};

const DEEPSEEK_ENTRY: ModelCatalogEntry = {
  id: 'deepseek-v4-flash',
  provider: 'deepseek',
  tags: ['chat'],
  supportsTools: true,
  supportsVision: false,
  contextWindow: 128_000,
  pricing: { inputCentsPerMillion: 30, outputCentsPerMillion: 120 },
};

const CLAUDE_ENTRY: ModelCatalogEntry = {
  id: 'claude-sonnet-5-5',
  provider: 'anthropic',
  tags: ['chat'],
  supportsTools: true,
  supportsVision: true,
  contextWindow: 200_000,
  pricing: {
    inputCentsPerMillion: 300,
    outputCentsPerMillion: 1500,
    cacheReadCentsPerMillion: 30,
  },
};

const LEASE: RelayArgs['lease'] = {
  organizationId: 'org-1',
  sessionId: 'model-api:key-1',
  execId: 'req-1',
  keyId: 'tr_1',
  relayModel: {
    providerSlug: 'deepseek',
    modelId: 'deepseek-v4-flash',
    anthropicLane: false,
    ref: 'org-1__deepseek__deepseek-v4-flash/deepseek-v4-flash',
  },
  servingCredentials: { deepseek: 'cred-1' },
};

const CLAUDE_LEASE: RelayArgs['lease'] = {
  ...LEASE,
  relayModel: {
    providerSlug: 'anthropic',
    modelId: 'claude-sonnet-5-5',
    anthropicLane: false,
    ref: 'anthropic/claude-sonnet-5-5',
  },
  servingCredentials: {},
};

const MESSAGES = [{ role: 'user', content: 'Say hello.' }];

/** What the relay sent the provider. */
interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  signal: AbortSignal | undefined;
}

interface Booked {
  keyId: string;
  usage: RelayUsage;
  cents: number;
}

function headersOf(init: RequestInit): Record<string, string> {
  return Object.fromEntries(new Headers(init.headers).entries());
}

/** A relay leg over a scripted provider, recording what it sent, what it
 * booked and how each call ended. */
function harness(
  over: {
    connector?: RelayConnector;
    entry?: ModelCatalogEntry;
    upstream?: (sent: Sent) => Response | Promise<Response>;
    deps?: Partial<ModelApiRelayDeps>;
  } = {},
) {
  const sent: Sent[] = [];
  const booked: Booked[] = [];
  const outcomes: RelayOutcome[] = [];
  const grants: RelayGrant[] = [];
  const deps: ModelApiRelayDeps = {
    connectorFor: async (grant) => {
      grants.push(grant);
      return {
        connector: over.connector ?? DEEPSEEK,
        entry: over.entry ?? DEEPSEEK_ENTRY,
      };
    },
    bookCall: async (keyId, usage, cents) => {
      booked.push({ keyId, usage, cents });
    },
    fetcher: async (url, init) => {
      const call: Sent = {
        url,
        headers: headersOf(init),
        body: JSON.parse(
          typeof init.body === 'string' ? init.body : '{}',
        ) as Record<string, unknown>,
        signal: init.signal ?? undefined,
      };
      sent.push(call);
      return over.upstream !== undefined
        ? over.upstream(call)
        : Response.json(COMPLETION);
    },
    ...over.deps,
  };
  const call = (args: Partial<RelayArgs> = {}) =>
    relayModelApiCall({
      wire: 'openai',
      lease: LEASE,
      publicModel: 'deepseek/deepseek-v4-flash',
      body: { model: 'deepseek/deepseek-v4-flash', messages: MESSAGES },
      stream: false,
      anthropicHeaders: { 'anthropic-version': '2023-06-01' },
      requestId: 'req-7',
      signal: new AbortController().signal,
      onDone: (outcome) => outcomes.push(outcome),
      deps,
      ...args,
    });
  return { call, sent, booked, outcomes, grants };
}

const COMPLETION = {
  id: 'c1',
  object: 'chat.completion',
  model: 'deepseek-v4-flash',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'Hello.' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
};

/** A body that arrives in the given pieces, one read each, then ends — or
 * breaks off with `fail`, or with `hang` waits until the call is aborted. */
function pieces(
  parts: string[],
  options: { hang?: AbortSignal; fail?: Error } = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const part = parts[index];
      index += 1;
      if (part !== undefined) {
        controller.enqueue(encoder.encode(part));
        return undefined;
      }
      if (options.fail !== undefined) {
        controller.error(options.fail);
        return undefined;
      }
      const hang = options.hang;
      if (hang === undefined) {
        controller.close();
        return undefined;
      }
      return new Promise<void>((_resolve, reject) => {
        hang.addEventListener('abort', () => reject(new Error('aborted')));
      });
    },
  });
}

function sse(
  parts: string[],
  options: Parameters<typeof pieces>[1] = {},
): Response {
  return new Response(pieces(parts, options), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** A Chat Completions chunk naming `model`: the provider's own id as it
 * sends it, the caller's as the door passes it on. */
const chunk = (body: Record<string, unknown>, model = 'deepseek-v4-flash') =>
  `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', model, ...body })}\n\n`;

const anthropicEvent = (event: Record<string, unknown>) =>
  `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`;

/** The relay's own estimate of the prompt it sent, which the provider read
 * whether or not it said so: the fields of the request that carry it. */
const PROMPT_ESTIMATE = estimatedPromptTokens({
  messages: MESSAGES,
  input: undefined,
  system: undefined,
  instructions: undefined,
  tools: undefined,
});

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('what goes upstream', () => {
  it('calls the connector’s own endpoint with the provider’s model id and the organization’s credential, and nothing of the caller’s', async () => {
    const { call, sent, grants } = harness();
    await call({ anthropicHeaders: { 'anthropic-beta': 'x' } });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(sent[0]?.headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer sk-deepseek-org',
    });
    expect(sent[0]?.body).toEqual({
      model: 'deepseek-v4-flash',
      messages: MESSAGES,
    });
    // The connector is resolved with the credential the key was minted
    // under.
    expect(grants[0]).toMatchObject({
      organizationId: 'org-1',
      allowedModels: [
        { providerSlug: 'deepseek', modelId: 'deepseek-v4-flash' },
      ],
      servingCredentials: { deepseek: 'cred-1' },
    });
  });

  it('passes the Anthropic version and betas the caller sent to an Anthropic provider', async () => {
    const { call, sent } = harness({
      connector: ANTHROPIC,
      entry: CLAUDE_ENTRY,
      upstream: () =>
        Response.json({
          type: 'message',
          model: 'claude-sonnet-5-5',
          content: [],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
    });
    await call({
      wire: 'anthropic',
      lease: CLAUDE_LEASE,
      publicModel: 'anthropic/claude-sonnet-5-5',
      body: {
        model: 'anthropic/claude-sonnet-5-5',
        max_tokens: 64,
        messages: MESSAGES,
      },
      anthropicHeaders: {
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'interleaved-thinking-2025-05-14',
      },
    });
    expect(sent[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(sent[0]?.headers).toEqual({
      'content-type': 'application/json',
      'x-api-key': 'sk-ant-org',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'interleaved-thinking-2025-05-14',
    });
    expect(sent[0]?.body.model).toBe('claude-sonnet-5-5');
  });

  it('rides the connector’s native Anthropic endpoint on the Anthropic lane', async () => {
    const { call, sent } = harness({
      connector: {
        ...DEEPSEEK,
        harnessEndpoint: {
          baseUrl: 'https://api.deepseek.com/anthropic',
          apiFormat: 'anthropic',
        },
      },
      upstream: () =>
        Response.json({
          type: 'message',
          content: [],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
    });
    await call({
      wire: 'anthropic',
      lease: {
        ...LEASE,
        relayModel: { ...LEASE.relayModel, anthropicLane: true },
      },
      body: {
        model: 'deepseek/deepseek-v4-flash',
        max_tokens: 64,
        messages: MESSAGES,
      },
    });
    expect(sent[0]?.url).toBe('https://api.deepseek.com/anthropic/v1/messages');
    expect(sent[0]?.body.model).toBe('deepseek-v4-flash');
  });
});

describe('a passed-through answer', () => {
  const PUBLIC_MODEL = 'deepseek/deepseek-v4-flash';
  const BODIES = [
    { choices: [{ index: 0, delta: { role: 'assistant', content: 'Hel' } }] },
    { choices: [{ index: 0, delta: { content: 'lo' } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    {
      choices: [],
      usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
    },
  ];
  const DONE = 'data: [DONE]\n\n';
  /** The provider's stream, naming the model by its own id. */
  const STREAM = [...BODIES.map((body) => chunk(body)), DONE];
  /** The same chunks as the caller reads them: naming the id it sent. */
  const NAMED = BODIES.map((body) => chunk(body, PUBLIC_MODEL));

  it('streams the provider’s events naming the id the caller sent, without the usage chunk the caller did not ask for, and books the usage it read', async () => {
    const { call, sent, booked, outcomes } = harness({
      upstream: () => sse(STREAM),
    });
    const response = await call({
      stream: true,
      body: { model: PUBLIC_MODEL, stream: true, messages: MESSAGES },
    });
    expect(response.headers.get('content-type')).toBe(
      'text/event-stream; charset=utf-8',
    );
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    expect(await response.text()).toBe(
      [NAMED[0], NAMED[1], NAMED[2], DONE].join(''),
    );
    // The relay asks for the usage chunk the caller will not see.
    expect(sent[0]?.body.stream_options).toEqual({ include_usage: true });
    await vi.waitFor(() => expect(outcomes).toHaveLength(1));
    expect(booked).toEqual([
      {
        keyId: 'tr_1',
        usage: {
          inputTokens: 120,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 30,
        },
        // 120 in at 30c/M, 30 out at 120c/M.
        cents: 0.0072,
      },
    ]);
    expect(outcomes).toEqual([
      { status: 'completed', usage: { inputTokens: 120, outputTokens: 30 } },
    ]);
  });

  it('keeps the usage chunk for a caller that asked for it', async () => {
    const { call } = harness({ upstream: () => sse(STREAM) });
    const response = await call({
      stream: true,
      body: {
        model: PUBLIC_MODEL,
        stream: true,
        stream_options: { include_usage: true },
        messages: MESSAGES,
      },
    });
    expect(await response.text()).toBe([...NAMED, DONE].join(''));
  });

  it('passes an Anthropic stream through as sent but for the id the caller sent in its opening message, and books every kind of token at its own price', async () => {
    const start = {
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-5-5',
        content: [],
        usage: {
          input_tokens: 1_000,
          cache_read_input_tokens: 4_000,
          cache_creation_input_tokens: 0,
          output_tokens: 1,
        },
      },
    };
    const rest = [
      anthropicEvent({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Done.' },
      }),
      anthropicEvent({ type: 'message_delta', usage: { output_tokens: 200 } }),
      anthropicEvent({ type: 'message_stop' }),
    ];
    const { call, booked, outcomes } = harness({
      connector: ANTHROPIC,
      entry: CLAUDE_ENTRY,
      upstream: () => sse([anthropicEvent(start), ...rest]),
    });
    const response = await call({
      wire: 'anthropic',
      lease: CLAUDE_LEASE,
      publicModel: 'anthropic/claude-sonnet-5-5',
      stream: true,
      body: {
        model: 'anthropic/claude-sonnet-5-5',
        max_tokens: 1_024,
        stream: true,
        messages: MESSAGES,
      },
    });
    expect(response.headers.get('request-id')).toBe('req-7');
    expect(await response.text()).toBe(
      [
        anthropicEvent({
          ...start,
          message: { ...start.message, model: 'anthropic/claude-sonnet-5-5' },
        }),
        ...rest,
      ].join(''),
    );
    await vi.waitFor(() => expect(outcomes).toHaveLength(1));
    // 1,000 × 3 + 4,000 × 0.3 + 200 × 15, in millionths of a dollar.
    expect(booked[0]?.cents).toBe(0.72);
    // The whole prompt, the cached share included, for the ledger.
    expect(outcomes).toEqual([
      { status: 'completed', usage: { inputTokens: 5_000, outputTokens: 200 } },
    ]);
  });

  it('answers a whole completion naming the id the caller sent, and books its usage', async () => {
    const { call, booked, outcomes } = harness();
    const response = await call();
    expect(await response.json()).toEqual({
      ...COMPLETION,
      model: PUBLIC_MODEL,
    });
    await vi.waitFor(() => expect(outcomes).toHaveLength(1));
    expect(booked).toHaveLength(1);
    expect(outcomes).toEqual([
      { status: 'completed', usage: { inputTokens: 10, outputTokens: 3 } },
    ]);
  });
});
describe('a translated answer', () => {
  /** A Claude model that answers once, whole — or, with `hang`, reads the
   * prompt and answers nothing until the call is stopped. */
  function claude(options: { hang?: boolean } = {}): LanguageModelV4 & {
    calls: LanguageModelV4CallOptions[];
  } {
    const calls: LanguageModelV4CallOptions[] = [];
    return {
      specificationVersion: 'v4',
      provider: 'test',
      modelId: 'claude-sonnet-5-5',
      supportedUrls: {},
      calls,
      doGenerate: async (call) => {
        calls.push(call);
        if (options.hang === true) {
          await new Promise<never>((_resolve, reject) => {
            call.abortSignal?.addEventListener('abort', () =>
              reject(new Error('aborted')),
            );
          });
        }
        return {
          content: [{ type: 'text', text: 'Hello.' }],
          finishReason: { unified: 'stop', raw: 'end_turn' },
          usage: {
            inputTokens: {
              total: 120,
              noCache: 100,
              cacheRead: 20,
              cacheWrite: 0,
            },
            outputTokens: { total: 9, text: 9, reasoning: 0 },
          },
          warnings: [],
        };
      },
      doStream: async () => {
        throw new Error('not streamed here');
      },
    };
  }

  it('answers an OpenAI-door call to an Anthropic provider in Chat Completions, naming the id the caller sent, and books the provider’s usage', async () => {
    const model = claude();
    const { call, booked, outcomes } = harness({
      connector: ANTHROPIC,
      entry: CLAUDE_ENTRY,
      deps: { model },
    });
    const response = await call({
      lease: CLAUDE_LEASE,
      publicModel: 'anthropic/claude-sonnet-5-5',
      body: {
        model: 'anthropic/claude-sonnet-5-5',
        max_completion_tokens: 256,
        messages: MESSAGES,
      },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      object: 'chat.completion',
      model: 'anthropic/claude-sonnet-5-5',
      choices: [{ message: { role: 'assistant', content: 'Hello.' } }],
    });
    expect(model.calls[0]?.maxOutputTokens).toBe(256);
    await vi.waitFor(() => expect(outcomes).toHaveLength(1));
    // 100 fresh at 300c/M, 20 cached at 30c/M, 9 out at 1,500c/M.
    expect(booked).toEqual([
      {
        keyId: 'tr_1',
        usage: {
          inputTokens: 100,
          cacheReadTokens: 20,
          cacheWriteTokens: 0,
          outputTokens: 9,
        },
        cents: 0.0441,
      },
    ]);
    expect(outcomes).toEqual([
      { status: 'completed', usage: { inputTokens: 120, outputTokens: 9 } },
    ]);
  });

  it('says what the relay cannot carry to the provider in the wire’s shape, booking nothing', async () => {
    const { call, booked, outcomes } = harness({
      connector: ANTHROPIC,
      entry: CLAUDE_ENTRY,
      deps: { model: claude() },
    });
    const response = await call({
      lease: CLAUDE_LEASE,
      body: { model: 'anthropic/claude-sonnet-5-5', n: 2, messages: MESSAGES },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        message: '"n": this model gives one answer per request; ask for one.',
        type: 'invalid_request_error',
        param: null,
        code: 'MODEL_API_UPSTREAM_ERROR',
      },
    });
    await vi.waitFor(() => expect(outcomes).toEqual([{ status: 'failed' }]));
    expect(booked).toEqual([]);
  });

  it('books the prompt Claude read when the caller leaves before its answer began [MAPI-R8]', async () => {
    const body = {
      model: 'anthropic/claude-sonnet-5-5',
      max_completion_tokens: 256,
      messages: MESSAGES,
    };
    const model = claude({ hang: true });
    const { call, booked, outcomes } = harness({
      connector: ANTHROPIC,
      entry: CLAUDE_ENTRY,
      deps: { model },
    });
    const caller = new AbortController();
    const pending = call({
      lease: CLAUDE_LEASE,
      publicModel: 'anthropic/claude-sonnet-5-5',
      body,
      signal: caller.signal,
    });
    await vi.waitFor(() => expect(model.calls).toHaveLength(1));
    caller.abort();
    expect((await pending).status).toBe(499);
    await vi.waitFor(() => expect(outcomes).toHaveLength(1));
    // The prompt as the relay sent it on the provider's wire, estimated.
    const prompt = estimatedPromptTokens(
      openAiChatAdapter.parse(body).options.prompt,
    );
    expect(outcomes).toEqual([
      { status: 'cancelled', usage: { inputTokens: prompt, outputTokens: 0 } },
    ]);
    expect(booked[0]?.usage).toEqual({
      inputTokens: prompt,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
    });
  });
});

describe('a call that ends early', () => {
  it('ends a stream that breaks off with an error event in the wire’s shape, booked at what was sent and received [MAPI-R8]', async () => {
    const { call, booked, outcomes } = harness({
      upstream: () =>
        sse([chunk({ choices: [{ index: 0, delta: { content: 'abcd' } }] })], {
          fail: new Error('socket hang up'),
        }),
    });
    const response = await call({ stream: true });
    const text = await response.text();
    expect(
      text.endsWith(
        `data: ${JSON.stringify({
          error: {
            message:
              'The model stream broke off, or went quiet for too long, before the answer was complete.',
            type: 'server_error',
            param: null,
            code: 'MODEL_API_UPSTREAM_ERROR',
          },
        })}\n\n`,
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(outcomes).toHaveLength(1));
    // The prompt the relay sent, as it counts it, and the output it relayed.
    expect(outcomes).toEqual([
      {
        status: 'failed',
        usage: { inputTokens: PROMPT_ESTIMATE, outputTokens: 1 },
      },
    ]);
    expect(booked[0]?.usage).toEqual({
      inputTokens: PROMPT_ESTIMATE,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1,
    });
  });

  it('stops the provider’s call when the caller hangs up half-way, and books the half that was produced [MAPI-R8]', async () => {
    const { call, sent, booked, outcomes } = harness({
      upstream: (request) =>
        sse(
          [
            chunk({
              choices: [{ index: 0, delta: { content: 'twelve chars' } }],
            }),
            chunk({
              choices: [{ index: 0, delta: { content: 'twelve chars' } }],
            }),
          ],
          request.signal !== undefined ? { hang: request.signal } : {},
        ),
    });
    const caller = new AbortController();
    const response = await call({ stream: true, signal: caller.signal });
    const reader = response.body?.getReader();
    await reader?.read();
    await reader?.read();
    caller.abort();
    await reader?.cancel();
    await vi.waitFor(() => expect(outcomes).toHaveLength(1));
    expect(sent[0]?.signal?.aborted).toBe(true);
    expect(outcomes).toEqual([
      {
        status: 'cancelled',
        usage: {
          inputTokens: PROMPT_ESTIMATE,
          outputTokens: 2 * estimateTokens('twelve chars'),
        },
      },
    ]);
    expect(booked).toHaveLength(1);
  });

  it('stops a stream that goes quiet past its idle budget, and ends it with the wire’s error', async () => {
    const { call, outcomes } = harness({
      upstream: (request) =>
        sse(
          [chunk({ choices: [{ index: 0, delta: { content: 'abcd' } }] })],
          request.signal !== undefined ? { hang: request.signal } : {},
        ),
      deps: { lifetime: { streamIdleMs: 50, streamMs: 60_000 } },
    });
    const text = await (await call({ stream: true })).text();
    expect(text).toContain('"code":"MODEL_API_UPSTREAM_ERROR"');
    expect(text).toContain('went quiet for too long');
    await vi.waitFor(() => expect(outcomes).toHaveLength(1));
    expect(outcomes[0]).toMatchObject({
      status: 'failed',
      usage: { outputTokens: 1 },
    });
  });

  /** A provider that reads the request and answers nothing until the call
   * is stopped. */
  const untilStopped = (request: Sent) =>
    new Promise<Response>((_resolve, reject) => {
      request.signal?.addEventListener('abort', () =>
        reject(new Error('aborted')),
      );
    });

  /** The ending of a call that stopped before its answer began: the prompt
   * the provider read, and no output. */
  const promptOnly = (status: RelayOutcome['status']): RelayOutcome => ({
    status,
    usage: { inputTokens: PROMPT_ESTIMATE, outputTokens: 0 },
  });

  it('stops a whole answer past its lifetime with a 504, booked at the prompt the provider read [MAPI-R8]', async () => {
    const { call, booked, outcomes } = harness({
      upstream: untilStopped,
      deps: { lifetime: { wholeMs: 50 } },
    });
    const response = await call();
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({
      error: {
        message: 'The model provider did not answer in time.',
        type: 'timeout_error',
        param: null,
        code: 'MODEL_API_UPSTREAM_ERROR',
      },
    });
    await vi.waitFor(() => expect(outcomes).toEqual([promptOnly('failed')]));
    expect(booked).toHaveLength(1);
  });

  it('books the prompt the provider read when the caller hangs up before the whole answer came [MAPI-R8]', async () => {
    const { call, sent, booked, outcomes } = harness({
      upstream: untilStopped,
    });
    const caller = new AbortController();
    const pending = call({ signal: caller.signal });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    caller.abort();
    expect((await pending).status).toBe(499);
    await vi.waitFor(() => expect(outcomes).toEqual([promptOnly('cancelled')]));
    expect(sent[0]?.signal?.aborted).toBe(true);
    expect(booked).toHaveLength(1);
  });

  it('books the prompt the provider read when the connection breaks before the answer, saying only that the provider stopped answering [MAPI-R8]', async () => {
    const { call, booked, outcomes } = harness({
      upstream: () =>
        Promise.reject(
          new TypeError('fetch failed', {
            cause: new Error('other side closed: 10.0.3.7:443'),
          }),
        ),
    });
    const response = await call();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: {
        message: 'The model provider stopped answering.',
        type: 'api_error',
        param: null,
        code: 'MODEL_API_UPSTREAM_ERROR',
      },
    });
    await vi.waitFor(() => expect(outcomes).toEqual([promptOnly('failed')]));
    expect(booked).toHaveLength(1);
  });

  it('sends nothing and books nothing for a caller who left before the call was made', async () => {
    const { call, sent, booked, outcomes } = harness();
    const caller = new AbortController();
    caller.abort();
    const response = await call({ signal: caller.signal });
    expect(response.status).toBe(499);
    expect(sent).toHaveLength(0);
    await vi.waitFor(() => expect(outcomes).toEqual([{ status: 'cancelled' }]));
    expect(booked).toEqual([]);
  });

  it('carries the cost of a call it could not book to the request’s close', async () => {
    const { call, outcomes } = harness({
      deps: {
        bookCall: async () => {
          throw new Error('connection reset');
        },
      },
    });
    await call();
    await vi.waitFor(() => expect(outcomes).toHaveLength(1));
    // 10 in at 30c/M, 3 out at 120c/M.
    expect(outcomes).toEqual([
      {
        status: 'completed',
        usage: { inputTokens: 10, outputTokens: 3 },
        unbookedCents: 0.00066,
      },
    ]);
  });

  it('closes the request only once the call is booked', async () => {
    let release: () => void = () => undefined;
    const { call, outcomes } = harness({
      deps: {
        bookCall: () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      },
    });
    await call();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(outcomes).toEqual([]);
    release();
    await vi.waitFor(() => expect(outcomes).toHaveLength(1));
  });
});

describe('a refusal', () => {
  it('relays the provider’s refusal of the request in the wire’s shape, with its status, message and type', async () => {
    const { call, booked, outcomes } = harness({
      upstream: () =>
        Response.json(
          {
            error: {
              type: 'invalid_request_error',
              message:
                'This model has a maximum context length of 64000 tokens; see https://docs.example.com/limits',
            },
          },
          { status: 400 },
        ),
    });
    const response = await call();
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        message:
          'This model has a maximum context length of 64000 tokens; see https://docs.example.com/limits',
        type: 'invalid_request_error',
        param: null,
        code: 'MODEL_API_UPSTREAM_ERROR',
      },
    });
    await vi.waitFor(() => expect(outcomes).toEqual([{ status: 'failed' }]));
    expect(booked).toEqual([]);
  });

  it('keeps a provider’s rate limit a 429', async () => {
    const { call } = harness({
      upstream: () =>
        Response.json({ error: { message: 'slow down' } }, { status: 429 }),
    });
    expect((await call()).status).toBe(429);
  });

  it('says a refused organization credential as a 502, in the Anthropic shape with the request id', async () => {
    const { call } = harness({
      connector: ANTHROPIC,
      entry: CLAUDE_ENTRY,
      upstream: () =>
        Response.json(
          {
            type: 'error',
            error: {
              type: 'authentication_error',
              message: 'invalid x-api-key',
            },
          },
          { status: 401 },
        ),
    });
    const response = await call({
      wire: 'anthropic',
      lease: CLAUDE_LEASE,
      body: {
        model: 'anthropic/claude-sonnet-5-5',
        max_tokens: 64,
        messages: MESSAGES,
      },
    });
    expect(response.status).toBe(502);
    expect(response.headers.get('request-id')).toBe('req-7');
    const body = (await response.json()) as {
      type: string;
      error: { type: string; message: string; code: string };
      request_id: string;
    };
    expect(body).toMatchObject({
      type: 'error',
      error: { type: 'api_error', code: 'MODEL_API_UPSTREAM_ERROR' },
      request_id: 'req-7',
    });
    expect(body.error.message).toContain(
      "The model provider refused the organization's credential (HTTP 401)",
    );
  });

  it('keeps internal addresses out of a relayed refusal, answering a generic one instead', async () => {
    const { call } = harness({
      upstream: () =>
        Response.json(
          {
            error: {
              message:
                'Post "http://10.0.3.7:8000/v1/chat/completions": dial tcp 10.0.3.7:8000: connect: connection refused',
            },
          },
          { status: 500 },
        ),
    });
    const response = await call();
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toBe(
      'The model provider refused the request (HTTP 500).',
    );
    expect(JSON.stringify(body)).not.toContain('10.0.3.7');
  });

  it.each([
    'upstream vllm-serving:8080 unavailable',
    'no such host: vllm.internal',
    'see http://inference/v1 for details',
    'failed on [fd00::12]:443',
    'Cannot connect to API: getaddrinfo ENOTFOUND vllm-serving',
  ])('treats %j as internal detail', async (message) => {
    const { call } = harness({
      upstream: () => Response.json({ error: { message } }, { status: 503 }),
    });
    const response = await call();
    expect(response.status).toBe(503);
    expect(
      ((await response.json()) as { error: { message: string } }).error.message,
    ).toBe('The model provider refused the request (HTTP 503).');
  });

  it('answers a provider no connection reached with a 502 that names no address, booking nothing', async () => {
    const { call, booked, outcomes } = harness({
      upstream: () =>
        Promise.reject(
          Object.assign(new TypeError('fetch failed'), {
            cause: {
              code: 'ECONNREFUSED',
              message: 'connect ECONNREFUSED 10.0.3.7:8000',
            },
          }),
        ),
    });
    const response = await call();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: {
        message: 'The model provider could not be reached.',
        type: 'api_error',
        param: null,
        code: 'MODEL_API_UPSTREAM_ERROR',
      },
    });
    await vi.waitFor(() => expect(outcomes).toEqual([{ status: 'failed' }]));
    expect(booked).toEqual([]);
  });

  it('refuses with a 503 and calls nothing when the provider cannot serve the model, keeping the reason to the log', async () => {
    const { call, sent, outcomes } = harness({
      deps: {
        connectorFor: async () => {
          throw new Error(
            'Host "10.0.0.5" is a private/loopback address and is blocked.',
          );
        },
      },
    });
    const refusal = await call().catch((caught: unknown) => caught);
    expect(refusal).toBeInstanceOf(ModelApiRefusal);
    expect(refusal).toMatchObject({
      status: 503,
      code: 'MODEL_API_UNAVAILABLE',
    });
    expect((refusal as Error).message).not.toContain('10.0.0.5');
    expect(sent).toHaveLength(0);
    expect(outcomes).toEqual([{ status: 'failed' }]);
  });

  it('refuses a connector with no endpoint for the lane the way it refuses one that cannot serve', async () => {
    const { call, sent } = harness();
    await expect(
      call({
        wire: 'anthropic',
        lease: {
          ...LEASE,
          relayModel: { ...LEASE.relayModel, anthropicLane: true },
        },
      }),
    ).rejects.toMatchObject({ status: 503, code: 'MODEL_API_UNAVAILABLE' });
    expect(sent).toHaveLength(0);
  });
});

describe('the relay’s own call to the provider', () => {
  // The engine's real fetch, through its own connection pool, against a
  // loopback provider that counts what reaches it.
  let server: Server;
  let received = 0;

  beforeAll(async () => {
    server = createServer((request, response) => {
      received += 1;
      request.resume();
      request.on('end', () => {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(COMPLETION));
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
  });

  beforeEach(() => {
    received = 0;
    vi.stubEnv('TALE_ALLOW_PRIVATE_PROVIDER_HOSTS', '1');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  /** A call to the loopback provider with no fetch of the test's own. */
  function callLoopback(signal: AbortSignal, outcomes: RelayOutcome[]) {
    const { port } = server.address() as AddressInfo;
    return relayModelApiCall({
      wire: 'openai',
      lease: LEASE,
      publicModel: 'deepseek/deepseek-v4-flash',
      body: { model: 'deepseek/deepseek-v4-flash', messages: MESSAGES },
      stream: false,
      anthropicHeaders: {},
      requestId: undefined,
      signal,
      onDone: (outcome) => outcomes.push(outcome),
      deps: {
        connectorFor: async () => ({
          connector: { ...DEEPSEEK, baseUrl: `http://127.0.0.1:${port}/v1` },
          entry: DEEPSEEK_ENTRY,
        }),
        bookCall: async () => undefined,
      },
    });
  }

  it('relays a caller who stays: the provider receives the request once', async () => {
    const outcomes: RelayOutcome[] = [];
    const response = await callLoopback(new AbortController().signal, outcomes);
    expect(await response.json()).toEqual({
      ...COMPLETION,
      model: 'deepseek/deepseek-v4-flash',
    });
    expect(received).toBe(1);
    await vi.waitFor(() =>
      expect(outcomes).toEqual([
        { status: 'completed', usage: { inputTokens: 10, outputTokens: 3 } },
      ]),
    );
  });

  it('sends nothing for a caller who left while the request was governed', async () => {
    const caller = new AbortController();
    const outcomes: RelayOutcome[] = [];
    // The guardrails and the key mint run before the relay, asynchronously.
    setTimeout(() => caller.abort(), 5);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await callLoopback(caller.signal, outcomes);
    // Let a request that did leave land before counting.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received).toBe(0);
    await vi.waitFor(() => expect(outcomes).toEqual([{ status: 'cancelled' }]));
  });
});
