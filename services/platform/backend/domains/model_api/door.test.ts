/**
 * The door end to end over the model relay, with the domain's gates and the
 * hold scripted and a provider behind the relay: an OpenAI-door call to an
 * Anthropic connector translated both ways, through the provider's real SDK;
 * the text the guardrails masked reaching the provider, and its answer
 * naming the id the caller sent; the call booked on the request's op before
 * the request is closed; a provider that cannot serve the model refused
 * before anything is sent; and a caller who left while the request was
 * governed never sent.
 */

import type { ModelCatalogEntry } from '@tale/shared/schemas/providers';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RelayConnector } from '../llm_relay/endpoint.ts';
import type { RelayUsage } from '../llm_relay/usage.ts';
import type { ModelApiRelayDeps } from './relay.ts';

const gate = vi.hoisted(() => ({ resolveModelApiGate: vi.fn() }));
vi.mock('./access.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./access.ts')>()),
  ...gate,
}));

const listing = vi.hoisted(() => ({ listModelApiModels: vi.fn() }));
vi.mock('./models.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./models.ts')>()),
  ...listing,
}));

interface JudgedRequest {
  segments: { read(): string; write(text: string): void }[];
}

const guardrails = vi.hoisted(() => ({
  apply: vi.fn(async (_request: JudgedRequest): Promise<void> => undefined),
}));
vi.mock('./guardrails.ts', () => ({
  buildModelApiGuardrails: vi.fn(async () => ({ apply: guardrails.apply })),
}));

const metering = vi.hoisted(() => ({
  openModelApiLease: vi.fn(),
  heartbeatModelApiOp: vi.fn(() => () => undefined),
  closeModelApiLease: vi.fn(),
}));
vi.mock('./metering.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./metering.ts')>()),
  ...metering,
}));

vi.mock('../governance/model-endpoints.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../governance/model-endpoints.ts')
  >()),
  recordModelEndpointRefusal: vi.fn(async (): Promise<void> => undefined),
}));

vi.mock('../../auth/membership.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/membership.ts')>()),
  getUserTeamIds: vi.fn(async () => []),
}));

/** The relay's connector resolution and booking, as each test scripts them. */
const relay = vi.hoisted(() => ({
  deps: null as ModelApiRelayDeps | null,
}));
vi.mock('./relay.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./relay.ts')>()),
  modelApiRelayDeps: () => {
    if (relay.deps === null) throw new Error('no relay deps scripted');
    return relay.deps;
  },
}));

const { relayModelApiRequest } = await import('./door.ts');

const SQL = {} as Sql;

const POLICY = {
  enabled: true,
  mode: 'blocklist' as const,
  rules: [{ scope: 'default' as const, allowedModels: [], blockedModels: [] }],
  modelApi: { enabled: true },
};

const CLAUDE = {
  id: 'anthropic/claude-sonnet-5-5',
  providerSlug: 'anthropic',
  modelId: 'claude-sonnet-5-5',
  label: 'Claude Sonnet 5.5',
  vision: true,
  tools: true,
  contextWindow: 200_000,
  maxOutputTokens: 8_000,
  pricing: { inputCentsPerMillion: 300, outputCentsPerMillion: 1500 },
  connector: { name: 'anthropic', baseUrl: 'https://api.anthropic.com' },
};

const DEEPSEEK = {
  id: 'deepseek/deepseek-v4-flash',
  providerSlug: 'deepseek',
  modelId: 'deepseek-v4-flash',
  label: 'DeepSeek V4 Flash',
  vision: false,
  tools: true,
  contextWindow: 128_000,
  maxOutputTokens: 8_000,
  pricing: { inputCentsPerMillion: 30, outputCentsPerMillion: 120 },
  connector: { name: 'deepseek', baseUrl: 'https://api.deepseek.com/v1' },
};

const CONNECTORS: Record<string, RelayConnector> = {
  anthropic: {
    name: 'anthropic',
    apiFormat: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiKey: 'sk-ant-org',
  },
  deepseek: {
    name: 'deepseek',
    apiFormat: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-deepseek-org',
  },
};

function entryOf(model: typeof CLAUDE | typeof DEEPSEEK): ModelCatalogEntry {
  return {
    id: model.modelId,
    provider: model.providerSlug,
    tags: ['chat'],
    supportsTools: true,
    supportsVision: model.vision,
    contextWindow: model.contextWindow,
    pricing: model.pricing,
  };
}

function leaseFor(model: typeof CLAUDE | typeof DEEPSEEK) {
  return {
    organizationId: 'org-1',
    sessionId: 'model-api:key-1',
    execId: 'req-uuid',
    keyId: 'tr_1',
    relayModel: {
      providerSlug: model.providerSlug,
      modelId: model.modelId,
      anthropicLane: false,
      ref: `${model.providerSlug}/${model.modelId}`,
    },
    servingCredentials: {},
  };
}

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

interface Booked {
  keyId: string;
  usage: RelayUsage;
  cents: number;
}

