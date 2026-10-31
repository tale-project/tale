/**
 * The mock speaks the Messages API well enough for the official client:
 * the SDK's stream accumulator checks the event order, joins the tool
 * input fragments and raises the errors Anthropic sends.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import Anthropic from '@anthropic-ai/sdk';

import { createMockServer, type MockServer } from '../../src/mock/server.ts';
import { parsePrometheus } from '../../src/runner/probes.ts';

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

/** Claude Code's shell tool, as it offers it. */
const BASH_TOOL: Anthropic.Tool = {
  name: 'Bash',
  description: 'Executes a given bash command',
  input_schema: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      timeout: { type: 'number' },
      description: { type: 'string' },
      run_in_background: { type: 'boolean' },
    },
    required: ['command'],
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

  test('a hog turn calls Bash, and its result ends the turn', async () => {
    const ask = 'Run the burst [[mock:hog=64]] [[mock:hog-seconds=2]]';
    const message = await client.messages
      .stream({
        model: 'load-chat-fast',
        max_tokens: 4096,
        tools: [WEATHER_TOOL, BASH_TOOL],
        messages: [{ role: 'user', content: ask }],
      })
      .finalMessage();
    expect(message.stop_reason).toBe('tool_use');
    const call = message.content.find((block) => block.type === 'tool_use');
    if (call?.type !== 'tool_use') throw new Error('no tool_use block');
    expect(call.name).toBe('Bash');
    const input = call.input as Record<string, unknown>;
    expect(String(input.command)).toStartWith("python3 -c '");
    expect(input.description).toBe('Hold 64 MiB and keep a CPU busy for 2 s');

    const answer = await client.messages.create({
      model: 'load-chat-fast',
      max_tokens: 4096,
      tools: [WEATHER_TOOL, BASH_TOOL],
      messages: [
        { role: 'user', content: ask },
        { role: 'assistant', content: message.content },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: call.id,
              content: 'held 64 MiB and spun 2 s',
            },
          ],
        },
      ],
    });
    expect(answer.stop_reason).toBe('end_turn');
    expect(answer.content.some((block) => block.type === 'tool_use')).toBe(
      false,
    );
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

/**
 * Claude Code sends its environment as a `system` message after the user's
 * (a role the SDK's types do not offer), and the sandbox's gateway, bifrost,
 * passes such a message on as a user message of its own, wrapped in
 * `<system-reminder>`. This mock calls a tool on every turn it may, so a
 * turn read as anything but the user's shows.
 */
describe("Claude Code's turns, as they reach the mock", () => {
  let eager: MockServer;
  beforeAll(async () => {
    eager = await createMockServer(
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
        toolCallRate: 1,
      },
      {},
    );
  });
  afterAll(async () => {
    await eager.close();
  });

  const ask = 'Run the burst [[mock:hog=64]] [[mock:hog-seconds=2]]';
  const environment =
    '# Environment\nYou have been invoked in this environment';
  const budget = '<total_tokens>14979595 tokens left</total_tokens>';
  const shapes = [
    [
      'a system message',
      (text: string) => ({ role: 'system', content: [{ type: 'text', text }] }),
    ],
    [
      "the gateway's reminder",
      (text: string) => ({
        role: 'user',
        content: [
          {
            type: 'text',
            text: `<system-reminder>\n${text}\n</system-reminder>\n`,
          },
        ],
      }),
    ],
  ] as const;

  async function send(messages: unknown[]): Promise<Anthropic.Message> {
    const response = await fetch(`${eager.url}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': 'load-test-key',
      },
      body: JSON.stringify({
        model: 'load-chat-fast',
        max_tokens: 4096,
        tools: [WEATHER_TOOL, BASH_TOOL],
        messages,
      }),
    });
    expect(response.status).toBe(200);
    return (await response.json()) as Anthropic.Message;
  }

  /** The hog calls the mock sent and the hog results it answered. */
  async function hogCounts(): Promise<[number, number]> {
    const samples = parsePrometheus(
      await (await fetch(`${eager.url}/metrics`)).text(),
    );
    const count = (name: string): number =>
      samples.find((sample) => sample.name === name)?.value ?? Number.NaN;
    return [
      count('tale_load_mock_hog_calls_total'),
      count('tale_load_mock_hog_results_total'),
    ];
  }

  test.each(shapes)(
    'the hog runs past %s, and its result ends the turn',
    async (_shape, instructions) => {
      const opening = [
        { role: 'user', content: [{ type: 'text', text: ask }] },
        instructions(environment),
      ];
      const [calls, results] = await hogCounts();
      const message = await send(opening);
      expect(message.stop_reason).toBe('tool_use');
      const call = message.content.find((block) => block.type === 'tool_use');
      if (call?.type !== 'tool_use') throw new Error('no tool_use block');
      expect(call.name).toBe('Bash');
      const input = call.input as Record<string, unknown>;
      expect(input.description).toBe('Hold 64 MiB and keep a CPU busy for 2 s');
      expect(await hogCounts()).toEqual([calls + 1, results]);

      const answer = await send([
        ...opening,
        { role: 'assistant', content: message.content },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: call.id,
              content: 'held 64 MiB and spun 2 s',
            },
          ],
        },
        instructions(budget),
      ]);
      expect(answer.stop_reason).toBe('end_turn');
      expect(answer.content.some((block) => block.type === 'tool_use')).toBe(
        false,
      );
      expect(await hogCounts()).toEqual([calls + 1, results + 1]);
    },
  );
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
