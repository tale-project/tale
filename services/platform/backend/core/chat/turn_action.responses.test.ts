// @vitest-environment node

/**
 * A model whose function tools work only on the Responses API streams its
 * answer in that API's events, not as Chat Completions deltas: the text and
 * refusal deltas, each function call announced by its output item and
 * closed with its complete arguments, and the usage once, on the closing
 * `response.*` event. A failure arrives as an `error` event or a response
 * that closed as `response.failed`. Read through the same stream reader a
 * chat turn uses, so the turn sees the chunks it sees from every other
 * dialect.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ModelCallRequest } from '../../../lib/chat/turn';
import type { ActionCtx } from '../lib/ctx';
import { loadProviderDefinitions } from '../lib/providers/load_system_config';
import { readEvent, readStreamFailure } from './stream_decode';
import {
  createDirectModelCall,
  streamSse,
  type DirectWire,
} from './turn_action';

/** An SSE body the way the Responses API writes one: an `event:` line naming
 * each event, then its `data:` line (which repeats the type). */
function responsesStream(events: readonly Record<string, unknown>[]): Response {
  const body = events
    .map(
      (event) =>
        `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`,
    )
    .join('');
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function chunksOf(response: Response) {
  const chunks = [];
  for await (const chunk of streamSse(response, 'openai-responses')) {
    chunks.push(chunk);
  }
  return chunks;
}

const USAGE = {
  input_tokens: 1200,
  input_tokens_details: { cached_tokens: 1000 },
  output_tokens: 80,
  output_tokens_details: { reasoning_tokens: 50 },
  total_tokens: 1280,
};

describe('streamSse — the Responses API stream', () => {
  it('streams the text and settles the closing usage, cache and reasoning counts included', async () => {
    const chunks = await chunksOf(
      responsesStream([
        { type: 'response.created', response: { status: 'in_progress' } },
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { type: 'reasoning', id: 'rs_1' },
        },
        {
          type: 'response.output_item.added',
          output_index: 1,
          item: { type: 'message', id: 'msg_1', role: 'assistant' },
        },
        { type: 'response.output_text.delta', output_index: 1, delta: 'Hel' },
        { type: 'response.output_text.delta', output_index: 1, delta: 'lo.' },
        {
          type: 'response.completed',
          response: { status: 'completed', usage: USAGE },
        },
      ]),
    );
    expect(chunks.map((chunk) => chunk.text).join('')).toBe('Hello.');
    expect(chunks.at(-1)).toEqual({
      text: '',
      usage: {
        inputTokens: 1200,
        outputTokens: 80,
        totalTokens: 1280,
        cachedInputTokens: 1000,
        reasoningTokens: 50,
      },
      finishReason: 'stop',
    });
  });

  it('settles the function calls it announced, keyed by call_id, in output order', async () => {
    const chunks = await chunksOf(
      responsesStream([
        {
          type: 'response.output_item.added',
          output_index: 1,
          item: {
            type: 'function_call',
            id: 'fc_1',
            call_id: 'call_a',
            name: 'rag_search',
            arguments: '',
          },
        },
        {
          type: 'response.output_item.added',
          output_index: 2,
          item: {
            type: 'function_call',
            id: 'fc_2',
            call_id: 'call_b',
            name: 'rag_fetch',
            arguments: '',
          },
        },
        {
          type: 'response.function_call_arguments.delta',
          output_index: 2,
          item_id: 'fc_2',
          delta: '{"ref":',
        },
        {
          type: 'response.function_call_arguments.delta',
          output_index: 1,
          item_id: 'fc_1',
          delta: '{"query":"tax"}',
        },
        {
          type: 'response.function_call_arguments.delta',
          output_index: 2,
          item_id: 'fc_2',
          delta: '"doc-1"}',
        },
        // A delta for an item that was never announced has nowhere to go.
        {
          type: 'response.function_call_arguments.delta',
          output_index: 7,
          delta: '{"lost":true}',
        },
        {
          type: 'response.function_call_arguments.done',
          output_index: 1,
          item_id: 'fc_1',
          arguments: '{"query":"tax"}',
        },
        {
          type: 'response.output_item.done',
          output_index: 2,
          item: {
            type: 'function_call',
            id: 'fc_2',
            call_id: 'call_b',
            name: 'rag_fetch',
            arguments: '{"ref":"doc-1"}',
          },
        },
        {
          type: 'response.completed',
          response: {
            status: 'completed',
            usage: { input_tokens: 300, output_tokens: 40 },
          },
        },
      ]),
    );
    expect(chunks.at(-1)).toEqual({
      text: '',
      usage: { inputTokens: 300, outputTokens: 40, totalTokens: 340 },
      finishReason: 'tool-calls',
      toolCalls: [
        { id: 'call_a', name: 'rag_search', input: { query: 'tax' } },
        { id: 'call_b', name: 'rag_fetch', input: { ref: 'doc-1' } },
      ],
    });
  });

  it('lets the closing arguments win over what the deltas put together', async () => {
    const chunks = await chunksOf(
      responsesStream([
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { type: 'function_call', call_id: 'call_a', name: 'lookup' },
        },
        {
          type: 'response.function_call_arguments.delta',
          output_index: 0,
          delta: '{"q":"partial',
        },
        {
          type: 'response.function_call_arguments.done',
          output_index: 0,
          arguments: '{"q":"whole"}',
        },
        { type: 'response.completed', response: { status: 'completed' } },
      ]),
    );
    expect(chunks.at(-1)).toMatchObject({
      finishReason: 'tool-calls',
      toolCalls: [{ id: 'call_a', name: 'lookup', input: { q: 'whole' } }],
    });
  });

  it('reads a refusal as the reply text', async () => {
    const chunks = await chunksOf(
      responsesStream([
        { type: 'response.refusal.delta', output_index: 0, delta: 'I cannot.' },
        { type: 'response.completed', response: { status: 'completed' } },
      ]),
    );
    expect(chunks.map((chunk) => chunk.text).join('')).toBe('I cannot.');
  });

  it('carries the reasoning summary a request asked for', async () => {
    const chunks = await chunksOf(
      responsesStream([
        {
          type: 'response.reasoning_summary_text.delta',
          output_index: 0,
          delta: 'Thinking it over.',
        },
        { type: 'response.reasoning_summary_text.delta', delta: '' },
        { type: 'response.output_text.delta', delta: 'Done.' },
      ]),
    );
    expect(chunks).toEqual([
      { text: '', reasoning: 'Thinking it over.' },
      { text: 'Done.' },
    ]);
  });

  it.each([
    ['max_output_tokens', 'length'],
    ['content_filter', 'content-filter'],
    ['something_new', 'other'],
  ])(
    'names an incomplete answer cut by %s as %s',
    async (reason, finishReason) => {
      const chunks = await chunksOf(
        responsesStream([
          { type: 'response.output_text.delta', delta: 'Partial' },
          {
            type: 'response.incomplete',
            response: {
              status: 'incomplete',
              incomplete_details: { reason },
              usage: { input_tokens: 10, output_tokens: 20 },
            },
          },
        ]),
      );
      expect(chunks.at(-1)).toEqual({
        text: '',
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        finishReason,
      });
    },
  );

  it('ends the round with the words of an error event', async () => {
    const response = responsesStream([
      { type: 'response.output_text.delta', delta: 'Start' },
      {
        type: 'error',
        code: 'rate_limit_exceeded',
        message: 'Rate limit reached for gpt-6.1-sol.',
        param: null,
      },
      { type: 'response.output_text.delta', delta: 'never read' },
    ]);
    const seen: string[] = [];
    await expect(async () => {
      for await (const chunk of streamSse(response, 'openai-responses')) {
        seen.push(chunk.text);
      }
    }).rejects.toMatchObject({
      message: expect.stringContaining('Rate limit reached for gpt-6.1-sol.'),
      code: 'rate_limit_exceeded',
    });
    expect(seen).toEqual(['Start']);
  });

  it('books what a failed response reports before ending the round with its words', async () => {
    const response = responsesStream([
      {
        type: 'response.failed',
        response: {
          status: 'failed',
          error: { code: 'server_error', message: 'The server had an error.' },
          usage: { input_tokens: 500, output_tokens: 0 },
        },
      },
    ]);
    const chunks: unknown[] = [];
    await expect(async () => {
      for await (const chunk of streamSse(response, 'openai-responses')) {
        chunks.push(chunk);
      }
    }).rejects.toMatchObject({
      message: expect.stringContaining('The server had an error.'),
      code: 'server_error',
    });
    expect(chunks).toEqual([
      {
        text: '',
        usage: { inputTokens: 500, outputTokens: 0, totalTokens: 500 },
      },
    ]);
  });
});

