import { describe, expect, it } from 'vitest';

import type { RelayConnector } from './endpoint.ts';
import type { UpstreamFetch } from './passthrough.ts';
import {
  createRelayHandler,
  type RelayHandlerDeps,
  tokenHashOf,
} from './server.ts';
import type { RelayGrant } from './store.ts';
import type { RelayUsage } from './usage.ts';

const ORG = 'org_1';
const TOKEN = 'tale-rt-turn-key';

const GRANT: RelayGrant = {
  organizationId: ORG,
  sessionId: 'session_1',
  keyId: 'tr_1',
  allowedModels: [
    { providerSlug: 'anthropic', modelId: 'claude-sonnet-5-5' },
    { providerSlug: 'deepseek', modelId: 'deepseek-v4' },
  ],
  servingCredentials: {},
};

const ANTHROPIC: RelayConnector = {
  name: 'anthropic',
  apiFormat: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  apiKey: 'sk-ant-org',
};

const sse = (event: Record<string, unknown>) =>
  `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`;

const STREAM = [
  sse({
    type: 'message_start',
    message: {
      usage: {
        input_tokens: 1000,
        cache_read_input_tokens: 4000,
        cache_creation_input_tokens: 0,
        output_tokens: 1,
      },
    },
  }),
  sse({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: 'Done.' },
  }),
  sse({ type: 'message_delta', usage: { output_tokens: 200 } }),
  sse({ type: 'message_stop' }),
].join('');

interface Booked {
  keyId: string;
  usage: RelayUsage;
  cents: number;
}

function relay(
  over: Partial<RelayHandlerDeps> & {
    grants?: Record<string, RelayGrant>;
    remaining?: number | null;
    upstream?: (url: string, init: RequestInit) => Response;
  } = {},
) {
  const booked: Booked[] = [];
  const grantReads: string[] = [];
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  const grants = over.grants ?? { [tokenHashOf(TOKEN)]: GRANT };
  const fetcher: UpstreamFetch = async (url, init) => {
    sent.push({
      url,
      body: JSON.parse(
        typeof init.body === 'string' ? init.body : '{}',
      ) as Record<string, unknown>,
    });
    return over.upstream !== undefined
      ? over.upstream(url, init)
      : new Response(STREAM, {
          headers: { 'content-type': 'text/event-stream' },
        });
  };
  const deps: RelayHandlerDeps = {
    grantOf: async (hash) => {
      grantReads.push(hash);
      return grants[hash] ?? null;
    },
    remainingCents: async () =>
      over.remaining === undefined ? 500 : over.remaining,
    bookCall: async (keyId, usage, cents) => {
      booked.push({ keyId, usage, cents });
    },
    connectorFor: async (_grant, slug) => ({
      connector:
        slug === 'anthropic' ? ANTHROPIC : { ...ANTHROPIC, name: slug },
      entry: {
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
      },
    }),
    fetcher,
    ...over,
  };
  return { handle: createRelayHandler(deps), booked, grantReads, sent };
}

