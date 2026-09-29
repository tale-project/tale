/**
 * The Anthropic Messages request as the model endpoint reads it — the shape
 * Claude Code sends: a system prompt in text blocks, tool results carrying
 * images, the client-run tools — and the refusals of what it cannot govern.
 */

import { describe, expect, it } from 'vitest';

import {
  anthropicUpstreamBody,
  inspectAnthropicMessagesRequest,
  refuseUnpricedAnthropicBetas,
} from './anthropic.ts';
import { ModelApiRefusal } from './wire.ts';

const IMAGE = {
  type: 'image',
  source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(64) },
};

function refusal(body: unknown): ModelApiRefusal {
  try {
    inspectAnthropicMessagesRequest(body);
  } catch (error) {
    if (error instanceof ModelApiRefusal) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

const BASE = {
  model: 'deepseek/deepseek-v4-flash',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'hi' }],
};

describe('inspectAnthropicMessagesRequest', () => {
  it('reads a Claude Code turn: system blocks, text, a tool result with an image, client tools', () => {
    const request = inspectAnthropicMessagesRequest({
      model: 'deepseek/deepseek-v4-flash',
      max_tokens: 32_000,
      stream: true,
      system: [
        {
          type: 'text',
          text: 'You are Claude Code.',
          cache_control: { type: 'ephemeral' },
        },
        { type: 'text', text: 'Project rules.' },
      ],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '<system-reminder>ctx</system-reminder>' },
            { type: 'text', text: 'Fix the bug.' },
          ],
        },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '…', signature: 'sig' },
            {
              type: 'tool_use',
              id: 'tu_1',
              name: 'Read',
              input: { path: 'a.png' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_1',
              content: [{ type: 'text', text: 'file bytes' }, IMAGE],
            },
          ],
        },
      ],
      tools: [
        { name: 'Read', input_schema: { type: 'object' } },
        { type: 'custom', name: 'Grep', input_schema: { type: 'object' } },
        { type: 'text_editor_20250728', name: 'str_replace_based_edit_tool' },
      ],
      metadata: { user_id: 'u' },
    });
    expect(request.model).toBe('deepseek/deepseek-v4-flash');
    expect(request.stream).toBe(true);
    expect(request.maxOutputTokens).toBe(32_000);
    expect(request.offersTools).toBe(true);
    // The tool result's image needs a vision model.
    expect(request.imageCount).toBe(1);
    expect(request.mediaChars).toBe(64);
    // Every text the caller wrote, whatever its role: the signed reasoning
    // and the names are judged but never rewritten.
    expect(
      request.segments.map((segment) => [
        segment.where,
        segment.read(),
        segment.maskable,
      ]),
    ).toEqual([
      ['system prompt', 'You are Claude Code.', true],
      ['system prompt', 'Project rules.', true],
      ['message', '<system-reminder>ctx</system-reminder>', true],
      ['message', 'Fix the bug.', true],
      ['assistant turn', '…', false],
      ['tool call', 'Read', false],
      ['tool call', 'a.png', true],
      ['tool result', 'file bytes', true],
      ['tool definition', 'Read', false],
      ['tool definition', 'Grep', false],
      ['tool definition', 'str_replace_based_edit_tool', false],
    ]);
  });

  it('rewrites a string system prompt and a string message in place', () => {
    const request = inspectAnthropicMessagesRequest({
      ...BASE,
      system: 'secret 4111',
      messages: [{ role: 'user', content: 'card 4111' }],
    });
    for (const segment of request.segments) {
      segment.write(segment.read().replace('4111', '[CARD]'));
    }
    expect(request.body.system).toBe('secret [CARD]');
    expect(request.body.messages).toEqual([
      { role: 'user', content: 'card [CARD]' },
    ]);
  });

  it('never relays the gateway-only fallbacks, and names the gateway model upstream', () => {
    const request = inspectAnthropicMessagesRequest({
      ...BASE,
      fallbacks: ['openai/gpt-5'],
    });
    expect(anthropicUpstreamBody(request, 'org__deepseek__x/x')).toEqual({
      model: 'org__deepseek__x/x',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'hi' }],
    });
  });

  it.each([
    [{ ...BASE, max_tokens: undefined }, 'max_tokens'],
    [{ ...BASE, model: '' }, 'model'],
    [
      { ...BASE, messages: [{ role: 'system', content: 'x' }] },
      'messages.0.role',
    ],
    [{ ...BASE, system: [{ type: 'image', source: {} }] }, 'system.0'],
    [
      {
        ...BASE,
        messages: [{ role: 'user', content: [{ type: 'container_upload' }] }],
      },
      'messages.0.content.0.type',
    ],
    [
      {
        ...BASE,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'url', url: 'http://169.254.169.254/x' },
              },
            ],
          },
        ],
      },
      'messages.0.content.0.source.url',
    ],
    // A file stored in the organization's vendor account.
    [
      {
        ...BASE,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'document', source: { type: 'file', file_id: 'file_1' } },
            ],
          },
        ],
      },
      'messages.0.content.0.source',
    ],
    // Billed at a rate the catalog does not know.
    [{ ...BASE, service_tier: 'priority' }, 'service_tier'],
    // An assistant block the door does not read.
    [
      {
        ...BASE,
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'server_tool_use', id: 's', name: 'web_search' }],
          },
        ],
      },
      'messages.0.content.0.type',
    ],
  ])('refuses %j at %s', (body, param) => {
    const error = refusal(body);
    expect(error.status).toBe(400);
    expect(error.code).toBe('INVALID_BODY');
    expect(error.param).toBe(param);
  });

  it.each([
    [
      { ...BASE, tools: [{ type: 'web_search_20250305', name: 'web_search' }] },
      'tools.0.type',
    ],
    [
      { ...BASE, tools: [{ type: 'code_execution_20250825', name: 'x' }] },
      'tools.0.type',
    ],
    [{ ...BASE, mcp_servers: [{ url: 'https://mcp.example' }] }, 'mcp_servers'],
    [{ ...BASE, container: 'container_1' }, 'container'],
  ])('refuses a vendor-run tool %j at %s', (body, param) => {
    const error = refusal(body);
    expect(error.code).toBe('MODEL_API_VENDOR_TOOL_UNSUPPORTED');
    expect(error.param).toBe(param);
  });
});

