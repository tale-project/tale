// @vitest-environment node

/**
 * The model endpoints, route by route, with the domain's gates and the
 * gateway scripted: the door shut or refused in each wire's own error
 * shape, the OpenAI listing, the model resolution, the capability checks,
 * the guardrails' block and mask, the budget refusal, and a relayed call —
 * streamed and whole, tools included — whose end closes its lease with the
 * usage the answer reported; a caller who hangs up while the request is
 * governed has it closed unsent, with nothing to book; and, with the EU/EEA
 * processing rule on, a model the gateway would serve from an endpoint
 * outside the region refused and audited before anything is held.
 */

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RestEnv } from './shared.ts';

const gate = vi.hoisted(() => ({
  resolveModelApiGate: vi.fn(),
}));
vi.mock('../domains/model_api/access.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domains/model_api/access.ts')>()),
  ...gate,
}));

const listing = vi.hoisted(() => ({ listModelApiModels: vi.fn() }));
vi.mock('../domains/model_api/models.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domains/model_api/models.ts')>()),
  ...listing,
}));

interface JudgedRequest {
  segments: { read(): string; write(text: string): void }[];
}

const guardrails = vi.hoisted(() => ({
  apply: vi.fn(async (_request: JudgedRequest): Promise<void> => undefined),
  buildModelApiGuardrails: vi.fn(),
}));
vi.mock('../domains/model_api/guardrails.ts', () => ({
  buildModelApiGuardrails: guardrails.buildModelApiGuardrails,
}));

const metering = vi.hoisted(() => ({
  openModelApiLease: vi.fn(),
  heartbeatModelApiOp: vi.fn(() => () => undefined),
  closeModelApiLease: vi.fn(),
}));
vi.mock('../domains/model_api/metering.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../domains/model_api/metering.ts')
  >()),
  ...metering,
}));

const audit = vi.hoisted(() => ({
  recordModelEndpointRefusal: vi.fn(async (): Promise<void> => undefined),
}));
vi.mock('../domains/governance/model-endpoints.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../domains/governance/model-endpoints.ts')
  >()),
  ...audit,
}));

vi.mock('../auth/membership.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth/membership.ts')>()),
  getUserTeamIds: vi.fn(async () => []),
}));

const { createModelApiRestRoutes } = await import('./v1-model-api.ts');
const { setGatewayFetchForTests } =
  await import('../domains/model_api/relay.ts');
const { ModelApiRefusal } = await import('../domains/model_api/wire.ts');
const { spendFactsOf } = await import('../domains/model_api/metering.ts');

const POLICY = {
  enabled: true,
  mode: 'blocklist' as const,
  rules: [
    {
      scope: 'default' as const,
      allowedModels: [],
      blockedModels: ['gpt-blocked'],
    },
  ],
  modelApi: { enabled: true },
};

const MODELS = [
  {
    id: 'openrouter/anthropic/claude-sonnet-4.6',
    providerSlug: 'openrouter',
    modelId: 'anthropic/claude-sonnet-4.6',
    label: 'Claude Sonnet 4.6',
    vision: true,
    tools: true,
    contextWindow: 200_000,
    pricing: { inputCentsPerMillion: 300, outputCentsPerMillion: 1500 },
    connector: { name: 'openrouter' },
  },
  {
    id: 'deepseek/deepseek-v4-flash',
    providerSlug: 'deepseek',
    modelId: 'deepseek-v4-flash',
    label: 'DeepSeek V4 Flash',
    vision: false,
    tools: true,
    contextWindow: 128_000,
    connector: { name: 'deepseek' },
  },
];

const LEASE = {
  organizationId: 'org-1',
  sessionId: 'model-api:key-1',
  execId: 'req-uuid',
  token: 'sk-bf-lease',
  keyId: 'vk-1',
  gatewayModel: 'openrouter/anthropic/claude-sonnet-4.6',
};

let gatewayCalls: { url: string; body: Record<string, unknown> }[] = [];
let restoreGateway: () => void = () => undefined;

function gateway(respond: () => Response) {
  restoreGateway = setGatewayFetchForTests(async (url, init) => {
    gatewayCalls.push({
      url,
      body: JSON.parse(
        typeof init.body === 'string' ? init.body : '{}',
      ) as Record<string, unknown>,
    });
    return respond();
  });
}

