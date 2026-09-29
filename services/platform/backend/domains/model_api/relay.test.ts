/**
 * The relay leg against a scripted gateway: what goes upstream (the body, the
 * request's key, the Anthropic version — nothing of the caller's headers),
 * and what comes back in the caller's wire — streams passed through event by
 * event with the model renamed and the usage read, tool calls intact, the
 * gateway's routing names never shown, a hang-up aborting the vendor.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type RelayArgs,
  type RelayOutcome,
  relayToGateway,
  setGatewayFetchForTests,
} from './relay.ts';
import { ModelApiRefusal } from './wire.ts';

interface Call {
  url: string;
  init: RequestInit;
}

let calls: Call[] = [];
let restore: () => void = () => undefined;

function gateway(respond: (call: Call) => Response | Promise<Response>) {
  restore = setGatewayFetchForTests(async (url, init) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  });
}

/** A body that arrives in the given pieces, one read each. */
function pieces(
  parts: string[],
  onCancel?: () => void,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const part = parts[index];
      index += 1;
      if (part === undefined) controller.close();
      else controller.enqueue(encoder.encode(part));
    },
    cancel() {
      onCancel?.();
    },
  });
}

function sse(parts: string[]): Response {
  return new Response(pieces(parts), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function args(overrides: Partial<RelayArgs>): {
  args: RelayArgs;
  outcomes: RelayOutcome[];
} {
  const outcomes: RelayOutcome[] = [];
  return {
    outcomes,
    args: {
      wire: 'openai',
      publicModel: 'deepseek/deepseek-v4-flash',
      gatewayModel: 'org-1__deepseek__deepseek-v4-flash/deepseek-v4-flash',
      token: 'sk-bf-secret',
      body: { model: 'org-1__deepseek__deepseek-v4-flash/deepseek-v4-flash' },
      stream: false,
      dropUsageChunk: false,
      anthropicHeaders: { 'anthropic-version': '2023-06-01' },
      requestId: 'req-7',
      signal: new AbortController().signal,
      onDone: (outcome) => outcomes.push(outcome),
      ...overrides,
    },
  };
}

/** The data payloads of an SSE text, parsed where they are JSON. */
function events(text: string): unknown[] {
  return text
    .split('\n\n')
    .filter((block) => block.trim() !== '')
    .map((block) => {
      const data = block
        .split('\n')
        .find((line) => line.startsWith('data:'))
        ?.slice(5)
        .trim();
      if (data === undefined) return { raw: block };
      return data === '[DONE]' ? data : JSON.parse(data);
    });
}

beforeEach(() => {
  calls = [];
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  restore();
});

describe('relayToGateway — what goes upstream', () => {
  it('sends the body with the request key to the wire’s gateway route, and no caller header', async () => {
    gateway(() => Response.json({ model: 'x', choices: [] }));
    const { args: openai } = args({ body: { model: 'gw/m', messages: [] } });
    await relayToGateway(openai);
    expect(calls[0]?.url).toMatch(/\/openai\/v1\/chat\/completions$/);
    expect(calls[0]?.init.headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer sk-bf-secret',
      accept: 'application/json',
    });
    const sent = calls[0]?.init.body;
    expect(typeof sent).toBe('string');
    expect(JSON.parse(typeof sent === 'string' ? sent : '')).toEqual({
      model: 'gw/m',
      messages: [],
    });

    const { args: anthropic } = args({
      wire: 'anthropic',
      stream: true,
      anthropicHeaders: {
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'interleaved-thinking-2025-05-14',
      },
    });
    gateway(() =>
      sse(['event: message_stop\ndata: {"type":"message_stop"}\n\n']),
    );
    const response = await relayToGateway(anthropic);
    await response.text();
    expect(calls[1]?.url).toMatch(/\/anthropic\/v1\/messages$/);
    expect(calls[1]?.init.headers).toMatchObject({
      authorization: 'Bearer sk-bf-secret',
      accept: 'text/event-stream',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'interleaved-thinking-2025-05-14',
    });
  });
});

describe('relayToGateway — OpenAI streams', () => {
  const chunk = (body: Record<string, unknown>) =>
    `data: ${JSON.stringify({
      id: 'c1',
      object: 'chat.completion.chunk',
      model: 'org-1__deepseek__deepseek-v4-flash/deepseek-v4-flash',
      ...body,
    })}\n\n`;

  it('passes the stream through with the model renamed, tool calls intact, the injected usage chunk dropped and read', async () => {
    const toolCall = {
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: { name: 'lookup', arguments: '{"q":' },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    };
    const stream = [
      chunk({
        choices: [{ index: 0, delta: { role: 'assistant', content: 'Hel' } }],
      }),
      // An event split across two reads.
      chunk({ choices: [{ index: 0, delta: { content: 'lo' } }] }).slice(0, 30),
      chunk({ choices: [{ index: 0, delta: { content: 'lo' } }] }).slice(30),
      chunk(toolCall),
      chunk({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '"x"}' } }],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }),
      chunk({
        choices: [],
        usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
      }),
      'data: [DONE]\n\n',
    ];
    gateway(() => sse(stream));
    const { args: relay, outcomes } = args({
      stream: true,
      dropUsageChunk: true,
    });
    const response = await relayToGateway(relay);
    expect(response.headers.get('content-type')).toBe(
      'text/event-stream; charset=utf-8',
    );
    const received = events(await response.text());
    expect(received).toHaveLength(5);
    for (const event of received.slice(0, 4)) {
      expect(event).toMatchObject({ model: 'deepseek/deepseek-v4-flash' });
    }
    expect(received[1]).toMatchObject({
      choices: [{ delta: { content: 'lo' } }],
    });
    expect(received[2]).toMatchObject({ choices: toolCall.choices });
    expect(received[4]).toBe('[DONE]');
    expect(outcomes).toEqual([
      { status: 'completed', usage: { inputTokens: 120, outputTokens: 30 } },
    ]);
  });

  it('keeps the usage chunk for a caller that asked for it', async () => {
    gateway(() =>
      sse([
        chunk({
          choices: [],
          usage: { prompt_tokens: 1, completion_tokens: 2 },
        }),
        'data: [DONE]\n\n',
      ]),
    );
    const { args: relay } = args({ stream: true, dropUsageChunk: false });
    const received = events(await (await relayToGateway(relay)).text());
    expect(received[0]).toMatchObject({ usage: { prompt_tokens: 1 } });
  });

  it('reads CRLF-framed events', async () => {
    gateway(() =>
      sse([
        `data: ${JSON.stringify({ model: 'gw', choices: [{ index: 0, delta: { content: 'a' } }] })}\r\n\r`,
        '\n',
        'data: [DONE]\r\n\r\n',
      ]),
    );
    const { args: relay } = args({ stream: true });
    const received = events(await (await relayToGateway(relay)).text());
    expect(received).toEqual([
      {
        model: 'deepseek/deepseek-v4-flash',
        choices: [{ index: 0, delta: { content: 'a' } }],
      },
      '[DONE]',
    ]);
  });

  it('ends a broken stream with an error event in the wire’s shape', async () => {
    const encoder = new TextEncoder();
    let sent = false;
    gateway(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (!sent) {
                sent = true;
                controller.enqueue(encoder.encode(chunk({ choices: [] })));
                return;
              }
              controller.error(new Error('socket hang up'));
            },
          }),
          { status: 200 },
        ),
    );
    const { args: relay, outcomes } = args({ stream: true });
    const received = events(await (await relayToGateway(relay)).text());
    expect(received.at(-1)).toEqual({
      error: {
        message: 'The model stream broke off before the answer was complete.',
        type: 'server_error',
        param: null,
        code: 'MODEL_API_UPSTREAM_ERROR',
      },
    });
    expect(outcomes).toEqual([{ status: 'failed' }]);
  });

  it('aborts the vendor when the caller hangs up', async () => {
    let upstreamCancelled = false;
    let upstreamSignal: AbortSignal | undefined;
    gateway((call) => {
      upstreamSignal = call.init.signal ?? undefined;
      return new Response(
        pieces([chunk({ choices: [] }), chunk({ choices: [] })], () => {
          upstreamCancelled = true;
        }),
        { status: 200 },
      );
    });
    const caller = new AbortController();
    const { args: relay, outcomes } = args({
      stream: true,
      signal: caller.signal,
    });
    const response = await relayToGateway(relay);
    const reader = response.body?.getReader();
    await reader?.read();
    caller.abort();
    await reader?.cancel();
    expect(upstreamSignal?.aborted).toBe(true);
    expect(upstreamCancelled).toBe(true);
    expect(outcomes).toEqual([{ status: 'cancelled' }]);
  });
});

