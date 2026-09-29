/**
 * The Anthropic Messages request as the model endpoint reads it — the shape
 * Claude Code sends: a system prompt in text blocks, tool results carrying
 * images, the client-run tools — and the refusals of what it cannot govern.
 */

import { describe, expect, it } from 'vitest';

import {
  anthropicUpstreamBody,
  inspectAnthropicMessagesRequest,
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
    // The tool result's image needs a vision model; its text is tool data.
    expect(request.imageCount).toBe(1);
    expect(
      request.segments.map((segment) => [segment.role, segment.read()]),
    ).toEqual([
      ['system', 'You are Claude Code.'],
      ['system', 'Project rules.'],
      ['user', '<system-reminder>ctx</system-reminder>'],
      ['user', 'Fix the bug.'],
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
