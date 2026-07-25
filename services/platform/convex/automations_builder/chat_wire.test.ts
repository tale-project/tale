import { describe, expect, it } from 'vitest';

import type { BuilderMessage } from '../../lib/automations_builder/session';
import { buildChatRequest, parseChatReply } from './chat_wire';

const messages: BuilderMessage[] = [
  { role: 'system', content: 'GUIDE' },
  { role: 'user', content: 'JOB' },
  { role: 'user', content: 'WHAT THE LAST ATTEMPT LEARNED' },
  { role: 'assistant', content: 'ACTION' },
  { role: 'user', content: 'RESULT' },
];

function request(apiFormat: 'openai' | 'anthropic', baseUrl: string) {
  return buildChatRequest({
    apiFormat,
    baseUrl,
    modelId: 'vendor/model-1',
    apiKey: 'secret-key',
    messages,
    temperature: 0.1,
    maxTokens: 8000,
  });
}

describe('the OpenAI-compatible shape', () => {
  it('posts the whole conversation to the completions path', () => {
    const wire = request('openai', 'https://example.test/api/v1/');
    expect(wire.url).toBe('https://example.test/api/v1/chat/completions');
    expect(wire.headers.authorization).toBe('Bearer secret-key');
    expect(JSON.parse(wire.body)).toEqual({
      model: 'vendor/model-1',
      max_tokens: 8000,
      temperature: 0.1,
      messages,
    });
  });

  it('reads the reply text and the token counts', () => {
    expect(
      parseChatReply('openai', {
        choices: [{ message: { content: 'yaml action' } }],
        usage: { prompt_tokens: 120, completion_tokens: 30 },
      }),
    ).toEqual({
      content: 'yaml action',
      usage: { prompt: 120, completion: 30 },
    });
  });
});

describe('the Anthropic shape', () => {
  it('hoists the system prompt and merges consecutive user turns', () => {
    const wire = request('anthropic', 'https://api.example.test');
    expect(wire.url).toBe('https://api.example.test/v1/messages');
    expect(wire.headers['x-api-key']).toBe('secret-key');
    expect(wire.headers['anthropic-version']).toBe('2023-06-01');
    expect(JSON.parse(wire.body)).toEqual({
      model: 'vendor/model-1',
      max_tokens: 8000,
      temperature: 0.1,
      system: 'GUIDE',
      // The restart seed's two user messages became one; the API rejects
      // two turns of the same role in a row.
      messages: [
        { role: 'user', content: 'JOB\n\nWHAT THE LAST ATTEMPT LEARNED' },
        { role: 'assistant', content: 'ACTION' },
        { role: 'user', content: 'RESULT' },
      ],
    });
  });

  it('joins the text blocks of the reply', () => {
    expect(
      parseChatReply('anthropic', {
        content: [
          { type: 'text', text: 'CAUSE: the node had no code.\n' },
          { type: 'text', text: '```yaml\nmethod: run_automation\n```' },
        ],
        usage: { input_tokens: 900, output_tokens: 210 },
      }),
    ).toEqual({
      content:
        'CAUSE: the node had no code.\n```yaml\nmethod: run_automation\n```',
      usage: { prompt: 900, completion: 210 },
    });
  });
});

describe('unusable payloads', () => {
  it.each([
    ['openai' as const, { choices: [] }],
    ['openai' as const, { choices: [{ message: { content: '' } }] }],
    ['anthropic' as const, { content: [] }],
    ['anthropic' as const, {}],
  ])('refuses a %s payload with no text: %j', (apiFormat, payload) => {
    expect(() => parseChatReply(apiFormat, payload)).toThrow(
      'the model returned no text content',
    );
  });

  it('refuses a non-object payload', () => {
    expect(() => parseChatReply('openai', 'nope')).toThrow(
      'the model returned a non-object payload',
    );
  });
});