describe('relayToGateway — a hang-up while the vendor is silent', () => {
  it('ends the stream once the aborted upstream read fails, and reports it cancelled', async () => {
    gateway((call) => {
      const signal = call.init.signal ?? undefined;
      return new Response(
        new ReadableStream<Uint8Array>({
          // A long prefill: nothing until the request is aborted.
          pull: (controller) =>
            new Promise<void>((resolve) => {
              signal?.addEventListener('abort', () => {
                controller.error(new DOMException('aborted', 'AbortError'));
                resolve();
              });
            }),
        }),
        { status: 200 },
      );
    });
    const caller = new AbortController();
    const { args: relay, outcomes } = args({
      stream: true,
      signal: caller.signal,
    });
    const response = await relayToGateway(relay);
    const reader = response.body?.getReader();
    const pending = reader?.read();
    caller.abort();
    await expect(pending).rejects.toBeDefined();
    expect(outcomes).toEqual([{ status: 'cancelled' }]);
  });
});

describe('relayToGateway — Anthropic streams', () => {
  it('renames the model on message_start and reads the input and output usage', async () => {
    const stream = [
      `event: message_start\ndata: ${JSON.stringify({
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model:
            'org-1__deepseek__deepseek-v4-flash__anthropic/deepseek-v4-flash',
          content: [],
          usage: { input_tokens: 900, output_tokens: 1 },
        },
      })}\n\n`,
      'event: ping\ndata: {"type": "ping"}\n\n',
      `event: content_block_start\ndata: ${JSON.stringify({
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'tu_1',
          name: 'Read',
          input: {},
        },
      })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"path":"a"}' },
      })}\n\n`,
      `event: message_delta\ndata: ${JSON.stringify({
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
        usage: { output_tokens: 42 },
      })}\n\n`,
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];
    gateway(() => sse(stream));
    const { args: relay, outcomes } = args({
      wire: 'anthropic',
      stream: true,
      gatewayModel:
        'org-1__deepseek__deepseek-v4-flash__anthropic/deepseek-v4-flash',
    });
    const text = await (await relayToGateway(relay)).text();
    expect(text).toContain('event: message_start\ndata: ');
    expect(text).toContain('event: ping\ndata: {"type":"ping"}');
    expect(text).not.toContain('org-1__');
    const received = events(text);
    expect(received[0]).toMatchObject({
      message: { model: 'deepseek/deepseek-v4-flash' },
    });
    expect(received[3]).toMatchObject({
      delta: { type: 'input_json_delta', partial_json: '{"path":"a"}' },
    });
    expect(outcomes).toEqual([
      { status: 'completed', usage: { inputTokens: 900, outputTokens: 42 } },
    ]);
  });
});

