import type {
  LanguageModelV4FinishReason,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from '@ai-sdk/provider';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type Carried, seal } from './carry.ts';
import { type EncodeContext, TranslationError } from './contract.ts';
import { openAiChatAdapter } from './openai-chat.ts';

/** One of the relay's own `reasoning_details` entries. */
const entry = (id: string, index: number, carried: Carried) => ({
  type: 'reasoning.encrypted',
  id,
  format: 'tale-relay-v1',
  index,
  data: seal(carried),
});

const parse = (body: Record<string, unknown>) =>
  openAiChatAdapter.parse(body).options;

/** The words a refused request is answered with. */
function refusal(body: Record<string, unknown>): string {
  try {
    openAiChatAdapter.parse(body);
  } catch (error) {
    if (error instanceof TranslationError) {
      expect(error.kind).toBe('invalid_request');
      return error.message;
    }
    throw error;
  }
  throw new Error('the request was not refused');
}

const hello = [{ role: 'user', content: 'Hello' }];
const helloPrompt = [
  { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
];

const CREATED = 1_760_000_000;

const context = (request: Record<string, unknown> = {}): EncodeContext => ({
  model: 'claude-sonnet-5',
  id: 'abc123',
  created: CREATED,
  request,
});

const HEAD = {
  id: 'chatcmpl-abc123',
  object: 'chat.completion.chunk',
  created: CREATED,
  model: 'claude-sonnet-5',
};

const chunk = (
  delta: Record<string, unknown>,
  finishReason: string | null = null,
) =>
  `data: ${JSON.stringify({ ...HEAD, choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;

const ROLE = chunk({ role: 'assistant', content: '' });
const DONE = 'data: [DONE]\n\n';

const usage: LanguageModelV4Usage = {
  inputTokens: { total: 1_200, noCache: 200, cacheRead: 900, cacheWrite: 100 },
  outputTokens: { total: 80, text: 50, reasoning: 30 },
};

const USAGE = {
  prompt_tokens: 1_200,
  completion_tokens: 80,
  total_tokens: 1_280,
  prompt_tokens_details: { cached_tokens: 900 },
  completion_tokens_details: { reasoning_tokens: 30 },
};

const usageChunk = `data: ${JSON.stringify({ ...HEAD, choices: [], usage: USAGE })}\n\n`;

const finish = (
  unified: LanguageModelV4FinishReason['unified'],
  raw: string = unified,
): LanguageModelV4StreamPart => ({
  type: 'finish',
  finishReason: { unified, raw },
  usage,
});

async function* streamOf(
  parts: readonly LanguageModelV4StreamPart[],
): AsyncIterable<LanguageModelV4StreamPart> {
  for (const part of parts) yield part;
}

/** Every event the adapter writes for these parts. */
async function encode(
  parts: readonly LanguageModelV4StreamPart[],
  request: Record<string, unknown> = {},
): Promise<string[]> {
  const events: string[] = [];
  for await (const event of openAiChatAdapter.encodeStream(
    streamOf(parts),
    context(request),
  )) {
    events.push(event);
  }
  return events;
}

interface FoldedCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

/** The assistant message pi folds a stream into and sends back (pi-ai
 * 1.0–1.6, `api/openai-completions.js`): tool calls gathered by their
 * index, and every `reasoning_details` entry kept from whichever chunk —
 * sent back in place of the reasoning text when there are any. */
function fold(events: readonly string[]): Record<string, unknown> {
  let content = '';
  let reasoning = '';
  const calls = new Map<number, FoldedCall>();
  const details: unknown[] = [];
  for (const event of events) {
    const data = event.slice('data: '.length).trim();
    if (data === '[DONE]') continue;
    const parsed = JSON.parse(data) as {
      choices: {
        delta: {
          content?: string;
          reasoning_content?: string;
          reasoning_details?: unknown[];
          tool_calls?: {
            index: number;
            id?: string;
            function: { name?: string; arguments?: string };
          }[];
        };
      }[];
    };
    for (const { delta } of parsed.choices) {
      content += delta.content ?? '';
      reasoning += delta.reasoning_content ?? '';
      details.push(...(delta.reasoning_details ?? []));
      for (const call of delta.tool_calls ?? []) {
        const known = calls.get(call.index) ?? {
          id: call.id ?? '',
          type: 'function',
          function: { name: call.function.name ?? '', arguments: '' },
        };
        known.function.arguments += call.function.arguments ?? '';
        calls.set(call.index, known);
      }
    }
  }
  return {
    role: 'assistant',
    content: content === '' ? null : content,
    ...(details.length > 0
      ? { reasoning_details: details }
      : { reasoning_content: reasoning }),
    tool_calls: [...calls.values()],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reading a Chat Completions request', () => {
  it('reads system and developer messages as system messages, one per text', () => {
    expect(
      parse({
        messages: [
          { role: 'system', content: 'You are pi.' },
          {
            role: 'developer',
            content: [
              { type: 'text', text: 'Be brief.' },
              { type: 'text', text: ' \n' },
              { type: 'text', text: 'Use tools.' },
            ],
          },
          { role: 'user', content: 'Hello' },
          // Blank texts carry nothing, and a provider refuses them.
          { role: 'system', content: '' },
          { role: 'user', content: '  \n' },
        ],
      }).prompt,
    ).toEqual([
      { role: 'system', content: 'You are pi.' },
      { role: 'system', content: 'Be brief.' },
      { role: 'system', content: 'Use tools.' },
      ...helloPrompt,
    ]);
  });

  it("reads a user's text, images and files as text and file parts", () => {
    const { prompt } = parse({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is in these?' },
            { type: 'text', text: '' },
            { type: 'text', text: '\n\n' },
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' },
            },
            {
              type: 'image_url',
              image_url: { url: 'https://example.com/cat.jpg', detail: 'auto' },
            },
            {
              type: 'image_url',
              image_url: { url: 'DATA:image/jpg;BASE64,/9j/4AAQ' },
            },
            { type: 'image_url', image_url: { url: 'data:;base64,R0lGODlh' } },
            {
              type: 'file',
              file: {
                filename: 'report.pdf',
                file_data: 'data:application/pdf;base64,JVBERi0x',
              },
            },
            {
              type: 'file',
              file: { file_data: 'data:text/plain,hello%20world' },
            },
          ],
        },
      ],
    });
    expect(prompt).toEqual([
      {
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
          // `image/jpg` is not IANA's name, and a provider refuses it.
          {
            type: 'file',
            mediaType: 'image/jpeg',
            data: { type: 'data', data: '/9j/4AAQ' },
          },
          // An image of no named type is typed from its bytes by the SDK.
          {
            type: 'file',
            mediaType: 'image',
            data: { type: 'data', data: 'R0lGODlh' },
          },
          {
            type: 'file',
            mediaType: 'application/pdf',
            filename: 'report.pdf',
            data: { type: 'data', data: 'JVBERi0x' },
          },
          {
            type: 'file',
            mediaType: 'text/plain',
            data: {
              type: 'data',
              data: Buffer.from('hello world').toString('base64'),
            },
          },
        ],
      },
    ]);
    expect(JSON.stringify(prompt)).toContain(
      '"url":"https://example.com/cat.jpg"',
    );
  });

  it('refuses audio, files stored with OpenAI, and content it cannot carry', () => {
    const user = (part: Record<string, unknown>) => ({
      messages: [{ role: 'user', content: [part] }],
    });
    expect(
      refusal(
        user({
          type: 'input_audio',
          input_audio: { data: 'UklGRg==', format: 'wav' },
        }),
      ),
    ).toBe(
      'messages[0].content[0]: audio input cannot be carried to this model: its provider takes no audio.',
    );
    expect(
      refusal(user({ type: 'file', file: { file_id: 'file-1' } })),
    ).toMatch(
      /^messages\[0\]\.content\[0\]\.file\.file_id: a file stored with OpenAI cannot be read by this model/,
    );
    expect(
      refusal(user({ type: 'file', file: { file_data: 'JVBERi0x' } })),
    ).toMatch(/file_data must be a data URL that names the file's type/);
    expect(
      refusal(
        user({ type: 'file', file: { file_data: 'data:;base64,JVBERi0x' } }),
      ),
    ).toMatch(/file_data must be a data URL that names the file's type/);
    expect(
      refusal(
        user({
          type: 'image_url',
          image_url: { url: 'ftp://example.com/a.png' },
        }),
      ),
    ).toBe(
      'messages[0].content[0].image_url.url must be a data: URL or an http(s) URL.',
    );
    expect(
      refusal(
        user({
          type: 'video_url',
          video_url: { url: 'https://example.com/a.mp4' },
        }),
      ),
    ).toBe(
      'messages[0].content[0]: a "video_url" part cannot be carried to this model.',
    );
    expect(
      refusal({
        messages: [
          {
            role: 'system',
            content: [
              {
                type: 'image_url',
                image_url: { url: 'https://example.com/a.png' },
              },
            ],
          },
        ],
      }),
    ).toBe('messages[0].content[0]: a system message takes text parts only.');
  });

  it('reads an assistant turn: its reasoning first, then its text, then its tool calls', () => {
    expect(
      parse({
        messages: [
          ...hello,
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'Looking.' }],
            reasoning_content: 'Two files to look at.',
            tool_calls: [
              {
                id: 'toolu_1',
                type: 'function',
                function: { name: 'bash', arguments: '{"command":"ls"}' },
              },
              {
                id: 'toolu_2',
                type: 'function',
                function: { name: 'read', arguments: '{"path":"a.ts"}' },
              },
            ],
          },
        ],
      }).prompt,
    ).toEqual([
      ...helloPrompt,
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'Two files to look at.' },
          { type: 'text', text: 'Looking.' },
          {
            type: 'tool-call',
            toolCallId: 'toolu_1',
            toolName: 'bash',
            input: { command: 'ls' },
          },
          {
            type: 'tool-call',
            toolCallId: 'toolu_2',
            toolName: 'read',
            input: { path: 'a.ts' },
          },
        ],
      },
    ]);
  });

  it("reads `reasoning`, a refusal as text, and drops a turn's blank text and an empty turn", () => {
    expect(
      parse({
        messages: [
          ...hello,
          {
            role: 'assistant',
            content: '',
            reasoning: 'Thinking it over.',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'now', arguments: '' },
              },
            ],
          },
          { role: 'tool', tool_call_id: 'call_1', content: '12:00' },
          {
            role: 'assistant',
            content: [{ type: 'refusal', refusal: 'I cannot.' }],
          },
          { role: 'assistant', content: null, refusal: 'Nor that.' },
          { role: 'assistant', content: '  \n' },
        ],
      }).prompt,
    ).toEqual([
      ...helloPrompt,
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'Thinking it over.' },
          {
            type: 'tool-call',
            toolCallId: 'call_1',
            toolName: 'now',
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
            toolName: 'now',
            output: { type: 'text', value: '12:00' },
          },
        ],
      },
      { role: 'assistant', content: [{ type: 'text', text: 'I cannot.' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Nor that.' }] },
    ]);
  });

  it("reads the relay's sealed entries back: each signed thought as written, and each call's own fields", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const assistant = parse({
      messages: [
        ...hello,
        {
          role: 'assistant',
          content: null,
          // The client's own copy of the text gives way to the sealed one.
          reasoning_content: 'Edited on the way.',
          reasoning_details: [
            // OpenRouter's own entries mean nothing to this model's provider.
            {
              type: 'reasoning.text',
              text: 'Elsewhere.',
              signature: 'or-sig',
              format: 'anthropic-claude-v1',
              index: 0,
            },
            entry('toolu_1', 0, {
              options: { anthropic: { redactedData: 'opaque' } },
              text: '',
            }),
            entry('toolu_1', 1, {
              options: { anthropic: { signature: 'sig-1' } },
              text: 'Check the files.',
              calls: { toolu_1: { google: { thoughtSignature: 'ts-1' } } },
            }),
            { type: 'reasoning.encrypted', id: 'x', data: 'tale-relay.v1:@@@' },
          ],
          tool_calls: [
            {
              id: 'toolu_1',
              type: 'function',
              function: { name: 'bash', arguments: '{}' },
            },
            {
              id: 'constructor',
              type: 'function',
              function: { name: 'read', arguments: '{}' },
            },
          ],
        },
      ],
    }).prompt[1];
    expect(assistant).toStrictEqual({
      role: 'assistant',
      content: [
        {
          type: 'reasoning',
          text: '',
          providerOptions: { anthropic: { redactedData: 'opaque' } },
        },
        {
          type: 'reasoning',
          text: 'Check the files.',
          providerOptions: { anthropic: { signature: 'sig-1' } },
        },
        {
          type: 'tool-call',
          toolCallId: 'toolu_1',
          toolName: 'bash',
          input: {},
          providerOptions: { google: { thoughtSignature: 'ts-1' } },
        },
        // A call id that names a key every object inherits finds nothing.
        {
          type: 'tool-call',
          toolCallId: 'constructor',
          toolName: 'read',
          input: {},
        },
      ],
    });
    // The entry that does not read is passed over, said once.
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("keeps the client's reasoning when the entries carry only what calls ask back", () => {
    expect(
      parse({
        messages: [
          ...hello,
          {
            role: 'assistant',
            content: null,
            reasoning_content: 'Plan.',
            reasoning_details: [
              entry('call_5', 0, {
                calls: { call_5: { google: { thoughtSignature: 'ts-5' } } },
              }),
            ],
            tool_calls: [
              {
                id: 'call_5',
                type: 'function',
                function: { name: 'read', arguments: '{}' },
              },
            ],
          },
        ],
      }).prompt[1],
    ).toStrictEqual({
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'Plan.' },
        {
          type: 'tool-call',
          toolCallId: 'call_5',
          toolName: 'read',
          input: {},
          providerOptions: { google: { thoughtSignature: 'ts-5' } },
        },
      ],
    });
  });

  it('sends arguments that encode no JSON object as {}, with a warning, never a refusal', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const inputs = (args: unknown) =>
      parse({
        messages: [
          ...hello,
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'f', arguments: args },
              },
            ],
          },
        ],
      }).prompt[1];
    expect(inputs('{"path": "a.ts"')).toEqual({
      role: 'assistant',
      content: [
        { type: 'tool-call', toolCallId: 'c1', toolName: 'f', input: {} },
      ],
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(
      /^\[llm-relay\] messages\[1\]\.tool_calls\[0\]\.function\.arguments is not JSON/,
    );
    expect(inputs('["a.ts"]')).toMatchObject({ content: [{ input: {} }] });
    expect(warn).toHaveBeenCalledTimes(2);
    // No arguments at all is how a call to a tool that takes none looks.
    expect(inputs('')).toMatchObject({ content: [{ input: {} }] });
    expect(inputs({ path: 'a.ts' })).toMatchObject({
      content: [{ input: { path: 'a.ts' } }],
    });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('answers each tool message with one result, named after the call it answers', () => {
    const { prompt } = parse({
      messages: [
        ...hello,
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'c1',
              type: 'function',
              function: { name: 'read', arguments: '{}' },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'c1',
          content: [
            { type: 'text', text: 'line 1' },
            { type: 'text', text: 'line 2' },
          ],
        },
        // A result whose call the client trimmed away keeps the name it gives.
        { role: 'tool', tool_call_id: 'c0', name: 'list', content: 'a.ts' },
        { role: 'tool', tool_call_id: 'c9', content: null },
      ],
    });
    expect(prompt.slice(2)).toEqual([
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'read',
            output: {
              type: 'content',
              value: [
                { type: 'text', text: 'line 1' },
                { type: 'text', text: 'line 2' },
              ],
            },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'c0',
            toolName: 'list',
            output: { type: 'text', value: 'a.ts' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'c9',
            toolName: '',
            output: { type: 'text', value: '' },
          },
        ],
      },
    ]);
  });

  it('reads function tools, giving a tool without parameters the empty object schema (#5353)', () => {
    const schema = {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    };
    expect(
      parse({
        messages: hello,
        tools: [
          {
            type: 'function',
            function: {
              name: 'read',
              description: 'Read a file.',
              parameters: schema,
              strict: true,
            },
          },
          // Qwen Code's tools that take no arguments come without parameters.
          { type: 'function', function: { name: 'list_skills' } },
          { type: 'function', function: { name: 'now', parameters: {} } },
        ],
      }).tools,
    ).toEqual([
      {
        type: 'function',
        name: 'read',
        description: 'Read a file.',
        inputSchema: schema,
        strict: true,
      },
      {
        type: 'function',
        name: 'list_skills',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        type: 'function',
        name: 'now',
        inputSchema: { type: 'object', properties: {} },
      },
    ]);
    expect(parse({ messages: hello, tools: [] })).toStrictEqual({
      prompt: helloPrompt,
    });
  });

  it('refuses a tool that is not a function', () => {
    expect(
      refusal({
        messages: hello,
        tools: [{ type: 'custom', custom: { name: 'apply_patch' } }],
      }),
    ).toBe(
      'tools[0]: only function tools can be carried to this model, not a "custom" tool.',
    );
    expect(
      refusal({ messages: hello, tools: [{ type: 'function', function: {} }] }),
    ).toBe('tools[0].function needs its "name".');
  });

  it.each([
    ['auto', { type: 'auto' }],
    ['none', { type: 'none' }],
    ['required', { type: 'required' }],
    [
      { type: 'function', function: { name: 'read' } },
      { type: 'tool', toolName: 'read' },
    ],
  ])('reads the tool choice %j', (choice, expected) => {
    expect(parse({ messages: hello, tool_choice: choice }).toolChoice).toEqual(
      expected,
    );
  });

  it('reads the sampling settings, the newer output cap first', () => {
    expect(
      parse({
        messages: hello,
        max_completion_tokens: 4_096,
        max_tokens: 1_024,
        temperature: 0.2,
        top_p: 0.9,
        top_k: 40,
        stop: ['\n\n', ''],
        presence_penalty: 0.5,
        frequency_penalty: -0.5,
        seed: 7,
      }),
    ).toStrictEqual({
      prompt: helloPrompt,
      maxOutputTokens: 4_096,
      temperature: 0.2,
      topP: 0.9,
      topK: 40,
      stopSequences: ['\n\n'],
      presencePenalty: 0.5,
      frequencyPenalty: -0.5,
      seed: 7,
    });
    expect(
      parse({
        messages: hello,
        max_tokens: 1_024,
        stop: 'END',
        temperature: null,
      }),
    ).toStrictEqual({
      prompt: helloPrompt,
      maxOutputTokens: 1_024,
      stopSequences: ['END'],
    });
  });

  it('reads a response format as text or JSON, with its schema', () => {
    const schema = {
      type: 'object',
      properties: { answer: { type: 'string' } },
    };
    expect(
      parse({ messages: hello, response_format: { type: 'json_object' } })
        .responseFormat,
    ).toEqual({ type: 'json' });
    expect(
      parse({
        messages: hello,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'verdict',
            description: 'The verdict.',
            schema,
            strict: true,
          },
        },
      }).responseFormat,
    ).toEqual({
      type: 'json',
      schema,
      name: 'verdict',
      description: 'The verdict.',
    });
    expect(
      parse({ messages: hello, response_format: { type: 'text' } })
        .responseFormat,
    ).toEqual({ type: 'text' });
  });

  it.each(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])(
    'reads reasoning_effort %s as the reasoning it asks for',
    (effort) => {
      expect(
        parse({ messages: hello, reasoning_effort: effort }).reasoning,
      ).toBe(effort);
    },
  );

  it.each([
    [{}, '"messages" must be a non-empty array.'],
    [{ messages: [] }, '"messages" must be a non-empty array.'],
    [
      { messages: hello, n: 2 },
      '"n": this model gives one answer per request; ask for one.',
    ],
    [
      { messages: hello, modalities: ['text', 'audio'] },
      '"modalities": this model answers in text only; audio output cannot be carried to it.',
    ],
    [
      { messages: hello, audio: { voice: 'alloy', format: 'wav' } },
      '"audio": this model answers in text only; audio output cannot be carried to it.',
    ],
    [
      { messages: hello, functions: [{ name: 'f', parameters: {} }] },
      '"functions": legacy function calling cannot be carried to this model; define the functions in "tools" and choose one with "tool_choice".',
    ],
    [
      { messages: hello, function_call: 'auto' },
      '"function_call": legacy function calling cannot be carried to this model; define the functions in "tools" and choose one with "tool_choice".',
    ],
    [
      { messages: [...hello, { role: 'function', name: 'f', content: '1' }] },
      'messages[1]: the legacy "function" role cannot be carried to this model; answer a tool call with a "tool" message.',
    ],
    [
      {
        messages: [
          ...hello,
          {
            role: 'assistant',
            content: null,
            function_call: { name: 'f', arguments: '{}' },
          },
        ],
      },
      'messages[1].function_call: legacy function calling cannot be carried to this model; send the call in "tool_calls".',
    ],
    [
      { messages: [{ role: 'critic', content: 'No.' }] },
      'messages[0]: "critic" is not a Chat Completions role.',
    ],
    [
      { messages: [{ content: 'Hello' }] },
      'messages[0] must be a message with a "role".',
    ],
    [
      { messages: [...hello, { role: 'tool', content: '1' }] },
      'messages[1] needs its "tool_call_id".',
    ],
    [
      {
        messages: [
          ...hello,
          {
            role: 'assistant',
            content: null,
            tool_calls: [{ type: 'function', function: { name: 'f' } }],
          },
        ],
      },
      'messages[1].tool_calls[0] needs its "id".',
    ],
    [
      {
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'image_url', image_url: { url: 'https://a.b/c.png' } },
            ],
          },
        ],
      },
      'messages[0].content[0]: an assistant message takes text and refusal parts only.',
    ],
    [
      { messages: hello, temperature: 'hot' },
      '"temperature" must be a number.',
    ],
    [
      { messages: hello, max_tokens: 0 },
      '"max_tokens" must be a whole number of at least 1.',
    ],
    [{ messages: hello, seed: 1.5 }, '"seed" must be a whole number.'],
    [
      { messages: hello, stop: ['END', 1] },
      '"stop" must be a string or an array of strings.',
    ],
    [
      { messages: hello, tool_choice: 'any' },
      '"tool_choice" must be "auto", "none", "required" or {"type": "function", "function": {"name": …}}.',
    ],
    [
      { messages: hello, response_format: { type: 'grammar' } },
      '"response_format" must be of type "text", "json_object" or "json_schema".',
    ],
    [
      { messages: hello, reasoning_effort: 'extreme' },
      '"reasoning_effort" must be one of "none", "minimal", "low", "medium", "high", "xhigh", "max".',
    ],
  ])('refuses %j', (body, message) => {
    expect(refusal(body)).toBe(message);
  });

  it('drops what the call has no place for with one warning naming it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const options = parse({
      messages: [
        {
          role: 'user',
          name: 'ann',
          content: [
            {
              type: 'text',
              text: 'Hello',
              cache_control: { type: 'ephemeral' },
            },
            {
              type: 'image_url',
              image_url: { url: 'https://example.com/a.png', detail: 'high' },
            },
          ],
        },
      ],
      logprobs: true,
      top_logprobs: 3,
      logit_bias: { '50256': -100 },
      user: 'user-1',
      parallel_tool_calls: false,
      store: true,
      metadata: { run: '1' },
      prediction: { type: 'content', content: 'Hi' },
      web_search_options: {},
    });
    expect(options.prompt).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "[llm-relay] a Chat Completions request asked for what its model's provider cannot take; dropped: messages[].name, cache_control, image_url.detail, logprobs, top_logprobs, logit_bias, parallel_tool_calls, store, metadata, user, prediction, web_search_options",
    );
  });

  it('drops a default that asks for nothing without a word', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(
      parse({
        model: 'claude-sonnet-5',
        messages: hello,
        stream: true,
        stream_options: { include_usage: true },
        store: false,
        parallel_tool_calls: true,
        logprobs: false,
        metadata: {},
        modalities: ['text'],
        service_tier: 'auto',
        n: 1,
      }),
    ).toStrictEqual({ prompt: helloPrompt });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('writing a streamed answer as Chat Completions chunks', () => {
  it("streams text in the vendor's shape: the role, the text, the finish, [DONE]", async () => {
    const events = await encode([
      { type: 'stream-start', warnings: [] },
      {
        type: 'response-metadata',
        id: 'msg_1',
        modelId: 'claude-sonnet-5-20261001',
      },
      { type: 'text-start', id: '0' },
      { type: 'text-delta', id: '0', delta: 'Hel' },
      { type: 'text-delta', id: '0', delta: '' },
      { type: 'text-delta', id: '0', delta: 'lo' },
      { type: 'text-end', id: '0' },
      finish('stop', 'end_turn'),
    ]);
    expect(events[0]).toBe(
      'data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1760000000,"model":"claude-sonnet-5","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n',
    );
    expect(events).toEqual([
      ROLE,
      chunk({ content: 'Hel' }),
      chunk({ content: 'lo' }),
      chunk({}, 'stop'),
      DONE,
    ]);
  });

  it('streams reasoning as reasoning_content, and seals its signature into the finish', async () => {
    expect(
      await encode([
        { type: 'reasoning-start', id: '0' },
        { type: 'reasoning-delta', id: '0', delta: 'Think' },
        { type: 'reasoning-delta', id: '0', delta: ' more.' },
        {
          type: 'reasoning-delta',
          id: '0',
          delta: '',
          providerMetadata: { anthropic: { signature: 'sig' } },
        },
        { type: 'reasoning-end', id: '0' },
        { type: 'text-start', id: '1' },
        { type: 'text-delta', id: '1', delta: 'Answer.' },
        { type: 'text-end', id: '1' },
        finish('stop'),
      ]),
    ).toEqual([
      ROLE,
      chunk({ reasoning_content: 'Think' }),
      chunk({ reasoning_content: ' more.' }),
      chunk({ content: 'Answer.' }),
      // No call followed the thinking: its entry is named after the answer.
      chunk(
        {
          reasoning_details: [
            entry('chatcmpl-abc123', 0, {
              options: { anthropic: { signature: 'sig' } },
              text: 'Think more.',
            }),
          ],
        },
        'stop',
      ),
      DONE,
    ]);
  });

  it('seals each thinking part apart, named after the first call that followed, with the calls on the last', async () => {
    const events = await encode([
      {
        type: 'reasoning-start',
        id: '0',
        providerMetadata: { anthropic: { redactedData: 'opaque' } },
      },
      { type: 'reasoning-end', id: '0' },
      { type: 'reasoning-start', id: '1' },
      { type: 'reasoning-delta', id: '1', delta: 'Check the files.' },
      {
        type: 'reasoning-delta',
        id: '1',
        delta: '',
        providerMetadata: { anthropic: { signature: 'sig-1' } },
      },
      { type: 'reasoning-end', id: '1' },
      { type: 'tool-input-start', id: 'toolu_1', toolName: 'bash' },
      { type: 'tool-input-delta', id: 'toolu_1', delta: '{}' },
      {
        type: 'tool-call',
        toolCallId: 'toolu_1',
        toolName: 'bash',
        input: '{}',
        providerMetadata: { google: { thoughtSignature: 'ts-1' } },
      },
      {
        type: 'tool-call',
        toolCallId: 'toolu_2',
        toolName: 'read',
        input: '{}',
      },
      finish('tool-calls'),
    ]);
    expect(events.at(-2)).toBe(
      chunk(
        {
          reasoning_details: [
            entry('toolu_1', 0, {
              options: { anthropic: { redactedData: 'opaque' } },
              text: '',
            }),
            entry('toolu_1', 1, {
              options: { anthropic: { signature: 'sig-1' } },
              text: 'Check the files.',
              calls: { toolu_1: { google: { thoughtSignature: 'ts-1' } } },
            }),
          ],
        },
        'tool_calls',
      ),
    );
  });

  it('carries what calls ask back in an entry of their own when no thinking carries anything', async () => {
    const events = await encode([
      { type: 'reasoning-delta', id: '0', delta: 'Plan.' },
      {
        type: 'tool-call',
        toolCallId: 'call_5',
        toolName: 'read',
        input: '{}',
        providerMetadata: { google: { thoughtSignature: 'ts-5' } },
      },
      {
        type: 'tool-call',
        toolCallId: 'call_6',
        toolName: 'list',
        input: '{}',
      },
      finish('tool-calls'),
    ]);
    expect(events.at(-2)).toBe(
      chunk(
        {
          reasoning_details: [
            entry('call_5', 0, {
              calls: { call_5: { google: { thoughtSignature: 'ts-5' } } },
            }),
          ],
        },
        'tool_calls',
      ),
    );
  });

  it('streams tool calls by their index, once each, then the usage the client asked for', async () => {
    expect(
      await encode(
        [
          { type: 'text-delta', id: '0', delta: 'Looking.' },
          { type: 'tool-input-start', id: 'toolu_1', toolName: 'read' },
          { type: 'tool-input-delta', id: 'toolu_1', delta: '{"path":' },
          { type: 'tool-input-delta', id: 'toolu_1', delta: '"a.ts"}' },
          { type: 'tool-input-end', id: 'toolu_1' },
          {
            type: 'tool-call',
            toolCallId: 'toolu_1',
            toolName: 'read',
            input: '{"path":"a.ts"}',
          },
          { type: 'tool-input-start', id: 'toolu_2', toolName: 'bash' },
          {
            type: 'tool-input-delta',
            id: 'toolu_2',
            delta: '{"command":"ls"}',
          },
          { type: 'tool-input-end', id: 'toolu_2' },
          {
            type: 'tool-call',
            toolCallId: 'toolu_2',
            toolName: 'bash',
            input: '{"command":"ls"}',
          },
          finish('tool-calls', 'tool_use'),
        ],
        { stream: true, stream_options: { include_usage: true } },
      ),
    ).toEqual([
      ROLE,
      chunk({ content: 'Looking.' }),
      chunk({
        tool_calls: [
          {
            index: 0,
            id: 'toolu_1',
            type: 'function',
            function: { name: 'read', arguments: '' },
          },
        ],
      }),
      chunk({
        tool_calls: [{ index: 0, function: { arguments: '{"path":' } }],
      }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '"a.ts"}' } }] }),
      chunk({
        tool_calls: [
          {
            index: 1,
            id: 'toolu_2',
            type: 'function',
            function: { name: 'bash', arguments: '' },
          },
        ],
      }),
      chunk({
        tool_calls: [{ index: 1, function: { arguments: '{"command":"ls"}' } }],
      }),
      chunk({}, 'tool_calls'),
      usageChunk,
      DONE,
    ]);
  });

  it('writes a call the SDK gives only whole as one chunk', async () => {
    expect(
      await encode([
        {
          type: 'tool-call',
          toolCallId: 'toolu_9',
          toolName: 'bash',
          input: '{"command":"pwd"}',
        },
        finish('tool-calls'),
      ]),
    ).toEqual([
      ROLE,
      chunk({
        tool_calls: [
          {
            index: 0,
            id: 'toolu_9',
            type: 'function',
            function: { name: 'bash', arguments: '{"command":"pwd"}' },
          },
        ],
      }),
      chunk({}, 'tool_calls'),
      DONE,
    ]);
  });

  it('sends the arguments the deltas left out: a call without arguments is {}', async () => {
    expect(
      await encode([
        { type: 'tool-input-start', id: 'toolu_3', toolName: 'list_skills' },
        { type: 'tool-input-end', id: 'toolu_3' },
        {
          type: 'tool-call',
          toolCallId: 'toolu_3',
          toolName: 'list_skills',
          input: '{}',
        },
        finish('tool-calls'),
      ]),
    ).toEqual([
      ROLE,
      chunk({
        tool_calls: [
          {
            index: 0,
            id: 'toolu_3',
            type: 'function',
            function: { name: 'list_skills', arguments: '' },
          },
        ],
      }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '{}' } }] }),
      chunk({}, 'tool_calls'),
      DONE,
    ]);
  });

  it('shows no call the provider runs itself', async () => {
    expect(
      await encode([
        {
          type: 'tool-input-start',
          id: 'srvtoolu_1',
          toolName: 'web_search',
          providerExecuted: true,
        },
        { type: 'tool-input-delta', id: 'srvtoolu_1', delta: '{"query":"x"}' },
        {
          type: 'tool-call',
          toolCallId: 'srvtoolu_1',
          toolName: 'web_search',
          input: '{"query":"x"}',
          providerExecuted: true,
        },
        {
          type: 'tool-call',
          toolCallId: 'toolu_4',
          toolName: 'read',
          input: '{}',
        },
        finish('tool-calls'),
      ]),
    ).toEqual([
      ROLE,
      chunk({
        tool_calls: [
          {
            index: 0,
            id: 'toolu_4',
            type: 'function',
            function: { name: 'read', arguments: '{}' },
          },
        ],
      }),
      chunk({}, 'tool_calls'),
      DONE,
    ]);
  });

  it.each([
    ['length', 'max_tokens', 'length'],
    ['content-filter', 'refusal', 'content_filter'],
    ['other', 'pause_turn', 'stop'],
    ['error', undefined, 'stop'],
    ['interrupted', undefined, 'stop'],
  ] as const)(
    'ends a %s finish as finish_reason %s',
    async (unified, raw, expected) => {
      const events = await encode([
        { type: 'text-delta', id: '0', delta: 'Partial' },
        {
          type: 'finish',
          finishReason: { unified, raw },
          usage,
        },
      ]);
      expect(events).toEqual([
        ROLE,
        chunk({ content: 'Partial' }),
        chunk({}, expected),
        DONE,
      ]);
    },
  );

  it('counts the prompt from its parts when the provider gives no total', async () => {
    const events = await encode(
      [
        {
          type: 'finish',
          finishReason: { unified: 'stop', raw: undefined },
          usage: {
            inputTokens: {
              total: undefined,
              noCache: 10,
              cacheRead: 5,
              cacheWrite: 2,
            },
            outputTokens: { total: undefined, text: 3, reasoning: undefined },
          },
        },
      ],
      { stream_options: { include_usage: true } },
    );
    expect(events.at(-2)).toBe(
      `data: ${JSON.stringify({
        ...HEAD,
        choices: [],
        usage: {
          prompt_tokens: 17,
          completion_tokens: 3,
          total_tokens: 20,
          prompt_tokens_details: { cached_tokens: 5 },
          completion_tokens_details: { reasoning_tokens: 0 },
        },
      })}\n\n`,
    );
  });
});

describe('a pi tool loop through the relay', () => {
  it('round-trips the calls, the signed thinking and the results answering them', async () => {
    const events = await encode([
      { type: 'reasoning-start', id: '0' },
      { type: 'reasoning-delta', id: '0', delta: 'Two files to look at.' },
      {
        type: 'reasoning-delta',
        id: '0',
        delta: '',
        providerMetadata: { anthropic: { signature: 'sig' } },
      },
      { type: 'reasoning-end', id: '0' },
      { type: 'text-delta', id: '1', delta: 'Looking.' },
      { type: 'tool-input-start', id: 'toolu_1', toolName: 'bash' },
      { type: 'tool-input-delta', id: 'toolu_1', delta: '{"command":' },
      { type: 'tool-input-delta', id: 'toolu_1', delta: '"ls"}' },
      { type: 'tool-input-end', id: 'toolu_1' },
      {
        type: 'tool-call',
        toolCallId: 'toolu_1',
        toolName: 'bash',
        input: '{"command":"ls"}',
      },
      {
        type: 'tool-call',
        toolCallId: 'toolu_2',
        toolName: 'read',
        input: '{"path":"a.ts"}',
      },
      finish('tool-calls', 'tool_use'),
    ]);
    const assistant = fold(events);
    // pi sends the sealed entry back, and the thinking's text only in it.
    expect(assistant).toEqual({
      role: 'assistant',
      content: 'Looking.',
      reasoning_details: [
        entry('toolu_1', 0, {
          options: { anthropic: { signature: 'sig' } },
          text: 'Two files to look at.',
        }),
      ],
      tool_calls: [
        {
          id: 'toolu_1',
          type: 'function',
          function: { name: 'bash', arguments: '{"command":"ls"}' },
        },
        {
          id: 'toolu_2',
          type: 'function',
          function: { name: 'read', arguments: '{"path":"a.ts"}' },
        },
      ],
    });

    const next = parse({
      messages: [
        { role: 'system', content: 'You are pi.' },
        { role: 'user', content: 'Look at the files.' },
        assistant,
        { role: 'tool', tool_call_id: 'toolu_1', content: 'a.ts\nb.ts' },
        { role: 'tool', tool_call_id: 'toolu_2', content: 'export {};' },
      ],
    });
    expect(next.prompt).toEqual([
      { role: 'system', content: 'You are pi.' },
      { role: 'user', content: [{ type: 'text', text: 'Look at the files.' }] },
      {
        role: 'assistant',
        content: [
          {
            type: 'reasoning',
            text: 'Two files to look at.',
            providerOptions: { anthropic: { signature: 'sig' } },
          },
          { type: 'text', text: 'Looking.' },
          {
            type: 'tool-call',
            toolCallId: 'toolu_1',
            toolName: 'bash',
            input: { command: 'ls' },
          },
          {
            type: 'tool-call',
            toolCallId: 'toolu_2',
            toolName: 'read',
            input: { path: 'a.ts' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'toolu_1',
            toolName: 'bash',
            output: { type: 'text', value: 'a.ts\nb.ts' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'toolu_2',
            toolName: 'read',
            output: { type: 'text', value: 'export {};' },
          },
        ],
      },
    ]);
  });
});

describe('writing a whole answer as one chat.completion', () => {
  const answer = (
    content: LanguageModelV4GenerateResult['content'],
    unified: LanguageModelV4FinishReason['unified'],
  ) =>
    openAiChatAdapter.encodeAnswer(
      {
        content,
        finishReason: { unified, raw: undefined },
        usage,
        warnings: [],
      },
      context(),
    );

  it('carries the text, the reasoning, the tool calls, the finish and the usage', () => {
    expect(
      answer(
        [
          { type: 'reasoning', text: 'Think.' },
          { type: 'text', text: 'Looking.' },
          {
            type: 'tool-call',
            toolCallId: 'toolu_1',
            toolName: 'read',
            input: '{"path":"a.ts"}',
          },
        ],
        'tool-calls',
      ),
    ).toStrictEqual({
      id: 'chatcmpl-abc123',
      object: 'chat.completion',
      created: CREATED,
      model: 'claude-sonnet-5',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Looking.',
            reasoning_content: 'Think.',
            tool_calls: [
              {
                id: 'toolu_1',
                type: 'function',
                function: { name: 'read', arguments: '{"path":"a.ts"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: USAGE,
    });
  });

  it('says null for the content of an answer that only calls tools', () => {
    const body = answer(
      [
        {
          type: 'tool-call',
          toolCallId: 'toolu_1',
          toolName: 'bash',
          input: '{"command":"ls"}',
        },
      ],
      'tool-calls',
    );
    expect(body.choices).toStrictEqual([
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'toolu_1',
              type: 'function',
              function: { name: 'bash', arguments: '{"command":"ls"}' },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ]);
  });

  it('writes a plain answer cut at its length as text alone', () => {
    const body = answer(
      [
        { type: 'text', text: 'Once upon' },
        { type: 'text', text: ' a time' },
      ],
      'length',
    );
    expect(body.choices).toStrictEqual([
      {
        index: 0,
        message: { role: 'assistant', content: 'Once upon a time' },
        finish_reason: 'length',
      },
    ]);
  });

  it("seals the thinking's signature into reasoning_details, named after the call that followed", () => {
    expect(
      answer(
        [
          {
            type: 'reasoning',
            text: 'Think.',
            providerMetadata: { anthropic: { signature: 'sig' } },
          },
          { type: 'text', text: 'Looking.' },
          {
            type: 'tool-call',
            toolCallId: 'toolu_1',
            toolName: 'read',
            input: '{}',
          },
        ],
        'tool-calls',
      ).choices,
    ).toStrictEqual([
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'Looking.',
          reasoning_content: 'Think.',
          reasoning_details: [
            entry('toolu_1', 0, {
              options: { anthropic: { signature: 'sig' } },
              text: 'Think.',
            }),
          ],
          tool_calls: [
            {
              id: 'toolu_1',
              type: 'function',
              function: { name: 'read', arguments: '{}' },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ]);
    expect(
      answer(
        [
          {
            type: 'reasoning',
            text: 'Hm.',
            providerMetadata: { anthropic: { signature: 'sig-2' } },
          },
          { type: 'text', text: 'Done.' },
        ],
        'stop',
      ).choices,
    ).toMatchObject([
      {
        message: {
          reasoning_details: [
            entry('chatcmpl-abc123', 0, {
              options: { anthropic: { signature: 'sig-2' } },
              text: 'Hm.',
            }),
          ],
        },
      },
    ]);
  });
});

describe('a stream that breaks', () => {
  it("ends with the error in the wire's shape", () => {
    expect(
      openAiChatAdapter.encodeStreamError(
        'rate_limit',
        'Slow down.',
        context(),
      ),
    ).toBe(
      'data: {"error":{"message":"Slow down.","type":"rate_limit_error","param":null,"code":null}}\n\n',
    );
  });
});