const call = (
  path: string,
  body: unknown,
  headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` },
) =>
  new Request(`http://relay${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

/** Lets the booking the answer's end fired run. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('who can call the relay', () => {
  it('refuses a call without a key, in the format of the door called [RELAY-R1]', async () => {
    const { handle } = relay();
    const answer = await handle(
      call('/anthropic/v1/messages', { model: 'x', messages: [] }, {}),
    );
    expect(answer.status).toBe(401);
    expect(await answer.json()).toMatchObject({
      type: 'error',
      error: { type: 'authentication_error' },
    });
  });

  it('refuses a key that is not a live turn’s, and remembers a grant only for seconds [RELAY-R1]', async () => {
    const { handle, grantReads } = relay();
    const unknown = await handle(
      call(
        '/openai/v1/chat/completions',
        { model: 'x', messages: [] },
        { authorization: 'Bearer replayed-key' },
      ),
    );
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toMatchObject({
      error: { type: 'authentication_error' },
    });
    await handle(
      call('/anthropic/v1/messages', {
        model: 'claude-sonnet-5-5',
        messages: [],
      }),
    );
    await handle(
      call('/anthropic/v1/messages', {
        model: 'claude-sonnet-5-5',
        messages: [],
      }),
    );
    expect(
      grantReads.filter((hash) => hash === tokenHashOf(TOKEN)),
    ).toHaveLength(1);
  });

  it('answers its health check without a key, and serves nothing it does not name', async () => {
    const { handle } = relay();
    expect((await handle(new Request('http://relay/health'))).status).toBe(200);
    expect((await handle(call('/api/v1/chat', {}))).status).toBe(404);
  });
});

describe('which model a turn may call', () => {
  it('lists the turn’s models by the names its harness uses', async () => {
    const { handle } = relay();
    const answer = await handle(
      new Request('http://relay/openai/v1/models', {
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
    );
    expect(await answer.json()).toEqual({
      object: 'list',
      data: [
        {
          id: 'anthropic/claude-sonnet-5-5',
          object: 'model',
          created: 0,
          owned_by: 'tale',
        },
        {
          id: 'org_1__deepseek__deepseek-v4/deepseek-v4',
          object: 'model',
          created: 0,
          owned_by: 'tale',
        },
      ],
    });
  });

  it('refuses a model the turn was not given [RELAY-R3]', async () => {
    const { handle, sent } = relay();
    const answer = await handle(
      call('/openai/v1/chat/completions', {
        model: 'openai/gpt-6',
        messages: [],
      }),
    );
    expect(answer.status).toBe(403);
    expect(
      ((await answer.json()) as { error: { message: string } }).error.message,
    ).toBe('The model "openai/gpt-6" is not one this turn may call.');
    expect(sent).toHaveLength(0);
  });
});

describe('the turn’s allowance', () => {
  it('refuses a call once the allowance is used up, with the status agents read as spent [RELAY-R4]', async () => {
    const { handle, sent } = relay({ remaining: 0 });
    const answer = await handle(
      call('/anthropic/v1/messages', {
        model: 'claude-sonnet-5-5',
        messages: [],
      }),
    );
    expect(answer.status).toBe(402);
    expect(await answer.json()).toMatchObject({
      error: { type: 'billing_error' },
    });
    expect(sent).toHaveLength(0);
  });

  it('refuses the key of a turn whose op is gone [RELAY-R1]', async () => {
    const { handle } = relay({ remaining: null });
    const answer = await handle(
      call('/anthropic/v1/messages', {
        model: 'claude-sonnet-5-5',
        messages: [],
      }),
    );
    expect(answer.status).toBe(401);
  });

  it('books each call on its turn when it ends, every kind of token at its own price [RELAY-R5]', async () => {
    const { handle, booked } = relay();
    const answer = await handle(
      call('/anthropic/v1/messages', {
        model: 'anthropic/claude-sonnet-5-5',
        stream: true,
        messages: [{ role: 'user', content: 'go' }],
      }),
    );
    await answer.text();
    await settled();
    expect(booked).toEqual([
      {
        keyId: 'tr_1',
        usage: {
          inputTokens: 1000,
          cacheReadTokens: 4000,
          cacheWriteTokens: 0,
          outputTokens: 200,
        },
        // 1000 × 3 + 4000 × 0.3 + 200 × 15, in millionths of a dollar.
        cents: 0.72,
      },
    ]);
  });

  it('books nothing for a call the provider refused [RELAY-R5]', async () => {
    const { handle, booked } = relay({
      upstream: () =>
        Response.json(
          {
            type: 'error',
            error: { type: 'invalid_request_error', message: 'too long' },
          },
          { status: 400 },
        ),
    });
    const answer = await handle(
      call('/anthropic/v1/messages', {
        model: 'claude-sonnet-5-5',
        messages: [],
      }),
    );
    expect(answer.status).toBe(400);
    await settled();
    expect(booked).toEqual([]);
  });
});

describe('the provider’s answer', () => {
  it('passes the provider’s stream on as it was sent, with the model’s own name upstream [RELAY-R6]', async () => {
    const { handle, sent } = relay();
    const answer = await handle(
      call('/anthropic/v1/messages', {
        model: 'anthropic/claude-sonnet-5-5',
        stream: true,
        messages: [{ role: 'user', content: 'go' }],
      }),
    );
    expect(await answer.text()).toBe(STREAM);
    expect(sent[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(sent[0]?.body.model).toBe('claude-sonnet-5-5');
  });

  it('sends a call with tools the off of a model that takes tools only there, whatever its client asked [RELAY-R11]', async () => {
    // Pi on OpenAI's GPT-6 Sol, whose Chat Completions takes function tools
    // only at `none` while its own default is medium: Pi asks no effort,
    // and the relay sends the catalog's off.
    const { handle, sent } = relay({
      grants: {
        [tokenHashOf(TOKEN)]: {
          ...GRANT,
          allowedModels: [{ providerSlug: 'openai', modelId: 'gpt-6-sol' }],
        },
      },
      connectorFor: async () => ({
        connector: {
          name: 'openai',
          apiFormat: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-openai-org',
        },
        entry: {
          id: 'gpt-6-sol',
          provider: 'openai',
          tags: ['chat'],
          supportsTools: true,
          supportsVision: true,
          reasoning: { knob: 'effort', off: 'none', toolsRequireOff: true },
          contextWindow: 1_050_000,
        },
      }),
      upstream: () =>
        Response.json({
          id: 'chatcmpl-1',
          choices: [],
          usage: { prompt_tokens: 3, completion_tokens: 1 },
        }),
    });
    const tools = [
      { type: 'function', function: { name: 'connector', parameters: {} } },
    ];
    await handle(
      call('/openai/v1/chat/completions', {
        model: 'openai/gpt-6-sol',
        messages: [{ role: 'user', content: 'go' }],
        tools,
      }),
    );
    await handle(
      call('/openai/v1/chat/completions', {
        model: 'openai/gpt-6-sol',
        messages: [{ role: 'user', content: 'go' }],
        reasoning_effort: 'high',
      }),
    );
    expect(sent[0]?.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(sent[0]?.body).toMatchObject({
      model: 'gpt-6-sol',
      reasoning_effort: 'none',
      tools,
    });
    // Without tools the model takes any effort: the client's stands.
    expect(sent[1]?.body.reasoning_effort).toBe('high');
  });

  it('says a refused provider credential as its own 502, never as the agent’s key [RELAY-R9]', async () => {
    const { handle } = relay({
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
    const answer = await handle(
      call('/anthropic/v1/messages', {
        model: 'claude-sonnet-5-5',
        messages: [],
      }),
    );
    expect(answer.status).toBe(502);
    expect(
      ((await answer.json()) as { error: { message: string } }).error.message,
    ).toContain("refused the organization's credential");
  });

  it('says a provider that cannot serve the turn, without calling it', async () => {
    const { handle, sent } = relay({
      connectorFor: async () => {
        throw new Error(
          'its credential cannot be served through the model relay',
        );
      },
    });
    const answer = await handle(
      call('/anthropic/v1/messages', {
        model: 'claude-sonnet-5-5',
        messages: [],
      }),
    );
    expect(answer.status).toBe(502);
    expect(sent).toHaveLength(0);
  });

  it('refuses a body that is not a JSON object, or that names no model', async () => {
    const { handle } = relay();
    expect(
      (await handle(call('/openai/v1/chat/completions', 'not json'))).status,
    ).toBe(400);
    expect(
      (await handle(call('/openai/v1/chat/completions', { messages: [] })))
        .status,
    ).toBe(400);
  });

  it('counts tokens at an Anthropic provider, which counts them for nothing', async () => {
    const { handle, sent, booked } = relay({
      upstream: () => Response.json({ input_tokens: 42 }),
    });
    const answer = await handle(
      call('/anthropic/v1/messages/count_tokens', {
        model: 'claude-sonnet-5-5',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );
    expect(await answer.json()).toEqual({ input_tokens: 42 });
    expect(sent[0]?.url).toBe(
      'https://api.anthropic.com/v1/messages/count_tokens',
    );
    await settled();
    expect(booked).toEqual([]);
  });
});
