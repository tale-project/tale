/**
 * The OpenAI Chat Completions request as the model endpoint reads it: the
 * facts it governs, the text the guardrails judge (and may rewrite in
 * place), the refusals of what it cannot govern, and the body it relays.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  inspectOpenAiChatRequest,
  openAiStreamIncludesUsage,
  openAiUpstreamBody,
} from './openai.ts';
import { ModelApiRefusal } from './wire.ts';

const IMAGE = `data:image/png;base64,${'A'.repeat(600)}`;

function refusal(body: unknown): ModelApiRefusal {
  try {
    inspectOpenAiChatRequest(body);
  } catch (error) {
    if (error instanceof ModelApiRefusal) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('inspectOpenAiChatRequest', () => {
  it('reads the model, the stream flag, the output cap, the media and the text', () => {
    const request = inspectOpenAiChatRequest({
      model: ' openrouter/anthropic/claude-sonnet-4.6 ',
      stream: true,
      max_completion_tokens: 900,
      max_tokens: 50,
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'developer', content: [{ type: 'text', text: 'No emoji.' }] },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is in this picture?' },
            { type: 'image_url', image_url: { url: IMAGE } },
            {
              type: 'image_url',
              image_url: { url: 'https://example.com/a.png' },
            },
            {
              type: 'file',
              file: { file_data: 'data:application/pdf;base64,AA' },
            },
          ],
        },
        { role: 'assistant', content: 'A cat.', tool_calls: [] },
        { role: 'tool', tool_call_id: 'call_1', content: 'raw tool output' },
      ],
      tools: [{ type: 'function', function: { name: 'look', parameters: {} } }],
    });
    expect(request.model).toBe('openrouter/anthropic/claude-sonnet-4.6');
    expect(request.stream).toBe(true);
    // The newer cap wins over the deprecated one.
    expect(request.maxOutputTokens).toBe(900);
    expect(request.imageCount).toBe(2);
    expect(request.documentCount).toBe(1);
    expect(request.offersTools).toBe(true);
    // Every text the caller wrote, whatever its role — a name judged but
    // never rewritten.
    expect(
      request.segments.map((segment) => [
        segment.where,
        segment.read(),
        segment.maskable,
      ]),
    ).toEqual([
      ['system prompt', 'Be brief.', true],
      ['system prompt', 'No emoji.', true],
      ['message', 'What is in this picture?', true],
      ['assistant turn', 'A cat.', true],
      ['tool result', 'raw tool output', true],
      ['tool definition', 'look', false],
    ]);
    // The inline media is measured by its part, for the prompt estimate.
    expect(request.mediaChars).toBe(
      IMAGE.length + 'data:application/pdf;base64,AA'.length,
    );
    expect(request.textBytes).toBe(
      ['Be brief.', 'No emoji.', 'What is in this picture?', 'A cat.']
        .concat(['raw tool output', 'look'])
        .reduce((bytes, text) => bytes + Buffer.byteLength(text), 0),
    );
  });

  it('rewrites a judged text in the body it relays', () => {
    const request = inspectOpenAiChatRequest({
      model: 'm/x',
      messages: [
        { role: 'user', content: 'mail me at a@b.example' },
        { role: 'user', content: [{ type: 'text', text: 'call 555' }] },
      ],
    });
    request.segments[0]?.write('mail me at [EMAIL]');
    request.segments[1]?.write('call [PHONE]');
    expect(request.body.messages).toEqual([
      { role: 'user', content: 'mail me at [EMAIL]' },
      { role: 'user', content: [{ type: 'text', text: 'call [PHONE]' }] },
    ]);
  });

  it('counts the answers the request asks for, one when it names none', () => {
    const messages = [{ role: 'user', content: 'hi' }];
    expect(
      inspectOpenAiChatRequest({ model: 'm/x', messages, n: 3 }).choiceCount,
    ).toBe(3);
    expect(
      inspectOpenAiChatRequest({ model: 'm/x', messages }).choiceCount,
    ).toBe(1);
  });

  it('never relays the gateway-only fallbacks', () => {
    const request = inspectOpenAiChatRequest({
      model: 'm/x',
      messages: [{ role: 'user', content: 'hi' }],
      fallbacks: ['openai/gpt-5'],
    });
    expect(request.body).not.toHaveProperty('fallbacks');
  });

  it.each([
    [{ messages: [{ role: 'user', content: 'hi' }] }, 'model'],
    [{ model: 'm/x', messages: [] }, 'messages'],
    [
      {
        model: 'm/x',
        messages: [{ role: 'user', content: 'hi' }],
        stream: 'yes',
      },
      'stream',
    ],
    [
      {
        model: 'm/x',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 0,
      },
      'max_tokens',
    ],
    [{ model: 'm/x', messages: [{ role: 'user', content: 'hi' }], n: 0 }, 'n'],
    // Each answer holds the whole output cap.
    [{ model: 'm/x', messages: [{ role: 'user', content: 'hi' }], n: 9 }, 'n'],
    // Billed at rates the catalog does not know.
    [
      {
        model: 'm/x',
        messages: [{ role: 'user', content: 'hi' }],
        service_tier: 'priority',
      },
      'service_tier',
    ],
    [
      {
        model: 'm/x',
        messages: [{ role: 'user', content: 'hi' }],
        modalities: ['text', 'audio'],
      },
      'modalities',
    ],
    [
      {
        model: 'm/x',
        messages: [{ role: 'user', content: 'hi' }],
        audio: { voice: 'alloy', format: 'mp3' },
      },
      'audio',
    ],
    // Kept in the vendor account beyond the request.
    [
      {
        model: 'm/x',
        messages: [{ role: 'user', content: 'hi' }],
        store: true,
      },
      'store',
    ],
    // A file stored in the organization's vendor account.
    [
      {
        model: 'm/x',
        messages: [
          {
            role: 'user',
            content: [{ type: 'file', file: { file_id: 'file-abc123' } }],
          },
        ],
      },
      'messages.0.content.0.file.file_id',
    ],
    [
      { model: 'm/x', messages: [{ role: 'critic', content: 'hi' }] },
      'messages.0.role',
    ],
    [
      {
        model: 'm/x',
        messages: [
          {
            role: 'system',
            content: [{ type: 'image_url', image_url: { url: IMAGE } }],
          },
        ],
      },
      'messages.0.content.0',
    ],
    [
      {
        model: 'm/x',
        messages: [
          { role: 'user', content: [{ type: 'input_audio', input_audio: {} }] },
        ],
      },
      'messages.0.content.0',
    ],
    [
      {
        model: 'm/x',
        messages: [{ role: 'user', content: [{ type: 'input_video' }] }],
      },
      'messages.0.content.0.type',
    ],
    [
      {
        model: 'm/x',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: 'http://10.0.0.1/a.png' },
              },
            ],
          },
        ],
      },
      'messages.0.content.0.image_url.url',
    ],
  ])('refuses %j at %s', (body, param) => {
    const error = refusal(body);
    expect(error.status).toBe(400);
    expect(error.code).toBe('INVALID_BODY');
    expect(error.param).toBe(param);
  });

  it('refuses a tool the vendor would run, and the vendor web search', () => {
    const tool = refusal({
      model: 'm/x',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        { type: 'function', function: { name: 'a' } },
        { type: 'web_search' },
      ],
    });
    expect(tool.code).toBe('MODEL_API_VENDOR_TOOL_UNSUPPORTED');
    expect(tool.param).toBe('tools.1.type');
    const search = refusal({
      model: 'm/x',
      messages: [{ role: 'user', content: 'hi' }],
      web_search_options: {},
    });
    expect(search.code).toBe('MODEL_API_VENDOR_TOOL_UNSUPPORTED');
  });
});

describe('inspectOpenAiChatRequest — every text the caller wrote', () => {
  it('serves the priced tiers and a declined store', () => {
    for (const tier of ['auto', 'default']) {
      expect(() =>
        inspectOpenAiChatRequest({
          model: 'm/x',
          messages: [{ role: 'user', content: 'hi' }],
          service_tier: tier,
          store: false,
          n: 8,
        }),
      ).not.toThrow();
    }
  });

  it('collects tool calls, results, definitions, the prediction and the response schema', () => {
    const request = inspectOpenAiChatRequest({
      model: 'm/x',
      messages: [
        { role: 'user', content: 'Book it.', name: 'jane' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'c1',
              type: 'function',
              function: {
                name: 'book',
                arguments:
                  '{"who":"jane@example.com","seats":[1,2],"note":"aisle"}',
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'c1',
          content: [{ type: 'text', text: 'booked' }],
        },
        { role: 'function', name: 'legacy', content: 'done' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'book',
            description: 'Books seats.',
            parameters: {
              type: 'object',
              properties: {
                who: { type: 'string', description: 'The traveller.' },
                description: { type: 'string', title: 'A free note' },
              },
            },
          },
        },
      ],
      functions: [{ name: 'old', description: 'An old function.' }],
      prediction: { type: 'content', content: 'Booked for jane.' },
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'booking',
          description: 'The booking.',
          schema: { type: 'object', description: 'One booking.' },
        },
      },
    });
    expect(
      request.segments.map((segment) => [
        segment.where,
        segment.read(),
        segment.maskable,
      ]),
    ).toEqual([
      ['message', 'jane', false],
      ['message', 'Book it.', true],
      ['tool call', 'book', false],
      ['tool call', 'jane@example.com', true],
      ['tool call', 'aisle', true],
      ['tool result', 'booked', true],
      ['message', 'legacy', false],
      ['tool result', 'done', true],
      ['tool definition', 'book', false],
      ['tool definition', 'Books seats.', true],
      ['tool definition', 'A free note', true],
      ['tool definition', 'The traveller.', true],
      ['tool definition', 'old', false],
      ['tool definition', 'An old function.', true],
      ['prediction', 'Booked for jane.', true],
      ['response format', 'booking', false],
      ['response format', 'The booking.', true],
      ['response format', 'One booking.', true],
    ]);
  });

  it('rewrites a tool call argument inside its JSON, keeping the JSON whole', () => {
    const request = inspectOpenAiChatRequest({
      model: 'm/x',
      messages: [
        {
          role: 'assistant',
          tool_calls: [
            {
              id: 'c1',
              type: 'function',
              function: {
                name: 'mail',
                arguments: '{"to":"jane@example.com"}',
              },
            },
          ],
        },
      ],
    });
    const argument = request.segments.find(
      (segment) => segment.read() === 'jane@example.com',
    );
    argument?.write('[EMAIL]');
    const calls = (request.body.messages as Array<Record<string, unknown>>)[0]
      ?.tool_calls as Array<{ function: { arguments: string } }>;
    expect(JSON.parse(calls[0]?.function.arguments ?? '')).toEqual({
      to: '[EMAIL]',
    });
  });

  it('judges arguments that are not JSON as one text', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const request = inspectOpenAiChatRequest({
      model: 'm/x',
      messages: [
        {
          role: 'assistant',
          tool_calls: [
            {
              id: 'c1',
              type: 'function',
              function: { name: 'x', arguments: '{half' },
            },
          ],
        },
      ],
    });
    expect(request.segments.map((segment) => segment.read())).toEqual([
      'x',
      '{half',
    ]);
  });
});

describe('openAiUpstreamBody', () => {
  it('sends the held output cap when the caller named none, and keeps a named one', () => {
    const open = inspectOpenAiChatRequest({
      model: 'm/x',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(openAiUpstreamBody(open, 'gw/model', 8192)).toMatchObject({
      max_completion_tokens: 8192,
    });
    const capped = inspectOpenAiChatRequest({
      model: 'm/x',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
    });
    const body = openAiUpstreamBody(capped, 'gw/model', 100);
    expect(body).not.toHaveProperty('max_completion_tokens');
    expect(body.max_tokens).toBe(100);
  });

  it('names the gateway model and asks a stream for its usage chunk', () => {
    const request = inspectOpenAiChatRequest({
      model: 'openrouter/openai/gpt-5',
      stream: true,
      stream_options: { include_obfuscation: false },
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(openAiStreamIncludesUsage(request.body)).toBe(false);
    expect(
      openAiUpstreamBody(request, 'openrouter/openai/gpt-5', 4096),
    ).toMatchObject({
      model: 'openrouter/openai/gpt-5',
      stream_options: { include_obfuscation: false, include_usage: true },
    });
  });

  it('leaves a non-streamed body without stream options', () => {
    const request = inspectOpenAiChatRequest({
      model: 'openrouter/openai/gpt-5',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(openAiUpstreamBody(request, 'gw/model', 4096)).not.toHaveProperty(
      'stream_options',
    );
  });

  it('knows when the caller asked for the usage chunk itself', () => {
    expect(
      openAiStreamIncludesUsage({ stream_options: { include_usage: true } }),
    ).toBe(true);
  });
});