/** The relay over a scripted provider, recording what it sent and booked. */
function provider(answer: (sent: Sent) => Response | Promise<Response>) {
  const sent: Sent[] = [];
  const booked: Booked[] = [];
  relay.deps = {
    connectorFor: async (_grant, providerSlug, modelId) => {
      const model = [CLAUDE, DEEPSEEK].find(
        (candidate) => candidate.modelId === modelId,
      );
      const connector = CONNECTORS[providerSlug];
      if (connector === undefined || model === undefined) {
        throw new Error(`no connector "${providerSlug}"`);
      }
      return { connector, entry: entryOf(model) };
    },
    bookCall: async (keyId, usage, cents) => {
      booked.push({ keyId, usage, cents });
    },
    fetcher: async (input, init) => {
      const call: Sent = {
        url: input,
        headers: Object.fromEntries(new Headers(init.headers).entries()),
        body: JSON.parse(
          typeof init.body === 'string' ? init.body : '{}',
        ) as Record<string, unknown>,
      };
      sent.push(call);
      return answer(call);
    },
  };
  return { sent, booked };
}

function caller(signal: AbortSignal = new AbortController().signal) {
  return {
    organizationId: 'org-1',
    orgSlug: 'acme',
    userId: 'user-1',
    role: 'developer',
    apiKeyId: 'key-1',
    requestId: 'req-7',
    signal,
    anthropicHeaders: { 'anthropic-version': '2023-06-01' },
  };
}

const anthropicEvent = (event: Record<string, unknown>) =>
  `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`;

/** Claude answering "Hello there." as Anthropic streams it. */
const CLAUDE_STREAM = [
  anthropicEvent({
    type: 'message_start',
    message: {
      id: 'msg_01',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5-5',
      content: [],
      stop_reason: null,
      usage: { input_tokens: 900, output_tokens: 1 },
    },
  }),
  anthropicEvent({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  }),
  anthropicEvent({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: 'Hello there.' },
  }),
  anthropicEvent({ type: 'content_block_stop', index: 0 }),
  anthropicEvent({
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 7 },
  }),
  anthropicEvent({ type: 'message_stop' }),
].join('');

/** The `data:` payloads of a Chat Completions stream. */
function chatChunks(text: string): unknown[] {
  return text
    .split('\n\n')
    .filter((block) => block.startsWith('data: '))
    .map((block) => {
      const data = block.slice('data: '.length);
      return data === '[DONE]' ? data : (JSON.parse(data) as unknown);
    });
}

