import type {
  LanguageModelV4FinishReason,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from '@ai-sdk/provider';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest';

import { anthropicAdapter, setKeepAliveClockForTests } from './anthropic.ts';
import { seal, unseal } from './carry.ts';
import {
  type EncodeContext,
  type ParsedRequest,
  TranslationError,
} from './contract.ts';

const context: EncodeContext = {
  model: 'claude-sonnet-4-5',
  id: 'abc123',
  created: 1_790_000_000,
  request: {},
};

let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** A request with what Anthropic requires, and `fields` on top. */
function request(
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hi' }],
    ...fields,
  };
}

function optionsOf(body: Record<string, unknown>): ParsedRequest['options'] {
  return anthropicAdapter.parse(body).options;
}

function expectRefusal(body: Record<string, unknown>, message: RegExp): void {
  expect(() => anthropicAdapter.parse(body)).toThrow(TranslationError);
  expect(() => anthropicAdapter.parse(body)).toThrow(message);
}

/** The URL a file part of a prompt message points at. */
function hrefOf(message: unknown, index: number): string {
  const { content } = message as { content: Array<{ data: { url: URL } }> };
  return content[index]!.data.url.href;
}

/** The one warning a call logged. */
function warning(): string {
  expect(warn).toHaveBeenCalledTimes(1);
  return String(warn.mock.calls[0]![0]);
}

const READ_TOOL = {
  name: 'Read',
  description: 'Reads a file.',
  input_schema: {
    type: 'object',
    properties: { file_path: { type: 'string' } },
    required: ['file_path'],
  },
};

const USAGE: LanguageModelV4Usage = {
  inputTokens: {
    total: 120,
    noCache: 100,
    cacheRead: 20,
    cacheWrite: undefined,
  },
  outputTokens: { total: 30, text: 20, reasoning: 10 },
};

function finish(
  unified: LanguageModelV4FinishReason['unified'],
  usage: LanguageModelV4Usage = USAGE,
): LanguageModelV4StreamPart {
  return { type: 'finish', finishReason: { unified, raw: unified }, usage };
}

async function* streamOf(
  parts: readonly LanguageModelV4StreamPart[],
): AsyncIterable<LanguageModelV4StreamPart> {
  for (const part of parts) yield part;
}

async function eventsOf(
  parts: readonly LanguageModelV4StreamPart[],
): Promise<string[]> {
  const events: string[] = [];
  for await (const event of anthropicAdapter.encodeStream(
    streamOf(parts),
    context,
  )) {
    events.push(event);
  }
  return events;
}

// The events as Anthropic writes them, field by field in its order.
const event = (type: string, data: Record<string, unknown> = {}) =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const start = (index: number, block: Record<string, unknown>) =>
  event('content_block_start', { index, content_block: block });
const delta = (index: number, value: Record<string, unknown>) =>
  event('content_block_delta', { index, delta: value });
const stop = (index: number) => event('content_block_stop', { index });
const TEXT = { type: 'text', text: '' };
const THINKING = { type: 'thinking', thinking: '', signature: '' };
const toolUse = (id: string, name: string) => ({
  type: 'tool_use',
  id,
  name,
  input: {},
});
const text = (index: number, value: string) =>
  delta(index, { type: 'text_delta', text: value });
const thought = (index: number, value: string) =>
  delta(index, { type: 'thinking_delta', thinking: value });
const json = (index: number, value: string) =>
  delta(index, { type: 'input_json_delta', partial_json: value });
const signature = (index: number, value: string | undefined) =>
  delta(index, { type: 'signature_delta', signature: value });
const messageDelta = (
  stopReason: string,
  usage: Record<string, number> = {
    input_tokens: 100,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 20,
    output_tokens: 30,
  },
) =>
  event('message_delta', {
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage,
  });

const MESSAGE_START =
  'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_abc123","type":"message","role":"assistant","model":"claude-sonnet-4-5","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":0,"output_tokens":0}}}\n\n';
const MESSAGE_STOP = 'event: message_stop\ndata: {"type":"message_stop"}\n\n';
const PING = 'event: ping\ndata: {"type": "ping"}\n\n';

interface WireEvent {
  type: string;
  index: number;
  content_block: Record<string, unknown>;
  delta: Record<string, string | null>;
  usage: Record<string, number>;
}

/** A streamed message put together the way an Anthropic client does it: by
 * block index, a tool's input parsed when its block stops. */
function messageOf(events: readonly string[]): {
  content: Record<string, unknown>[];
  stopReason: unknown;
  usage: unknown;
} {
  const content: Record<string, unknown>[] = [];
  const inputs: string[] = [];
  let stopReason: unknown;
  let usage: unknown;
  for (const raw of events) {
    const [eventLine = '', dataLine = ''] = raw.split('\n');
    const data = JSON.parse(dataLine.slice('data: '.length)) as WireEvent;
    expect(eventLine).toBe(`event: ${data.type}`);
    expect(raw.endsWith('\n\n')).toBe(true);
    switch (data.type) {
      case 'content_block_start':
        expect(data.index).toBe(content.length);
        content[data.index] = { ...data.content_block };
        inputs[data.index] = '';
        break;
      case 'content_block_delta': {
        const block = content[data.index]!;
        const value = data.delta;
        if (value.type === 'text_delta') {
          block.text = `${String(block.text)}${value.text}`;
        } else if (value.type === 'thinking_delta') {
          block.thinking = `${String(block.thinking)}${value.thinking}`;
        } else if (value.type === 'signature_delta') {
          block.signature = `${String(block.signature)}${value.signature}`;
        } else {
          inputs[data.index] += String(value.partial_json);
        }
        break;
      }
      case 'content_block_stop': {
        const block = content[data.index]!;
        if (block.type === 'tool_use') {
          block.input = JSON.parse(inputs[data.index] || '{}');
        }
        break;
      }
      case 'message_delta':
        stopReason = data.delta.stop_reason;
        usage = data.usage;
        break;
      default:
        break;
    }
  }
  return { content, stopReason, usage };
}

