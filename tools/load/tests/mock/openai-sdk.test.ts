/**
 * The mock speaks Chat Completions well enough for the official client:
 * whatever the SDK parses, accumulates and raises here is what a real
 * provider would have produced.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import OpenAI from 'openai';

import { createMockServer, type MockServer } from '../../src/mock/server.ts';

let mock: MockServer;
let client: OpenAI;

const FAST = {
  port: 0,
  seed: 7,
  ttftMedianMs: 5,
  ttftP95Ms: 10,
  tokensPerSecondMean: 20_000,
  tokensPerSecondSd: 0,
  rate429: 0,
  rate5xx: 0,
  midStreamErrorRate: 0,
  toolCallRate: 0,
};

beforeAll(async () => {
  mock = await createMockServer(FAST, {});
  client = new OpenAI({
    apiKey: 'load-test-key',
    baseURL: `${mock.url}/v1`,
    maxRetries: 0,
  });
});

afterAll(async () => {
  await mock.close();
});

const WEATHER_TOOL = {
  type: 'function' as const,
  function: {
    name: 'get_weather',
    description: 'Current weather in a city',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string' },
        unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
      },
      required: ['city', 'unit'],
      additionalProperties: false,
    },
  },
};

describe('chat completions through the OpenAI SDK', () => {
  test('a buffered reply carries consistent usage', async () => {
    const completion = await client.chat.completions.create({
      model: 'load-chat-fast',
      messages: [
        { role: 'user', content: 'Summarize the week [[mock:tokens=40]]' },
      ],
    });
    const choice = completion.choices[0];
    expect(choice?.finish_reason).toBe('stop');
    expect(choice?.message.role).toBe('assistant');
    expect(choice?.message.content?.length ?? 0).toBeGreaterThan(0);
    const usage = completion.usage;
    expect(usage?.completion_tokens).toBe(40);
    expect(usage?.prompt_tokens ?? 0).toBeGreaterThan(0);
    expect(usage?.total_tokens).toBe(
      (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0),
    );
  });

  test('a stream starts with the role, ends with usage and [DONE]', async () => {
    const stream = await client.chat.completions.create({
      model: 'load-chat-fast',
      messages: [
        { role: 'user', content: 'Tell me a story [[mock:tokens=60]]' },
      ],
      stream: true,
      stream_options: { include_usage: true },
    });
    const chunks: OpenAI.Chat.Completions.ChatCompletionChunk[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    expect(chunks[0]?.choices[0]?.delta.role).toBe('assistant');
    const text = chunks
      .map((chunk) => chunk.choices[0]?.delta.content ?? '')
      .join('');
    expect(text.length).toBeGreaterThan(0);
    const finishes = chunks.flatMap((chunk) =>
      chunk.choices.flatMap((choice) =>
        choice.finish_reason ? [choice.finish_reason] : [],
      ),
    );
    expect(finishes).toEqual(['stop']);
    const last = chunks.at(-1);
    expect(last?.choices).toEqual([]);
    expect(last?.usage?.completion_tokens).toBe(60);
    // Every chunk of one completion shares its id.
    expect(new Set(chunks.map((chunk) => chunk.id)).size).toBe(1);
  });

  test('a forced tool call accumulates into valid arguments', async () => {
    const runner = client.chat.completions.stream({
      model: 'load-chat-fast',
      messages: [{ role: 'user', content: 'Weather in Bern? [[mock:tool]]' }],
      tools: [WEATHER_TOOL],
    });
    const completion = await runner.finalChatCompletion();
    const choice = completion.choices[0];
    expect(choice?.finish_reason).toBe('tool_calls');
    const call = choice?.message.tool_calls?.[0];
    expect(call?.type).toBe('function');
    if (call?.type !== 'function') throw new Error('no function call');
    expect(call.function.name).toBe('get_weather');
    const args = JSON.parse(call.function.arguments) as Record<string, unknown>;
    expect(typeof args.city).toBe('string');
    expect(['celsius', 'fahrenheit']).toContain(String(args.unit));
  });

  test('a tool result continues the conversation with text', async () => {
    const completion = await client.chat.completions.create({
      model: 'load-chat-fast',
      tools: [WEATHER_TOOL],
      messages: [
        { role: 'user', content: 'Weather in Bern?' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: '{"city":"Bern","unit":"celsius"}',
              },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', content: '{"temp":12}' },
      ],
    });
    expect(completion.choices[0]?.finish_reason).toBe('stop');
    expect(completion.choices[0]?.message.content?.length ?? 0).toBeGreaterThan(
      0,
    );
  });

  test('a reasoning model streams its reasoning before the answer', async () => {
    const stream = await client.chat.completions.create({
      model: 'load-chat-reasoning',
      reasoning_effort: 'medium',
      messages: [
        { role: 'user', content: 'Plan a migration [[mock:tokens=50]]' },
      ],
      stream: true,
      stream_options: { include_usage: true },
    });
    let reasoning = '';
    let content = '';
    let reasoningAfterContent = false;
    let usage: OpenAI.CompletionUsage | null | undefined;
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta as
        | { content?: string | null; reasoning_content?: string }
        | undefined;
      if (delta?.reasoning_content) {
        if (content !== '') reasoningAfterContent = true;
        reasoning += delta.reasoning_content;
      }
      if (delta?.content) content += delta.content;
      if (chunk.usage) usage = chunk.usage;
    }
    expect(reasoning.length).toBeGreaterThan(0);
    expect(content.length).toBeGreaterThan(0);
    expect(reasoningAfterContent).toBe(false);
    expect(
      usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    ).toBeGreaterThan(0);
  });

  test('a repeated prefix is reported as cached', async () => {
    const system = `You are a careful assistant. ${'Policy text. '.repeat(400)}`;
    const ask = () =>
      client.chat.completions.create({
        model: 'load-chat-fast',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: 'Hi [[mock:tokens=5]]' },
        ],
      });
    await ask();
    const second = await ask();
    expect(
      second.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    ).toBeGreaterThan(1000);
  });

  test('the first token waits for the time to first token', async () => {
    const started = performance.now();
    const stream = await client.chat.completions.create({
      model: 'load-chat-fast',
      messages: [
        { role: 'user', content: 'Hi [[mock:ttft=200]] [[mock:tokens=5]]' },
      ],
      stream: true,
    });
    let firstText = 0;
    for await (const chunk of stream) {
      if (firstText === 0 && chunk.choices[0]?.delta.content)
        firstText = performance.now() - started;
    }
    expect(firstText).toBeGreaterThanOrEqual(190);
  });
});

describe('refusals the SDK recognizes', () => {
  test('429 is a rate limit with Retry-After', async () => {
    const error = await client.chat.completions
      .create({
        model: 'load-chat-fast',
        messages: [{ role: 'user', content: 'Hi [[mock:429]]' }],
      })
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    expect(error).toBeInstanceOf(OpenAI.RateLimitError);
    const rateLimit = error as InstanceType<typeof OpenAI.RateLimitError>;
    expect(Number(rateLimit.headers?.get('retry-after'))).toBeGreaterThan(0);
  });

  test('503 is a server error', async () => {
    const error = await client.chat.completions
      .create({
        model: 'load-chat-fast',
        messages: [{ role: 'user', content: 'Hi [[mock:503]]' }],
      })
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    expect(error).toBeInstanceOf(OpenAI.InternalServerError);
    expect((error as InstanceType<typeof OpenAI.APIError>).status).toBe(503);
  });

  test('a stream that fails midway raises while reading', async () => {
    const stream = await client.chat.completions.create({
      model: 'load-chat-fast',
      messages: [
        {
          role: 'user',
          content: 'Hi [[mock:midstream-error]] [[mock:tokens=200]]',
        },
      ],
      stream: true,
    });
    let text = '';
    const read = (async () => {
      for await (const chunk of stream)
        text += chunk.choices[0]?.delta.content ?? '';
    })();
    await expect(read).rejects.toBeDefined();
    expect(text.length).toBeGreaterThan(0);
  });

  test('a missing key is refused as unauthenticated', async () => {
    const response = await fetch(`${mock.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'load-chat-fast',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error?: { type?: string } };
    expect(typeof body.error?.type).toBe('string');
  });

  test('a model it does not list is still served, but not looked up', async () => {
    // A deployment may point its own model ids at the mock.
    const completion = await client.chat.completions.create({
      model: 'gpt-staging-alias',
      messages: [{ role: 'user', content: 'Hi [[mock:tokens=5]]' }],
    });
    expect(completion.model).toBe('gpt-staging-alias');
    const error = await client.models.retrieve('no-such-model').then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(OpenAI.NotFoundError);
  });
});

describe('the other OpenAI routes', () => {
  test('models list the chat and embedding models', async () => {
    const ids: string[] = [];
    for await (const model of client.models.list()) ids.push(model.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'load-chat-fast',
        'load-chat-reasoning',
        'load-embed',
      ]),
    );
  });

  test('embeddings decode from the SDK default base64 and are stable', async () => {
    const first = await client.embeddings.create({
      model: 'load-embed',
      input: ['quarterly revenue', 'holiday schedule'],
      dimensions: 64,
    });
    expect(first.data).toHaveLength(2);
    expect(first.data.map((row) => row.index)).toEqual([0, 1]);
    for (const row of first.data) expect(row.embedding).toHaveLength(64);
    expect(first.usage.prompt_tokens).toBeGreaterThan(0);
    const again = await client.embeddings.create({
      model: 'load-embed',
      input: 'quarterly revenue',
      dimensions: 64,
    });
    expect(again.data[0]?.embedding).toEqual(first.data[0]?.embedding);
    expect(first.data[1]?.embedding).not.toEqual(first.data[0]?.embedding);
    const norm = Math.hypot(...(first.data[0]?.embedding ?? []));
    expect(norm).toBeCloseTo(1, 3);
  });
});