describe('readStreamFailure — the Responses API', () => {
  it('reads an error a server wrapped under `error`', () => {
    expect(
      readStreamFailure('openai-responses', {
        type: 'error',
        error: { code: 429, message: 'Too many requests' },
      }),
    ).toEqual({ message: 'Too many requests', code: '429', status: 429 });
  });

  it('reads an error event with no code without taking its type for one', () => {
    expect(
      readStreamFailure('openai-responses', {
        type: 'error',
        code: null,
        message: 'Something broke',
      }),
    ).toEqual({ message: 'Something broke' });
  });

  it('reads a failed response that named no error', () => {
    expect(
      readStreamFailure('openai-responses', {
        type: 'response.failed',
        response: { status: 'failed' },
      }),
    ).toEqual({ message: '' });
  });

  it('reads no failure from an ordinary event, nor from a Chat Completions error shape', () => {
    expect(
      readStreamFailure('openai-responses', {
        type: 'response.output_text.delta',
        delta: 'ok',
      }),
    ).toBeUndefined();
    // `{"error": {...}}` is a Chat Completions failure; the Responses API
    // names its failures by event type.
    expect(
      readStreamFailure('openai-responses', {
        type: 'response.in_progress',
        error: null,
      }),
    ).toBeUndefined();
  });
});