describe('reading an Anthropic request', () => {
  it('reads max_tokens, the system prompt and the messages', () => {
    expect(
      optionsOf(
        request({
          system: 'Be brief.',
          messages: [
            { role: 'user', content: 'Hi' },
            { role: 'assistant', content: 'Hello.' },
            { role: 'user', content: [{ type: 'text', text: 'Bye' }] },
          ],
        }),
      ),
    ).toEqual({
      maxOutputTokens: 1024,
      prompt: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Hello.' }] },
        { role: 'user', content: [{ type: 'text', text: 'Bye' }] },
      ],
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('joins the text blocks of a system prompt, its cache hints left out without a word', () => {
    const [system] = optionsOf(
      request({
        system: [
          {
            type: 'text',
            text: "You are Claude Code, Anthropic's official CLI for Claude.",
            cache_control: { type: 'ephemeral' },
          },
          { type: 'text', text: '' },
          { type: 'text', text: 'Answer briefly.' },
        ],
      }),
    ).prompt;
    expect(system).toEqual({
      role: 'system',
      content:
        "You are Claude Code, Anthropic's official CLI for Claude.\n\nAnswer briefly.",
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['no max_tokens', { max_tokens: undefined }, /max_tokens is required/],
    ['max_tokens 0', { max_tokens: 0 }, /max_tokens is required/],
    ['a fraction of a token', { max_tokens: 1.5 }, /max_tokens is required/],
    ['max_tokens as text', { max_tokens: '1024' }, /max_tokens is required/],
    ['no messages', { messages: undefined }, /messages is required/],
    ['an empty message list', { messages: [] }, /messages is required/],
    ['messages as text', { messages: 'Hi' }, /messages is required/],
    [
      'a message that is no object',
      { messages: ['Hi'] },
      /messages\.0 must be a message/,
    ],
    [
      'a system role among the messages',
      { messages: [{ role: 'system', content: 'Hi' }] },
      /messages\.0\.role must be "user" or "assistant"/,
    ],
    [
      'content that is neither text nor blocks',
      { messages: [{ role: 'user', content: 42 }] },
      /messages\.0\.content must be a string or a list/,
    ],
    [
      'a block without a type',
      { messages: [{ role: 'user', content: [{ text: 'Hi' }] }] },
      /messages\.0\.content\.0 must be a content block/,
    ],
    [
      'a text block without text',
      { messages: [{ role: 'user', content: [{ type: 'text', text: 7 }] }] },
      /messages\.0\.content\.0\.text must be a string/,
    ],
    [
      'an image in the system prompt',
      { system: [{ type: 'image' }] },
      /system\.0 must be a text block/,
    ],
    ['a system prompt of a number', { system: 42 }, /system must be a string/],
    [
      'a temperature as text',
      { temperature: '0.5' },
      /temperature must be a number/,
    ],
    [
      'a stop sequence that is no string',
      { stop_sequences: ['</a>', 1] },
      /stop_sequences must be a list/,
    ],
    [
      'stop sequences that are no list',
      { stop_sequences: '</a>' },
      /stop_sequences must be a list/,
    ],
    [
      'a thinking type it does not know',
      { thinking: { type: 'sometimes' } },
      /thinking\.type must be/,
    ],
    [
      'thinking enabled without a budget',
      { thinking: { type: 'enabled' } },
      /thinking\.budget_tokens/,
    ],
    [
      'an effort it does not know',
      { output_config: { effort: 'extreme' } },
      /output_config\.effort/,
    ],
    [
      'tools that are no list',
      { tools: { name: 'Read' } },
      /tools must be a list/,
    ],
    [
      'a tool without a name',
      { tools: [{ input_schema: {} }] },
      /tools\.0\.name must be a string/,
    ],
    [
      'an input schema that is no object',
      { tools: [{ name: 'x', input_schema: [] }] },
      /tools\.0\.input_schema must be a JSON Schema object/,
    ],
    [
      'a tool choice it does not know',
      { tool_choice: { type: 'maybe' } },
      /tool_choice\.type must be/,
    ],
  ])('refuses %s, as the Anthropic API does', (_case, fields, message) => {
    expectRefusal(request(fields), message);
  });

  it('reads images as file parts: base64 data with its media type, a URL as an image', () => {
    const [user] = optionsOf(
      request({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What is in these?' },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: 'iVBORw0KGgo=',
                },
                cache_control: { type: 'ephemeral' },
              },
              {
                type: 'image',
                source: { type: 'url', url: 'https://example.com/cat.jpg' },
              },
            ],
          },
        ],
      }),
    ).prompt;
    expect(user).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'What is in these?' },
        {
          type: 'file',
          mediaType: 'image/png',
          data: { type: 'data', data: 'iVBORw0KGgo=' },
        },
        {
          type: 'file',
          mediaType: 'image',
          data: { type: 'url', url: expect.any(URL) },
        },
      ],
    });
    expect(hrefOf(user, 2)).toBe('https://example.com/cat.jpg');
  });

  it('reads documents: a PDF as a file, plain text and a content source as their blocks', () => {
    const [user] = optionsOf(
      request({
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: 'JVBERi0=',
                },
                title: 'Report',
              },
              {
                type: 'document',
                source: {
                  type: 'text',
                  media_type: 'text/plain',
                  data: 'Plain notes.',
                },
              },
              {
                type: 'document',
                source: { type: 'url', url: 'https://example.com/report.pdf' },
              },
              {
                type: 'document',
                source: {
                  type: 'content',
                  content: [
                    { type: 'text', text: 'Part one.' },
                    {
                      type: 'image',
                      source: {
                        type: 'base64',
                        media_type: 'image/jpeg',
                        data: '/9j/',
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    ).prompt;
    expect(user).toEqual({
      role: 'user',
      content: [
        {
          type: 'file',
          mediaType: 'application/pdf',
          data: { type: 'data', data: 'JVBERi0=' },
        },
        { type: 'text', text: 'Plain notes.' },
        {
          type: 'file',
          mediaType: 'application/pdf',
          data: { type: 'url', url: expect.any(URL) },
        },
        { type: 'text', text: 'Part one.' },
        {
          type: 'file',
          mediaType: 'image/jpeg',
          data: { type: 'data', data: '/9j/' },
        },
      ],
    });
    expect(hrefOf(user, 2)).toBe('https://example.com/report.pdf');
    expect(warn).not.toHaveBeenCalled();
  });

  it('reads a base64 document without a media type as the PDF Anthropic takes it for', () => {
    const [user] = optionsOf(
      request({
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: { type: 'base64', data: 'JVBERi0=' },
              },
            ],
          },
        ],
      }),
    ).prompt;
    expect(user).toEqual({
      role: 'user',
      content: [
        {
          type: 'file',
          mediaType: 'application/pdf',
          data: { type: 'data', data: 'JVBERi0=' },
        },
      ],
    });
  });

  it('names the citations a document asked for in its warning: only Anthropic gives them', () => {
    optionsOf(
      request({
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: { type: 'text', media_type: 'text/plain', data: 'x' },
                citations: { enabled: true },
              },
            ],
          },
        ],
      }),
    );
    expect(warning()).toContain('document citations');
  });

  it('reads a search result as the text it carries', () => {
    const [user] = optionsOf(
      request({
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'search_result',
                source: 'https://docs.example.com/install',
                title: 'Install guide',
                content: [{ type: 'text', text: 'Run the installer.' }],
              },
            ],
          },
        ],
      }),
    ).prompt;
    expect(user).toEqual({
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Install guide (https://docs.example.com/install)\n\nRun the installer.',
        },
      ],
    });
  });

  it.each([
    [
      'an image',
      {
        type: 'image',
        source: { type: 'file', file_id: 'file_011CNha8iCJcU1wXNR6q4V8w' },
      },
    ],
    [
      'a document',
      {
        type: 'document',
        source: { type: 'file', file_id: 'file_011CNha8iCJcU1wXNR6q4V8w' },
      },
    ],
  ])(
    'refuses %s uploaded to Anthropic, which no other provider can read',
    (_kind, block) => {
      expectRefusal(
        request({ messages: [{ role: 'user', content: [block] }] }),
        /messages\.0\.content\.0: a file uploaded to Anthropic \(file_id\)/,
      );
    },
  );

  it('refuses a URL that is none, and a source it does not know', () => {
    expectRefusal(
      request({
        messages: [
          {
            role: 'user',
            content: [{ type: 'image', source: { type: 'url', url: 'cat' } }],
          },
        ],
      }),
      /messages\.0\.content\.0\.source\.url must be a URL/,
    );
    expectRefusal(
      request({
        messages: [
          {
            role: 'user',
            content: [{ type: 'image', source: { type: 's3', key: 'cat' } }],
          },
        ],
      }),
      /source\.type "s3" is not a source the relay can read/,
    );
  });

  it('refuses a block it does not know, rather than lose what it says', () => {
    expectRefusal(
      request({
        messages: [
          { role: 'user', content: [{ type: 'audio', data: 'UklGRg==' }] },
        ],
      }),
      /messages\.0\.content\.0: the relay cannot carry a block of type "audio"/,
    );
    expectRefusal(
      request({
        messages: [
          { role: 'user', content: 'Hi' },
          {
            role: 'assistant',
            content: [{ type: 'image', source: { type: 'url', url: 'x' } }],
          },
        ],
      }),
      /messages\.1\.content\.0: an assistant message cannot carry a block of type "image"/,
    );
    expectRefusal(
      request({
        messages: [
          {
            role: 'user',
            content: [{ type: 'tool_use', id: 'x', name: 'y', input: {} }],
          },
        ],
      }),
      /a block of type "tool_use" belongs in an assistant message/,
    );
  });

  it("reads an assistant turn's text, its thinking without the signature, and its tool calls", () => {
    expect(
      optionsOf(
        request({
          messages: [
            { role: 'user', content: 'Weather in Paris?' },
            {
              role: 'assistant',
              content: [
                {
                  type: 'thinking',
                  thinking: 'I need the weather tool.',
                  signature: 'EqQBCkgIBBABGAIiQL2x',
                },
                { type: 'text', text: 'Checking.' },
                {
                  type: 'tool_use',
                  id: 'toolu_01',
                  name: 'get_weather',
                  input: { city: 'Paris' },
                },
              ],
            },
            {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'toolu_01',
                  content: '18°C',
                },
              ],
            },
          ],
        }),
      ).prompt,
    ).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Weather in Paris?' }] },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'I need the weather tool.' },
          { type: 'text', text: 'Checking.' },
          {
            type: 'tool-call',
            toolCallId: 'toolu_01',
            toolName: 'get_weather',
            input: { city: 'Paris' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'toolu_01',
            toolName: 'get_weather',
            output: { type: 'text', value: '18°C' },
          },
        ],
      },
    ]);
  });

  it('leaves redacted thinking and server tool blocks out, named in one warning', () => {
    expect(
      optionsOf(
        request({
          messages: [
            { role: 'user', content: 'Any news?' },
            {
              role: 'assistant',
              content: [
                { type: 'redacted_thinking', data: 'EmwKAhgBEgy3va3pzix' },
                {
                  type: 'server_tool_use',
                  id: 'srvtoolu_01',
                  name: 'web_search',
                  input: { query: 'news' },
                },
                {
                  type: 'web_search_tool_result',
                  tool_use_id: 'srvtoolu_01',
                  content: [],
                },
                { type: 'text', text: 'Here is the news.' },
              ],
            },
            { role: 'user', content: 'Thanks.' },
          ],
        }),
      ).prompt,
    ).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Any news?' }] },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Here is the news.' }],
      },
      { role: 'user', content: [{ type: 'text', text: 'Thanks.' }] },
    ]);
    expect(warning()).toBe(
      '[llm-relay] an Anthropic request left out what the other wire has no place for: redacted_thinking blocks, server_tool_use blocks, web_search_tool_result blocks',
    );
  });

  it("puts a user turn's tool results first, as a tool message naming each call's tool", () => {
    const { prompt } = optionsOf(
      request({
        messages: [
          { role: 'user', content: 'Read a, then run the tests.' },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'call_a',
                name: 'Read',
                input: { file_path: '/a' },
              },
              {
                type: 'tool_use',
                id: 'call_b',
                name: 'Bash',
                input: { command: 'bun test' },
              },
              { type: 'tool_use', id: 'call_c', name: 'TodoWrite', input: {} },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'call_a',
                content: [
                  { type: 'text', text: 'line 1' },
                  { type: 'text', text: 'line 2' },
                ],
              },
              {
                type: 'tool_result',
                tool_use_id: 'call_b',
                content: 'exit code 1',
                is_error: true,
              },
              { type: 'tool_result', tool_use_id: 'call_c' },
              { type: 'text', text: 'Why did it fail?' },
            ],
          },
        ],
      }),
    );
    expect(prompt.slice(2)).toEqual([
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_a',
            toolName: 'Read',
            output: { type: 'text', value: 'line 1\n\nline 2' },
          },
          {
            type: 'tool-result',
            toolCallId: 'call_b',
            toolName: 'Bash',
            output: { type: 'error-text', value: 'exit code 1' },
          },
          {
            type: 'tool-result',
            toolCallId: 'call_c',
            toolName: 'TodoWrite',
            output: { type: 'text', value: '' },
          },
        ],
      },
      { role: 'user', content: [{ type: 'text', text: 'Why did it fail?' }] },
    ]);
  });

  it("gives a tool result with images or documents as the SDK's content, its text and files in order", () => {
    const { prompt } = optionsOf(
      request({
        messages: [
          { role: 'user', content: 'Look at the page.' },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'call_shot',
                name: 'Screenshot',
                input: {},
              },
              {
                type: 'tool_use',
                id: 'call_pdf',
                name: 'Read',
                input: { file_path: '/r.pdf' },
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'call_shot',
                content: [
                  {
                    type: 'image',
                    source: {
                      type: 'base64',
                      media_type: 'image/png',
                      data: 'iVBORw0KGgo=',
                    },
                  },
                ],
              },
              {
                type: 'tool_result',
                tool_use_id: 'call_pdf',
                // Content has no error flag: what failed is in its text.
                is_error: true,
                content: [
                  { type: 'text', text: 'Page 2 is missing.' },
                  {
                    type: 'document',
                    source: {
                      type: 'base64',
                      media_type: 'application/pdf',
                      data: 'JVBERi0=',
                    },
                  },
                ],
              },
              { type: 'text', text: 'What do they show?' },
            ],
          },
        ],
      }),
    );
    expect(prompt.slice(2)).toEqual([
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_shot',
            toolName: 'Screenshot',
            output: {
              type: 'content',
              value: [
                {
                  type: 'file',
                  mediaType: 'image/png',
                  data: { type: 'data', data: 'iVBORw0KGgo=' },
                },
              ],
            },
          },
          {
            type: 'tool-result',
            toolCallId: 'call_pdf',
            toolName: 'Read',
            output: {
              type: 'content',
              value: [
                { type: 'text', text: 'Page 2 is missing.' },
                {
                  type: 'file',
                  mediaType: 'application/pdf',
                  data: { type: 'data', data: 'JVBERi0=' },
                },
              ],
            },
          },
        ],
      },
      { role: 'user', content: [{ type: 'text', text: 'What do they show?' }] },
    ]);
  });

  it('leaves out the tool references of a tool search: every tool is given anyway', () => {
    const { prompt } = optionsOf(
      request({
        messages: [
          { role: 'user', content: 'Find a tool.' },
          {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'call_s', name: 'ToolSearch', input: {} },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'call_s',
                content: [{ type: 'tool_reference', tool_name: 'Read' }],
              },
            ],
          },
        ],
      }),
    );
    expect(prompt[2]).toEqual({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call_s',
          toolName: 'ToolSearch',
          output: { type: 'text', value: '' },
        },
      ],
    });
    expect(warning()).toContain('tool_reference blocks');
  });

  it('refuses a tool result that answers no earlier tool call', () => {
    expectRefusal(
      request({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'toolu_x', content: 'ok' },
            ],
          },
        ],
      }),
      /messages\.0\.content\.0\.tool_use_id "toolu_x" answers no tool_use/,
    );
  });
});