describe('inspectAnthropicMessagesRequest — every text the caller wrote', () => {
  it('serves the priced tiers', () => {
    for (const tier of ['auto', 'standard_only']) {
      expect(() =>
        inspectAnthropicMessagesRequest({ ...BASE, service_tier: tier }),
      ).not.toThrow();
    }
  });

  it('collects documents given as text, search results and a prefill', () => {
    const request = inspectAnthropicMessagesRequest({
      ...BASE,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'text',
                media_type: 'text/plain',
                data: 'The memo.',
              },
              title: 'Memo',
              context: 'From the archive.',
            },
            {
              type: 'document',
              source: {
                type: 'content',
                content: [{ type: 'text', text: 'Page one.' }],
              },
            },
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: 'J'.repeat(40),
              },
            },
            {
              type: 'search_result',
              source: 'https://example.com/a',
              title: 'Result',
              content: [{ type: 'text', text: 'Snippet.' }],
            },
          ],
        },
        { role: 'assistant', content: 'The answer is' },
      ],
    });
    expect(
      request.segments.map((segment) => [segment.where, segment.read()]),
    ).toEqual([
      ['document', 'The memo.'],
      ['document', 'Memo'],
      ['document', 'From the archive.'],
      ['document', 'Page one.'],
      ['document', 'Result'],
      ['document', 'https://example.com/a'],
      ['document', 'Snippet.'],
      ['assistant turn', 'The answer is'],
    ]);
    // Only the PDF is a binary document, and only its bytes are media.
    expect(request.documentCount).toBe(1);
    expect(request.mediaChars).toBe(40);
  });

  it('rewrites a tool call input in place', () => {
    const request = inspectAnthropicMessagesRequest({
      ...BASE,
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 't',
              name: 'mail',
              input: { to: ['jane@example.com'] },
            },
          ],
        },
      ],
    });
    request.segments
      .find((segment) => segment.read() === 'jane@example.com')
      ?.write('[EMAIL]');
    expect(request.body.messages).toEqual([
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 't',
            name: 'mail',
            input: { to: ['[EMAIL]'] },
          },
        ],
      },
    ]);
  });
});

describe('refuseUnpricedAnthropicBetas', () => {
  it('refuses a million-token context beta, whose rate is not metered', () => {
    let error: unknown;
    try {
      refuseUnpricedAnthropicBetas(
        'interleaved-thinking-2025-05-14, context-1m-2025-08-07',
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ModelApiRefusal);
    expect((error as ModelApiRefusal).code).toBe('INVALID_HEADER');
    expect((error as ModelApiRefusal).param).toBe('anthropic-beta');
  });

  it('lets every other beta through', () => {
    expect(() =>
      refuseUnpricedAnthropicBetas(
        'interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14',
      ),
    ).not.toThrow();
    expect(() => refuseUnpricedAnthropicBetas(undefined)).not.toThrow();
  });
});