function mount(options: { apiKeyId?: string; role?: string } = {}) {
  const app = new Hono<RestEnv>();
  app.use(async (c, next) => {
    c.set('userId', 'user-1');
    c.set('userEmail', 'dev@example.com');
    c.set('organizationId', 'org-1');
    c.set('orgSlug', 'acme');
    c.set('role', options.role ?? 'developer');
    c.set('orgExplicit', false);
    c.set('clientIp', '203.0.113.9');
    c.set('apiKeyId', options.apiKeyId ?? 'key-1');
    c.set('requestId', 'req-7');
    return next();
  });
  app.route('/', createModelApiRestRoutes({ sql: {} as Sql }));
  return app;
}

function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return mount().request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const CHAT = {
  model: 'openrouter/anthropic/claude-sonnet-4.6',
  messages: [{ role: 'user', content: 'Hello' }],
};
const MESSAGES = {
  model: 'openrouter/anthropic/claude-sonnet-4.6',
  max_tokens: 256,
  messages: [{ role: 'user', content: 'Hello' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  gatewayCalls = [];
  gate.resolveModelApiGate.mockResolvedValue({ kind: 'open', policy: POLICY });
  listing.listModelApiModels.mockResolvedValue(MODELS);
  guardrails.buildModelApiGuardrails.mockResolvedValue({
    apply: guardrails.apply,
  });
  metering.openModelApiLease.mockResolvedValue(LEASE);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  restoreGateway();
});

describe('the door is shut', () => {
  it('answers an organization that has not turned the endpoints on with 403 in each wire’s shape [MAPI-R1]', async () => {
    gate.resolveModelApiGate.mockResolvedValue({ kind: 'disabled' });
    const openai = await post('/openai/chat/completions', CHAT);
    expect(openai.status).toBe(403);
    expect(await openai.json()).toEqual({
      error: {
        message: expect.stringContaining('not enabled for this organization'),
        type: 'permission_error',
        param: null,
        code: 'MODEL_API_DISABLED',
      },
    });
    const anthropic = await post('/anthropic/v1/messages', MESSAGES);
    expect(anthropic.status).toBe(403);
    expect(anthropic.headers.get('request-id')).toBe('req-7');
    expect(await anthropic.json()).toEqual({
      type: 'error',
      error: {
        type: 'permission_error',
        message: expect.stringContaining('not enabled for this organization'),
        code: 'MODEL_API_DISABLED',
      },
      request_id: 'req-7',
    });
    const models = await mount().request('http://localhost/openai/models');
    expect(models.status).toBe(403);
    expect(metering.openModelApiLease).not.toHaveBeenCalled();
  });

  it('refuses a member without the right, and says when the policy cannot be read [MAPI-R2]', async () => {
    gate.resolveModelApiGate.mockResolvedValue({ kind: 'forbidden' });
    const forbidden = await post('/openai/chat/completions', CHAT);
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({
      error: { code: 'MODEL_API_FORBIDDEN' },
    });
    gate.resolveModelApiGate.mockResolvedValue({ kind: 'unavailable' });
    const unavailable = await post('/anthropic/v1/messages', MESSAGES);
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get('retry-after')).toBe('30');
  });
});

describe('GET /openai/models', () => {
  it('lists the callable models in the OpenAI shape, under the id both wires take [MAPI-R4]', async () => {
    const response = await mount().request('http://localhost/openai/models');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      object: 'list',
      data: [
        {
          id: 'openrouter/anthropic/claude-sonnet-4.6',
          object: 'model',
          created: 0,
          owned_by: 'openrouter',
        },
        {
          id: 'deepseek/deepseek-v4-flash',
          object: 'model',
          created: 0,
          owned_by: 'deepseek',
        },
      ],
    });
    expect(listing.listModelApiModels).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org-1',
        orgSlug: 'acme',
        userId: 'user-1',
      }),
    );
  });
});

