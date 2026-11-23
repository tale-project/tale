import { describe, expect, it } from 'vitest';

import type { UpstreamEndpoint } from './endpoint.ts';
import {
  forwardedExtraHeaders,
  type RelayCallOutcome,
  relayPassthrough,
  type UpstreamFetch,
} from './passthrough.ts';

const encoder = new TextEncoder();

/** A body that sends `chunks`, then ends — or hangs, until aborted. */
function streamOf(
  chunks: readonly string[],
  options: { hang?: boolean; signal?: AbortSignal | null } = {},
): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index++]));
        return;
      }
      if (options.hang !== true) {
        controller.close();
        return;
      }
      await new Promise<void>((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
          reject(options.signal?.reason ?? new Error('aborted'));
        });
      });
    },
  });
}

const sse = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  signal: AbortSignal | null;
}

function upstream(answer: (sent: Sent) => Response): {
  fetcher: UpstreamFetch;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  return {
    sent,
    fetcher: async (url, init) => {
      const record: Sent = {
        url,
        headers: init.headers as Record<string, string>,
        body: JSON.parse(
          typeof init.body === 'string' ? init.body : '{}',
        ) as Record<string, unknown>,
        signal: init.signal ?? null,
      };
      sent.push(record);
      return answer(record);
    },
  };
}

const endpoint = (wire: UpstreamEndpoint['wire']): UpstreamEndpoint => ({
  wire,
  connector: wire === 'anthropic' ? 'anthropic' : 'openai',
  modelId: 'the-model',
  baseUrl:
    wire === 'anthropic'
      ? 'https://api.anthropic.com'
      : 'https://api.openai.com/v1',
  apiKey: 'sk-upstream',
  headers: {},
});

function outcomeOf(): {
  onDone: (outcome: RelayCallOutcome) => void;
  outcomes: RelayCallOutcome[];
} {
  const outcomes: RelayCallOutcome[] = [];
  return { onDone: (outcome) => outcomes.push(outcome), outcomes };
}