beforeEach(() => {
  vi.clearAllMocks();
  relay.deps = null;
  gate.resolveModelApiGate.mockResolvedValue({ kind: 'open', policy: POLICY });
  listing.listModelApiModels.mockResolvedValue([CLAUDE, DEEPSEEK]);
  metering.openModelApiLease.mockImplementation(
    async (_sql: unknown, args: { model: typeof CLAUDE }) =>
      leaseFor(args.model),
  );
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('an OpenAI-door call to an Anthropic connector', () => {
  it('reaches Claude in Anthropic’s wire and streams the answer back as Chat Completions, booked at Claude’s usage', async () => {
    const { sent, booked } = provider(
      () =>
        new Response(CLAUDE_STREAM, {
          headers: { 'content-type': 'text/event-stream' },
        }),
    );
    const response = await relayModelApiRequest(
      SQL,
      'openai',
      caller(),
      async () => ({
        model: 'anthropic/claude-sonnet-5-5',
        stream: true,
        messages: [
          { role: 'system', content: 'Be brief.' },
          { role: 'user', content: 'Say hello.' },
        ],
      }),
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(sent[0]?.headers['x-api-key']).toBe('sk-ant-org');
    // The held output cap rides the call: the hold is a bound only if the
    // answer is.
    expect(sent[0]?.body).toMatchObject({
      model: 'claude-sonnet-5-5',
      max_tokens: 8_000,
      stream: true,
      system: [{ type: 'text', text: 'Be brief.' }],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Say hello.' }] },
      ],
    });

    expect(response.headers.get('content-type')).toBe(
      'text/event-stream; charset=utf-8',
    );
    const chunks = chatChunks(await response.text());
    expect(chunks.at(-1)).toBe('[DONE]');
    const events = chunks.slice(0, -1) as {
      object: string;
      model: string;
      choices: { delta: { content?: string } }[];
      usage?: unknown;
    }[];
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event).toMatchObject({
        object: 'chat.completion.chunk',
        model: 'anthropic/claude-sonnet-5-5',
      });
      // The caller did not ask for the usage chunk.
      expect(event.usage).toBeUndefined();
    }
    expect(
      events
        .flatMap((event) => event.choices.map((choice) => choice.delta.content))
        .join(''),
    ).toBe('Hello there.');

    await vi.waitFor(() =>
      expect(metering.closeModelApiLease).toHaveBeenCalledTimes(1),
    );
    // 900 in at 300c/M, 7 out at 1,500c/M.
    expect(booked).toEqual([
      {
        keyId: 'tr_1',
        usage: {
          inputTokens: 900,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 7,
        },
        cents: 0.2805,
      },
    ]);
    expect(metering.closeModelApiLease).toHaveBeenCalledWith(
      SQL,
      leaseFor(CLAUDE),
      { status: 'completed', usage: { inputTokens: 900, outputTokens: 7 } },
    );
  });

  it('answers a whole call as a Chat Completion naming the id the caller sent', async () => {
    provider(() =>
      Response.json({
        id: 'msg_02',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-5-5',
        content: [{ type: 'text', text: 'Hello there.' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 900, output_tokens: 7 },
      }),
    );
    const response = await relayModelApiRequest(
      SQL,
      'openai',
      caller(),
      async () => ({
        model: 'anthropic/claude-sonnet-5-5',
        messages: [{ role: 'user', content: 'Say hello.' }],
      }),
    );
    expect(await response.json()).toMatchObject({
      object: 'chat.completion',
      model: 'anthropic/claude-sonnet-5-5',
      choices: [
        {
          message: { role: 'assistant', content: 'Hello there.' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 900, completion_tokens: 7 },
    });
  });
});

describe('the door over the relay', () => {
  it('sends the provider the text as the guardrails masked it [MAPI-R6]', async () => {
    guardrails.apply.mockImplementationOnce(async (request: JudgedRequest) => {
      for (const segment of request.segments) {
        segment.write(segment.read().replace('jane@example.com', '[EMAIL]'));
      }
    });
    const { sent } = provider(() =>
      Response.json({
        id: 'c1',
        object: 'chat.completion',
        model: 'deepseek-v4-flash',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' } }],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      }),
    );
    const response = await relayModelApiRequest(
      SQL,
      'openai',
      caller(),
      async () => ({
        model: 'deepseek/deepseek-v4-flash',
        messages: [{ role: 'user', content: 'write to jane@example.com' }],
      }),
    );
    expect(sent[0]?.url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(sent[0]?.body.messages).toEqual([
      { role: 'user', content: 'write to [EMAIL]' },
    ]);
    // A passed-through answer names the id the caller sent, not the
    // provider's own.
    expect(await response.json()).toMatchObject({
      model: 'deepseek/deepseek-v4-flash',
      choices: [{ message: { content: 'ok' } }],
    });
  });

  it('books the call on the request’s op before it closes the request, which settles it [MAPI-R8]', async () => {
    let release: () => void = () => undefined;
    provider(() =>
      Response.json({
        id: 'c1',
        object: 'chat.completion',
        model: 'deepseek-v4-flash',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' } }],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      }),
    );
    const deps = relay.deps;
    if (deps === null) throw new Error('no relay deps scripted');
    relay.deps = {
      ...deps,
      bookCall: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    };
    const response = await relayModelApiRequest(
      SQL,
      'openai',
      caller(),
      async () => ({
        model: 'deepseek/deepseek-v4-flash',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );
    expect(response.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(metering.closeModelApiLease).not.toHaveBeenCalled();
    release();
    await vi.waitFor(() =>
      expect(metering.closeModelApiLease).toHaveBeenCalledWith(
        SQL,
        leaseFor(DEEPSEEK),
        { status: 'completed', usage: { inputTokens: 5, outputTokens: 1 } },
      ),
    );
  });

  it('refuses a model its provider cannot serve before anything is sent, and closes the request', async () => {
    const { sent } = provider(() => Response.json({}));
    const deps = relay.deps;
    if (deps === null) throw new Error('no relay deps scripted');
    relay.deps = {
      ...deps,
      connectorFor: async () => {
        throw new Error('its credential cannot be served through the relay');
      },
    };
    const refusal = await relayModelApiRequest(
      SQL,
      'anthropic',
      caller(),
      async () => ({
        model: 'anthropic/claude-sonnet-5-5',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).catch((caught: unknown) => caught);
    expect(refusal).toMatchObject({
      status: 503,
      code: 'MODEL_API_UNAVAILABLE',
    });
    expect(sent).toHaveLength(0);
    expect(metering.closeModelApiLease).toHaveBeenCalledWith(
      SQL,
      leaseFor(CLAUDE),
      { status: 'failed' },
    );
  });

  it('sends nothing and books nothing when the caller leaves while the request is governed', async () => {
    const { sent, booked } = provider(() => Response.json({}));
    const leaving = new AbortController();
    guardrails.apply.mockImplementationOnce(async () => {
      leaving.abort();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    await relayModelApiRequest(
      SQL,
      'openai',
      caller(leaving.signal),
      async () => ({
        model: 'deepseek/deepseek-v4-flash',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );
    await vi.waitFor(() =>
      expect(metering.closeModelApiLease).toHaveBeenCalledWith(
        SQL,
        leaseFor(DEEPSEEK),
        { status: 'cancelled' },
      ),
    );
    expect(sent).toHaveLength(0);
    expect(booked).toEqual([]);
  });
});