describe('which model', () => {
  it('refuses a model the key holder’s model access blocks, and one nobody lists [MAPI-R4]', async () => {
    const blocked = await post('/openai/chat/completions', {
      ...CHAT,
      model: 'openai/gpt-blocked',
    });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({
      error: { code: 'MODEL_API_MODEL_FORBIDDEN', param: 'model' },
    });
    const unknown = await post('/anthropic/v1/messages', {
      ...MESSAGES,
      model: 'claude-sonnet-4-6',
    });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({
      type: 'error',
      error: { type: 'not_found_error', code: 'MODEL_API_MODEL_UNKNOWN' },
    });
    expect(metering.openModelApiLease).not.toHaveBeenCalled();
  });

  it('refuses images for a model without vision [MAPI-R5]', async () => {
    const response = await post('/openai/chat/completions', {
      model: 'deepseek/deepseek-v4-flash',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'what is this?' },
            {
              type: 'image_url',
              image_url: { url: 'https://example.com/a.png' },
            },
          ],
        },
      ],
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'MODEL_API_VISION_UNSUPPORTED' },
    });
  });

  it('answers a body that is not JSON in the wire’s shape', async () => {
    const response = await post('/anthropic/v1/messages', '{"model":');
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      type: 'error',
      error: { type: 'invalid_request_error', code: 'INVALID_BODY' },
    });
  });
});

