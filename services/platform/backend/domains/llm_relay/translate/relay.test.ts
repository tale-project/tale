import {
  APICallError,
  type LanguageModelV4,
  type LanguageModelV4CallOptions,
  type LanguageModelV4StreamPart,
  UnsupportedFunctionalityError,
} from '@ai-sdk/provider';
import { describe, expect, it } from 'vitest';

import type { UpstreamEndpoint } from '../endpoint.ts';
import type { RelayCallOutcome } from '../passthrough.ts';
import {
  type EncodeContext,
  type InboundAdapter,
  TranslationError,
} from './contract.ts';
import { relayTranslated } from './relay.ts';

const USAGE = {
  inputTokens: { total: 120, noCache: 100, cacheRead: 20, cacheWrite: 0 },
  outputTokens: { total: 9, text: 9, reasoning: 0 },
};

const endpoint = (
  wire: UpstreamEndpoint['wire'] = 'anthropic',
  connector = 'anthropic',
): UpstreamEndpoint => ({
  wire,
  connector,
  modelId: 'claude-sonnet-5-5',
  baseUrl: 'https://api.anthropic.com',
  apiKey: 'sk-upstream',
  headers: {},
});

/** An adapter that writes each part's type, so a test reads the order. */
function adapter(
  over: Partial<InboundAdapter> = {},
): InboundAdapter & { contexts: EncodeContext[]; errors: string[] } {
  const contexts: EncodeContext[] = [];
  const errors: string[] = [];
  return {
    contexts,
    errors,
    parse: (body) => {
      if (body.bad === true)
        throw new TranslationError('the request names no input');
      return {
        options: {
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        },
      };
    },
    async *encodeStream(parts, context) {
      contexts.push(context);
      for await (const part of parts) yield `data: ${part.type}\n\n`;
    },
    encodeAnswer: (result, context) => {
      contexts.push(context);
      return { content: result.content, model: context.model };
    },
    encodeStreamError: (kind, message, context) => {
      errors.push(`${kind}: ${message}`);
      return `data: error ${context.model}\n\n`;
    },
    ...over,
  };
}

/** A model whose stream sends `parts` then ends — or hangs until aborted. */
function model(
  parts: readonly LanguageModelV4StreamPart[],
  options: {
    hang?: boolean;
    generateError?: unknown;
    streamError?: unknown;
  } = {},
): LanguageModelV4 & { calls: LanguageModelV4CallOptions[] } {
  const calls: LanguageModelV4CallOptions[] = [];
  return {
    specificationVersion: 'v4',
    provider: 'test',
    modelId: 'claude-sonnet-5-5',
    supportedUrls: {},
    calls,
    doGenerate: async (call) => {
      calls.push(call);
      if (options.generateError !== undefined) throw options.generateError;
      return {
        content: [{ type: 'text', text: 'Hello' }],
        finishReason: { unified: 'stop', raw: 'end_turn' },
        usage: USAGE,
        warnings: [],
      };
    },
    doStream: async (call) => {
      calls.push(call);
      if (options.streamError !== undefined) throw options.streamError;
      let index = 0;
      return {
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          async pull(controller) {
            if (index < parts.length) {
              controller.enqueue(parts[index++] as LanguageModelV4StreamPart);
              return;
            }
            if (options.hang !== true) {
              controller.close();
              return;
            }
            await new Promise<void>((_resolve, reject) => {
              call.abortSignal?.addEventListener('abort', () => {
                reject(call.abortSignal?.reason ?? new Error('aborted'));
              });
            });
          },
        }),
      };
    },
  };
}

const TEXT: LanguageModelV4StreamPart[] = [
  { type: 'text-start', id: 't1' },
  { type: 'text-delta', id: 't1', delta: 'Hello' },
  { type: 'text-end', id: 't1' },
  {
    type: 'finish',
    usage: USAGE,
    finishReason: { unified: 'stop', raw: 'end_turn' },
  },
];

function done(): {
  onDone: (o: RelayCallOutcome) => void;
  outcomes: RelayCallOutcome[];
} {
  const outcomes: RelayCallOutcome[] = [];
  return { onDone: (o) => outcomes.push(o), outcomes };
}