describe('a call relayed on its own wire', () => {
  it('passes an Anthropic stream on byte for byte, with the model’s upstream id and the usage read', async () => {
    const events = [
      sse({
        type: 'message_start',
        message: {
          usage: {
            input_tokens: 10,
            cache_read_input_tokens: 90,
            cache_creation_input_tokens: 0,
            output_tokens: 1,
          },
        },
      }),
      'event: ping\ndata: {"type": "ping"}\n\n',
      sse({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello' },
      }),
      sse({ type: 'message_delta', usage: { output_tokens: 42 } }),
      sse({ type: 'message_stop' }),
    ];
    const { fetcher, sent } = upstream(
      () =>
        new Response(
          streamOf([events.join('').slice(0, 37), events.join('').slice(37)]),
          {
            headers: { 'content-type': 'text/event-stream' },
          },
        ),
    );
    const { onDone, outcomes } = outcomeOf();

    const response = await relayPassthrough({
      endpoint: endpoint('anthropic'),
      body: {
        model: 'anthropic/claude-sonnet-5-5',
        stream: true,
        fallbacks: ['x'],
        messages: [{ role: 'user', content: 'hi' }],
      },
      stream: true,
      forwarded: { anthropicVersion: '2023-06-01', anthropicBeta: 'b1' },
      extraHeaders: { 'x-tale-cache-affinity': 'exec-1' },
      signal: new AbortController().signal,
      onDone,
      fetcher,
    });

    expect(await response.text()).toBe(events.join(''));
    expect(sent[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(sent[0]?.body).toEqual({
      model: 'the-model',
      stream: true,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(sent[0]?.headers).toMatchObject({
      'x-api-key': 'sk-upstream',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'b1',
      'x-tale-cache-affinity': 'exec-1',
    });
    expect(outcomes).toEqual([
      {
        status: 'completed',
        usage: {
          inputTokens: 10,
          cacheReadTokens: 90,
          cacheWriteTokens: 0,
          outputTokens: 42,
        },
        estimated: false,
        upstreamStatus: 200,
      },
    ]);
  });

  it('asks a Chat Completions stream for its usage, and drops that chunk again for a client that did not', async () => {
    const usageChunk = sse({
      choices: [],
      usage: { prompt_tokens: 20, completion_tokens: 5 },
    });
    const text = sse({ choices: [{ index: 0, delta: { content: 'ok' } }] });
    const make = () =>
      upstream(
        () =>
          new Response(streamOf([text, usageChunk, 'data: [DONE]\n\n']), {
            headers: { 'content-type': 'text/event-stream' },
          }),
      );

    const quiet = make();
    const asked = make();
    const quietDone = outcomeOf();
    const askedDone = outcomeOf();
    const quietAnswer = await relayPassthrough({
      endpoint: endpoint('openai-chat'),
      body: { model: 'm', stream: true, messages: [] },
      stream: true,
      signal: new AbortController().signal,
      onDone: quietDone.onDone,
      fetcher: quiet.fetcher,
    });
    const askedAnswer = await relayPassthrough({
      endpoint: endpoint('openai-chat'),
      body: {
        model: 'm',
        stream: true,
        stream_options: { include_usage: true },
        messages: [],
      },
      stream: true,
      signal: new AbortController().signal,
      onDone: askedDone.onDone,
      fetcher: asked.fetcher,
    });

    expect(quiet.sent[0]?.body.stream_options).toEqual({ include_usage: true });
    expect(await quietAnswer.text()).toBe(`${text}data: [DONE]\n\n`);
    expect(await askedAnswer.text()).toBe(
      `${text}${usageChunk}data: [DONE]\n\n`,
    );
    expect(quietDone.outcomes[0]?.usage).toEqual({
      inputTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 5,
    });
    expect(askedDone.outcomes[0]?.estimated).toBe(false);
  });

  it('reads a Responses stream’s usage off the event that ends it', async () => {
    const { fetcher } = upstream(
      () =>
        new Response(
          streamOf([
            sse({ type: 'response.output_text.delta', delta: 'Hi' }),
            sse({
              type: 'response.completed',
              response: { usage: { input_tokens: 30, output_tokens: 4 } },
            }),
          ]),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    const { onDone, outcomes } = outcomeOf();
    const answer = await relayPassthrough({
      endpoint: endpoint('openai-responses'),
      body: { model: 'm', stream: true, input: 'hi' },
      stream: true,
      signal: new AbortController().signal,
      onDone,
      fetcher,
    });
    await answer.text();
    expect(outcomes[0]).toMatchObject({
      status: 'completed',
      usage: { inputTokens: 30, outputTokens: 4 },
      estimated: false,
    });
  });

  it('passes a whole answer back and reads its usage', async () => {
    const whole = {
      id: 'msg_1',
      content: [{ type: 'text', text: 'Hi' }],
      usage: { input_tokens: 5, output_tokens: 2 },
    };
    const { fetcher } = upstream(() => Response.json(whole));
    const { onDone, outcomes } = outcomeOf();
    const answer = await relayPassthrough({
      endpoint: endpoint('anthropic'),
      body: { model: 'm', messages: [] },
      stream: false,
      signal: new AbortController().signal,
      onDone,
      fetcher,
    });
    expect(await answer.json()).toEqual(whole);
    expect(outcomes[0]).toMatchObject({
      status: 'completed',
      usage: { inputTokens: 5, outputTokens: 2 },
      estimated: false,
    });
  });

  it('aborts the call upstream when the client hangs up, and books what it counted [RELAY-R8]', async () => {
    const { fetcher, sent } = upstream(
      (call) =>
        new Response(
          streamOf(
            [
              sse({
                type: 'message_start',
                message: { usage: { input_tokens: 10, output_tokens: 1 } },
              }),
              sse({
                type: 'content_block_delta',
                delta: { type: 'text_delta', text: 'a'.repeat(400) },
              }),
            ],
            { hang: true, signal: call.signal },
          ),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    const { onDone, outcomes } = outcomeOf();
    const answer = await relayPassthrough({
      endpoint: endpoint('anthropic'),
      body: { model: 'm', stream: true, messages: [] },
      stream: true,
      signal: new AbortController().signal,
      onDone,
      fetcher,
    });
    const reader = answer.body?.getReader();
    await reader?.read();
    await reader?.read();
    await reader?.cancel(new Error('client gone'));

    expect(sent[0]?.signal?.aborted).toBe(true);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.status).toBe('cancelled');
    expect(outcomes[0]?.estimated).toBe(true);
    expect(outcomes[0]?.usage.inputTokens).toBe(10);
    expect(outcomes[0]?.usage.outputTokens).toBeGreaterThanOrEqual(100);
  });

  it('ends a stream that goes silent past its idle budget [RELAY-R8]', async () => {
    const { fetcher, sent } = upstream(
      (call) =>
        new Response(
          streamOf([sse({ choices: [{ delta: { content: 'x' } }] })], {
            hang: true,
            signal: call.signal,
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    const { onDone, outcomes } = outcomeOf();
    const answer = await relayPassthrough({
      endpoint: endpoint('openai-chat'),
      body: {
        model: 'm',
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
      },
      stream: true,
      signal: new AbortController().signal,
      onDone,
      fetcher,
      lifetime: { streamIdleMs: 30 },
    });
    await expect(answer.text()).rejects.toThrow();
    expect(sent[0]?.signal?.aborted).toBe(true);
    expect(outcomes[0]?.status).toBe('failed');
    expect(outcomes[0]?.estimated).toBe(true);
  });

  it('passes a vendor’s refusal back in its own shape, and books nothing for it', async () => {
    const refusal = {
      type: 'error',
      error: { type: 'invalid_request_error', message: 'max_tokens too large' },
    };
    const { fetcher } = upstream(() => Response.json(refusal, { status: 400 }));
    const { onDone, outcomes } = outcomeOf();
    const answer = await relayPassthrough({
      endpoint: endpoint('anthropic'),
      body: { model: 'm', messages: [] },
      stream: false,
      signal: new AbortController().signal,
      onDone,
      fetcher,
    });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toEqual(refusal);
    expect(outcomes[0]).toEqual({
      status: 'failed',
      usage: {
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
      },
      estimated: false,
      upstreamStatus: 400,
    });
  });

  it('says a refused credential as its own 502, so the client never thinks its token is wrong', async () => {
    const { fetcher } = upstream(() =>
      Response.json({ error: { message: 'invalid api key' } }, { status: 401 }),
    );
    const answer = await relayPassthrough({
      endpoint: endpoint('openai-chat'),
      body: { model: 'm', messages: [] },
      stream: false,
      signal: new AbortController().signal,
      onDone: () => {},
      fetcher,
    });
    expect(answer.status).toBe(502);
    expect(await answer.json()).toMatchObject({
      error: {
        message: expect.stringContaining(
          "refused the organization's credential (HTTP 401)",
        ),
      },
    });
  });

  it('answers an unreachable vendor with 502 that names no address, and books nothing', async () => {
    const { onDone, outcomes } = outcomeOf();
    const answer = await relayPassthrough({
      endpoint: endpoint('openai-chat'),
      body: { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
      stream: false,
      signal: new AbortController().signal,
      onDone,
      fetcher: async () => {
        throw Object.assign(new TypeError('fetch failed'), {
          cause: { code: 'ECONNREFUSED', address: '10.1.2.3', port: 443 },
        });
      },
    });
    expect(answer.status).toBe(502);
    const said = JSON.stringify(await answer.json());
    expect(said).toContain('could not be reached');
    expect(said).not.toContain('10.1.2.3');
    expect(outcomes[0]).toMatchObject({
      status: 'failed',
      estimated: false,
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  });

  it('books the prompt of a call that was sent and broke before its answer, an image as one image [RELAY-R5]', async () => {
    const { onDone, outcomes } = outcomeOf();
    const image = 'A'.repeat(200_000);
    const answer = await relayPassthrough({
      endpoint: endpoint('anthropic'),
      body: {
        model: 'm',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What is in this picture?' },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: image,
                },
              },
            ],
          },
        ],
      },
      stream: true,
      signal: new AbortController().signal,
      onDone,
      fetcher: async () => {
        throw new TypeError('other side closed');
      },
    });
    expect(answer.status).toBe(502);
    expect(outcomes[0]?.status).toBe('failed');
    expect(outcomes[0]?.estimated).toBe(true);
    // The picture weighs about what a vendor bills for one, not its base64.
    expect(outcomes[0]?.usage.inputTokens).toBeGreaterThan(1_600);
    expect(outcomes[0]?.usage.inputTokens).toBeLessThan(1_700);
  });

  it('names the caller’s model in the answer where a door asks it to', async () => {
    const { fetcher } = upstream(() =>
      Response.json({ id: 'c1', model: 'gpt-6-2026-11-01', choices: [] }),
    );
    const answer = await relayPassthrough({
      endpoint: endpoint('openai-chat'),
      body: { model: 'm', messages: [] },
      stream: false,
      signal: new AbortController().signal,
      onDone: () => {},
      answerModel: 'openai/gpt-6',
      fetcher,
    });
    expect(await answer.json()).toEqual({
      id: 'c1',
      model: 'openai/gpt-6',
      choices: [],
    });
    const streamed = await relayPassthrough({
      endpoint: endpoint('openai-chat'),
      body: { model: 'm', stream: true, messages: [] },
      stream: true,
      signal: new AbortController().signal,
      onDone: () => {},
      answerModel: 'openai/gpt-6',
      fetcher: upstream(
        () =>
          new Response(
            streamOf([
              sse({ id: 'c1', model: 'gpt-6-2026-11-01', choices: [] }),
              'data: [DONE]\n\n',
            ]),
            { headers: { 'content-type': 'text/event-stream' } },
          ),
      ).fetcher,
    });
    expect(await streamed.text()).toBe(
      `data: ${JSON.stringify({ id: 'c1', model: 'openai/gpt-6', choices: [] })}\n\ndata: [DONE]\n\n`,
    );
  });

  it('sends nothing for a client that left while its request was governed', async () => {
    const { fetcher, sent } = upstream(() => Response.json({}));
    const { onDone, outcomes } = outcomeOf();
    const gone = new AbortController();
    gone.abort();
    await relayPassthrough({
      endpoint: endpoint('openai-chat'),
      body: { model: 'm', messages: [] },
      stream: false,
      signal: gone.signal,
      onDone,
      fetcher,
    });
    expect(sent).toHaveLength(0);
    expect(outcomes).toEqual([
      {
        status: 'cancelled',
        usage: {
          inputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 0,
        },
        estimated: false,
      },
    ]);
  });
});

describe('the effort a call with tools carries to a model that takes tools only at its off', () => {
  /** OpenAI's Chat Completions for a model that takes function tools only
   * at `reasoning_effort: none`, whose own default is medium. */
  const offOnly: UpstreamEndpoint = {
    ...endpoint('openai-chat'),
    toolsEffort: 'none',
  };
  const TOOLS = [
    {
      type: 'function',
      function: { name: 'connector', parameters: { type: 'object' } },
    },
  ];
  const answered = () =>
    upstream(() =>
      Response.json({
        id: 'chatcmpl-1',
        choices: [],
        usage: { prompt_tokens: 3, completion_tokens: 1 },
      }),
    );
  const relay = async (
    to: UpstreamEndpoint,
    body: Record<string, unknown>,
    fetcher: UpstreamFetch,
  ) =>
    relayPassthrough({
      endpoint: to,
      body: { model: 'm', messages: [], ...body },
      stream: false,
      signal: new AbortController().signal,
      onDone: outcomeOf().onDone,
      fetcher,
    });

  it('sends the off with tools, whatever the client asked: an effort above it, or none (Pi’s)', async () => {
    const { fetcher, sent } = answered();
    await relay(offOnly, { tools: TOOLS }, fetcher);
    await relay(offOnly, { tools: TOOLS, reasoning_effort: 'high' }, fetcher);
    // The older form of tools counts too.
    await relay(offOnly, { functions: [{ name: 'connector' }] }, fetcher);
    expect(sent.map((call) => call.body.reasoning_effort)).toEqual([
      'none',
      'none',
      'none',
    ]);
    expect(sent[1]?.body.tools).toEqual(TOOLS);
  });

  it('leaves a call without tools as its client sent it', async () => {
    const { fetcher, sent } = answered();
    await relay(offOnly, {}, fetcher);
    await relay(offOnly, { tools: [], reasoning_effort: 'high' }, fetcher);
    expect(sent[0]?.body).not.toHaveProperty('reasoning_effort');
    expect(sent[1]?.body.reasoning_effort).toBe('high');
  });

  it('leaves the effort to the client on a wire that takes tools at any', async () => {
    const { fetcher, sent } = answered();
    // The Responses API (Codex on OpenAI's own API), and Chat Completions
    // for a model that names no such limit.
    await relay(
      endpoint('openai-responses'),
      { tools: TOOLS, reasoning: { effort: 'high' } },
      fetcher,
    );
    await relay(
      endpoint('openai-chat'),
      { tools: TOOLS, reasoning_effort: 'high' },
      fetcher,
    );
    expect(sent[0]?.body).not.toHaveProperty('reasoning_effort');
    expect(sent[0]?.body.reasoning).toEqual({ effort: 'high' });
    expect(sent[1]?.body.reasoning_effort).toBe('high');
  });
});

describe('headers a client hands on to the vendor', () => {
  it('passes x-bf-eh-<name> on as <name>, but never a credential', () => {
    expect(
      forwardedExtraHeaders(
        new Headers({
          'x-bf-eh-x-tale-cache-affinity': 'exec-1',
          'x-bf-eh-authorization': 'Bearer stolen',
          'x-bf-eh-x-api-key': 'stolen',
          'x-other': 'kept out',
        }),
      ),
    ).toEqual({ 'x-tale-cache-affinity': 'exec-1' });
  });
});