describe('the EU/EEA processing rule [GOV-R17]', () => {
  const EU_POLICY = {
    ...POLICY,
    euProcessing: { enabled: true, hosts: ['llm.example.eu'] },
  };
  /** OpenRouter pointed at its EU endpoint — which the gateway's built-in
   * connection to OpenRouter does not use. */
  const OPENROUTER = {
    ...MODELS[0],
    connector: {
      name: 'openrouter',
      baseUrl: 'https://eu.openrouter.ai/api/v1',
    },
  };
  const withAnthropicEndpoint = (baseUrl: string) => ({
    ...OPENROUTER,
    connector: {
      ...OPENROUTER.connector,
      harnessEndpoint: { baseUrl, apiFormat: 'anthropic' as const },
    },
  });
  const deepseekAt = (baseUrl: string) => ({
    ...MODELS[1],
    connector: { name: 'deepseek', baseUrl },
  });
  const DEEPSEEK_CHAT = { ...CHAT, model: 'deepseek/deepseek-v4-flash' };

  beforeEach(() => {
    gate.resolveModelApiGate.mockResolvedValue({
      kind: 'open',
      policy: EU_POLICY,
    });
  });

  it('refuses a provider the gateway reaches through its built-in connection, even one pointed at its EU endpoint, before anything is held', async () => {
    listing.listModelApiModels.mockResolvedValue([OPENROUTER]);
    const response = await post('/openai/chat/completions', CHAT);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        message: expect.stringContaining(
          'the model gateway reaches the provider "openrouter" through its built-in connection',
        ),
        type: 'permission_error',
        param: 'model',
        code: 'MODEL_API_MODEL_FORBIDDEN',
      },
    });
    expect(audit.recordModelEndpointRefusal).toHaveBeenCalledWith(
      expect.anything(),
      {
        organizationId: 'org-1',
        surface: 'model-api',
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet-4.6',
        reason: 'gateway-builtin',
        code: 'MODEL_ENDPOINT_OUTSIDE_EU',
        message: expect.stringContaining(
          'This organization processes prompts only in the EU/EEA',
        ),
        actor: { id: 'user-1', type: 'api' },
      },
    );
    expect(guardrails.buildModelApiGuardrails).not.toHaveBeenCalled();
    expect(metering.openModelApiLease).not.toHaveBeenCalled();
    expect(gatewayCalls).toHaveLength(0);
  });

  it('relays the Anthropic wire over the connector’s native EU endpoint, and refuses its global one and the chat wire', async () => {
    gateway(() =>
      Response.json({
        type: 'message',
        model: 'gw',
        content: [],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    listing.listModelApiModels.mockResolvedValue([
      withAnthropicEndpoint('https://eu.openrouter.ai/api'),
    ]);
    const relayed = await post('/anthropic/v1/messages', MESSAGES);
    expect(relayed.status).toBe(200);
    expect(gatewayCalls).toHaveLength(1);
    // The chat wire keeps the gateway's built-in connection.
    const chat = await post('/openai/chat/completions', CHAT);
    expect(chat.status).toBe(403);

    listing.listModelApiModels.mockResolvedValue([
      withAnthropicEndpoint('https://openrouter.ai/api'),
    ]);
    const refused = await post('/anthropic/v1/messages', MESSAGES);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({
      type: 'error',
      error: {
        type: 'permission_error',
        code: 'MODEL_API_MODEL_FORBIDDEN',
        message: expect.stringContaining(
          'An admin can serve the model through a provider whose endpoint is eu.openrouter.ai instead.',
        ),
      },
    });
    expect(audit.recordModelEndpointRefusal).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        host: 'openrouter.ai',
        reason: 'vendor-global',
      }),
    );
    expect(gatewayCalls).toHaveLength(1);
  });

  it('relays a custom provider on an attested endpoint, and refuses one on any other', async () => {
    gateway(() => Response.json({ model: 'gw', choices: [], usage: {} }));
    listing.listModelApiModels.mockResolvedValue([
      deepseekAt('https://llm.example.eu/v1'),
    ]);
    const relayed = await post('/openai/chat/completions', DEEPSEEK_CHAT);
    expect(relayed.status).toBe(200);
    expect(audit.recordModelEndpointRefusal).not.toHaveBeenCalled();

    listing.listModelApiModels.mockResolvedValue([
      deepseekAt('https://api.deepseek.com'),
    ]);
    const refused = await post('/openai/chat/completions', DEEPSEEK_CHAT);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({
      error: {
        code: 'MODEL_API_MODEL_FORBIDDEN',
        message: expect.stringContaining(
          'api.deepseek.com is not an endpoint known to process there',
        ),
      },
    });
    expect(audit.recordModelEndpointRefusal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        host: 'api.deepseek.com',
        reason: 'not-attested',
      }),
    );
    expect(gatewayCalls).toHaveLength(1);
  });

  it('lists only the models the rule lets through on the OpenAI wire [GOV-R22]', async () => {
    listing.listModelApiModels.mockResolvedValue([
      OPENROUTER,
      deepseekAt('https://llm.example.eu/v1'),
    ]);
    const response = await mount().request('http://localhost/openai/models');
    expect(response.status).toBe(200);
    expect(
      ((await response.json()) as { data: Array<{ id: string }> }).data.map(
        (model) => model.id,
      ),
    ).toEqual(['deepseek/deepseek-v4-flash']);
    // A listing is no call: nothing is audited.
    expect(audit.recordModelEndpointRefusal).not.toHaveBeenCalled();
  });

  it('refuses even when the audit entry cannot be written', async () => {
    audit.recordModelEndpointRefusal.mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    listing.listModelApiModels.mockResolvedValue([OPENROUTER]);
    const response = await post('/openai/chat/completions', CHAT);
    expect(response.status).toBe(403);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('could not be written'),
      expect.any(Error),
    );
    expect(metering.openModelApiLease).not.toHaveBeenCalled();
    expect(gatewayCalls).toHaveLength(0);
  });

  it('changes nothing while the rule is off', async () => {
    gate.resolveModelApiGate.mockResolvedValue({
      kind: 'open',
      policy: { ...POLICY, euProcessing: { enabled: false } },
    });
    gateway(() => Response.json({ model: 'gw', choices: [], usage: {} }));
    listing.listModelApiModels.mockResolvedValue([OPENROUTER]);
    const response = await post('/openai/chat/completions', CHAT);
    expect(response.status).toBe(200);
    expect(audit.recordModelEndpointRefusal).not.toHaveBeenCalled();
  });
});

