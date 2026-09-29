/**
 * The OpenAI Chat Completions request as the model endpoint reads it: the
 * facts it governs, the text the guardrails judge (and may rewrite in
 * place), the refusals of what it cannot govern, and the body it relays.
 */

import { describe, expect, it } from 'vitest';

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
    // System, developer and user text — never the assistant's or a tool's.
    expect(
      request.segments.map((segment) => [segment.role, segment.read()]),
    ).toEqual([
      ['system', 'Be brief.'],
      ['system', 'No emoji.'],
      ['user', 'What is in this picture?'],
    ]);
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

describe('openAiUpstreamBody', () => {
  it('names the gateway model and asks a stream for its usage chunk', () => {
    const request = inspectOpenAiChatRequest({
      model: 'openrouter/openai/gpt-5',
      stream: true,
      stream_options: { include_obfuscation: false },
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(openAiStreamIncludesUsage(request.body)).toBe(false);
    expect(
      openAiUpstreamBody(request, 'openrouter/openai/gpt-5'),
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
    expect(openAiUpstreamBody(request, 'gw/model')).not.toHaveProperty(
      'stream_options',
    );
  });

  it('knows when the caller asked for the usage chunk itself', () => {
    expect(
      openAiStreamIncludesUsage({ stream_options: { include_usage: true } }),
    ).toBe(true);
  });
});