describe('reading the tools and the settings of a request', () => {
  it("gives the model the client's own tools as function tools", () => {
    expect(
      optionsOf(
        request({
          tools: [
            {
              name: 'get_weather',
              description: 'The weather in a city.',
              input_schema: {
                type: 'object',
                properties: { city: { type: 'string' } },
                required: ['city'],
              },
              cache_control: { type: 'ephemeral' },
              strict: true,
              input_examples: [{ city: 'Paris' }],
            },
            { type: 'custom', name: 'now', input_schema: { type: 'object' } },
            { name: 'ping' },
            { name: 'noop', input_schema: {} },
          ],
        }),
      ).tools,
    ).toEqual([
      {
        type: 'function',
        name: 'get_weather',
        description: 'The weather in a city.',
        inputSchema: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
        strict: true,
        inputExamples: [{ input: { city: 'Paris' } }],
      },
      {
        type: 'function',
        name: 'now',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        type: 'function',
        name: 'ping',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        type: 'function',
        name: 'noop',
        inputSchema: { type: 'object', properties: {} },
      },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("leaves Anthropic's server tools out, named in the warning", () => {
    const options = optionsOf(
      request({
        tools: [
          { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
          { type: 'bash_20250124', name: 'bash' },
          { type: 'text_editor_20250728', name: 'str_replace_based_edit_tool' },
          {
            type: 'computer_20250124',
            name: 'computer',
            display_width_px: 1024,
            display_height_px: 768,
          },
          READ_TOOL,
        ],
      }),
    );
    expect(options.tools?.map((tool) => tool.name)).toEqual(['Read']);
    expect(warning()).toContain(
      'the web_search_20250305 tool, the bash_20250124 tool, the text_editor_20250728 tool, the computer_20250124 tool',
    );
  });

  it.each([
    [{ type: 'auto' }, { type: 'auto' }],
    [{ type: 'any' }, { type: 'required' }],
    [
      { type: 'tool', name: 'Read' },
      { type: 'tool', toolName: 'Read' },
    ],
    [{ type: 'none' }, { type: 'none' }],
  ])('reads the tool choice %j as %j', (choice, expected) => {
    expect(
      optionsOf(request({ tools: [READ_TOOL], tool_choice: choice }))
        .toolChoice,
    ).toEqual(expected);
  });

  it('names disable_parallel_tool_use in its warning: the SDK has no such switch', () => {
    optionsOf(
      request({
        tools: [READ_TOOL],
        tool_choice: { type: 'auto', disable_parallel_tool_use: true },
      }),
    );
    expect(warning()).toContain('disable_parallel_tool_use');
  });

  it('refuses a tool choice the model cannot honour without the tools left out', () => {
    const webSearch = { type: 'web_search_20250305', name: 'web_search' };
    expectRefusal(
      request({
        tools: [webSearch, READ_TOOL],
        tool_choice: { type: 'tool', name: 'web_search' },
      }),
      /tool_choice names the tool web_search/,
    );
    expectRefusal(
      request({ tools: [webSearch], tool_choice: { type: 'any' } }),
      /tool_choice asks for a tool call, but the request has no tool/,
    );
    expect(
      optionsOf(request({ tools: [webSearch], tool_choice: { type: 'auto' } })),
    ).not.toHaveProperty('toolChoice');
  });

  it('reads temperature, top_p, top_k and stop sequences; null as unset', () => {
    expect(
      optionsOf(
        request({
          temperature: 0.2,
          top_p: 0.9,
          top_k: 40,
          stop_sequences: ['</answer>'],
        }),
      ),
    ).toMatchObject({
      temperature: 0.2,
      topP: 0.9,
      topK: 40,
      stopSequences: ['</answer>'],
    });
    const unset = optionsOf(
      request({ temperature: null, top_k: null, stop_sequences: [] }),
    );
    expect(unset).not.toHaveProperty('temperature');
    expect(unset).not.toHaveProperty('topK');
    expect(unset).not.toHaveProperty('stopSequences');
  });

  it.each([
    [1024, 'low'],
    [2048, 'low'],
    [2049, 'medium'],
    [8192, 'medium'],
    [8193, 'high'],
    [31_999, 'high'],
  ])('reads a thinking budget of %i tokens as %s effort', (budget, effort) => {
    expect(
      optionsOf(
        request({ thinking: { type: 'enabled', budget_tokens: budget } }),
      ).reasoning,
    ).toBe(effort);
  });

  it('reads thinking turned off as none, and leaves adaptive thinking to the model', () => {
    expect(
      optionsOf(request({ thinking: { type: 'disabled' } })).reasoning,
    ).toBe('none');
    expect(
      optionsOf(request({ thinking: { type: 'adaptive' } })),
    ).not.toHaveProperty('reasoning');
    expect(optionsOf(request())).not.toHaveProperty('reasoning');
  });

  it.each(['low', 'medium', 'high', 'max'])(
    'takes the effort %s as named, over a thinking budget',
    (effort) => {
      expect(
        optionsOf(
          request({
            thinking: { type: 'enabled', budget_tokens: 1024 },
            output_config: { effort },
          }),
        ).reasoning,
      ).toBe(effort);
    },
  );

  it('keeps thinking off whatever effort the request names', () => {
    expect(
      optionsOf(
        request({
          thinking: { type: 'disabled' },
          output_config: { effort: 'high' },
        }),
      ).reasoning,
    ).toBe('none');
  });

  it('reads a structured output as a JSON response format with its schema', () => {
    const schema = {
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
    };
    expect(
      optionsOf(
        request({ output_config: { format: { type: 'json_schema', schema } } }),
      ).responseFormat,
    ).toEqual({ type: 'json', schema });
    expect(
      optionsOf(request({ output_format: { type: 'json_schema', schema } }))
        .responseFormat,
    ).toEqual({ type: 'json', schema });
    expectRefusal(
      request({ output_config: { format: { type: 'xml' } } }),
      /output_config\.format must be/,
    );
  });

  it('ignores metadata, service_tier and container, and names mcp_servers and context_management', () => {
    optionsOf(
      request({
        metadata: { user_id: 'user-1' },
        service_tier: 'auto',
        container: 'container_011CPR5CNjB747bTd36fQLFk',
      }),
    );
    expect(warn).not.toHaveBeenCalled();
    optionsOf(
      request({
        mcp_servers: [
          { type: 'url', url: 'https://mcp.example.com/sse', name: 'docs' },
        ],
        context_management: { edits: [{ type: 'clear_tool_uses_20250919' }] },
      }),
    );
    expect(warning()).toContain('mcp_servers, context_management');
  });
});

describe('writing a streamed answer', () => {
  it("streams text in Anthropic's own events, its usage at the end", async () => {
    expect(
      await eventsOf([
        { type: 'stream-start', warnings: [] },
        { type: 'response-metadata', id: 'chatcmpl-1', modelId: 'qwen3-coder' },
        { type: 'text-start', id: 'txt-0' },
        { type: 'text-delta', id: 'txt-0', delta: 'Hello' },
        { type: 'text-delta', id: 'txt-0', delta: ', world' },
        { type: 'text-end', id: 'txt-0' },
        finish('stop'),
      ]),
    ).toEqual([
      MESSAGE_START,
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":", world"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"input_tokens":100,"cache_creation_input_tokens":0,"cache_read_input_tokens":20,"output_tokens":30}}\n\n',
      MESSAGE_STOP,
    ]);
  });

  it('streams reasoning as a thinking block with an empty signature, and no signature_delta', async () => {
    const events = await eventsOf([
      { type: 'reasoning-start', id: 'reasoning-0' },
      { type: 'reasoning-delta', id: 'reasoning-0', delta: 'The user ' },
      { type: 'reasoning-delta', id: 'reasoning-0', delta: 'greets.' },
      { type: 'reasoning-end', id: 'reasoning-0' },
      { type: 'text-start', id: 'txt-0' },
      { type: 'text-delta', id: 'txt-0', delta: 'Hi!' },
      { type: 'text-end', id: 'txt-0' },
      finish('stop'),
    ]);
    expect(events).toEqual([
      MESSAGE_START,
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"The user "}}\n\n',
      thought(0, 'greets.'),
      stop(0),
      start(1, TEXT),
      text(1, 'Hi!'),
      stop(1),
      messageDelta('end_turn'),
      MESSAGE_STOP,
    ]);
    expect(events.join('')).not.toContain('signature_delta');
  });

  it('writes each tool call whole once its tool-call part comes, in the order the calls began', async () => {
    expect(
      await eventsOf([
        { type: 'text-start', id: 'txt-0' },
        { type: 'text-delta', id: 'txt-0', delta: 'Reading both.' },
        { type: 'tool-input-start', id: 'call_a', toolName: 'Read' },
        { type: 'tool-input-delta', id: 'call_a', delta: '{"file_path":' },
        { type: 'tool-input-delta', id: 'call_a', delta: '"/a.txt"}' },
        { type: 'tool-input-start', id: 'call_b', toolName: 'Read' },
        {
          type: 'tool-input-delta',
          id: 'call_b',
          delta: '{"file_path":"/b.txt"}',
        },
        // The SDK ends the text and the calls when the upstream's stream ends.
        { type: 'text-end', id: 'txt-0' },
        { type: 'tool-input-end', id: 'call_a' },
        {
          type: 'tool-call',
          toolCallId: 'call_a',
          toolName: 'Read',
          input: '{"file_path":"/a.txt"}',
        },
        { type: 'tool-input-end', id: 'call_b' },
        {
          type: 'tool-call',
          toolCallId: 'call_b',
          toolName: 'Read',
          input: '{"file_path":"/b.txt"}',
        },
        finish('tool-calls'),
      ]),
    ).toEqual([
      MESSAGE_START,
      start(0, TEXT),
      text(0, 'Reading both.'),
      stop(0),
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call_a","name":"Read","input":{}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"file_path\\":\\"/a.txt\\"}"}}\n\n',
      stop(1),
      start(2, toolUse('call_b', 'Read')),
      json(2, '{"file_path":"/b.txt"}'),
      stop(2),
      messageDelta('tool_use'),
      MESSAGE_STOP,
    ]);
  });

  it('writes a tool call the SDK gives only whole as a start, one delta with all its input, and a stop', async () => {
    expect(
      await eventsOf([
        {
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName: 'Glob',
          input: '{"pattern":"*.ts"}',
        },
        { type: 'tool-call', toolCallId: 'call_2', toolName: 'LS', input: '' },
        finish('tool-calls'),
      ]),
    ).toEqual([
      MESSAGE_START,
      start(0, toolUse('call_1', 'Glob')),
      json(0, '{"pattern":"*.ts"}'),
      stop(0),
      start(1, toolUse('call_2', 'LS')),
      json(1, '{}'),
      stop(1),
      messageDelta('tool_use'),
      MESSAGE_STOP,
    ]);
  });

  it('gives a call streamed without input the input its tool-call part carries', async () => {
    expect(
      await eventsOf([
        { type: 'tool-input-start', id: 'call_1', toolName: 'Clock' },
        { type: 'tool-input-end', id: 'call_1' },
        {
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName: 'Clock',
          input: '{"tz":"UTC"}',
        },
        finish('tool-calls'),
      ]),
    ).toEqual([
      MESSAGE_START,
      start(0, toolUse('call_1', 'Clock')),
      json(0, '{"tz":"UTC"}'),
      stop(0),
      messageDelta('tool_use'),
      MESSAGE_STOP,
    ]);
  });

  it('keeps interleaved calls apart: each is written whole, in the order the calls began', async () => {
    expect(
      await eventsOf([
        { type: 'tool-input-start', id: 'call_a', toolName: 'Read' },
        { type: 'tool-input-delta', id: 'call_a', delta: '{"file_path":' },
        { type: 'tool-input-start', id: 'call_b', toolName: 'Glob' },
        {
          type: 'tool-input-delta',
          id: 'call_b',
          delta: '{"pattern":"*.ts"}',
        },
        { type: 'tool-input-delta', id: 'call_a', delta: '"/a.txt"}' },
        { type: 'tool-input-end', id: 'call_a' },
        {
          type: 'tool-call',
          toolCallId: 'call_a',
          toolName: 'Read',
          input: '{"file_path":"/a.txt"}',
        },
        { type: 'tool-input-end', id: 'call_b' },
        {
          type: 'tool-call',
          toolCallId: 'call_b',
          toolName: 'Glob',
          input: '{"pattern":"*.ts"}',
        },
        finish('tool-calls'),
      ]),
    ).toEqual([
      MESSAGE_START,
      start(0, toolUse('call_a', 'Read')),
      json(0, '{"file_path":"/a.txt"}'),
      stop(0),
      start(1, toolUse('call_b', 'Glob')),
      json(1, '{"pattern":"*.ts"}'),
      stop(1),
      messageDelta('tool_use'),
      MESSAGE_STOP,
    ]);
  });

  it('pings a client that heard nothing for 10 seconds while a call is held, and only then', async () => {
    let now = 0;
    const restore = setKeepAliveClockForTests(() => now);
    try {
      // Each part with the time it comes at, in milliseconds.
      const steps: Array<[number, LanguageModelV4StreamPart]> = [
        // Nothing is held yet: a silence is none of the relay's doing.
        [2_000, { type: 'response-metadata', id: 'chatcmpl-1' }],
        [4_000, { type: 'tool-input-start', id: 'call_a', toolName: 'Write' }],
        [9_000, { type: 'tool-input-delta', id: 'call_a', delta: '{"text":' }],
        // 11 s since message_start.
        [11_000, { type: 'tool-input-delta', id: 'call_a', delta: '"a' }],
        // 9 s since the ping.
        [20_000, { type: 'tool-input-delta', id: 'call_a', delta: 'b' }],
        // 10 s since the ping.
        [21_000, { type: 'tool-input-delta', id: 'call_a', delta: 'c"}' }],
        [22_000, { type: 'tool-input-end', id: 'call_a' }],
        [
          23_000,
          {
            type: 'tool-call',
            toolCallId: 'call_a',
            toolName: 'Write',
            input: '{"text":"abc"}',
          },
        ],
        // The call is written: nothing is held any more.
        [60_000, { type: 'response-metadata', modelId: 'qwen3-coder' }],
        [61_000, finish('tool-calls')],
      ];
      async function* timed(): AsyncIterable<LanguageModelV4StreamPart> {
        for (const [at, part] of steps) {
          now = at;
          yield part;
        }
      }
      const events: string[] = [];
      for await (const written of anthropicAdapter.encodeStream(
        timed(),
        context,
      )) {
        events.push(written);
      }
      expect(events).toEqual([
        MESSAGE_START,
        PING,
        PING,
        start(0, toolUse('call_a', 'Write')),
        json(0, '{"text":"abc"}'),
        stop(0),
        messageDelta('tool_use'),
        MESSAGE_STOP,
      ]);
    } finally {
      restore();
    }
  });

  it('writes text that came while a call was held after the call', async () => {
    expect(
      await eventsOf([
        { type: 'tool-input-start', id: 'call_a', toolName: 'Write' },
        { type: 'tool-input-delta', id: 'call_a', delta: '{"content":' },
        { type: 'text-start', id: 'txt-0' },
        { type: 'text-delta', id: 'txt-0', delta: 'Writing.' },
        { type: 'tool-input-delta', id: 'call_a', delta: '"x"}' },
        { type: 'text-end', id: 'txt-0' },
        { type: 'tool-input-end', id: 'call_a' },
        {
          type: 'tool-call',
          toolCallId: 'call_a',
          toolName: 'Write',
          input: '{"content":"x"}',
        },
        finish('tool-calls'),
      ]),
    ).toEqual([
      MESSAGE_START,
      start(0, toolUse('call_a', 'Write')),
      json(0, '{"content":"x"}'),
      stop(0),
      start(1, TEXT),
      text(1, 'Writing.'),
      stop(1),
      messageDelta('tool_use'),
      MESSAGE_STOP,
    ]);
  });

  it('writes what was held back when the answer ran out of tokens inside a call', async () => {
    expect(
      await eventsOf([
        { type: 'tool-input-start', id: 'call_a', toolName: 'Write' },
        { type: 'tool-input-delta', id: 'call_a', delta: '{"content":"abc' },
        { type: 'text-delta', id: 'txt-0', delta: 'x' },
        finish('length'),
      ]),
    ).toEqual([
      MESSAGE_START,
      start(0, toolUse('call_a', 'Write')),
      json(0, '{"content":"abc'),
      stop(0),
      start(1, TEXT),
      text(1, 'x'),
      stop(1),
      messageDelta('max_tokens'),
      MESSAGE_STOP,
    ]);
  });

  it('opens a new block for an id the SDK uses again after its end', async () => {
    expect(
      await eventsOf([
        { type: 'reasoning-start', id: 'reasoning-0' },
        { type: 'reasoning-delta', id: 'reasoning-0', delta: 'First.' },
        { type: 'reasoning-end', id: 'reasoning-0' },
        { type: 'text-start', id: 'txt-0' },
        { type: 'text-delta', id: 'txt-0', delta: 'One.' },
        { type: 'text-end', id: 'txt-0' },
        { type: 'reasoning-start', id: 'reasoning-0' },
        { type: 'reasoning-delta', id: 'reasoning-0', delta: 'Second.' },
        { type: 'reasoning-end', id: 'reasoning-0' },
        { type: 'text-start', id: 'txt-0' },
        { type: 'text-delta', id: 'txt-0', delta: '' },
        { type: 'text-delta', id: 'txt-0', delta: 'Two.' },
        { type: 'text-end', id: 'txt-0' },
        { type: 'text-start', id: 'txt-1' },
        { type: 'text-end', id: 'txt-1' },
        finish('stop'),
      ]),
    ).toEqual([
      MESSAGE_START,
      start(0, THINKING),
      thought(0, 'First.'),
      stop(0),
      start(1, TEXT),
      text(1, 'One.'),
      stop(1),
      start(2, THINKING),
      thought(2, 'Second.'),
      stop(2),
      start(3, TEXT),
      text(3, 'Two.'),
      stop(3),
      messageDelta('end_turn'),
      MESSAGE_STOP,
    ]);
  });

  it('reports input without the cache, cache writes and reads, and all output', async () => {
    const events = await eventsOf([
      { type: 'text-delta', id: 'txt-0', delta: 'Hi' },
      finish('stop', {
        inputTokens: {
          total: 150,
          noCache: undefined,
          cacheRead: 20,
          cacheWrite: 30,
        },
        outputTokens: { total: undefined, text: 25, reasoning: 15 },
      }),
    ]);
    expect(messageOf(events).usage).toEqual({
      input_tokens: 100,
      cache_creation_input_tokens: 30,
      cache_read_input_tokens: 20,
      output_tokens: 40,
    });
  });

  it.each([
    ['stop', false, 'end_turn'],
    ['stop', true, 'tool_use'],
    ['tool-calls', true, 'tool_use'],
    ['length', false, 'max_tokens'],
    ['length', true, 'max_tokens'],
    ['content-filter', false, 'refusal'],
    ['other', false, 'end_turn'],
  ] as const)(
    'says a %s finish (a tool called: %s) stopped for %s',
    async (unified, called, stopReason) => {
      const events = await eventsOf([
        called
          ? { type: 'tool-call', toolCallId: 'c', toolName: 'LS', input: '{}' }
          : { type: 'text-delta', id: 'txt-0', delta: 'Done.' },
        finish(unified),
      ]);
      expect(messageOf(events).stopReason).toBe(stopReason);
    },
  );

  it('passes pings on, and leaves out what no Anthropic block can hold', async () => {
    const events = await eventsOf([
      { type: 'ping' },
      { type: 'raw', rawValue: { id: 'chunk' } },
      {
        type: 'source',
        sourceType: 'url',
        id: 'src-1',
        url: 'https://example.com',
      },
      {
        type: 'tool-input-start',
        id: 'srv_1',
        toolName: 'web_search',
        providerExecuted: true,
      },
      { type: 'tool-input-delta', id: 'srv_1', delta: '{"query":"x"}' },
      { type: 'tool-input-end', id: 'srv_1' },
      {
        type: 'tool-call',
        toolCallId: 'srv_1',
        toolName: 'web_search',
        input: '{"query":"x"}',
        providerExecuted: true,
      },
      {
        type: 'file',
        mediaType: 'image/png',
        data: { type: 'data', data: 'iVBORw0KGgo=' },
      },
      { type: 'text-delta', id: 'txt-0', delta: 'Done.' },
      finish('stop'),
    ]);
    expect(events).toEqual([
      MESSAGE_START,
      PING,
      start(0, TEXT),
      text(0, 'Done.'),
      stop(0),
      messageDelta('end_turn'),
      MESSAGE_STOP,
    ]);
    expect(warning()).toContain('a file the model made');
  });

  it('throws when the stream breaks, so the relay ends it with an error event', async () => {
    await expect(
      eventsOf([
        { type: 'text-delta', id: 'txt-0', delta: 'Hal' },
        { type: 'error', error: new Error('upstream reset') },
      ]),
    ).rejects.toThrow('upstream reset');
    await expect(
      eventsOf([{ type: 'text-delta', id: 'txt-0', delta: 'Hal' }]),
    ).rejects.toThrow(/ended before its answer did/);
  });
});

describe('writing a whole answer', () => {
  const answer: LanguageModelV4GenerateResult = {
    content: [
      { type: 'reasoning', text: 'The user wants the weather.' },
      { type: 'text', text: 'Checking.' },
      {
        type: 'tool-call',
        toolCallId: 'call_1',
        toolName: 'get_weather',
        input: '{"city":"Paris"}',
      },
    ],
    finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
    usage: USAGE,
    warnings: [],
  };

  it("writes Anthropic's message: thinking, text and tool_use blocks, the stop reason and the usage", () => {
    expect(anthropicAdapter.encodeAnswer(answer, context)).toEqual({
      id: 'msg_abc123',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-5',
      content: [
        {
          type: 'thinking',
          thinking: 'The user wants the weather.',
          signature: '',
        },
        { type: 'text', text: 'Checking.' },
        {
          type: 'tool_use',
          id: 'call_1',
          name: 'get_weather',
          input: { city: 'Paris' },
        },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: {
        input_tokens: 100,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 20,
        output_tokens: 30,
      },
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('answers a tool input that is no JSON object as {}, and says so', () => {
    const encoded = anthropicAdapter.encodeAnswer(
      {
        ...answer,
        content: [
          { type: 'tool-call', toolCallId: 'a', toolName: 'LS', input: '' },
          {
            type: 'tool-call',
            toolCallId: 'b',
            toolName: 'LS',
            input: '{"x":',
          },
        ],
      },
      context,
    );
    expect(encoded.content).toEqual([
      { type: 'tool_use', id: 'a', name: 'LS', input: {} },
      { type: 'tool_use', id: 'b', name: 'LS', input: {} },
    ]);
    expect(warning()).toMatch(/a tool call input is not JSON/);
  });

  it('says max_tokens for an answer that ran out of tokens', () => {
    expect(
      anthropicAdapter.encodeAnswer(
        {
          ...answer,
          content: [{ type: 'text', text: 'The answer is' }],
          finishReason: { unified: 'length', raw: 'length' },
        },
        context,
      ),
    ).toMatchObject({
      content: [{ type: 'text', text: 'The answer is' }],
      stop_reason: 'max_tokens',
    });
  });
});

describe('a Claude Code tool loop with thinking', () => {
  const followUp = (assistant: unknown) =>
    optionsOf({
      model: 'claude-opus-4-1',
      max_tokens: 32_000,
      stream: true,
      system: [
        {
          type: 'text',
          text: "You are Claude Code, Anthropic's official CLI for Claude.",
          cache_control: { type: 'ephemeral' },
        },
        { type: 'text', text: 'Answer briefly.' },
      ],
      thinking: { type: 'enabled', budget_tokens: 31_999 },
      tools: [READ_TOOL],
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'What is in a.txt?' }],
        },
        { role: 'assistant', content: assistant },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call_1',
              content: [{ type: 'text', text: 'hello' }],
              cache_control: { type: 'ephemeral' },
            },
          ],
        },
      ],
    });

  const expectedPrompt = [
    {
      role: 'system',
      content:
        "You are Claude Code, Anthropic's official CLI for Claude.\n\nAnswer briefly.",
    },
    { role: 'user', content: [{ type: 'text', text: 'What is in a.txt?' }] },
    {
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'I should read the file.' },
        { type: 'text', text: 'Let me read it.' },
        {
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName: 'Read',
          input: { file_path: '/repo/a.txt' },
        },
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call_1',
          toolName: 'Read',
          output: { type: 'text', value: 'hello' },
        },
      ],
    },
  ];

  it('reads back the thinking, tool_use and tool_result blocks of a streamed turn', async () => {
    const turn = messageOf(
      await eventsOf([
        { type: 'reasoning-start', id: 'reasoning-0' },
        {
          type: 'reasoning-delta',
          id: 'reasoning-0',
          delta: 'I should read the file.',
        },
        { type: 'reasoning-end', id: 'reasoning-0' },
        { type: 'text-start', id: 'txt-0' },
        { type: 'text-delta', id: 'txt-0', delta: 'Let me read it.' },
        { type: 'tool-input-start', id: 'call_1', toolName: 'Read' },
        {
          type: 'tool-input-delta',
          id: 'call_1',
          delta: '{"file_path":"/repo/a.txt"}',
        },
        { type: 'text-end', id: 'txt-0' },
        { type: 'tool-input-end', id: 'call_1' },
        {
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName: 'Read',
          input: '{"file_path":"/repo/a.txt"}',
        },
        finish('tool-calls'),
      ]),
    );
    expect(turn.stopReason).toBe('tool_use');
    expect(turn.content).toEqual([
      { type: 'thinking', thinking: 'I should read the file.', signature: '' },
      { type: 'text', text: 'Let me read it.' },
      {
        type: 'tool_use',
        id: 'call_1',
        name: 'Read',
        input: { file_path: '/repo/a.txt' },
      },
    ]);

    const options = followUp(turn.content);
    expect(options.prompt).toEqual(expectedPrompt);
    expect(options.reasoning).toBe('high');
    expect(options.maxOutputTokens).toBe(32_000);
    expect(options.tools?.map((tool) => tool.name)).toEqual(['Read']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('reads back a whole answer the same way', () => {
    const turn = anthropicAdapter.encodeAnswer(
      {
        content: [
          { type: 'reasoning', text: 'I should read the file.' },
          { type: 'text', text: 'Let me read it.' },
          {
            type: 'tool-call',
            toolCallId: 'call_1',
            toolName: 'Read',
            input: '{"file_path":"/repo/a.txt"}',
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: USAGE,
        warnings: [],
      },
      context,
    );
    expect(followUp(turn.content).prompt).toEqual(expectedPrompt);
  });
});

describe('a stream that broke', () => {
  it("is told in Anthropic's error event, which names no answer", () => {
    expect(
      anthropicAdapter.encodeStreamError(
        'overloaded',
        'Try again soon.',
        context,
      ),
    ).toBe(
      'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Try again soon."}}\n\n',
    );
    expect(
      anthropicAdapter.encodeStreamError(
        'timeout',
        'The model stopped answering.',
        context,
      ),
    ).toBe(
      'event: error\ndata: {"type":"error","error":{"type":"timeout_error","message":"The model stopped answering."}}\n\n',
    );
  });
});

describe('carrying what the upstream asks to have back in a thinking signature', () => {
  const signed = { anthropic: { signature: 'sig-of-the-thinking' } };
  const gemini = (thoughtSignature: string) => ({
    google: { thoughtSignature },
  });

  /** Each event of a stream with how many parts had come when it was
   * written, and what it is. */
  async function timelineOf(
    parts: readonly LanguageModelV4StreamPart[],
  ): Promise<string[]> {
    let pulled = 0;
    async function* counted(): AsyncIterable<LanguageModelV4StreamPart> {
      for (const part of parts) {
        pulled += 1;
        yield part;
      }
    }
    const timeline: string[] = [];
    for await (const raw of anthropicAdapter.encodeStream(counted(), context)) {
      const data = JSON.parse(raw.split('\n')[1]!.slice('data: '.length)) as {
        type: string;
        content_block?: { type: string };
        delta?: { type?: string };
      };
      const what =
        data.type === 'content_block_start'
          ? `start ${data.content_block!.type}`
          : data.type === 'content_block_delta'
            ? String(data.delta!.type)
            : data.type === 'content_block_stop'
              ? 'stop'
              : data.type;
      timeline.push(`${pulled} ${what}`);
    }
    return timeline;
  }

  it('seals what a thinking stream asked for, with its text, in a signature_delta before its stop', async () => {
    expect(
      await eventsOf([
        { type: 'reasoning-start', id: 'reasoning-0' },
        { type: 'reasoning-delta', id: 'reasoning-0', delta: 'Plan ' },
        {
          type: 'reasoning-delta',
          id: 'reasoning-0',
          delta: 'it.',
          providerMetadata: signed,
        },
        { type: 'reasoning-end', id: 'reasoning-0' },
        { type: 'text-delta', id: 'txt-0', delta: 'Done.' },
        finish('stop'),
      ]),
    ).toEqual([
      MESSAGE_START,
      start(0, THINKING),
      thought(0, 'Plan '),
      thought(0, 'it.'),
      signature(0, seal({ options: signed, text: 'Plan it.' })),
      stop(0),
      start(1, TEXT),
      text(1, 'Done.'),
      stop(1),
      messageDelta('end_turn'),
      MESSAGE_STOP,
    ]);
  });

  it('carries the thought signatures of the calls right after a thinking block in its signature, before them', async () => {
    expect(
      await eventsOf([
        { type: 'reasoning-start', id: 'reasoning-0' },
        { type: 'reasoning-delta', id: 'reasoning-0', delta: 'Check both.' },
        { type: 'reasoning-end', id: 'reasoning-0' },
        { type: 'tool-input-start', id: 'call_a', toolName: 'Read' },
        { type: 'tool-input-delta', id: 'call_a', delta: '{"file_path":"/a"}' },
        { type: 'tool-input-start', id: 'call_b', toolName: 'Read' },
        { type: 'tool-input-delta', id: 'call_b', delta: '{"file_path":"/b"}' },
        { type: 'tool-input-end', id: 'call_a' },
        {
          type: 'tool-call',
          toolCallId: 'call_a',
          toolName: 'Read',
          input: '{"file_path":"/a"}',
          providerMetadata: gemini('ts-a'),
        },
        { type: 'tool-input-end', id: 'call_b' },
        {
          type: 'tool-call',
          toolCallId: 'call_b',
          toolName: 'Read',
          input: '{"file_path":"/b"}',
          providerMetadata: gemini('ts-b'),
        },
        finish('tool-calls'),
      ]),
    ).toEqual([
      MESSAGE_START,
      start(0, THINKING),
      thought(0, 'Check both.'),
      signature(
        0,
        seal({ calls: { call_a: gemini('ts-a'), call_b: gemini('ts-b') } }),
      ),
      stop(0),
      start(1, toolUse('call_a', 'Read')),
      json(1, '{"file_path":"/a"}'),
      stop(1),
      start(2, toolUse('call_b', 'Read')),
      json(2, '{"file_path":"/b"}'),
      stop(2),
      messageDelta('tool_use'),
      MESSAGE_STOP,
    ]);
  });

  it('writes an empty thinking block to carry the signatures of calls no thinking block is open before', async () => {
    expect(
      await eventsOf([
        { type: 'text-delta', id: 'txt-0', delta: 'Checking.' },
        { type: 'tool-input-start', id: 'call_a', toolName: 'Read' },
        { type: 'tool-input-delta', id: 'call_a', delta: '{"file_path":"/a"}' },
        { type: 'text-end', id: 'txt-0' },
        { type: 'tool-input-end', id: 'call_a' },
        {
          type: 'tool-call',
          toolCallId: 'call_a',
          toolName: 'Read',
          input: '{"file_path":"/a"}',
          providerMetadata: gemini('ts-a'),
        },
        finish('tool-calls'),
      ]),
    ).toEqual([
      MESSAGE_START,
      start(0, TEXT),
      text(0, 'Checking.'),
      stop(0),
      start(1, THINKING),
      signature(1, seal({ calls: { call_a: gemini('ts-a') } })),
      stop(1),
      start(2, toolUse('call_a', 'Read')),
      json(2, '{"file_path":"/a"}'),
      stop(2),
      messageDelta('tool_use'),
      MESSAGE_STOP,
    ]);
  });

  it('streams thinking as it comes, and writes a call only once its tool-call part has come', async () => {
    expect(
      await timelineOf([
        { type: 'reasoning-delta', id: 'reasoning-0', delta: 'Think.' },
        { type: 'reasoning-end', id: 'reasoning-0' },
        { type: 'tool-input-start', id: 'call_a', toolName: 'Read' },
        { type: 'tool-input-delta', id: 'call_a', delta: '{"file_path":"/a"}' },
        { type: 'tool-input-end', id: 'call_a' },
        {
          type: 'tool-call',
          toolCallId: 'call_a',
          toolName: 'Read',
          input: '{"file_path":"/a"}',
          providerMetadata: gemini('ts-a'),
        },
        finish('tool-calls'),
      ]),
    ).toEqual([
      '0 message_start',
      '1 start thinking',
      '1 thinking_delta',
      '6 signature_delta',
      '6 stop',
      '6 start tool_use',
      '6 input_json_delta',
      '6 stop',
      '7 message_delta',
      '7 message_stop',
    ]);
  });

  it('seals a whole answer the same way: a thinking block carries itself and the calls after it, earlier calls get an empty carrier', () => {
    const encoded = anthropicAdapter.encodeAnswer(
      {
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_0',
            toolName: 'LS',
            input: '{}',
            providerMetadata: gemini('ts-0'),
          },
          { type: 'reasoning', text: 'Now read.', providerMetadata: signed },
          { type: 'text', text: 'Reading.' },
          {
            type: 'tool-call',
            toolCallId: 'call_1',
            toolName: 'Read',
            input: '{"file_path":"/a"}',
            providerMetadata: gemini('ts-1'),
          },
          {
            type: 'tool-call',
            toolCallId: 'call_2',
            toolName: 'Read',
            input: '{"file_path":"/b"}',
          },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: USAGE,
        warnings: [],
      },
      context,
    );
    expect(encoded.content).toEqual([
      {
        type: 'thinking',
        thinking: '',
        signature: seal({ calls: { call_0: gemini('ts-0') } }),
      },
      { type: 'tool_use', id: 'call_0', name: 'LS', input: {} },
      {
        type: 'thinking',
        thinking: 'Now read.',
        signature: seal({
          options: signed,
          text: 'Now read.',
          calls: { call_1: gemini('ts-1') },
        }),
      },
      { type: 'text', text: 'Reading.' },
      {
        type: 'tool_use',
        id: 'call_1',
        name: 'Read',
        input: { file_path: '/a' },
      },
      {
        type: 'tool_use',
        id: 'call_2',
        name: 'Read',
        input: { file_path: '/b' },
      },
    ]);
  });

  it('reads a sealed signature back: the thinking gets what it carried and the text it holds for, the calls after it theirs', () => {
    const { prompt } = optionsOf(
      request({
        messages: [
          { role: 'user', content: 'Read a and b.' },
          {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'call_0', name: 'LS', input: {} },
              {
                type: 'thinking',
                thinking: 'Now read (as the client kept it).',
                signature: seal({
                  options: signed,
                  text: 'Now read.',
                  calls: { call_0: gemini('ts-0'), call_1: gemini('ts-1') },
                }),
              },
              {
                type: 'tool_use',
                id: 'call_1',
                name: 'Read',
                input: { file_path: '/a' },
              },
              {
                type: 'tool_use',
                id: 'call_2',
                name: 'Read',
                input: { file_path: '/b' },
              },
            ],
          },
          {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'call_0', content: 'a b' },
              { type: 'tool_result', tool_use_id: 'call_1', content: 'A' },
              { type: 'tool_result', tool_use_id: 'call_2', content: 'B' },
            ],
          },
        ],
      }),
    );
    expect(prompt[1]).toEqual({
      role: 'assistant',
      content: [
        // A call before the signature carries nothing back.
        { type: 'tool-call', toolCallId: 'call_0', toolName: 'LS', input: {} },
        { type: 'reasoning', text: 'Now read.', providerOptions: signed },
        {
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName: 'Read',
          input: { file_path: '/a' },
          providerOptions: gemini('ts-1'),
        },
        {
          type: 'tool-call',
          toolCallId: 'call_2',
          toolName: 'Read',
          input: { file_path: '/b' },
        },
      ],
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("adds no thinking for an empty block that carried only calls, and drops a signature that is not the relay's", () => {
    const { prompt } = optionsOf(
      request({
        messages: [
          { role: 'user', content: 'Go.' },
          {
            role: 'assistant',
            content: [
              {
                type: 'thinking',
                thinking: 'Anthropic thought this.',
                signature: 'EqQBCkgIBBABGAIiQL2x',
              },
              {
                type: 'thinking',
                thinking: '',
                signature: seal({ calls: { call_a: gemini('ts-a') } }),
              },
              {
                type: 'tool_use',
                id: 'call_a',
                name: 'Read',
                input: { file_path: '/a' },
              },
            ],
          },
          {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'call_a', content: 'A' },
            ],
          },
        ],
      }),
    );
    expect(prompt[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'Anthropic thought this.' },
        {
          type: 'tool-call',
          toolCallId: 'call_a',
          toolName: 'Read',
          input: { file_path: '/a' },
          providerOptions: gemini('ts-a'),
        },
      ],
    });
  });

  it('drops a sealed signature that does not read, saying so', () => {
    const { prompt } = optionsOf(
      request({
        messages: [
          { role: 'user', content: 'Go.' },
          {
            role: 'assistant',
            content: [
              {
                type: 'thinking',
                thinking: 'Thought.',
                signature: 'tale-relay.v1:%%%',
              },
            ],
          },
          { role: 'user', content: 'On.' },
        ],
      }),
    );
    expect(prompt[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'reasoning', text: 'Thought.' }],
    });
    expect(warning()).toMatch(/a carried value does not read/);
  });

  it('round-trips the thought signature of a streamed call through Claude Code', async () => {
    const turn = messageOf(
      await eventsOf([
        { type: 'text-delta', id: 'txt-0', delta: 'Reading.' },
        { type: 'tool-input-start', id: 'call_a', toolName: 'Read' },
        { type: 'tool-input-delta', id: 'call_a', delta: '{"file_path":"/a"}' },
        { type: 'text-end', id: 'txt-0' },
        { type: 'tool-input-end', id: 'call_a' },
        {
          type: 'tool-call',
          toolCallId: 'call_a',
          toolName: 'Read',
          input: '{"file_path":"/a"}',
          providerMetadata: gemini('ts-a'),
        },
        finish('tool-calls'),
      ]),
    );
    expect(turn.content.map((block) => block.type)).toEqual([
      'text',
      'thinking',
      'tool_use',
    ]);
    expect(unseal(turn.content[1]!.signature)).toEqual({
      calls: { call_a: gemini('ts-a') },
    });
    const { prompt } = optionsOf(
      request({
        tools: [READ_TOOL],
        messages: [
          { role: 'user', content: 'Read a.' },
          { role: 'assistant', content: turn.content },
          {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'call_a', content: 'hello' },
            ],
          },
        ],
      }),
    );
    expect(prompt.slice(1)).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Reading.' },
          {
            type: 'tool-call',
            toolCallId: 'call_a',
            toolName: 'Read',
            input: { file_path: '/a' },
            providerOptions: gemini('ts-a'),
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_a',
            toolName: 'Read',
            output: { type: 'text', value: 'hello' },
          },
        ],
      },
    ]);
  });
});