describe('guardrails and budget', () => {
  it('refuses what the guardrails block before anything is held or relayed [MAPI-R6]', async () => {
    guardrails.apply.mockRejectedValueOnce(
      new ModelApiRefusal(
        400,
        'MODEL_API_GUARDRAIL_BLOCKED',
        'Blocked by the chat_filter guardrail (codenames).',
      ),
    );
    const response = await post('/anthropic/v1/messages', MESSAGES);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        code: 'MODEL_API_GUARDRAIL_BLOCKED',
      },
    });
    expect(metering.openModelApiLease).not.toHaveBeenCalled();
    expect(gatewayCalls).toHaveLength(0);
  });

  it('relays the text as the guardrails masked it [MAPI-R6]', async () => {
    guardrails.apply.mockImplementationOnce(async (request: JudgedRequest) => {
      for (const segment of request.segments) {
        segment.write(segment.read().replace('jane@example.com', '[EMAIL]'));
      }
    });
    gateway(() =>
      Response.json({
        id: 'msg',
        type: 'message',
        model: 'openrouter/anthropic/claude-sonnet-4.6',
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 5, output_tokens: 1 },
      }),
    );
    await post('/anthropic/v1/messages', {
      ...MESSAGES,
      messages: [{ role: 'user', content: 'write to jane@example.com' }],
    });
    expect(gatewayCalls[0]?.body.messages).toEqual([
      { role: 'user', content: 'write to [EMAIL]' },
    ]);
  });

  it('answers a reached cap with 429 BUDGET_EXCEEDED, its wait, and no retry, in each shape [MAPI-R7]', async () => {
    const refusal = new ModelApiRefusal(
      429,
      'BUDGET_EXCEEDED',
      'Usage limit reached. Your daily cost limit is used up until 2026-09-30T00:00:00.000Z.',
      { headers: { 'retry-after': '3600' } },
    );
    metering.openModelApiLease.mockRejectedValue(refusal);
    const openai = await post('/openai/chat/completions', CHAT);
    expect(openai.status).toBe(429);
    expect(openai.headers.get('retry-after')).toBe('3600');
    expect(openai.headers.get('x-should-retry')).toBe('false');
    expect(await openai.json()).toEqual({
      error: {
        message: refusal.message,
        type: 'insufficient_quota',
        param: null,
        code: 'BUDGET_EXCEEDED',
      },
    });
    const anthropic = await post('/anthropic/v1/messages', MESSAGES);
    expect(anthropic.status).toBe(429);
    expect(await anthropic.json()).toMatchObject({
      type: 'error',
      error: { type: 'rate_limit_error', code: 'BUDGET_EXCEEDED' },
    });
    expect(gatewayCalls).toHaveLength(0);
  });

  it('holds the request’s worst case for the key holder and the key [MAPI-R7]', async () => {
    gateway(() => Response.json({ model: 'x', choices: [], usage: {} }));
    await post('/openai/chat/completions', { ...CHAT, max_tokens: 1_000 });
    expect(metering.openModelApiLease).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org-1',
        userId: 'user-1',
        apiKeyId: 'key-1',
        requestId: expect.any(String),
        wire: 'openai',
        model: MODELS[0],
        worstCase: expect.objectContaining({
          outputCap: 1_000,
          choiceCount: 1,
          cents: expect.any(Number),
        }),
      }),
    );
    // The guardrail events are filed under the server's own request id,
    // the caller's beside it.
    const [, lease] = metering.openModelApiLease.mock.calls[0] as [
      unknown,
      { requestId: string },
    ];
    expect(guardrails.buildModelApiGuardrails).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org-1',
        orgSlug: 'acme',
        requestId: lease.requestId,
        callerRequestId: 'req-7',
      }),
    );
    expect(lease.requestId).not.toBe('req-7');
  });

  it('sends the held output cap upstream when the caller named none', async () => {
    gateway(() => Response.json({ model: 'x', choices: [], usage: {} }));
    await post('/openai/chat/completions', CHAT);
    expect(gatewayCalls[0]?.body.max_completion_tokens).toBeGreaterThan(0);
  });
});

