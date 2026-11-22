import type {
  LanguageModelV4FinishReason,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from '@ai-sdk/provider';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isRecord } from '../../../../lib/utils/type-utils.ts';
import { seal, unseal } from './carry.ts';
import { type EncodeContext, TranslationError } from './contract.ts';
import { genAiAdapter } from './genai.ts';

const MODEL = 'gemini/gemini-3-pro';
const EMPTY_OBJECT = { type: 'object', properties: {} };

function parse(body: Record<string, unknown>) {
  return genAiAdapter.parse(body).options;
}

/** The message a body is refused with. */
function refusalOf(body: Record<string, unknown>): string {
  try {
    genAiAdapter.parse(body);
  } catch (error) {
    if (error instanceof TranslationError) return error.message;
    throw error;
  }
  throw new Error('the body was not refused');
}

const user = (...parts: unknown[]) => ({ role: 'user', parts });
const model = (...parts: unknown[]) => ({ role: 'model', parts });
const call = (
  name: string,
  args: Record<string, unknown> = {},
  id?: string,
) => ({
  functionCall: { name, args, ...(id === undefined ? {} : { id }) },
});
const reply = (name: string, response: unknown, id?: string) => ({
  functionResponse: { name, response, ...(id === undefined ? {} : { id }) },
});
const ASKED = [user({ text: 'Hi' })];

const context = (request: Record<string, unknown> = {}): EncodeContext => ({
  model: MODEL,
  id: 'resp-1',
  created: 1_763_800_000,
  request,
});
const THOUGHTS = {
  generationConfig: { thinkingConfig: { includeThoughts: true } },
};

const USAGE: LanguageModelV4Usage = {
  inputTokens: { total: 120, noCache: 20, cacheRead: 100, cacheWrite: 0 },
  outputTokens: { total: 50, text: 30, reasoning: 20 },
};
const USAGE_METADATA = {
  promptTokenCount: 120,
  candidatesTokenCount: 30,
  totalTokenCount: 170,
  cachedContentTokenCount: 100,
  thoughtsTokenCount: 20,
};

const finish = (
  unified: LanguageModelV4FinishReason['unified'],
): LanguageModelV4StreamPart => ({
  type: 'finish',
  finishReason: { unified, raw: unified },
  usage: USAGE,
});

async function* partsOf(
  parts: LanguageModelV4StreamPart[],
): AsyncIterable<LanguageModelV4StreamPart> {
  yield* parts;
}

async function eventsOf(
  parts: LanguageModelV4StreamPart[],
  request: Record<string, unknown> = {},
): Promise<string[]> {
  const events: string[] = [];
  for await (const event of genAiAdapter.encodeStream(
    partsOf(parts),
    context(request),
  )) {
    events.push(event);
  }
  return events;
}

/** The event GenAI streams for one part of the model's turn. */
const partEvent = (part: unknown) =>
  `data: ${JSON.stringify({
    candidates: [{ content: { parts: [part], role: 'model' }, index: 0 }],
    modelVersion: MODEL,
    responseId: 'resp-1',
  })}\n\n`;

/** GenAI's last event of a stream. */
const lastEvent = (
  finishReason: string,
  usageMetadata: Record<string, number> = USAGE_METADATA,
) =>
  `data: ${JSON.stringify({
    candidates: [
      { content: { parts: [], role: 'model' }, finishReason, index: 0 },
    ],
    usageMetadata,
    modelVersion: MODEL,
    responseId: 'resp-1',
  })}\n\n`;