describe('readEvent — the Responses API', () => {
  it('ignores the control events and output items that are not function calls', () => {
    const state = { running: { input: 0, output: 0 }, drafts: new Map() };
    for (const event of [
      { type: 'response.created' },
      { type: 'response.in_progress' },
      { type: 'response.content_part.added', output_index: 0 },
      { type: 'response.output_text.done', output_index: 0, text: 'x' },
      { type: 'response.output_item.added', item: { type: 'function_call' } },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: { type: 'message' },
      },
      { type: 'response.function_call_arguments.done', arguments: '{}' },
      { output_index: 0, delta: 'untyped' },
    ]) {
      expect(readEvent('openai-responses', event, state)).toEqual({
        text: '',
      });
    }
    expect(state.drafts.size).toBe(0);
  });
});

describe('createDirectModelCall — the wire a direct chat turn takes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const openai = loadProviderDefinitions().find(
    (provider) => provider.name === 'openai',
  );
  if (openai === undefined)
    throw new Error('the shipped openai provider is gone');
  const wire: DirectWire = {
    apiFormat: 'openai',
    wireDialect: 'openai-modern',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    attribution: {},
  };
  // The call reads nothing off the context unless a message carries an
  // attachment to inline.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- unread without attachments
  const ctx = {} as ActionCtx;

  function request(overrides: Partial<ModelCallRequest>): ModelCallRequest {
    return {
      organizationId: 'org_a',
      model: 'gpt-6.1-sol',
      providerSlug: 'openai',
      system: 'GUIDE',
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'HI' }] }],
      tools: [
        {
          name: 'rag_search',
          description: 'Search the knowledge.',
          parameters: { type: 'object', properties: {} },
        },
      ],
      execution: { mode: 'direct' },
      sampling: {
        maxTokens: 4096,
        temperature: 0.7,
        reasoning: { kind: 'effort', value: 'extra' },
      },
      ...overrides,
    };
  }

  /** Stub the provider: record each request, answer with `answer`. */
  function stubProvider(answer: () => Response) {
    const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        // The direct call always sends its body as a JSON string.
        const body = typeof init?.body === 'string' ? init.body : '{}';
        seen.push({ url, body: JSON.parse(body) });
        return answer();
      }),
    );
    return seen;
  }

  it('calls a Responses-only model on the Responses API and reads its stream', async () => {
    const seen = stubProvider(() =>
      responsesStream([
        { type: 'response.output_text.delta', delta: 'Hello.' },
        {
          type: 'response.completed',
          response: {
            status: 'completed',
            usage: { input_tokens: 30, output_tokens: 3 },
          },
        },
      ]),
    );
    const call = createDirectModelCall(ctx, 'org_a', openai, wire);
    const chunks = [];
    for await (const chunk of call(request({ toolCallingApi: 'responses' }))) {
      chunks.push(chunk);
    }
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe('https://api.openai.com/v1/responses');
    expect(seen[0]?.body).toMatchObject({
      model: 'gpt-6.1-sol',
      instructions: 'GUIDE',
      max_output_tokens: 4096,
      reasoning: { effort: 'xhigh' },
      input: [{ role: 'user', content: 'HI' }],
      store: false,
      stream: true,
    });
    // The shipped entry reasons, so the platform's temperature stays off;
    // the Responses API refuses the Chat Completions usage option.
    expect(seen[0]?.body).not.toHaveProperty('temperature');
    expect(seen[0]?.body).not.toHaveProperty('stream_options');
    expect(chunks.map((chunk) => chunk.text).join('')).toBe('Hello.');
    expect(chunks.at(-1)).toMatchObject({
      usage: { inputTokens: 30, outputTokens: 3 },
      finishReason: 'stop',
    });
  });

  it('keeps a model without the flag on Chat Completions, usage frame requested', async () => {
    const seen = stubProvider(
      () =>
        new Response(
          `data: ${JSON.stringify({
            choices: [
              { index: 0, delta: { content: 'Hi.' }, finish_reason: 'stop' },
            ],
          })}\n\ndata: [DONE]\n\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    const call = createDirectModelCall(ctx, 'org_a', openai, wire);
    const chunks = [];
    for await (const chunk of call(request({ model: 'gpt-5.6-sol' }))) {
      chunks.push(chunk);
    }
    expect(seen[0]?.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(seen[0]?.body).toMatchObject({
      model: 'gpt-5.6-sol',
      stream: true,
      stream_options: { include_usage: true },
      reasoning_effort: 'high',
    });
    expect(seen[0]?.body).not.toHaveProperty('input');
    expect(chunks.map((chunk) => chunk.text).join('')).toBe('Hi.');
  });
});