describe('a relayed call', () => {
  it('streams an OpenAI answer with a tool call, then closes the lease with its usage', async () => {
    const chunk = (body: Record<string, unknown>) =>
      `data: ${JSON.stringify({ object: 'chat.completion.chunk', model: 'gw', ...body })}\n\n`;
    gateway(
      () =>
        new Response(
          [
            chunk({
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_1',
                        type: 'function',
                        function: {
                          name: 'weather',
                          arguments: '{"city":"Bern"}',
                        },
                      },
                    ],
                  },
                  finish_reason: 'tool_calls',
                },
              ],
            }),
            chunk({
              choices: [],
              usage: { prompt_tokens: 40, completion_tokens: 9 },
            }),
            'data: [DONE]\n\n',
          ].join(''),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    const response = await post('/openai/chat/completions', {
      ...CHAT,
      stream: true,
      tools: [
        { type: 'function', function: { name: 'weather', parameters: {} } },
      ],
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('"name":"weather"');
    expect(text).toContain('"model":"openrouter/anthropic/claude-sonnet-4.6"');
    // The usage chunk the door asked for is not the caller's.
    expect(text).not.toContain('prompt_tokens');
    expect(gatewayCalls[0]?.body).toMatchObject({
      model: 'openrouter/anthropic/claude-sonnet-4.6',
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(metering.closeModelApiLease).toHaveBeenCalledWith(
      expect.anything(),
      LEASE,
      {
        outcome: {
          status: 'completed',
          usage: { inputTokens: 40, outputTokens: 9 },
          countedOutputTokens: expect.any(Number),
        },
        model: MODELS[0],
        promptTokens: expect.any(Number),
      },
    );
  });

  it('accepts the query parameters an Anthropic SDK adds', async () => {
    gateway(() =>
      Response.json({
        type: 'message',
        model: 'gw',
        content: [],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    const response = await post('/anthropic/v1/messages?beta=true', MESSAGES, {
      'anthropic-version': '2023-06-01',
    });
    expect(response.status).toBe(200);
    expect(gatewayCalls[0]?.url).toMatch(/\/anthropic\/v1\/messages$/);
  });

  it('refuses a key-less call [MAPI-R3]', async () => {
    const response = await mount({ apiKeyId: '' }).request(
      'http://localhost/openai/chat/completions',
      { method: 'POST', body: JSON.stringify(CHAT) },
    );
    expect(response.status).toBe(401);
  });
});

describe('a caller who hangs up while the request is governed', () => {
  type Ending = Parameters<typeof spendFactsOf>[0];

  function postChat(signal: AbortSignal) {
    return mount().request('http://localhost/openai/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(CHAT),
      signal,
    });
  }

  /** What the lease was closed with — the ending its settlement books. */
  function ending(): Ending {
    expect(metering.closeModelApiLease).toHaveBeenCalledTimes(1);
    const [, lease, closed] = metering.closeModelApiLease.mock.calls[0] as [
      unknown,
      unknown,
      Ending,
    ];
    expect(lease).toEqual(LEASE);
    return closed;
  }

  beforeEach(() => {
    gateway(() =>
      Response.json({
        model: 'gw',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' } }],
        usage: { prompt_tokens: 1_000_000, completion_tokens: 2 },
      }),
    );
  });

  it('sends nothing and books no prompt when the caller leaves while the guardrails judge it', async () => {
    const caller = new AbortController();
    guardrails.apply.mockImplementationOnce(async () => {
      caller.abort();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    await postChat(caller.signal);
    expect(gatewayCalls).toHaveLength(0);
    const closed = ending();
    expect(closed.outcome).toEqual({ status: 'cancelled' });
    expect(spendFactsOf(closed).floorCents).toBeNull();
  });

  it('sends nothing and books no prompt when the caller leaves while its key is minted', async () => {
    const caller = new AbortController();
    metering.openModelApiLease.mockImplementationOnce(async () => {
      caller.abort();
      await new Promise((resolve) => setTimeout(resolve, 5));
      return LEASE;
    });
    await postChat(caller.signal);
    expect(gatewayCalls).toHaveLength(0);
    const closed = ending();
    expect(closed.outcome).toEqual({ status: 'cancelled' });
    expect(spendFactsOf(closed).floorCents).toBeNull();
  });

  it('relays a caller who stays through the same work, and books what the answer reported', async () => {
    const caller = new AbortController();
    guardrails.apply.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    const response = await postChat(caller.signal);
    expect(response.status).toBe(200);
    expect(gatewayCalls).toHaveLength(1);
    const closed = ending();
    expect(closed.outcome).toEqual({
      status: 'completed',
      usage: { inputTokens: 1_000_000, outputTokens: 2 },
    });
    // 1M input tokens at the catalog's 300c/M.
    expect(spendFactsOf(closed).expectedCents).toBeGreaterThanOrEqual(300);
  });
});