const warnings = () =>
  vi.mocked(console.warn).mock.calls.map(([message]) => String(message));

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a GenAI request read into the SDK’s call', () => {
  it('reads the system instruction, each role, and a turn without a role as the user’s', () => {
    const options = parse({
      systemInstruction: {
        role: 'user',
        parts: [{ text: 'Be brief.' }, { text: 'Answer in French.' }],
      },
      contents: [
        { parts: [{ text: 'Hi' }] },
        model({ text: 'Salut' }),
        user({ text: 'Again' }, { text: '' }),
      ],
    });
    expect(options).toEqual({
      prompt: [
        { role: 'system', content: 'Be brief.\nAnswer in French.' },
        { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Salut' }] },
        { role: 'user', content: [{ type: 'text', text: 'Again' }] },
      ],
    });
    expect(Object.keys(options)).toEqual(['prompt']);
  });

  it('takes a system instruction given as a string', () => {
    expect(
      parse({ systemInstruction: 'Be brief.', contents: ASKED }).prompt[0],
    ).toEqual({ role: 'system', content: 'Be brief.' });
  });

  it('keeps a system instruction’s text and drops its media, naming them', () => {
    expect(
      parse({
        systemInstruction: {
          parts: [
            { text: 'Be brief.' },
            { inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' } },
          ],
        },
        contents: ASKED,
      }).prompt[0],
    ).toEqual({ role: 'system', content: 'Be brief.' });
    expect(warnings()).toEqual([
      expect.stringContaining('systemInstruction media'),
    ]);
  });

  it('reads a model turn’s thoughts as reasoning, and drops their signatures', () => {
    const { prompt } = parse({
      contents: [
        user({ text: 'Why?' }),
        model(
          {
            text: 'The user asks why.',
            thought: true,
            thoughtSignature: 'c2ln',
          },
          { thoughtSignature: 'c2ln' },
          { text: 'Because.' },
        ),
        user({ text: 'Thinking aloud', thought: true }),
      ],
    });
    expect(prompt.slice(1)).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'The user asks why.' },
          { type: 'text', text: 'Because.' },
        ],
      },
      { role: 'user', content: [{ type: 'text', text: 'Thinking aloud' }] },
    ]);
    expect(JSON.stringify(prompt)).not.toContain('c2ln');
    expect(warnings()).toEqual([]);
  });

  it('reads inline data and file URIs as file parts with their media type', () => {
    const { prompt } = parse({
      contents: [
        user(
          { inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' } },
          {
            fileData: {
              mimeType: 'application/pdf',
              fileUri: 'https://example.com/report.pdf',
            },
          },
          {
            fileData: {
              mimeType: 'video/mp4',
              fileUri: 'HTTPS://Example.com/clip.mp4',
            },
          },
          { text: 'What are these?' },
        ),
      ],
    });
    const [message] = prompt;
    if (message?.role !== 'user') throw new Error('expected a user message');
    expect(message.content).toMatchObject([
      {
        type: 'file',
        mediaType: 'image/png',
        data: { type: 'data', data: 'iVBORw0KGgo=' },
      },
      { type: 'file', mediaType: 'application/pdf', data: { type: 'url' } },
      {
        type: 'file',
        mediaType: 'video/mp4',
        data: { type: 'url', originalUrl: 'HTTPS://Example.com/clip.mp4' },
      },
      { type: 'text', text: 'What are these?' },
    ]);
    const links = message.content.flatMap((part) =>
      part.type === 'file' && part.data.type === 'url' ? [part.data] : [],
    );
    expect(links.map((link) => link.url.href)).toEqual([
      'https://example.com/report.pdf',
      'https://example.com/clip.mp4',
    ]);
    expect(links[0]).not.toHaveProperty('originalUrl');
  });

  it.each([
    {
      part: { inlineData: { data: 'AAAA' } },
      refusal:
        'contents[0].parts[0].inlineData needs a mimeType and base64 data',
    },
    {
      part: { inlineData: { mimeType: 'image/png' } },
      refusal:
        'contents[0].parts[0].inlineData needs a mimeType and base64 data',
    },
    {
      part: { fileData: { fileUri: 'https://example.com/a.pdf' } },
      refusal:
        "contents[0].parts[0].fileData needs a mimeType: the model's provider must be told what kind of file it is",
    },
    {
      part: { fileData: { mimeType: 'image/png', fileUri: 'not a uri' } },
      refusal: 'contents[0].parts[0].fileData.fileUri is not a URL',
    },
  ])('refuses a file it cannot pass on: $refusal', ({ part, refusal }) => {
    expect(refusalOf({ contents: [user(part)] })).toBe(refusal);
  });

  it('gives each call of a tool loop its own id, and each response the earliest unanswered call of its function', () => {
    const { prompt } = parse({
      contents: [
        user({ text: 'Compare a and b' }),
        model(
          call('ls', { path: 'a' }),
          call('ls', { path: 'b' }),
          call('read', { file: 'x' }),
        ),
        user(
          reply('ls', { output: 'A' }),
          reply('read', { output: 'X' }),
          reply('ls', { output: 'B' }),
        ),
      ],
    });
    expect(prompt.slice(1)).toEqual([
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_1_0',
            toolName: 'ls',
            input: { path: 'a' },
          },
          {
            type: 'tool-call',
            toolCallId: 'call_1_1',
            toolName: 'ls',
            input: { path: 'b' },
          },
          {
            type: 'tool-call',
            toolCallId: 'call_1_2',
            toolName: 'read',
            input: { file: 'x' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_1_0',
            toolName: 'ls',
            output: { type: 'text', value: 'A' },
          },
          {
            type: 'tool-result',
            toolCallId: 'call_1_2',
            toolName: 'read',
            output: { type: 'text', value: 'X' },
          },
          {
            type: 'tool-result',
            toolCallId: 'call_1_1',
            toolName: 'ls',
            output: { type: 'text', value: 'B' },
          },
        ],
      },
    ]);
  });

  it('pairs responses by the ids the client gave (Gemini CLI’s `<function>__<id>`), and still gives the upstream ids of its own', () => {
    const { prompt } = parse({
      contents: [
        user({ text: 'Read both' }),
        model(
          {
            ...call('read_file', { path: 'a' }, 'read_file__toolu_A'),
            thoughtSignature: 'skip_thought_signature_validator',
          },
          call('read_file', { path: 'b' }, 'read_file__toolu_B'),
          { functionCall: { name: 'now', id: 'now__toolu_C' } },
        ),
        user(
          reply('read_file', { output: 'b' }, 'read_file__toolu_B'),
          reply('now', { output: '12:00' }, 'now__toolu_C'),
          reply('read_file', { output: 'a' }, 'read_file__toolu_A'),
        ),
      ],
    });
    expect(prompt.slice(1)).toEqual([
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_1_0',
            toolName: 'read_file',
            input: { path: 'a' },
          },
          {
            type: 'tool-call',
            toolCallId: 'call_1_1',
            toolName: 'read_file',
            input: { path: 'b' },
          },
          {
            type: 'tool-call',
            toolCallId: 'call_1_2',
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
            toolCallId: 'call_1_1',
            toolName: 'read_file',
            output: { type: 'text', value: 'b' },
          },
          {
            type: 'tool-result',
            toolCallId: 'call_1_2',
            toolName: 'now',
            output: { type: 'text', value: '12:00' },
          },
          {
            type: 'tool-result',
            toolCallId: 'call_1_0',
            toolName: 'read_file',
            output: { type: 'text', value: 'a' },
          },
        ],
      },
    ]);
    expect(JSON.stringify(prompt)).not.toContain('skip_thought_signature');
  });

  it('pairs a response whose id names no call with the earliest unanswered call of its function', () => {
    const { prompt } = parse({
      contents: [
        user({ text: 'Run twice' }),
        model(call('run', {}, 'x1'), call('run', {}, 'x2')),
        user(
          reply('run', { output: 'first' }, 'elsewhere'),
          reply('run', { output: 'second' }),
        ),
      ],
    });
    expect(prompt[2]).toMatchObject({
      role: 'tool',
      content: [
        { toolCallId: 'call_1_0', output: { value: 'first' } },
        { toolCallId: 'call_1_1', output: { value: 'second' } },
      ],
    });
  });

  it('refuses a response that answers no earlier call, as GenAI does', () => {
    expect(refusalOf({ contents: [user(reply('ghost', {}))] })).toBe(
      'contents[0].parts[0].functionResponse answers no earlier functionCall of "ghost"',
    );
    expect(
      refusalOf({
        contents: [
          user({ text: 'Go' }),
          model(call('run')),
          user(reply('run', {}), reply('run', {})),
        ],
      }),
    ).toBe(
      'contents[2].parts[1].functionResponse answers no earlier functionCall of "run"',
    );
  });

  it('refuses a call in a user turn and a response in a model turn', () => {
    expect(refusalOf({ contents: [user(call('run'))] })).toBe(
      'contents[0].parts[0].functionCall belongs in a model turn',
    );
    expect(
      refusalOf({ contents: [user({ text: 'Go' }), model(reply('run', {}))] }),
    ).toBe('contents[1].parts[0].functionResponse belongs in a user turn');
  });

  it('splits a user turn that answers calls and says more: the tool results first, then the rest', () => {
    const { prompt } = parse({
      contents: [
        user({ text: 'Look at the logo' }),
        model(call('read_file', { path: 'logo.png' })),
        user(
          { text: 'Then continue' },
          reply('read_file', {
            output: 'Binary content provided (1 item(s)).',
          }),
          { inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' } },
        ),
      ],
    });
    expect(prompt.slice(2)).toEqual([
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_1_0',
            toolName: 'read_file',
            output: {
              type: 'text',
              value: 'Binary content provided (1 item(s)).',
            },
          },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Then continue' },
          {
            type: 'file',
            mediaType: 'image/png',
            data: { type: 'data', data: 'iVBORw0KGgo=' },
          },
        ],
      },
    ]);
  });

  it.each([
    {
      name: 'a lone output string as text',
      response: { output: 'file text' },
      output: { type: 'text', value: 'file text' },
    },
    {
      name: 'a lone output object as JSON',
      response: { output: { lines: 3 } },
      output: { type: 'json', value: { lines: 3 } },
    },
    {
      name: 'a lone error string as an error',
      response: { error: 'no such file' },
      output: { type: 'error-text', value: 'no such file' },
    },
    {
      name: 'a lone error object as an error',
      response: { error: { code: 'ENOENT' } },
      output: { type: 'error-json', value: { code: 'ENOENT' } },
    },
    {
      name: 'any other response whole',
      response: { output: 'partial', truncated: true },
      output: { type: 'json', value: { output: 'partial', truncated: true } },
    },
    {
      name: 'an empty response as the empty object',
      response: {},
      output: { type: 'json', value: {} },
    },
    {
      name: 'a missing response as the empty object',
      response: undefined,
      output: { type: 'json', value: {} },
    },
  ])('reads $name', ({ response, output }) => {
    const { prompt } = parse({
      contents: [
        user({ text: 'Go' }),
        model(call('read')),
        user(reply('read', response)),
      ],
    });
    expect(prompt[2]).toMatchObject({ role: 'tool', content: [{ output }] });
  });

  it('carries the media of a multimodal function response in the tool output', () => {
    const { prompt } = parse({
      contents: [
        user({ text: 'Show it' }),
        model(call('read_file', { path: 'logo.png' })),
        user({
          functionResponse: {
            name: 'read_file',
            response: { output: 'The logo' },
            parts: [
              { inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' } },
              { videoMetadata: { startOffset: '1s' } },
            ],
          },
        }),
      ],
    });
    expect(prompt[2]).toEqual({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call_1_0',
          toolName: 'read_file',
          output: {
            type: 'content',
            value: [
              { type: 'text', text: 'The logo' },
              {
                type: 'file',
                mediaType: 'image/png',
                data: { type: 'data', data: 'iVBORw0KGgo=' },
              },
            ],
          },
        },
      ],
    });
    expect(warnings()).toEqual([
      expect.stringContaining(
        'functionResponse.parts entries other than files',
      ),
    ]);
  });

  it.each([
    {
      contents: [model({ functionCall: { args: {} } })],
      refusal:
        'contents[0].parts[0].functionCall needs the name of the function',
    },
    {
      contents: [model({ functionCall: { name: 'run', args: '{"x":1}' } })],
      refusal: 'contents[0].parts[0].functionCall.args must be an object',
    },
    {
      contents: [user({ functionResponse: { response: {} } })],
      refusal:
        'contents[0].parts[0].functionResponse needs the name of the function it answers',
    },
    {
      contents: [user('Hi')],
      refusal: 'contents[0].parts[0] must be an object',
    },
  ])('refuses a malformed part: $refusal', ({ contents, refusal }) => {
    expect(refusalOf({ contents })).toBe(refusal);
  });

  it('drops code Google ran, saying so once', () => {
    const { prompt } = parse({
      contents: [
        user({ text: 'What is 2+2?' }),
        model(
          { executableCode: { language: 'PYTHON', code: 'print(2+2)' } },
          { codeExecutionResult: { outcome: 'OUTCOME_OK', output: '4' } },
          { text: 'It is 4.' },
        ),
        user({ text: 'And 3+3?' }),
        model({ executableCode: { language: 'PYTHON', code: 'print(3+3)' } }),
      ],
    });
    expect(prompt).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'What is 2+2?' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'It is 4.' }] },
      { role: 'user', content: [{ type: 'text', text: 'And 3+3?' }] },
    ]);
    expect(warnings()).toEqual([
      expect.stringContaining(
        'dropped from a GenAI request: code execution parts',
      ),
    ]);
  });

  it('reads function declarations: a JSON Schema as given, none or an empty one as the empty object schema', () => {
    const { tools } = parse({
      contents: ASKED,
      tools: [
        {
          functionDeclarations: [
            {
              name: 'grep',
              description: 'Search files',
              parametersJsonSchema: {
                type: 'object',
                properties: { pattern: { type: 'string' } },
                required: ['pattern'],
              },
            },
            { name: 'now' },
            {
              name: 'pwd',
              description: '',
              parametersJsonSchema: { type: 'object' },
            },
            { name: 'noop', parametersJsonSchema: {} },
          ],
        },
      ],
    });
    expect(tools).toEqual([
      {
        type: 'function',
        name: 'grep',
        description: 'Search files',
        inputSchema: {
          type: 'object',
          properties: { pattern: { type: 'string' } },
          required: ['pattern'],
        },
      },
      { type: 'function', name: 'now', inputSchema: EMPTY_OBJECT },
      { type: 'function', name: 'pwd', inputSchema: EMPTY_OBJECT },
      { type: 'function', name: 'noop', inputSchema: EMPTY_OBJECT },
    ]);
  });

  it('converts Google’s OpenAPI parameters to JSON Schema', () => {
    const { tools } = parse({
      contents: ASKED,
      tools: [
        {
          functionDeclarations: [
            {
              name: 'save',
              parameters: {
                type: 'OBJECT',
                properties: {
                  name: { type: 'STRING', description: 'Who', example: 'Ada' },
                  age: { type: 'INTEGER', format: 'int32', nullable: true },
                  tags: {
                    type: 'ARRAY',
                    items: { type: 'STRING', enum: ['a', 'b'], nullable: true },
                  },
                  choice: {
                    anyOf: [{ type: 'STRING' }, { type: 'NUMBER' }],
                    nullable: true,
                  },
                  anything: { type: 'TYPE_UNSPECIFIED' },
                },
                required: ['name'],
                propertyOrdering: ['name', 'age'],
              },
            },
          ],
        },
      ],
    });
    expect(tools?.[0]).toEqual({
      type: 'function',
      name: 'save',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Who', examples: ['Ada'] },
          age: { type: ['integer', 'null'], format: 'int32' },
          tags: {
            type: 'array',
            items: { type: ['string', 'null'], enum: ['a', 'b', null] },
          },
          choice: {
            anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }],
          },
          anything: {},
        },
        required: ['name'],
      },
    });
  });

  it('drops Google’s built-in tools, naming each once', () => {
    const { tools } = parse({
      contents: ASKED,
      tools: [
        { googleSearch: {} },
        { codeExecution: {} },
        { functionDeclarations: [{ name: 'f' }], urlContext: {} },
        { googleSearch: {} },
      ],
    });
    expect(tools).toEqual([
      { type: 'function', name: 'f', inputSchema: EMPTY_OBJECT },
    ]);
    expect(warnings()).toEqual([
      expect.stringContaining('googleSearch tool'),
      expect.stringContaining('codeExecution tool'),
      expect.stringContaining('urlContext tool'),
    ]);
  });

  it.each([
    {
      tools: [{ functionDeclarations: [{ description: 'nameless' }] }],
      refusal: 'tools[0].functionDeclarations[0] needs a name',
    },
    {
      tools: [{ functionDeclarations: { name: 'f' } }],
      refusal: 'tools[0].functionDeclarations must be an array',
    },
    { tools: ['grep'], refusal: 'tools[0] must be an object' },
    { tools: { functionDeclarations: [] }, refusal: 'tools must be an array' },
  ])('refuses malformed tools: $refusal', ({ tools, refusal }) => {
    expect(refusalOf({ contents: ASKED, tools })).toBe(refusal);
  });

  it.each([
    {
      name: 'AUTO as auto',
      config: { mode: 'AUTO' },
      choice: { type: 'auto' },
      kept: ['a', 'b', 'c'],
    },
    {
      name: 'NONE as none',
      config: { mode: 'NONE' },
      choice: { type: 'none' },
      kept: ['a', 'b', 'c'],
    },
    {
      name: 'ANY as required',
      config: { mode: 'ANY' },
      choice: { type: 'required' },
      kept: ['a', 'b', 'c'],
    },
    {
      name: 'ANY of one function as that tool',
      config: { mode: 'ANY', allowedFunctionNames: ['b'] },
      choice: { type: 'tool', toolName: 'b' },
      kept: ['a', 'b', 'c'],
    },
    {
      name: 'ANY of some functions as required among those',
      config: { mode: 'ANY', allowedFunctionNames: ['a', 'b'] },
      choice: { type: 'required' },
      kept: ['a', 'b'],
    },
    {
      name: 'VALIDATED as auto among the allowed',
      config: { mode: 'VALIDATED', allowedFunctionNames: ['c'] },
      choice: { type: 'auto' },
      kept: ['c'],
    },
    {
      name: 'no mode as the default',
      config: {},
      choice: undefined,
      kept: ['a', 'b', 'c'],
    },
    {
      name: 'in lower case as in upper case',
      config: { mode: 'none' },
      choice: { type: 'none' },
      kept: ['a', 'b', 'c'],
    },
  ])('reads the function calling mode $name', ({ config, choice, kept }) => {
    const options = parse({
      contents: ASKED,
      tools: [
        { functionDeclarations: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] },
      ],
      toolConfig: { functionCallingConfig: config },
    });
    expect(options.toolChoice).toEqual(choice);
    expect(options.tools?.map((tool) => tool.name)).toEqual(kept);
  });

  it('sends no tool choice for a request that declares no tools', () => {
    expect(
      parse({
        contents: ASKED,
        toolConfig: { functionCallingConfig: { mode: 'NONE' } },
      }),
    ).not.toHaveProperty('toolChoice');
  });

  it('refuses a function calling mode GenAI does not have', () => {
    expect(
      refusalOf({
        contents: ASKED,
        toolConfig: { functionCallingConfig: { mode: 'SOMETIMES' } },
      }),
    ).toBe(
      'toolConfig.functionCallingConfig.mode must be AUTO, ANY, NONE or VALIDATED',
    );
    expect(
      refusalOf({
        contents: ASKED,
        toolConfig: { functionCallingConfig: { mode: 2 } },
      }),
    ).toBe('toolConfig.functionCallingConfig.mode must be a string');
  });

  it('reads the sampling and output settings', () => {
    expect(
      parse({
        contents: ASKED,
        generationConfig: {
          maxOutputTokens: 1000,
          temperature: 0.5,
          topP: 0.9,
          topK: 40,
          seed: 7,
          presencePenalty: 0.1,
          frequencyPenalty: 0.2,
          stopSequences: ['END'],
          candidateCount: 1,
        },
      }),
    ).toEqual({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
      maxOutputTokens: 1000,
      temperature: 0.5,
      topP: 0.9,
      topK: 40,
      seed: 7,
      presencePenalty: 0.1,
      frequencyPenalty: 0.2,
      stopSequences: ['END'],
    });
    expect(warnings()).toEqual([]);
  });

  it('reads JSON output with its schema, given as JSON Schema or as Google’s OpenAPI', () => {
    const schema = { type: 'object', properties: { city: { type: 'string' } } };
    expect(
      parse({
        contents: ASKED,
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
        },
      }).responseFormat,
    ).toEqual({ type: 'json', schema });
    expect(
      parse({
        contents: ASKED,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: { city: { type: 'STRING' } },
          },
        },
      }).responseFormat,
    ).toEqual({ type: 'json', schema });
    expect(
      parse({
        contents: ASKED,
        generationConfig: { responseMimeType: 'application/json' },
      }).responseFormat,
    ).toEqual({ type: 'json' });
    expect(
      parse({
        contents: ASKED,
        generationConfig: { responseMimeType: 'text/plain' },
      }).responseFormat,
    ).toBeUndefined();
    expect(warnings()).toEqual([]);
  });

  it('drops a response schema given without JSON output, naming it', () => {
    expect(
      parse({
        contents: ASKED,
        generationConfig: { responseSchema: { type: 'STRING' } },
      }).responseFormat,
    ).toBeUndefined();
    expect(warnings()).toEqual([expect.stringContaining('response schema')]);
  });

  it.each([
    {
      config: { candidateCount: 2 },
      refusal:
        'generationConfig.candidateCount above 1 cannot be honoured: the relay answers with one candidate',
    },
    {
      config: { responseMimeType: 'text/x.enum' },
      refusal:
        'generationConfig.responseMimeType "text/x.enum" cannot be honoured: the model\'s provider answers in text or JSON',
    },
    {
      config: { temperature: '0.5' },
      refusal: 'generationConfig.temperature must be a number',
    },
    {
      config: { stopSequences: 'END' },
      refusal: 'generationConfig.stopSequences must be an array of strings',
    },
    {
      config: { thinkingConfig: { thinkingLevel: 'EXTREME' } },
      refusal:
        'generationConfig.thinkingConfig.thinkingLevel must be MINIMAL, LOW, MEDIUM or HIGH',
    },
    {
      config: { thinkingConfig: 'HIGH' },
      refusal: 'generationConfig.thinkingConfig must be an object',
    },
    { config: 'fast', refusal: 'generationConfig must be an object' },
  ])('refuses a setting it cannot honour: $refusal', ({ config, refusal }) => {
    expect(refusalOf({ contents: ASKED, generationConfig: config })).toBe(
      refusal,
    );
  });

  it.each([
    { thinking: { thinkingBudget: 0 }, reasoning: 'none' },
    { thinking: { thinkingBudget: -1 }, reasoning: undefined },
    { thinking: { thinkingBudget: 1024 }, reasoning: 'low' },
    { thinking: { thinkingBudget: 2048 }, reasoning: 'low' },
    { thinking: { thinkingBudget: 4096 }, reasoning: 'medium' },
    { thinking: { thinkingBudget: 8192 }, reasoning: 'medium' },
    { thinking: { thinkingBudget: 24_576 }, reasoning: 'high' },
    { thinking: { thinkingLevel: 'MINIMAL' }, reasoning: 'minimal' },
    { thinking: { thinkingLevel: 'LOW' }, reasoning: 'low' },
    { thinking: { thinkingLevel: 'MEDIUM' }, reasoning: 'medium' },
    {
      thinking: { thinkingLevel: 'HIGH', thinkingBudget: 0 },
      reasoning: 'high',
    },
    {
      thinking: {
        thinkingLevel: 'THINKING_LEVEL_UNSPECIFIED',
        thinkingBudget: 4096,
      },
      reasoning: 'medium',
    },
    { thinking: { includeThoughts: true }, reasoning: undefined },
  ])(
    'reads the thinking config $thinking as the effort $reasoning',
    ({ thinking, reasoning }) => {
      expect(
        parse({
          contents: ASKED,
          generationConfig: { thinkingConfig: thinking },
        }).reasoning,
      ).toBe(reasoning);
    },
  );

  it('drops what the model’s provider has no counterpart for, naming it, and ignores Google’s own settings', () => {
    const options = parse({
      contents: [user({ text: 'Hi' }, { toolCall: { name: 'google_search' } })],
      cachedContent: 'cachedContents/abc',
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      ],
      labels: { team: 'a' },
      someFutureField: true,
      generationConfig: { responseLogprobs: true, temperature: 1 },
    });
    expect(options.prompt).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
    ]);
    expect(options.temperature).toBe(1);
    expect(warnings()).toEqual([
      expect.stringContaining('dropped from a GenAI request: toolCall parts'),
      expect.stringContaining('generationConfig.responseLogprobs'),
      expect.stringContaining('cachedContent'),
      expect.stringContaining('someFutureField'),
    ]);
  });

  it.each([
    { body: {}, refusal: 'contents is required: the conversation to answer' },
    { body: { contents: 'Hi' }, refusal: 'contents must be an array of turns' },
    { body: { contents: [] }, refusal: 'contents must hold at least one turn' },
    {
      body: { contents: ['Hi'] },
      refusal: 'contents[0] must be an object with a role and parts',
    },
    {
      body: { contents: [{ role: 'system', parts: [{ text: 'Hi' }] }] },
      refusal: 'contents[0].role must be "user" or "model"',
    },
    {
      body: { contents: [{ role: 'user', parts: 'Hi' }] },
      refusal: 'contents[0].parts must be an array',
    },
    {
      body: { contents: [user({ text: 7 })] },
      refusal: 'contents[0].parts[0].text must be a string',
    },
    {
      body: { contents: [user({ text: '' })] },
      refusal: 'contents says nothing: every part is empty',
    },
    {
      body: { contents: ASKED, systemInstruction: 7 },
      refusal: 'systemInstruction must be a Content with parts, or a string',
    },
  ])('refuses a request GenAI would refuse: $refusal', ({ body, refusal }) => {
    expect(refusalOf(body)).toBe(refusal);
  });
});

