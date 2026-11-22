import type { LanguageModelV4Prompt } from '@ai-sdk/provider';
import { describe, expect, it } from 'vitest';

import type { UpstreamEndpoint } from '../endpoint.ts';
import {
  languageModelFor,
  promptForUpstream,
  reasoningForUpstream,
  relayUsageOf,
  upstreamProviderOptions,
} from './upstream.ts';

const endpoint = (
  wire: UpstreamEndpoint['wire'],
  connector = 'deepseek',
): UpstreamEndpoint => ({
  wire,
  connector,
  modelId: 'the-model',
  baseUrl: 'https://upstream.example/v1',
  apiKey: 'sk-upstream',
  headers: { 'X-Title': 'Tale' },
});

describe('the upstream a translated call goes to', () => {
  it('calls an Anthropic endpoint at its messages path, with the key and the headers', async () => {
    const seen: { url: string; headers: Headers }[] = [];
    const model = await languageModelFor(
      {
        ...endpoint('anthropic'),
        baseUrl: 'https://upstream.example/anthropic',
      },
      async (input, init) => {
        seen.push({
          url:
            typeof input === 'string'
              ? input
              : input instanceof URL
                ? input.href
                : input.url,
          headers: new Headers(init?.headers),
        });
        return Response.json({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'the-model',
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 3, output_tokens: 1 },
        });
      },
      { 'x-tale-cache-affinity': 'exec-1' },
    );
    await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    });
    expect(seen[0]?.url).toBe('https://upstream.example/anthropic/v1/messages');
    expect(seen[0]?.headers.get('x-api-key')).toBe('sk-upstream');
    expect(seen[0]?.headers.get('x-title')).toBe('Tale');
    expect(seen[0]?.headers.get('x-tale-cache-affinity')).toBe('exec-1');
  });

  it('calls a Chat Completions endpoint, with the effort as the relay spelled it', async () => {
    const bodies: Record<string, unknown>[] = [];
    const model = await languageModelFor(
      endpoint('openai-chat'),
      async (_input, init) => {
        bodies.push(
          JSON.parse(
            typeof init?.body === 'string' ? init.body : '{}',
          ) as Record<string, unknown>,
        );
        return Response.json({
          id: 'c1',
          object: 'chat.completion',
          created: 1,
          model: 'the-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'ok' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
        });
      },
    );
    await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      reasoning: 'high',
    });
    await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    });
    expect(bodies[0]?.model).toBe('the-model');
    expect(bodies[0]?.reasoning_effort).toBe('high');
    expect(bodies[0]?.stream_options).toBeUndefined();
    expect(bodies[1]).not.toHaveProperty('reasoning_effort');
  });

  it('never sends a translated call to the Responses API', async () => {
    await expect(
      languageModelFor(
        endpoint('openai-responses'),
        async () => new Response(),
      ),
    ).rejects.toThrow(/never goes to the Responses API/);
  });
});

describe('how an upstream is asked to think', () => {
  it('gives OpenAI’s own API every level it names', () => {
    const openai = endpoint('openai-chat', 'openai');
    expect(reasoningForUpstream(openai, 'none')).toBe('none');
    expect(reasoningForUpstream(openai, 'minimal')).toBe('minimal');
    expect(reasoningForUpstream(openai, 'xhigh')).toBe('xhigh');
    expect(reasoningForUpstream(openai, 'max')).toBe('xhigh');
  });

  it('rounds to low, medium and high for any other Chat Completions server, and sends nothing for none', () => {
    const other = endpoint('openai-chat', 'deepseek');
    expect(reasoningForUpstream(other, 'none')).toBeUndefined();
    expect(reasoningForUpstream(other, 'minimal')).toBe('low');
    expect(reasoningForUpstream(other, 'medium')).toBe('medium');
    expect(reasoningForUpstream(other, 'max')).toBe('high');
  });

  it('never tells Anthropic to stop thinking, and leaves an unasked level alone', () => {
    expect(reasoningForUpstream(endpoint('anthropic'), 'none')).toBeUndefined();
    expect(reasoningForUpstream(endpoint('anthropic'), 'max')).toBe('max');
    expect(
      reasoningForUpstream(endpoint('openai-chat'), undefined),
    ).toBeUndefined();
    expect(
      reasoningForUpstream(endpoint('openai-chat'), 'provider-default'),
    ).toBe('provider-default');
  });
});