const base = {
  inbound: 'openai-chat' as const,
  body: { model: 'anthropic/claude-sonnet-5-5', messages: [] },
  requestedModel: 'anthropic/claude-sonnet-5-5',
};

describe('a call translated between wires', () => {
  it('writes a whole answer in the client’s wire, with the model it asked for, and books its usage', async () => {
    const theAdapter = adapter();
    const theModel = model([]);
    const { onDone, outcomes } = done();
    const answer = await relayTranslated({
      ...base,
      endpoint: endpoint(),
      stream: false,
      signal: new AbortController().signal,
      onDone,
      adapter: theAdapter,
      model: theModel,
    });
    expect(await answer.json()).toEqual({
      content: [{ type: 'text', text: 'Hello' }],
      model: 'anthropic/claude-sonnet-5-5',
    });
    expect(theAdapter.contexts[0]?.request).toBe(base.body);
    expect(theAdapter.contexts[0]?.id).toMatch(/^[0-9a-f]{32}$/);
    expect(outcomes).toEqual([
      {
        status: 'completed',
        usage: {
          inputTokens: 100,
          cacheReadTokens: 20,
          cacheWriteTokens: 0,
          outputTokens: 9,
        },
        estimated: false,
      },
    ]);
    // Anthropic's own API is asked to cache, and the thinking is sent back.
    expect(theModel.calls[0]?.providerOptions).toEqual({
      anthropic: { sendReasoning: true, cacheControl: { type: 'ephemeral' } },
    });
    expect(theModel.calls[0]?.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('streams the answer event by event and books the usage the finish reports', async () => {
    const { onDone, outcomes } = done();
    const answer = await relayTranslated({
      ...base,
      endpoint: endpoint(),
      stream: true,
      signal: new AbortController().signal,
      onDone,
      adapter: adapter(),
      model: model(TEXT),
    });
    expect(answer.headers.get('content-type')).toContain('text/event-stream');
    expect(await answer.text()).toBe(
      'data: text-start\n\ndata: text-delta\n\ndata: text-end\n\ndata: finish\n\n',
    );
    expect(outcomes[0]).toMatchObject({
      status: 'completed',
      estimated: false,
    });
  });

  it('ends a stream the upstream broke with the wire’s error event, and books what it counted', async () => {
    const theAdapter = adapter();
    const { onDone, outcomes } = done();
    const answer = await relayTranslated({
      ...base,
      endpoint: endpoint(),
      stream: true,
      signal: new AbortController().signal,
      onDone,
      adapter: theAdapter,
      model: model([
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'x'.repeat(400) },
        { type: 'error', error: new Error('upstream reset') },
      ]),
    });
    expect(await answer.text()).toBe(
      'data: text-start\n\ndata: text-delta\n\ndata: error anthropic/claude-sonnet-5-5\n\n',
    );
    expect(theAdapter.errors[0]).toMatch(
      /^upstream: The model provider could not be reached/,
    );
    expect(outcomes[0]?.status).toBe('failed');
    expect(outcomes[0]?.estimated).toBe(true);
    expect(outcomes[0]?.usage.outputTokens).toBeGreaterThanOrEqual(100);
  });

  it('aborts the call upstream when the client hangs up', async () => {
    const theModel = model([TEXT[0], TEXT[1]] as LanguageModelV4StreamPart[], {
      hang: true,
    });
    const { onDone, outcomes } = done();
    const answer = await relayTranslated({
      ...base,
      endpoint: endpoint(),
      stream: true,
      signal: new AbortController().signal,
      onDone,
      adapter: adapter(),
      model: theModel,
    });
    const reader = answer.body?.getReader();
    await reader?.read();
    await reader?.read();
    await reader?.cancel(new Error('client gone'));
    expect(theModel.calls[0]?.abortSignal?.aborted).toBe(true);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.status).toBe('cancelled');
  });

  it('ends a stream that goes silent past its idle budget', async () => {
    const theAdapter = adapter();
    const { onDone, outcomes } = done();
    const answer = await relayTranslated({
      ...base,
      endpoint: endpoint(),
      stream: true,
      signal: new AbortController().signal,
      onDone,
      adapter: theAdapter,
      model: model([TEXT[0]] as LanguageModelV4StreamPart[], { hang: true }),
      lifetime: { streamIdleMs: 30 },
    });
    expect(await answer.text()).toContain('data: error');
    expect(theAdapter.errors[0]).toBe('timeout: The model stopped answering.');
    expect(outcomes[0]?.status).toBe('failed');
  });

  it('refuses a request its adapter cannot translate, sending nothing', async () => {
    const theModel = model(TEXT);
    const { onDone, outcomes } = done();
    const answer = await relayTranslated({
      ...base,
      body: { bad: true },
      endpoint: endpoint(),
      stream: true,
      signal: new AbortController().signal,
      onDone,
      adapter: adapter(),
      model: theModel,
    });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toEqual({
      error: {
        message: 'the request names no input',
        type: 'invalid_request_error',
        param: null,
        code: null,
      },
    });
    expect(theModel.calls).toHaveLength(0);
    expect(outcomes[0]).toMatchObject({ status: 'failed', estimated: false });
  });

  it('says the upstream’s refusals in the client’s wire: a credential as 502, a rate limit as 429, an untranslatable request as 400', async () => {
    const refusals = [
      new APICallError({
        message: 'Unauthorized',
        url: 'https://api.anthropic.com/v1/messages',
        requestBodyValues: {},
        statusCode: 401,
        responseBody: '{"error":{"message":"invalid x-api-key"}}',
      }),
      new APICallError({
        message: 'Too many',
        url: 'https://api.anthropic.com/v1/messages',
        requestBodyValues: {},
        statusCode: 429,
        responseBody: 'slow down',
      }),
      new UnsupportedFunctionalityError({ functionality: 'file URL for PDFs' }),
    ];
    const statuses: number[] = [];
    const messages: string[] = [];
    for (const refusal of refusals) {
      const answer = await relayTranslated({
        ...base,
        inbound: 'anthropic',
        endpoint: endpoint('openai-chat', 'deepseek'),
        stream: true,
        signal: new AbortController().signal,
        onDone: () => {},
        adapter: adapter(),
        model: model([], { streamError: refusal }),
      });
      statuses.push(answer.status);
      const body = (await answer.json()) as { error: { message: string } };
      messages.push(body.error.message);
    }
    expect(statuses).toEqual([502, 429, 400]);
    expect(messages[0]).toContain(
      "refused the organization's credential (HTTP 401)",
    );
    expect(messages[2]).toContain('cannot be sent to this model');
  });

  it('shapes the prompt for a Chat Completions upstream before it is sent', async () => {
    const theModel = model(TEXT);
    await relayTranslated({
      ...base,
      inbound: 'anthropic',
      endpoint: endpoint('openai-chat', 'deepseek'),
      stream: false,
      signal: new AbortController().signal,
      onDone: () => {},
      adapter: adapter({
        parse: () => ({
          options: {
            prompt: [
              {
                role: 'tool',
                content: [
                  {
                    type: 'tool-result',
                    toolCallId: 'c1',
                    toolName: 'shot',
                    output: {
                      type: 'content',
                      value: [
                        {
                          type: 'file',
                          data: { type: 'data', data: 'AAAA' },
                          mediaType: 'image/png',
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        }),
      }),
      model: theModel,
    });
    expect(theModel.calls[0]?.prompt.map((message) => message.role)).toEqual([
      'tool',
      'user',
    ]);
    expect(theModel.calls[0]?.providerOptions).toBeUndefined();
  });

  it('sends nothing for a client that already left', async () => {
    const theModel = model(TEXT);
    const gone = new AbortController();
    gone.abort();
    const { onDone, outcomes } = done();
    await relayTranslated({
      ...base,
      endpoint: endpoint(),
      stream: true,
      signal: gone.signal,
      onDone,
      adapter: adapter(),
      model: theModel,
    });
    expect(theModel.calls).toHaveLength(0);
    expect(outcomes[0]).toMatchObject({
      status: 'cancelled',
      estimated: false,
    });
  });
});