describe('a streamed answer written as GenAI events', () => {
  it('streams text as one GenerateContentResponse per piece, ending with the finish reason and the usage', async () => {
    expect(
      await eventsOf([
        { type: 'stream-start', warnings: [] },
        { type: 'response-metadata', id: 'up-1', modelId: 'claude-x' },
        { type: 'text-start', id: 't0' },
        { type: 'text-delta', id: 't0', delta: 'Hel' },
        { type: 'text-delta', id: 't0', delta: 'lo' },
        { type: 'text-delta', id: 't0', delta: '' },
        { type: 'text-end', id: 't0' },
        finish('stop'),
      ]),
    ).toEqual([
      'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}],"role":"model"},"index":0}],"modelVersion":"gemini/gemini-3-pro","responseId":"resp-1"}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"lo"}],"role":"model"},"index":0}],"modelVersion":"gemini/gemini-3-pro","responseId":"resp-1"}\n\n',
      'data: {"candidates":[{"content":{"parts":[],"role":"model"},"finishReason":"STOP","index":0}],"usageMetadata":{"promptTokenCount":120,"candidatesTokenCount":30,"totalTokenCount":170,"cachedContentTokenCount":100,"thoughtsTokenCount":20},"modelVersion":"gemini/gemini-3-pro","responseId":"resp-1"}\n\n',
    ]);
  });

  it('streams thoughts as thought parts to a client that asked for them, and leaves them out otherwise', async () => {
    const parts: LanguageModelV4StreamPart[] = [
      { type: 'reasoning-start', id: 'r0' },
      { type: 'reasoning-delta', id: 'r0', delta: 'The user greets.' },
      { type: 'reasoning-end', id: 'r0' },
      { type: 'text-delta', id: 't0', delta: 'Hi!' },
      finish('stop'),
    ];
    expect(await eventsOf(parts, THOUGHTS)).toEqual([
      partEvent({ text: 'The user greets.', thought: true }),
      partEvent({ text: 'Hi!' }),
      lastEvent('STOP'),
    ]);
    for (const request of [
      {},
      { generationConfig: { thinkingConfig: { thinkingBudget: 1024 } } },
    ]) {
      expect(await eventsOf(parts, request)).toEqual([
        partEvent({ text: 'Hi!' }),
        lastEvent('STOP'),
      ]);
    }
  });

  it('writes a streamed call once, whole, when its input is complete', async () => {
    expect(
      await eventsOf([
        { type: 'tool-input-start', id: 'toolu_1', toolName: 'read_file' },
        { type: 'tool-input-delta', id: 'toolu_1', delta: '{"path":' },
        { type: 'tool-input-delta', id: 'toolu_1', delta: '"a.ts"}' },
        { type: 'tool-input-end', id: 'toolu_1' },
        {
          type: 'tool-call',
          toolCallId: 'toolu_1',
          toolName: 'read_file',
          input: '{"path":"a.ts"}',
        },
        finish('tool-calls'),
      ]),
    ).toEqual([
      partEvent({
        functionCall: {
          name: 'read_file',
          args: { path: 'a.ts' },
          id: 'toolu_1',
        },
      }),
      lastEvent('STOP'),
    ]);
  });

  it('writes calls that arrive only whole, in order, an empty or null input as no arguments', async () => {
    expect(
      await eventsOf([
        { type: 'text-delta', id: 't0', delta: 'Reading.' },
        {
          type: 'tool-call',
          toolCallId: 'call_a',
          toolName: 'read_file',
          input: '{"path":"a"}',
        },
        { type: 'tool-call', toolCallId: 'call_b', toolName: 'now', input: '' },
        {
          type: 'tool-call',
          toolCallId: 'call_c',
          toolName: 'pwd',
          input: 'null',
        },
        finish('tool-calls'),
      ]),
    ).toEqual([
      partEvent({ text: 'Reading.' }),
      partEvent({
        functionCall: { name: 'read_file', args: { path: 'a' }, id: 'call_a' },
      }),
      partEvent({ functionCall: { name: 'now', args: {}, id: 'call_b' } }),
      partEvent({ functionCall: { name: 'pwd', args: {}, id: 'call_c' } }),
      lastEvent('STOP'),
    ]);
  });

  it('writes a call whose input streamed but never arrived whole at the end, from what streamed', async () => {
    expect(
      await eventsOf([
        { type: 'tool-input-start', id: 'toolu_1', toolName: 'search' },
        { type: 'tool-input-delta', id: 'toolu_1', delta: '{"q":"relay"}' },
        { type: 'tool-input-end', id: 'toolu_1' },
        finish('tool-calls'),
      ]),
    ).toEqual([
      partEvent({
        functionCall: { name: 'search', args: { q: 'relay' }, id: 'toolu_1' },
      }),
      lastEvent('STOP'),
    ]);
  });

  it('never writes a call twice, nor one the provider ran itself', async () => {
    const whole: LanguageModelV4StreamPart = {
      type: 'tool-call',
      toolCallId: 'toolu_1',
      toolName: 'run',
      input: '{}',
    };
    expect(
      await eventsOf([
        whole,
        whole,
        {
          type: 'tool-call',
          toolCallId: 'srvtoolu_1',
          toolName: 'web_search',
          input: '{"query":"x"}',
          providerExecuted: true,
        },
        finish('tool-calls'),
      ]),
    ).toEqual([
      partEvent({ functionCall: { name: 'run', args: {}, id: 'toolu_1' } }),
      lastEvent('STOP'),
    ]);
  });

  it('leaves out a call the token limit cut off, and ends with MAX_TOKENS', async () => {
    expect(
      await eventsOf([
        { type: 'text-delta', id: 't0', delta: 'Let me' },
        { type: 'tool-input-start', id: 'call_1', toolName: 'write_file' },
        { type: 'tool-input-delta', id: 'call_1', delta: '{"path":"a' },
        { type: 'tool-input-end', id: 'call_1' },
        {
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName: 'write_file',
          input: '{"path":"a',
        },
        finish('length'),
      ]),
    ).toEqual([partEvent({ text: 'Let me' }), lastEvent('MAX_TOKENS')]);
    expect(warnings()).toEqual([
      expect.stringContaining(
        'a call to "write_file" is left out of a GenAI answer',
      ),
    ]);
  });

  it('writes a file the model made as inline data, or by its URL', async () => {
    expect(
      await eventsOf([
        {
          type: 'file',
          mediaType: 'image/png',
          data: { type: 'data', data: new Uint8Array([1, 2, 3]) },
        },
        {
          type: 'file',
          mediaType: 'image/jpeg',
          data: { type: 'url', url: new URL('https://example.com/cat.jpg') },
        },
        finish('stop'),
      ]),
    ).toEqual([
      partEvent({ inlineData: { mimeType: 'image/png', data: 'AQID' } }),
      partEvent({
        fileData: {
          mimeType: 'image/jpeg',
          fileUri: 'https://example.com/cat.jpg',
        },
      }),
      lastEvent('STOP'),
    ]);
  });

  it('throws on an error part, so the relay ends the stream with the wire’s error', async () => {
    await expect(
      eventsOf([
        { type: 'text-delta', id: 't0', delta: 'Hi' },
        { type: 'error', error: new Error('overloaded') },
      ]),
    ).rejects.toThrow('the model provider reported an error mid-stream');
  });
});