describe('the options every translated call carries', () => {
  it('sends thinking back on Anthropic, and asks Anthropic’s own API alone to cache', () => {
    expect(upstreamProviderOptions(endpoint('anthropic', 'anthropic'))).toEqual(
      {
        anthropic: { sendReasoning: true, cacheControl: { type: 'ephemeral' } },
      },
    );
    expect(upstreamProviderOptions(endpoint('anthropic', 'deepseek'))).toEqual({
      anthropic: { sendReasoning: true },
    });
    expect(upstreamProviderOptions(endpoint('openai-chat'))).toBeUndefined();
  });
});

describe('the prompt as the upstream’s wire takes it', () => {
  const prompt: LanguageModelV4Prompt = [
    {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName: 'screenshot',
          input: {},
        },
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call_1',
          toolName: 'screenshot',
          output: {
            type: 'content',
            value: [
              { type: 'text', text: 'The page:' },
              {
                type: 'file',
                data: { type: 'data', data: 'iVBORw0KGgo=' },
                mediaType: 'image/png',
              },
            ],
          },
        },
      ],
    },
  ];

  it('moves the files of a tool’s answer to a user message after it on Chat Completions', () => {
    const shaped = promptForUpstream(endpoint('openai-chat'), prompt);
    expect(shaped).toHaveLength(3);
    expect(shaped[1]).toEqual({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call_1',
          toolName: 'screenshot',
          output: {
            type: 'text',
            value: 'The page:\n(a file follows in the next message)',
          },
        },
      ],
    });
    expect(shaped[2]).toEqual({
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'The file the call call_1 (screenshot) returned:',
        },
        {
          type: 'file',
          data: { type: 'data', data: 'iVBORw0KGgo=' },
          mediaType: 'image/png',
        },
      ],
    });
  });

  it('leads the client’s next user message with the files, never two user turns in a row', () => {
    const shaped = promptForUpstream(endpoint('openai-chat'), [
      ...prompt,
      { role: 'user', content: [{ type: 'text', text: 'Now compare it.' }] },
    ]);
    expect(shaped.map((message) => message.role)).toEqual([
      'assistant',
      'tool',
      'user',
    ]);
    expect(shaped[2]).toEqual({
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'The file the call call_1 (screenshot) returned:',
        },
        {
          type: 'file',
          data: { type: 'data', data: 'iVBORw0KGgo=' },
          mediaType: 'image/png',
        },
        { type: 'text', text: 'Now compare it.' },
      ],
    });
  });

  it('leaves the prompt alone on Anthropic, which takes files in a tool’s answer', () => {
    expect(promptForUpstream(endpoint('anthropic'), prompt)).toBe(prompt);
  });
});

describe('the SDK’s usage in the relay’s shape', () => {
  it('reads uncached input, cache reads and writes, and all output', () => {
    expect(
      relayUsageOf({
        inputTokens: {
          total: 1000,
          noCache: 100,
          cacheRead: 800,
          cacheWrite: 100,
        },
        outputTokens: { total: 60, text: 40, reasoning: 20 },
      }),
    ).toEqual({
      inputTokens: 100,
      cacheReadTokens: 800,
      cacheWriteTokens: 100,
      outputTokens: 60,
    });
    expect(
      relayUsageOf({
        inputTokens: {
          total: 50,
          noCache: undefined,
          cacheRead: 10,
          cacheWrite: undefined,
        },
        outputTokens: { total: undefined, text: 7, reasoning: 3 },
      }),
    ).toEqual({
      inputTokens: 40,
      cacheReadTokens: 10,
      cacheWriteTokens: 0,
      outputTokens: 10,
    });
  });
});
