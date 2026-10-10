/**
 * The mock speaks the Messages API well enough for the official client:
 * the SDK's stream accumulator checks the event order, joins the tool
 * input fragments and raises the errors Anthropic sends.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import Anthropic from '@anthropic-ai/sdk';

import { createMockServer, type MockServer } from '../../src/mock/server.ts';

let mock: MockServer;
let client: Anthropic;

beforeAll(async () => {
  mock = await createMockServer(
    {
      port: 0,
      seed: 11,
      ttftMedianMs: 5,
      ttftP95Ms: 10,
      tokensPerSecondMean: 20_000,
      tokensPerSecondSd: 0,
      rate429: 0,
      rate5xx: 0,
      midStreamErrorRate: 0,
      toolCallRate: 0,
    },
    {},
  );
  client = new Anthropic({
    apiKey: 'load-test-key',
    baseURL: mock.url,
    maxRetries: 0,
  });
});

afterAll(async () => {
  await mock.close();
});

const WEATHER_TOOL: Anthropic.Tool = {
  name: 'get_weather',
  description: 'Current weather in a city',
  input_schema: {
    type: 'object',
    properties: {
      city: { type: 'string' },
      unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
    },
    required: ['city', 'unit'],
  },
};

async function refusal(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (caught: unknown) => caught,
  );
}

describe('messages through the Anthropic SDK', () => {
  test('a buffered reply ends its turn with usage', async () => {
    const message = await client.messages.create({
      model: 'load-chat-fast',
      max_tokens: 512,
      messages: [
        { role: 'user', content: 'Summarize the week [[mock:tokens=40]]' },
      ],
    });
    expect(message.type).toBe('message');
    expect(message.role).toBe('assistant');
    expect(message.stop_reason).toBe('end_turn');
    const block = message.content[0];
    expect(block?.type).toBe('text');
    expect(block?.type === 'text' ? block.text.length : 0).toBeGreaterThan(0);
    expect(message.usage.output_tokens).toBe(40);
    expect(message.usage.input_tokens).toBeGreaterThan(0);
  });

  test('a stream accumulates to the same text it streamed', async () => {
    const stream = client.messages.stream({
      model: 'load-chat-fast',
      max_tokens: 512,
      messages: [
        { role: 'user', content: 'Tell me a story [[mock:tokens=60]]' },
      ],
    });
    let streamed = '';
    stream.on('text', (delta) => {
      streamed += delta;
    });
    const message = await stream.finalMessage();
    const text = message.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('');
    expect(text).toBe(streamed);
    expect(text.length).toBeGreaterThan(0);
    expect(message.usage.output_tokens).toBe(60);
  });

  test('max_tokens caps the reply and says so', async () => {
    const message = await client.messages
      .stream({
        model: 'load-chat-fast',
        max_tokens: 10,
        messages: [
          { role: 'user', content: 'A long essay [[mock:tokens=400]]' },
        ],
      })
      .finalMessage();
    expect(message.stop_reason).toBe('max_tokens');
    expect(message.usage.output_tokens).toBe(10);
  });

  test('a title call answers a title and ignores the turn directives', async () => {
    // The platform names a thread from its first message, directives and
    // all; that call must not inherit the turn's fault.
    const message = await client.messages.create({
      model: 'load-chat-fast',
      max_tokens: 30,
      system:
        'You are a title generator for chat conversations. Answer with a short title.',
      messages: [
        { role: 'user', content: 'Quarterly budget review [[mock:429]]' },
      ],
    });
    const block = message.content[0];
    const title = block?.type === 'text' ? block.text : '';
    expect(title.length).toBeGreaterThan(0);
    expect(title.split(/\s+/).length).toBeLessThanOrEqual(8);
  });

  test('a forced tool call streams valid input JSON', async () => {
    const message = await client.messages
      .stream({
        model: 'load-chat-fast',
        max_tokens: 512,
        tools: [WEATHER_TOOL],
        messages: [{ role: 'user', content: 'Weather in Bern? [[mock:tool]]' }],
      })
      .finalMessage();
    expect(message.stop_reason).toBe('tool_use');
    const call = message.content.find((block) => block.type === 'tool_use');
    if (call?.type !== 'tool_use') throw new Error('no tool_use block');
    expect(call.name).toBe('get_weather');
    expect(call.id).toMatch(/^toolu_/);
    const input = call.input as Record<string, unknown>;
    expect(typeof input.city).toBe('string');
    expect(['celsius', 'fahrenheit']).toContain(String(input.unit));
  });

  test('thinking comes first, signed', async () => {
    const message = await client.messages
      .stream({
        model: 'load-chat-reasoning',
        max_tokens: 4096,
        thinking: { type: 'enabled', budget_tokens: 1024 },
        messages: [
          { role: 'user', content: 'Plan a migration [[mock:tokens=50]]' },
        ],
      })
      .finalMessage();
    const first = message.content[0];
    expect(first?.type).toBe('thinking');
    if (first?.type !== 'thinking') throw new Error('no thinking block');
    expect(first.thinking.length).toBeGreaterThan(0);
    expect(first.signature.length).toBeGreaterThan(0);
    expect(message.content.some((block) => block.type === 'text')).toBe(true);
  });

  test('a cache breakpoint reads the cached prefix the second time', async () => {
    const system: Anthropic.TextBlockParam[] = [
      {
        type: 'text',
        text: `Company handbook. ${'Policy text. '.repeat(400)}`,
        cache_control: { type: 'ephemeral' },
      },
    ];
    const ask = () =>
      client.messages.create({
        model: 'load-chat-fast',
        max_tokens: 1024,
        system,
        messages: [{ role: 'user', content: 'Hi [[mock:tokens=5]]' }],
      });
    await ask();
    const second = await ask();
    expect(second.usage.cache_read_input_tokens ?? 0).toBeGreaterThan(1000);
  });

  test('count_tokens counts the prompt alone', async () => {
    const counted = await client.messages.countTokens({
      model: 'load-chat-fast',
      messages: [
        { role: 'user', content: 'How many tokens is this sentence?' },
      ],
    });
    expect(counted.input_tokens).toBeGreaterThan(0);
  });
});

describe('errors the SDK recognizes', () => {
  test('429 is a rate limit', async () => {
    const error = await refusal(
      client.messages.create({
        model: 'load-chat-fast',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hi [[mock:429]]' }],
      }),
    );
    expect(error).toBeInstanceOf(Anthropic.RateLimitError);
  });

  test('an outage is the 529 overloaded error Anthropic sends', async () => {
    const error = await refusal(
      client.messages.create({
        model: 'load-chat-fast',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hi [[mock:503]]' }],
      }),
    );
    expect(error).toBeInstanceOf(Anthropic.APIError);
    expect((error as InstanceType<typeof Anthropic.APIError>).status).toBe(529);
  });

  test('an error event in the stream rejects the accumulator', async () => {
    const error = await refusal(
      client.messages
        .stream({
          model: 'load-chat-fast',
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: 'Hi [[mock:midstream-error]] [[mock:tokens=200]]',
            },
          ],
        })
        .finalMessage(),
    );
    expect(error).toBeInstanceOf(Error);
  });

  test('a missing key is an authentication error', async () => {
    const response = await fetch(`${mock.url}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'load-chat-fast',
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });
    expect(response.status).toBe(401);
    const body = (await response.json()) as {
      type?: string;
      error?: { type?: string };
    };
    expect(body.type).toBe('error');
    expect(body.error?.type).toBe('authentication_error');
  });
});