describe('a whole answer written as one GenAI response', () => {
  const answer = (
    result: Partial<LanguageModelV4GenerateResult>,
    request: Record<string, unknown> = {},
  ) =>
    genAiAdapter.encodeAnswer(
      {
        content: [],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: USAGE,
        warnings: [],
        ...result,
      },
      context(request),
    );

  it('holds every part in order, with the finish reason and the usage', () => {
    const result: Partial<LanguageModelV4GenerateResult> = {
      content: [
        { type: 'reasoning', text: 'The user wants a file.' },
        { type: 'text', text: 'Reading it.' },
        {
          type: 'tool-call',
          toolCallId: 'toolu_1',
          toolName: 'read_file',
          input: '{"path":"a.ts"}',
        },
      ],
      finishReason: { unified: 'tool-calls', raw: 'tool_use' },
    };
    expect(answer(result, THOUGHTS)).toEqual({
      candidates: [
        {
          content: {
            parts: [
              { text: 'The user wants a file.', thought: true },
              { text: 'Reading it.' },
              {
                functionCall: {
                  name: 'read_file',
                  args: { path: 'a.ts' },
                  id: 'toolu_1',
                },
              },
            ],
            role: 'model',
          },
          finishReason: 'STOP',
          index: 0,
        },
      ],
      usageMetadata: USAGE_METADATA,
      modelVersion: MODEL,
      responseId: 'resp-1',
    });
    expect(answer(result)).toMatchObject({
      candidates: [
        { content: { parts: [{ text: 'Reading it.' }, { functionCall: {} }] } },
      ],
    });
  });

  it.each([
    ['stop', 'STOP'],
    ['tool-calls', 'STOP'],
    ['length', 'MAX_TOKENS'],
    ['content-filter', 'SAFETY'],
    ['error', 'OTHER'],
    ['interrupted', 'OTHER'],
    ['other', 'OTHER'],
  ] as const)('says the finish reason %s as %s', (unified, reason) => {
    expect(
      answer({
        content: [{ type: 'text', text: 'x' }],
        finishReason: { unified, raw: undefined },
      }),
    ).toMatchObject({ candidates: [{ finishReason: reason }] });
  });

  it.each([
    {
      name: 'every count',
      usage: USAGE,
      metadata: USAGE_METADATA,
    },
    {
      name: 'no count at all',
      usage: {
        inputTokens: {
          total: undefined,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: undefined,
          text: undefined,
          reasoning: undefined,
        },
      },
      metadata: {},
    },
    {
      name: 'the parts without their totals',
      usage: {
        inputTokens: {
          total: undefined,
          noCache: 10,
          cacheRead: 30,
          cacheWrite: 5,
        },
        outputTokens: { total: undefined, text: 7, reasoning: undefined },
      },
      metadata: {
        promptTokenCount: 45,
        candidatesTokenCount: 7,
        totalTokenCount: 52,
        cachedContentTokenCount: 30,
      },
    },
    {
      name: 'no cache and no thinking',
      usage: {
        inputTokens: { total: 9, noCache: 9, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 4, text: 4, reasoning: 0 },
      },
      metadata: {
        promptTokenCount: 9,
        candidatesTokenCount: 4,
        totalTokenCount: 13,
      },
    },
  ])('reports the usage of $name as GenAI counts it', ({ usage, metadata }) => {
    expect(answer({ usage }).usageMetadata).toEqual(metadata);
  });
});