describe('relayToGateway — whole answers', () => {
  it('renames the model and reads the usage of an OpenAI completion', async () => {
    gateway(() =>
      Response.json({
        id: 'c',
        object: 'chat.completion',
        model: 'org-1__deepseek__deepseek-v4-flash/deepseek-v4-flash',
        choices: [{ index: 0, message: { role: 'assistant', content: 'hi' } }],
        usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
      }),
    );
    const { args: relay, outcomes } = args({});
    const answer = (await (await relayToGateway(relay)).json()) as Record<
      string,
      unknown
    >;
    expect(answer.model).toBe('deepseek/deepseek-v4-flash');
    expect(outcomes).toEqual([
      { status: 'completed', usage: { inputTokens: 10, outputTokens: 3 } },
    ]);
  });

  it('renames the model and reads the usage of an Anthropic message', async () => {
    gateway(() =>
      Response.json({
        id: 'msg',
        type: 'message',
        role: 'assistant',
        model: 'gw-record/x',
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 7, output_tokens: 2 },
      }),
    );
    const { args: relay, outcomes } = args({
      wire: 'anthropic',
      gatewayModel: 'gw-record/x',
    });
    const response = await relayToGateway(relay);
    expect(response.headers.get('request-id')).toBe('req-7');
    const answer = (await response.json()) as Record<string, unknown>;
    expect(answer.model).toBe('deepseek/deepseek-v4-flash');
    expect(outcomes).toEqual([
      { status: 'completed', usage: { inputTokens: 7, outputTokens: 2 } },
    ]);
  });
});

describe('relayToGateway — refusals', () => {
  it('relays a vendor refusal in the wire’s shape, its status kept and the routing names replaced', async () => {
    gateway(() =>
      Response.json(
        {
          is_bifrost_error: false,
          status_code: 400,
          error: {
            type: 'invalid_request_error',
            message:
              'This model org-1__deepseek__deepseek-v4-flash/deepseek-v4-flash has a maximum context length of 64000 tokens',
          },
        },
        { status: 400 },
      ),
    );
    const { args: relay, outcomes } = args({});
    const response = await relayToGateway(relay);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        message:
          'This model deepseek/deepseek-v4-flash has a maximum context length of 64000 tokens',
        type: 'invalid_request_error',
        param: null,
        code: 'MODEL_API_UPSTREAM_ERROR',
      },
    });
    expect(outcomes).toEqual([{ status: 'failed' }]);
  });

  it('answers a refusal of the platform’s own wiring as a 502, in the Anthropic shape', async () => {
    gateway(() =>
      Response.json(
        { error: { message: 'virtual key not allowed' } },
        { status: 403 },
      ),
    );
    const { args: relay } = args({ wire: 'anthropic' });
    const response = await relayToGateway(relay);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      type: 'error',
      error: {
        type: 'api_error',
        message: 'virtual key not allowed',
        code: 'MODEL_API_UPSTREAM_ERROR',
      },
      request_id: 'req-7',
    });
  });

  it('keeps a vendor rate limit a 429', async () => {
    gateway(() =>
      Response.json({ error: { message: 'slow down' } }, { status: 429 }),
    );
    const { args: relay } = args({});
    expect((await relayToGateway(relay)).status).toBe(429);
  });

  it('throws the 502 refusal when the gateway cannot be reached', async () => {
    gateway(() => Promise.reject(new TypeError('fetch failed')));
    const { args: relay, outcomes } = args({});
    await expect(relayToGateway(relay)).rejects.toBeInstanceOf(ModelApiRefusal);
    expect(outcomes).toEqual([{ status: 'failed' }]);
  });
});