describe('what a provider asks to have back, carried in thoughtSignature', () => {
  const SIGNED = { anthropic: { signature: 'sig-1' } };
  const THINKING_SEAL = seal({ options: SIGNED, text: 'Let me think.' });
  const claudeThinks: LanguageModelV4StreamPart[] = [
    { type: 'reasoning-start', id: 'r0' },
    { type: 'reasoning-delta', id: 'r0', delta: 'Let me ' },
    { type: 'reasoning-delta', id: 'r0', delta: 'think.' },
    {
      type: 'reasoning-delta',
      id: 'r0',
      delta: '',
      providerMetadata: SIGNED,
    },
    { type: 'reasoning-end', id: 'r0' },
  ];
  const readFile: LanguageModelV4StreamPart = {
    type: 'tool-call',
    toolCallId: 'toolu_1',
    toolName: 'read_file',
    input: '{"path":"a.ts"}',
  };
  const readFileCall = {
    name: 'read_file',
    args: { path: 'a.ts' },
    id: 'toolu_1',
  };

  it('seals a thinking signature with the text it signs, on the block’s last thought and on the part after it', async () => {
    expect(unseal(THINKING_SEAL)).toEqual({
      options: SIGNED,
      text: 'Let me think.',
    });
    expect(
      await eventsOf(
        [
          ...claudeThinks,
          { type: 'text-delta', id: 't0', delta: 'Done.' },
          finish('stop'),
        ],
        THOUGHTS,
      ),
    ).toEqual([
      partEvent({ text: 'Let me ', thought: true }),
      partEvent({
        text: 'think.',
        thought: true,
        thoughtSignature: THINKING_SEAL,
      }),
      partEvent({ text: 'Done.', thoughtSignature: THINKING_SEAL }),
      lastEvent('STOP'),
    ]);
  });

  it('carries thinking the client does not see on the first part after it', async () => {
    expect(
      await eventsOf([...claudeThinks, readFile, finish('tool-calls')]),
    ).toEqual([
      partEvent({
        functionCall: readFileCall,
        thoughtSignature: THINKING_SEAL,
      }),
      lastEvent('STOP'),
    ]);
  });

  it('carries redacted thinking, which has no text', async () => {
    const redacted = { anthropic: { redactedData: 'opaque' } };
    expect(
      await eventsOf(
        [
          { type: 'reasoning-start', id: 'r0', providerMetadata: redacted },
          { type: 'reasoning-end', id: 'r0' },
          { type: 'text-delta', id: 't0', delta: 'Ok.' },
          finish('stop'),
        ],
        THOUGHTS,
      ),
    ).toEqual([
      partEvent({
        text: 'Ok.',
        thoughtSignature: seal({ options: redacted, text: '' }),
      }),
      lastEvent('STOP'),
    ]);
  });

  it('gives a call its Google signature as Google wrote it, and thinking without a signature no carrier', async () => {
    expect(
      await eventsOf(
        [
          { type: 'reasoning-start', id: 'r0' },
          { type: 'reasoning-delta', id: 'r0', delta: 'Plan.' },
          { type: 'reasoning-end', id: 'r0' },
          {
            ...readFile,
            providerMetadata: { google: { thoughtSignature: 'g-sig' } },
          },
          {
            type: 'tool-call',
            toolCallId: 'toolu_2',
            toolName: 'now',
            input: '{}',
          },
          finish('tool-calls'),
        ],
        THOUGHTS,
      ),
    ).toEqual([
      partEvent({ text: 'Plan.', thought: true }),
      partEvent({ functionCall: readFileCall, thoughtSignature: 'g-sig' }),
      partEvent({ functionCall: { name: 'now', args: {}, id: 'toolu_2' } }),
      lastEvent('STOP'),
    ]);
  });

  it('seals a call’s Google signature with the thinking before it when one call carries both', async () => {
    const google = { google: { thoughtSignature: 'g-sig' } };
    const [event] = await eventsOf([
      ...claudeThinks,
      { ...readFile, providerMetadata: google },
      finish('tool-calls'),
    ]);
    expect(event).toBe(
      partEvent({
        functionCall: readFileCall,
        thoughtSignature: seal({
          options: SIGNED,
          text: 'Let me think.',
          calls: { toolu_1: google },
        }),
      }),
    );
  });

  it('writes and carries a whole answer as the stream does', () => {
    expect(
      genAiAdapter.encodeAnswer(
        {
          content: [
            {
              type: 'reasoning',
              text: 'Let me think.',
              providerMetadata: SIGNED,
            },
            { type: 'text', text: 'Reading.' },
            readFile,
          ],
          finishReason: { unified: 'tool-calls', raw: 'tool_use' },
          usage: USAGE,
          warnings: [],
        },
        context(THOUGHTS),
      ),
    ).toMatchObject({
      candidates: [
        {
          content: {
            parts: [
              {
                text: 'Let me think.',
                thought: true,
                thoughtSignature: THINKING_SEAL,
              },
              { text: 'Reading.', thoughtSignature: THINKING_SEAL },
              { functionCall: readFileCall },
            ],
          },
        },
      ],
    });
  });

  it('sends a call’s Google signature back to Google, and never Gemini CLI’s stand-in', () => {
    const { prompt } = parse({
      contents: [
        user({ text: 'Go' }),
        model(
          { ...call('read_file', { path: 'a' }), thoughtSignature: 'g-sig' },
          {
            ...call('now'),
            thoughtSignature: 'skip_thought_signature_validator',
          },
        ),
      ],
    });
    expect(prompt[1]).toEqual({
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'call_1_0',
          toolName: 'read_file',
          input: { path: 'a' },
          providerOptions: { google: { thoughtSignature: 'g-sig' } },
        },
        {
          type: 'tool-call',
          toolCallId: 'call_1_1',
          toolName: 'now',
          input: {},
        },
      ],
    });
  });

  it('restores sealed thinking from a thought, with the text the provider signed, once', () => {
    const { prompt } = parse({
      contents: [
        user({ text: 'Go' }),
        model(
          { text: 'Let me ', thought: true },
          { text: 'think.', thought: true, thoughtSignature: THINKING_SEAL },
          // A client that repeats the sealed thought.
          { text: 'think.', thought: true, thoughtSignature: THINKING_SEAL },
          { text: 'Done.', thoughtSignature: THINKING_SEAL },
        ),
      ],
    });
    expect(prompt[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'Let me think.', providerOptions: SIGNED },
        { type: 'text', text: 'Done.' },
      ],
    });
  });

  it('restores sealed thinking from the part after it, where Gemini CLI keeps it', () => {
    const { prompt } = parse({
      contents: [
        user({ text: 'Go' }),
        model(
          { text: 'Reading.', thoughtSignature: THINKING_SEAL },
          {
            ...call('read_file', { path: 'a.ts' }, 'read_file__toolu_1'),
            thoughtSignature: 'skip_thought_signature_validator',
          },
        ),
      ],
    });
    expect(prompt[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'Let me think.', providerOptions: SIGNED },
        { type: 'text', text: 'Reading.' },
        {
          type: 'tool-call',
          toolCallId: 'call_1_1',
          toolName: 'read_file',
          input: { path: 'a.ts' },
        },
      ],
    });
  });

  it('restores what a seal holds for the call it came back on, under Gemini CLI’s prefixed id', () => {
    const google = { google: { thoughtSignature: 'g-sig' } };
    const { prompt } = parse({
      contents: [
        user({ text: 'Go' }),
        model({
          ...call('read_file', { path: 'a.ts' }, 'read_file__toolu_1'),
          thoughtSignature: seal({
            options: SIGNED,
            text: 'Let me think.',
            calls: { toolu_1: google },
          }),
        }),
      ],
    });
    expect(prompt[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'Let me think.', providerOptions: SIGNED },
        {
          type: 'tool-call',
          toolCallId: 'call_1_0',
          toolName: 'read_file',
          input: { path: 'a.ts' },
          providerOptions: google,
        },
      ],
    });
  });

  it('drops a vendor’s signature on a thought or a text, and a seal that does not read', () => {
    const { prompt } = parse({
      contents: [
        user({ text: 'Go' }),
        model(
          { text: 'Hmm.', thought: true, thoughtSignature: 'raw-sig' },
          { text: 'Sure.', thoughtSignature: 'raw-sig' },
          { ...call('now'), thoughtSignature: 'tale-relay.v1:@@@' },
        ),
      ],
    });
    expect(prompt[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'Hmm.' },
        { type: 'text', text: 'Sure.' },
        {
          type: 'tool-call',
          toolCallId: 'call_1_2',
          toolName: 'now',
          input: {},
        },
      ],
    });
    expect(warnings()).toEqual([
      expect.stringContaining('a carried value does not read'),
    ]);
  });

  it('brings Claude’s signed thinking back through Gemini CLI’s tool loop, which keeps no thought', async () => {
    const events = await eventsOf(
      [
        ...claudeThinks,
        { type: 'text-delta', id: 't0', delta: 'Reading.' },
        readFile,
        finish('tool-calls'),
      ],
      THOUGHTS,
    );
    // Gemini CLI's history of the turn: no thought, each call's id
    // prefixed with its function's name, and its stand-in signature on a
    // first call that has none.
    const history = events.flatMap((event) => {
      const body = JSON.parse(event.slice('data: '.length)) as {
        candidates: { content: { parts: Record<string, unknown>[] } }[];
      };
      return body.candidates[0]!.content.parts.filter((part) => !part.thought);
    });
    for (const part of history) {
      if (!isRecord(part.functionCall)) continue;
      part.functionCall.id = `read_file__${String(part.functionCall.id)}`;
      part.thoughtSignature ??= 'skip_thought_signature_validator';
    }
    const { prompt } = parse({
      contents: [
        user({ text: 'Read a.ts' }),
        { role: 'model', parts: history },
        user(reply('read_file', { output: 'export {}' }, 'read_file__toolu_1')),
      ],
    });
    expect(prompt.slice(1)).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'Let me think.', providerOptions: SIGNED },
          { type: 'text', text: 'Reading.' },
          {
            type: 'tool-call',
            toolCallId: 'call_1_1',
            toolName: 'read_file',
            input: { path: 'a.ts' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_1_1',
            toolName: 'read_file',
            output: { type: 'text', value: 'export {}' },
          },
        ],
      },
    ]);
  });
});

describe('a broken stream', () => {
  it('ends with the error body as an event the GenAI SDK raises as the API’s error', () => {
    expect(
      genAiAdapter.encodeStreamError(
        'timeout',
        'The model stopped answering.',
        context(),
      ),
    ).toBe(
      'data: {"error":{"code":504,"message":"The model stopped answering.","status":"DEADLINE_EXCEEDED"}}\n\n',
    );
  });
});
