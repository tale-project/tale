import type {
  LanguageModelV4FinishReason,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from '@ai-sdk/provider';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seal, unseal } from './carry.ts';
import type { EncodeContext } from './contract.ts';
import { TranslationError } from './contract.ts';
import { responsesAdapter } from './responses.ts';

function usage(
  input: Partial<LanguageModelV4Usage['inputTokens']> = {},
  output: Partial<LanguageModelV4Usage['outputTokens']> = {},
): LanguageModelV4Usage {
  return {
    inputTokens: {
      total: undefined,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
      ...input,
    },
    outputTokens: {
      total: undefined,
      text: undefined,
      reasoning: undefined,
      ...output,
    },
  };
}

const finish = (
  unified: LanguageModelV4FinishReason['unified'],
  used: LanguageModelV4Usage = usage({ total: 10 }, { total: 5 }),
): LanguageModelV4StreamPart => ({
  type: 'finish',
  finishReason: { unified, raw: undefined },
  usage: used,
});

function contextFor(request: Record<string, unknown> = {}): EncodeContext {
  return {
    model: 'gpt-5-codex',
    id: 'abc',
    created: 1_760_000_000,
    request: { model: 'gpt-5-codex', input: 'Hi', stream: true, ...request },
  };
}

async function* streamOf(
  parts: readonly LanguageModelV4StreamPart[],
  failure?: Error,
): AsyncIterable<LanguageModelV4StreamPart> {
  for (const part of parts) yield await Promise.resolve(part);
  if (failure !== undefined) throw failure;
}

async function encode(
  parts: readonly LanguageModelV4StreamPart[],
  request: Record<string, unknown> = {},
): Promise<string[]> {
  const events: string[] = [];
  for await (const event of responsesAdapter.encodeStream(
    streamOf(parts),
    contextFor(request),
  )) {
    events.push(event);
  }
  return events;
}

interface Event {
  event: string;
  data: Record<string, unknown>;
}

/** An event's `event:` name and its data, read back; each event is one
 * `event:` line and one `data:` line. */
function read(raw: string): Event {
  const match = /^event: ([^\n]+)\ndata: ([^\n]+)\n\n$/.exec(raw);
  if (match === null) throw new Error(`not one event: ${JSON.stringify(raw)}`);
  const data = JSON.parse(match[2] ?? '') as Record<string, unknown>;
  return { event: match[1] ?? '', data };
}

const typesOf = (events: string[]) => events.map((raw) => read(raw).event);

/** The data of the events of one type. */
const dataOf = (events: string[], type: string) =>
  events
    .map(read)
    .flatMap((event) => (event.event === type ? [event.data] : []));

/** The response the last event carries. */
function lastResponse(events: string[]): Record<string, unknown> {
  const last = read(events.at(-1) ?? '');
  return last.data.response as Record<string, unknown>;
}

const parse = (body: Record<string, unknown>) =>
  responsesAdapter.parse(body).options;

function refusal(body: Record<string, unknown>): string {
  try {
    responsesAdapter.parse(body);
  } catch (error) {
    if (error instanceof TranslationError) return error.message;
    throw error;
  }
  throw new Error('the request was not refused');
}

/** What a written item's `encrypted_content` carries, read back. */
const carriedBy = (item: unknown) =>
  unseal((item as Record<string, unknown>).encrypted_content);

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

describe('reading a Responses API request', () => {
  it('reads the instructions as the system message and a string input as one user text', () => {
    expect(
      parse({ model: 'm', instructions: 'Be brief.', input: 'Hello' }),
    ).toEqual({
      prompt: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      ],
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('makes system texts in a row one system message, and keeps a later developer message where it stands', () => {
    const options = parse({
      instructions: 'Base instructions.',
      input: [
        {
          type: 'message',
          role: 'developer',
          content: [{ type: 'input_text', text: 'Sandbox rules.' }],
        },
        { role: 'system', content: 'More rules.' },
        { role: 'user', content: 'Fix the bug.' },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'On it.', annotations: [] }],
        },
        { type: 'message', role: 'developer', content: 'Approvals changed.' },
        { type: 'message', role: 'user', content: '  ' },
      ],
    });
    expect(options.prompt).toEqual([
      {
        role: 'system',
        content: 'Base instructions.\n\nSandbox rules.\n\nMore rules.',
      },
      { role: 'user', content: [{ type: 'text', text: 'Fix the bug.' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'On it.' }] },
      { role: 'system', content: 'Approvals changed.' },
      { role: 'user', content: [{ type: 'text', text: '  ' }] },
    ]);
  });

  it('reads user content: text, an image inline or by address, and an inline file', () => {
    const options = parse({
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'What is this?' },
            { type: 'input_text', text: '' },
            {
              type: 'input_image',
              image_url: 'data:image/jpg;base64,AAAA',
              detail: 'auto',
            },
            {
              type: 'input_image',
              image_url: 'https://example.com/cat.png',
            },
            {
              type: 'input_file',
              filename: 'report.pdf',
              file_data: 'data:application/pdf;base64,JVBERi0=',
            },
          ],
        },
      ],
    });
    expect(options.prompt).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is this?' },
          {
            type: 'file',
            mediaType: 'image/jpeg',
            data: { type: 'data', data: 'AAAA' },
          },
          {
            type: 'file',
            mediaType: 'image',
            data: { type: 'url', url: new URL('https://example.com/cat.png') },
          },
          {
            type: 'file',
            mediaType: 'application/pdf',
            data: { type: 'data', data: 'JVBERi0=' },
            filename: 'report.pdf',
          },
        ],
      },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('refuses a file or an image stored with OpenAI, and a file that names no type', () => {
    const user = (part: Record<string, unknown>) => ({
      input: [{ role: 'user', content: [part] }],
    });
    expect(
      refusal(user({ type: 'input_file', file_id: 'file-123' })),
    ).toContain('a file stored with OpenAI cannot be read by this model');
    expect(
      refusal(user({ type: 'input_image', file_id: 'file-123' })),
    ).toContain('an image stored with OpenAI cannot be read by this model');
    expect(
      refusal(user({ type: 'input_file', file_data: 'JVBERi0=' })),
    ).toContain("must be a data URL that names the file's type");
    expect(
      refusal(user({ type: 'input_image', image_url: 'ftp://host/x.png' })),
    ).toContain('must be a data: URL or an http(s) URL');
  });

  it('reads a tool loop: the text, reasoning and calls of a turn as one assistant message, their outputs as one tool message', () => {
    const options = parse({
      input: [
        { type: 'message', role: 'user', content: 'List the files.' },
        {
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: 'I should run ls.' }],
          encrypted_content: null,
        },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Looking.' }],
        },
        {
          type: 'function_call',
          name: 'shell',
          arguments: '{"command":["ls"]}',
          call_id: 'call_1',
        },
        {
          type: 'function_call',
          name: 'update_plan',
          arguments: '',
          call_id: 'call_2',
        },
        {
          type: 'function_call_output',
          call_id: 'call_1',
          output: 'a.txt\nb.txt',
        },
        { type: 'function_call_output', call_id: 'call_2', output: 'ok' },
      ],
    });
    expect(options.prompt).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'List the files.' }] },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'I should run ls.' },
          { type: 'text', text: 'Looking.' },
          {
            type: 'tool-call',
            toolCallId: 'call_1',
            toolName: 'shell',
            input: { command: ['ls'] },
          },
          {
            type: 'tool-call',
            toolCallId: 'call_2',
            toolName: 'update_plan',
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
            toolName: 'shell',
            output: { type: 'text', value: 'a.txt\nb.txt' },
          },
          {
            type: 'tool-result',
            toolCallId: 'call_2',
            toolName: 'update_plan',
            output: { type: 'text', value: 'ok' },
          },
        ],
      },
    ]);
  });

  it('reads a custom tool call as a call of one string, `input`, and its output', () => {
    const options = parse({
      input: [
        { role: 'user', content: 'Patch it.' },
        {
          type: 'custom_tool_call',
          status: 'completed',
          call_id: 'call_9',
          name: 'apply_patch',
          input: '*** Begin Patch\n*** End Patch',
        },
        {
          type: 'custom_tool_call_output',
          call_id: 'call_9',
          output: 'Done!',
        },
      ],
    });
    expect(options.prompt.slice(1)).toEqual([
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_9',
            toolName: 'apply_patch',
            input: { input: '*** Begin Patch\n*** End Patch' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_9',
            toolName: 'apply_patch',
            output: { type: 'text', value: 'Done!' },
          },
        ],
      },
    ]);
  });

  it('reads an output of text parts as one text, and one with an image as content', () => {
    const outputOf = (output: unknown) => {
      const options = parse({
        input: [
          { role: 'user', content: 'Look.' },
          {
            type: 'function_call',
            name: 'view_image',
            arguments: '{"path":"a.png"}',
            call_id: 'c',
          },
          { type: 'function_call_output', call_id: 'c', output },
        ],
      });
      const tool = options.prompt[2];
      return tool?.role === 'tool' && tool.content[0]?.type === 'tool-result'
        ? tool.content[0].output
        : undefined;
    };
    expect(
      outputOf([
        { type: 'input_text', text: 'line one' },
        { type: 'input_text', text: 'line two' },
      ]),
    ).toEqual({ type: 'text', value: 'line one\nline two' });
    expect(
      outputOf([
        { type: 'input_text', text: 'The image:' },
        { type: 'input_image', image_url: 'data:image/png;base64,iVBO' },
      ]),
    ).toEqual({
      type: 'content',
      value: [
        { type: 'text', text: 'The image:' },
        {
          type: 'file',
          mediaType: 'image/png',
          data: { type: 'data', data: 'iVBO' },
        },
      ],
    });
    expect(outputOf(undefined)).toEqual({ type: 'text', value: '' });
  });

  it('gives a reasoning item back what the relay sealed in it, with the text it was signed with, and drops encrypted_content the relay did not write', () => {
    const signature = { anthropic: { signature: 'sig-1' } };
    const options = parse({
      input: [
        { role: 'user', content: 'Go.' },
        {
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: 'Thinking, as shown.' }],
          encrypted_content: seal({ options: signature, text: 'Thinking.' }),
        },
        {
          type: 'reasoning',
          summary: [],
          encrypted_content: seal({
            options: { anthropic: { redactedData: 'xyz' } },
          }),
        },
        {
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: 'OpenAI thought.' }],
          encrypted_content: 'gAAAAABopenai-opaque',
        },
        { type: 'reasoning', summary: [], encrypted_content: 'gAAAAAB' },
        {
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: 'A summary.' }],
          content: [{ type: 'reasoning_text', text: 'The raw thought.' }],
        },
      ],
    });
    expect(options.prompt[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'Thinking.', providerOptions: signature },
        {
          type: 'reasoning',
          text: '',
          providerOptions: { anthropic: { redactedData: 'xyz' } },
        },
        { type: 'reasoning', text: 'OpenAI thought.' },
        { type: 'reasoning', text: 'The raw thought.' },
      ],
    });
  });

  it('gives each call after a reasoning item what it carried for that call, and nothing to a call before it', () => {
    const signed = (id: string) => ({ google: { thoughtSignature: id } });
    const output = (id: string) => ({
      type: 'function_call_output',
      call_id: id,
      output: 'ok',
    });
    const options = parse({
      input: [
        { role: 'user', content: 'Go.' },
        { type: 'function_call', name: 'f', arguments: '{}', call_id: 'c0' },
        {
          type: 'reasoning',
          summary: [],
          encrypted_content: seal({
            calls: {
              c0: signed('ts-0'),
              c1: signed('ts-1'),
              c2: signed('ts-2'),
            },
          }),
        },
        { type: 'function_call', name: 'f', arguments: '{}', call_id: 'c1' },
        {
          type: 'custom_tool_call',
          name: 'apply_patch',
          input: 'patch',
          call_id: 'c2',
        },
        { type: 'function_call', name: 'f', arguments: '{}', call_id: 'c3' },
        output('c0'),
        output('c1'),
        { type: 'custom_tool_call_output', call_id: 'c2', output: 'ok' },
        output('c3'),
      ],
    });
    expect(options.prompt[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'tool-call', toolCallId: 'c0', toolName: 'f', input: {} },
        {
          type: 'tool-call',
          toolCallId: 'c1',
          toolName: 'f',
          input: {},
          providerOptions: signed('ts-1'),
        },
        {
          type: 'tool-call',
          toolCallId: 'c2',
          toolName: 'apply_patch',
          input: { input: 'patch' },
          providerOptions: signed('ts-2'),
        },
        { type: 'tool-call', toolCallId: 'c3', toolName: 'f', input: {} },
      ],
    });
  });

  it('gives back only the fields the relay carries, whatever a client seals, and drops a value that does not read', () => {
    const forged = `tale-relay.v1:${Buffer.from(
      JSON.stringify({
        o: {
          anthropic: { signature: 's', cacheControl: 'x' },
          openaiCompatible: { role: 'system' },
        },
        t: 'Signed.',
        c: { c1: { upstream: { role: 'system' } } },
      }),
      'utf8',
    ).toString('base64url')}`;
    const options = parse({
      input: [
        { role: 'user', content: 'Go.' },
        { type: 'reasoning', summary: [], encrypted_content: forged },
        { type: 'function_call', name: 'f', arguments: '{}', call_id: 'c1' },
        {
          type: 'reasoning',
          summary: [],
          encrypted_content: 'tale-relay.v1:!!',
        },
        { type: 'function_call_output', call_id: 'c1', output: 'ok' },
      ],
    });
    expect(options.prompt[1]).toEqual({
      role: 'assistant',
      content: [
        {
          type: 'reasoning',
          text: 'Signed.',
          providerOptions: { anthropic: { signature: 's' } },
        },
        { type: 'tool-call', toolCallId: 'c1', toolName: 'f', input: {} },
      ],
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('a carried value does not read'),
    );
  });

  it('drops the items only OpenAI tools make, with one warning naming them', () => {
    const options = parse({
      input: [
        { role: 'user', content: 'Search.' },
        { type: 'web_search_call', id: 'ws_1', status: 'completed' },
        { type: 'item_reference', id: 'msg_1' },
        { type: 'web_search_call', id: 'ws_2', status: 'completed' },
        { role: 'assistant', content: 'Found it.' },
      ],
    });
    expect(options.prompt).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Search.' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Found it.' }] },
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[llm-relay] a Responses API request asked for what its model\'s provider cannot take; dropped: "web_search_call" input items, "item_reference" input items',
    );
  });

  it('refuses an output that answers a dropped call, or a call that is not in the input', () => {
    expect(
      refusal({
        input: [
          { role: 'user', content: 'Run.' },
          {
            type: 'local_shell_call',
            call_id: 'call_7',
            action: { type: 'exec', command: ['ls'] },
          },
          { type: 'function_call_output', call_id: 'call_7', output: 'a' },
        ],
      }),
    ).toBe(
      'input[2] answers the local_shell_call "call_7", which cannot be carried to this model: it calls a tool only OpenAI\'s models have.',
    );
    expect(
      refusal({
        input: [
          { role: 'user', content: 'Run.' },
          { type: 'function_call_output', call_id: 'call_8', output: 'a' },
        ],
      }),
    ).toContain('answers the call "call_8", but no function_call');
  });

  it('sends arguments that encode no object as {}, saying so without quoting them', () => {
    const options = parse({
      input: [
        { role: 'user', content: 'Go.' },
        {
          type: 'function_call',
          name: 'f',
          arguments: '{secret-token',
          call_id: 'a',
        },
        { type: 'function_call', name: 'f', arguments: '[1]', call_id: 'b' },
      ],
    });
    expect(options.prompt[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'tool-call', toolCallId: 'a', toolName: 'f', input: {} },
        { type: 'tool-call', toolCallId: 'b', toolName: 'f', input: {} },
      ],
    });
    expect(warn.mock.calls).toEqual([
      ['[llm-relay] input[1].arguments is not JSON; the call is sent with {}'],
      [
        '[llm-relay] input[2].arguments encode no JSON object; the call is sent with {}',
      ],
    ]);
  });

  it('offers function tools, the empty object schema to one without parameters, and a custom tool as a function of one string', () => {
    const options = parse({
      input: 'Hi',
      tools: [
        {
          type: 'function',
          name: 'shell',
          description: 'Runs a command.',
          strict: false,
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'array', items: { type: 'string' } },
            },
            required: ['command'],
          },
        },
        { type: 'function', name: 'list_mcp_resources' },
        { type: 'function', name: 'noop', parameters: { type: 'object' } },
        {
          type: 'custom',
          name: 'apply_patch',
          description: 'Use the `apply_patch` tool to edit files.',
          format: {
            type: 'grammar',
            syntax: 'lark',
            definition: 'start: begin_patch hunk+ end_patch',
          },
        },
        { type: 'custom', name: 'note', format: { type: 'text' } },
      ],
    });
    expect(options.tools).toEqual([
      {
        type: 'function',
        name: 'shell',
        description: 'Runs a command.',
        inputSchema: {
          type: 'object',
          properties: { command: { type: 'array', items: { type: 'string' } } },
          required: ['command'],
        },
        strict: false,
      },
      {
        type: 'function',
        name: 'list_mcp_resources',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        type: 'function',
        name: 'noop',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        type: 'function',
        name: 'apply_patch',
        description: 'Use the `apply_patch` tool to edit files.',
        inputSchema: {
          type: 'object',
          properties: {
            input: {
              type: 'string',
              description:
                "The tool's whole input, written as the tool reads it: plain text, not JSON. It must match this lark grammar:\nstart: begin_patch hunk+ end_patch",
            },
          },
          required: ['input'],
        },
      },
      {
        type: 'function',
        name: 'note',
        inputSchema: {
          type: 'object',
          properties: {
            input: {
              type: 'string',
              description:
                "The tool's whole input, written as the tool reads it: plain text, not JSON.",
            },
          },
          required: ['input'],
        },
      },
    ]);
  });

  it('drops the tools OpenAI runs itself, with one warning naming them', () => {
    const options = parse({
      input: 'Hi',
      tools: [
        { type: 'web_search' },
        { type: 'function', name: 'shell', parameters: {} },
        { type: 'local_shell' },
        { type: 'mcp', server_label: 'docs', server_url: 'https://x' },
      ],
    });
    expect(options.tools?.map((tool) => tool.name)).toEqual(['shell']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'dropped: the "web_search" tool, the "local_shell" tool, the "mcp" tool',
      ),
    );
  });

  it('reads each tool choice', () => {
    const choiceOf = (toolChoice: unknown) =>
      parse({
        input: 'Hi',
        tools: [{ type: 'function', name: 'shell' }],
        tool_choice: toolChoice,
      }).toolChoice;
    expect(choiceOf('auto')).toEqual({ type: 'auto' });
    expect(choiceOf('none')).toEqual({ type: 'none' });
    expect(choiceOf('required')).toEqual({ type: 'required' });
    expect(choiceOf({ type: 'function', name: 'shell' })).toEqual({
      type: 'tool',
      toolName: 'shell',
    });
    expect(choiceOf({ type: 'custom', name: 'apply_patch' })).toEqual({
      type: 'tool',
      toolName: 'apply_patch',
    });
    expect(choiceOf(undefined)).toBeUndefined();
  });

  it('keeps the model to the tools an allowed_tools choice names', () => {
    const options = parse({
      input: 'Hi',
      tools: [
        { type: 'function', name: 'shell' },
        { type: 'function', name: 'read' },
        { type: 'custom', name: 'apply_patch' },
      ],
      tool_choice: {
        type: 'allowed_tools',
        mode: 'required',
        tools: [
          { type: 'function', name: 'read' },
          { type: 'custom', name: 'apply_patch' },
        ],
      },
    });
    expect(options.toolChoice).toEqual({ type: 'required' });
    expect(options.tools?.map((tool) => tool.name)).toEqual([
      'read',
      'apply_patch',
    ]);
  });

  it('refuses a tool choice that forces a tool OpenAI runs, or one it cannot read', () => {
    expect(
      refusal({ input: 'Hi', tool_choice: { type: 'web_search_preview' } }),
    ).toBe(
      '"tool_choice" asks for the "web_search_preview" tool, which this model\'s provider does not have.',
    );
    expect(refusal({ input: 'Hi', tool_choice: 'sometimes' })).toContain(
      '"tool_choice" must be',
    );
    expect(
      refusal({ input: 'Hi', tool_choice: { type: 'function' } }),
    ).toContain('"tool_choice" must be');
  });

  it('reads the output limit, sampling, reasoning effort and response format', () => {
    expect(
      parse({
        input: 'Hi',
        max_output_tokens: 2048,
        temperature: 0.2,
        top_p: 0.9,
        reasoning: { effort: 'high', summary: 'auto' },
        text: {
          format: {
            type: 'json_schema',
            name: 'answer',
            description: 'The answer.',
            schema: { type: 'object', properties: { a: { type: 'string' } } },
            strict: true,
          },
        },
      }),
    ).toEqual({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
      maxOutputTokens: 2048,
      temperature: 0.2,
      topP: 0.9,
      reasoning: 'high',
      responseFormat: {
        type: 'json',
        schema: { type: 'object', properties: { a: { type: 'string' } } },
        name: 'answer',
        description: 'The answer.',
      },
    });
    expect(
      parse({ input: 'Hi', text: { format: { type: 'json_object' } } })
        .responseFormat,
    ).toEqual({ type: 'json' });
    expect(
      parse({ input: 'Hi', reasoning: { effort: 'none' } }).reasoning,
    ).toBe('none');
    expect(parse({ input: 'Hi', reasoning: { summary: 'auto' } })).toEqual({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('leaves the provider’s default for an effort the SDK has no name for, and drops the hints it has no place for, in one warning', () => {
    const options = parse({
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_image',
              image_url: 'data:image/png;base64,iVBO',
              detail: 'high',
            },
          ],
        },
      ],
      reasoning: { effort: 'extreme' },
      text: { verbosity: 'low' },
      top_logprobs: 5,
    });
    expect(options.reasoning).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'dropped: input_image.detail, reasoning.effort, text.verbosity, top_logprobs',
      ),
    );
  });

  it('refuses settings of the wrong type', () => {
    expect(refusal({ input: 'Hi', max_output_tokens: 0 })).toBe(
      '"max_output_tokens" must be a whole number of at least 1.',
    );
    expect(refusal({ input: 'Hi', temperature: 'hot' })).toBe(
      '"temperature" must be a number.',
    );
    expect(refusal({ input: 'Hi', text: { format: { type: 'xml' } } })).toBe(
      '"text.format" must be of type "text", "json_object" or "json_schema".',
    );
    expect(refusal({ input: 'Hi', reasoning: 'high' })).toBe(
      '"reasoning" must be an object.',
    );
    expect(refusal({ input: 'Hi', tools: [{ name: 'x' }] })).toBe(
      'tools[0] must be a tool with a "type".',
    );
  });

  it('takes the fields that only ask the vendor to keep, label, bill or cache the call without a word', () => {
    const options = parse({
      input: 'Hi',
      store: false,
      include: ['reasoning.encrypted_content'],
      parallel_tool_calls: false,
      metadata: { run: '1' },
      prompt_cache_key: 'session-1',
      service_tier: 'flex',
      truncation: 'auto',
      user: 'someone',
      stream: true,
    });
    expect(options).toEqual({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('refuses what only a provider that keeps responses can answer', () => {
    expect(refusal({ input: 'Hi', previous_response_id: 'resp_123' })).toBe(
      '"previous_response_id": the relay keeps no responses, so it cannot continue one; send the whole conversation in "input".',
    );
    expect(refusal({ input: 'Hi', conversation: 'conv_1' })).toContain(
      'the relay keeps no conversations',
    );
    expect(refusal({ input: 'Hi', prompt: { id: 'pmpt_1' } })).toContain(
      'a prompt stored with OpenAI cannot be read by this model',
    );
    expect(refusal({ input: 'Hi', background: true })).toContain(
      '"background"',
    );
    expect(
      parse({ input: 'Hi', previous_response_id: null }).prompt,
    ).toHaveLength(1);
  });

  it('refuses a request without input, with input of the wrong type, or with nothing to answer', () => {
    expect(refusal({ instructions: 'x' })).toBe(
      '"input" is required: a string, or an array of input items.',
    );
    expect(refusal({ input: 42 })).toBe(
      '"input" must be a string or an array of input items.',
    );
    expect(refusal({ instructions: 'x', input: [] })).toBe(
      '"input" carries nothing for the model to answer.',
    );
    expect(refusal({ input: 'Hi', instructions: ['x'] })).toBe(
      '"instructions" must be a string.',
    );
  });

  it('refuses items it cannot read', () => {
    expect(refusal({ input: ['Hi'] })).toBe(
      'input[0] must be an input item (an object).',
    );
    expect(refusal({ input: [{ role: 'tool', content: 'x' }] })).toBe(
      'input[0] needs a "role": user, assistant, system or developer.',
    );
    expect(
      refusal({
        input: [{ type: 'function_call', name: 'f', arguments: '{}' }],
      }),
    ).toBe('input[0] needs its "call_id".');
    expect(
      refusal({
        input: [
          { role: 'user', content: [{ type: 'input_audio', data: 'x' }] },
        ],
      }),
    ).toBe(
      'input[0].content[0]: an "input_audio" part cannot be carried to this model.',
    );
    expect(
      refusal({
        input: [
          {
            role: 'developer',
            content: [{ type: 'input_image', image_url: 'x' }],
          },
        ],
      }),
    ).toBe('input[0].content[0]: a developer message takes text parts only.');
  });
});

describe('a streamed answer', () => {
  it('writes text as a message item, event by event, counted from 0', async () => {
    const events = await encode([
      { type: 'stream-start', warnings: [] },
      { type: 'response-metadata', id: 'upstream-id', modelId: 'claude' },
      { type: 'text-start', id: '0' },
      { type: 'text-delta', id: '0', delta: 'Hel' },
      { type: 'text-delta', id: '0', delta: 'lo' },
      { type: 'text-end', id: '0' },
      finish('stop', usage({ total: 10, cacheRead: 4 }, { total: 5 })),
    ]);
    expect(typesOf(events)).toEqual([
      'response.created',
      'response.in_progress',
      'response.output_item.added',
      'response.content_part.added',
      'response.output_text.delta',
      'response.output_text.delta',
      'response.output_text.done',
      'response.content_part.done',
      'response.output_item.done',
      'response.completed',
    ]);
    expect(events.map((raw) => read(raw).data.sequence_number)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(events.slice(2, 9)).toEqual([
      'event: response.output_item.added\ndata: {"type":"response.output_item.added","sequence_number":2,"output_index":0,"item":{"id":"msg_abc_0","type":"message","status":"in_progress","content":[],"role":"assistant"}}\n\n',
      'event: response.content_part.added\ndata: {"type":"response.content_part.added","sequence_number":3,"item_id":"msg_abc_0","output_index":0,"content_index":0,"part":{"type":"output_text","annotations":[],"logprobs":[],"text":""}}\n\n',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","sequence_number":4,"item_id":"msg_abc_0","output_index":0,"content_index":0,"delta":"Hel","logprobs":[]}\n\n',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","sequence_number":5,"item_id":"msg_abc_0","output_index":0,"content_index":0,"delta":"lo","logprobs":[]}\n\n',
      'event: response.output_text.done\ndata: {"type":"response.output_text.done","sequence_number":6,"item_id":"msg_abc_0","output_index":0,"content_index":0,"text":"Hello","logprobs":[]}\n\n',
      'event: response.content_part.done\ndata: {"type":"response.content_part.done","sequence_number":7,"item_id":"msg_abc_0","output_index":0,"content_index":0,"part":{"type":"output_text","annotations":[],"logprobs":[],"text":"Hello"}}\n\n',
      'event: response.output_item.done\ndata: {"type":"response.output_item.done","sequence_number":8,"output_index":0,"item":{"id":"msg_abc_0","type":"message","status":"completed","content":[{"type":"output_text","annotations":[],"logprobs":[],"text":"Hello"}],"role":"assistant"}}\n\n',
    ]);
    const created = read(events[0] ?? '').data;
    expect(created).toEqual({
      type: 'response.created',
      sequence_number: 0,
      response: {
        id: 'resp_abc',
        object: 'response',
        created_at: 1_760_000_000,
        status: 'in_progress',
        error: null,
        incomplete_details: null,
        instructions: null,
        max_output_tokens: null,
        model: 'gpt-5-codex',
        output: [],
        parallel_tool_calls: true,
        previous_response_id: null,
        reasoning: { effort: null, summary: null },
        store: false,
        temperature: null,
        text: { format: { type: 'text' } },
        tool_choice: 'auto',
        tools: [],
        top_p: null,
        truncation: 'disabled',
        usage: null,
        user: null,
        metadata: {},
      },
    });
    expect(read(events[1] ?? '').data.response).toEqual(created.response);
    const completed = lastResponse(events);
    expect(completed).toMatchObject({
      id: 'resp_abc',
      status: 'completed',
      error: null,
      incomplete_details: null,
      output: [
        {
          id: 'msg_abc_0',
          type: 'message',
          status: 'completed',
          content: [
            {
              type: 'output_text',
              annotations: [],
              logprobs: [],
              text: 'Hello',
            },
          ],
          role: 'assistant',
        },
      ],
      usage: {
        input_tokens: 10,
        input_tokens_details: { cached_tokens: 4 },
        output_tokens: 5,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 15,
      },
    });
  });

  it('writes reasoning as a summary item, then the text as the next item', async () => {
    const events = await encode([
      { type: 'reasoning-start', id: 'reasoning-0' },
      { type: 'reasoning-delta', id: 'reasoning-0', delta: 'Let me ' },
      { type: 'reasoning-delta', id: 'reasoning-0', delta: 'think.' },
      { type: 'reasoning-end', id: 'reasoning-0' },
      { type: 'text-start', id: 'txt-0' },
      { type: 'text-delta', id: 'txt-0', delta: 'Done.' },
      { type: 'text-end', id: 'txt-0' },
      finish('stop'),
    ]);
    expect(typesOf(events).slice(2)).toEqual([
      'response.output_item.added',
      'response.reasoning_summary_part.added',
      'response.reasoning_summary_text.delta',
      'response.reasoning_summary_text.delta',
      'response.reasoning_summary_text.done',
      'response.reasoning_summary_part.done',
      'response.output_item.done',
      'response.output_item.added',
      'response.content_part.added',
      'response.output_text.delta',
      'response.output_text.done',
      'response.content_part.done',
      'response.output_item.done',
      'response.completed',
    ]);
    expect(events.slice(2, 9)).toEqual([
      'event: response.output_item.added\ndata: {"type":"response.output_item.added","sequence_number":2,"output_index":0,"item":{"id":"rs_abc_0","type":"reasoning","summary":[]}}\n\n',
      'event: response.reasoning_summary_part.added\ndata: {"type":"response.reasoning_summary_part.added","sequence_number":3,"item_id":"rs_abc_0","output_index":0,"summary_index":0,"part":{"type":"summary_text","text":""}}\n\n',
      'event: response.reasoning_summary_text.delta\ndata: {"type":"response.reasoning_summary_text.delta","sequence_number":4,"item_id":"rs_abc_0","output_index":0,"summary_index":0,"delta":"Let me "}\n\n',
      'event: response.reasoning_summary_text.delta\ndata: {"type":"response.reasoning_summary_text.delta","sequence_number":5,"item_id":"rs_abc_0","output_index":0,"summary_index":0,"delta":"think."}\n\n',
      'event: response.reasoning_summary_text.done\ndata: {"type":"response.reasoning_summary_text.done","sequence_number":6,"item_id":"rs_abc_0","output_index":0,"summary_index":0,"text":"Let me think."}\n\n',
      'event: response.reasoning_summary_part.done\ndata: {"type":"response.reasoning_summary_part.done","sequence_number":7,"item_id":"rs_abc_0","output_index":0,"summary_index":0,"part":{"type":"summary_text","text":"Let me think."}}\n\n',
      'event: response.output_item.done\ndata: {"type":"response.output_item.done","sequence_number":8,"output_index":0,"item":{"id":"rs_abc_0","type":"reasoning","summary":[{"type":"summary_text","text":"Let me think."}]}}\n\n',
    ]);
    expect(dataOf(events, 'response.output_item.added')[1]).toMatchObject({
      output_index: 1,
      item: { id: 'msg_abc_1', type: 'message' },
    });
    expect(
      (lastResponse(events).output as unknown[]).map(
        (item) => (item as Record<string, unknown>).id,
      ),
    ).toEqual(['rs_abc_0', 'msg_abc_1']);
  });

  it('writes a streamed function call once, its arguments as they stream', async () => {
    const events = await encode([
      { type: 'tool-input-start', id: 'toolu_1', toolName: 'shell' },
      { type: 'tool-input-delta', id: 'toolu_1', delta: '{"command":' },
      { type: 'tool-input-delta', id: 'toolu_1', delta: '["ls"]}' },
      { type: 'tool-input-end', id: 'toolu_1' },
      {
        type: 'tool-call',
        toolCallId: 'toolu_1',
        toolName: 'shell',
        input: '{"command":["ls"]}',
      },
      finish('tool-calls'),
    ]);
    expect(events.slice(2, -1)).toEqual([
      'event: response.output_item.added\ndata: {"type":"response.output_item.added","sequence_number":2,"output_index":0,"item":{"id":"fc_abc_0","type":"function_call","status":"in_progress","arguments":"","call_id":"toolu_1","name":"shell"}}\n\n',
      'event: response.function_call_arguments.delta\ndata: {"type":"response.function_call_arguments.delta","sequence_number":3,"item_id":"fc_abc_0","output_index":0,"delta":"{\\"command\\":"}\n\n',
      'event: response.function_call_arguments.delta\ndata: {"type":"response.function_call_arguments.delta","sequence_number":4,"item_id":"fc_abc_0","output_index":0,"delta":"[\\"ls\\"]}"}\n\n',
      'event: response.function_call_arguments.done\ndata: {"type":"response.function_call_arguments.done","sequence_number":5,"item_id":"fc_abc_0","output_index":0,"name":"shell","arguments":"{\\"command\\":[\\"ls\\"]}"}\n\n',
      'event: response.output_item.done\ndata: {"type":"response.output_item.done","sequence_number":6,"output_index":0,"item":{"id":"fc_abc_0","type":"function_call","status":"completed","arguments":"{\\"command\\":[\\"ls\\"]}","call_id":"toolu_1","name":"shell"}}\n\n',
    ]);
    expect(lastResponse(events)).toMatchObject({
      status: 'completed',
      output: [
        {
          type: 'function_call',
          call_id: 'toolu_1',
          arguments: '{"command":["ls"]}',
        },
      ],
    });
  });

  it('writes a call the SDK gives only whole, its arguments as one delta, and a call named again once', async () => {
    const call: LanguageModelV4StreamPart = {
      type: 'tool-call',
      toolCallId: 'call_1',
      toolName: 'read',
      input: '{"path":"a"}',
    };
    const events = await encode([call, call, finish('tool-calls')]);
    expect(typesOf(events).slice(2)).toEqual([
      'response.output_item.added',
      'response.function_call_arguments.delta',
      'response.function_call_arguments.done',
      'response.output_item.done',
      'response.completed',
    ]);
    expect(dataOf(events, 'response.function_call_arguments.delta')).toEqual([
      {
        type: 'response.function_call_arguments.delta',
        sequence_number: 3,
        item_id: 'fc_abc_0',
        output_index: 0,
        delta: '{"path":"a"}',
      },
    ]);
  });

  it('streams what the whole call adds: a call without arguments is {}', async () => {
    const events = await encode([
      { type: 'tool-input-start', id: 'toolu_2', toolName: 'list' },
      { type: 'tool-input-end', id: 'toolu_2' },
      {
        type: 'tool-call',
        toolCallId: 'toolu_2',
        toolName: 'list',
        input: '{}',
      },
      finish('tool-calls'),
    ]);
    expect(
      dataOf(events, 'response.function_call_arguments.delta').map(
        (data) => data.delta,
      ),
    ).toEqual(['{}']);
    expect(dataOf(events, 'response.function_call_arguments.done')).toEqual([
      expect.objectContaining({ arguments: '{}', name: 'list' }),
    ]);
  });

  it('writes a call to a custom tool as a custom_tool_call, its input decoded and sent once', async () => {
    const patch = '*** Begin Patch\n*** Add File: a.txt\n+hi\n*** End Patch';
    const json = JSON.stringify({ input: patch });
    const events = await encode(
      [
        { type: 'tool-input-start', id: 'toolu_3', toolName: 'apply_patch' },
        { type: 'tool-input-delta', id: 'toolu_3', delta: json.slice(0, 15) },
        { type: 'tool-input-delta', id: 'toolu_3', delta: json.slice(15) },
        { type: 'tool-input-end', id: 'toolu_3' },
        {
          type: 'tool-call',
          toolCallId: 'toolu_3',
          toolName: 'apply_patch',
          input: json,
        },
        finish('tool-calls'),
      ],
      {
        tools: [
          { type: 'custom', name: 'apply_patch', format: { type: 'text' } },
        ],
      },
    );
    expect(typesOf(events).slice(2)).toEqual([
      'response.output_item.added',
      'response.custom_tool_call_input.delta',
      'response.custom_tool_call_input.done',
      'response.output_item.done',
      'response.completed',
    ]);
    expect(events.slice(2, 6)).toEqual([
      'event: response.output_item.added\ndata: {"type":"response.output_item.added","sequence_number":2,"output_index":0,"item":{"id":"ctc_abc_0","type":"custom_tool_call","status":"in_progress","call_id":"toolu_3","input":"","name":"apply_patch"}}\n\n',
      `event: response.custom_tool_call_input.delta\ndata: {"type":"response.custom_tool_call_input.delta","sequence_number":3,"item_id":"ctc_abc_0","output_index":0,"delta":${JSON.stringify(patch)}}\n\n`,
      `event: response.custom_tool_call_input.done\ndata: {"type":"response.custom_tool_call_input.done","sequence_number":4,"item_id":"ctc_abc_0","output_index":0,"input":${JSON.stringify(patch)}}\n\n`,
      `event: response.output_item.done\ndata: {"type":"response.output_item.done","sequence_number":5,"output_index":0,"item":{"id":"ctc_abc_0","type":"custom_tool_call","status":"completed","call_id":"toolu_3","input":${JSON.stringify(patch)},"name":"apply_patch"}}\n\n`,
    ]);
  });

  it('passes a custom call that carries no "input" string on as the model wrote it, saying so; an empty one has no input', async () => {
    const inputs = async (input: string) =>
      dataOf(
        await encode(
          [
            {
              type: 'tool-call',
              toolCallId: 'toolu_4',
              toolName: 'apply_patch',
              input,
            },
            finish('tool-calls'),
          ],
          { tools: [{ type: 'custom', name: 'apply_patch' }] },
        ),
        'response.custom_tool_call_input.done',
      ).map((data) => data.input);
    expect(await inputs('{"patch":"x"}')).toEqual(['{"patch":"x"}']);
    expect(warn).toHaveBeenCalledWith(
      '[llm-relay] a call to a custom tool carries no "input" string; its input goes to the client as the model wrote it',
    );
    expect(await inputs('{}')).toEqual(['']);
    expect(await inputs('*** Begin Patch')).toEqual(['*** Begin Patch']);
    expect(warn).toHaveBeenLastCalledWith(
      '[llm-relay] a call to a custom tool is not JSON; its input goes to the client as the model wrote it',
    );
  });

  it('holds arguments the SDK streams as raw text, and sends the whole call’s JSON once', async () => {
    const events = await encode([
      {
        type: 'tool-input-start',
        id: 'call_t',
        toolName: 'search',
        inputEncoding: 'text',
      },
      { type: 'tool-input-delta', id: 'call_t', delta: 'cats' },
      { type: 'tool-input-end', id: 'call_t' },
      {
        type: 'tool-call',
        toolCallId: 'call_t',
        toolName: 'search',
        input: '{"query":"cats"}',
      },
      finish('tool-calls'),
    ]);
    expect(
      dataOf(events, 'response.function_call_arguments.delta').map(
        (data) => data.delta,
      ),
    ).toEqual(['{"query":"cats"}']);
  });

  it('closes the text before the calls a Chat Completions provider streams while its text is open', async () => {
    // The order @ai-sdk/openai-compatible gives: its text ends, and its
    // calls are whole, only when the stream ends; a later block reuses an
    // id.
    const events = await encode([
      { type: 'reasoning-start', id: 'reasoning-0' },
      { type: 'reasoning-delta', id: 'reasoning-0', delta: 'Plan.' },
      { type: 'reasoning-end', id: 'reasoning-0' },
      { type: 'text-start', id: 'txt-0' },
      { type: 'text-delta', id: 'txt-0', delta: 'Checking both.' },
      { type: 'tool-input-start', id: 'call_a', toolName: 'read' },
      { type: 'tool-input-delta', id: 'call_a', delta: '{"path":"a"}' },
      { type: 'tool-input-start', id: 'call_b', toolName: 'read' },
      { type: 'tool-input-delta', id: 'call_b', delta: '{"path":"b"}' },
      { type: 'text-end', id: 'txt-0' },
      { type: 'tool-input-end', id: 'call_a' },
      {
        type: 'tool-call',
        toolCallId: 'call_a',
        toolName: 'read',
        input: '{"path":"a"}',
      },
      { type: 'tool-input-end', id: 'call_b' },
      {
        type: 'tool-call',
        toolCallId: 'call_b',
        toolName: 'read',
        input: '{"path":"b"}',
      },
      finish('tool-calls'),
    ]);
    const added = dataOf(events, 'response.output_item.added').map(
      (data) => data.output_index,
    );
    const done = dataOf(events, 'response.output_item.done').map(
      (data) => data.output_index,
    );
    expect(added).toEqual([0, 1, 2, 3]);
    expect(done).toEqual([0, 1, 2, 3]);
    const types = typesOf(events);
    // The message is done before the first call is added.
    expect(types.indexOf('response.output_text.done')).toBeLessThan(
      types.indexOf('response.function_call_arguments.delta'),
    );
    expect(
      (lastResponse(events).output as Record<string, unknown>[]).map((item) => [
        item.type,
        item.id,
        item.status,
      ]),
    ).toEqual([
      ['reasoning', 'rs_abc_0', undefined],
      ['message', 'msg_abc_1', 'completed'],
      ['function_call', 'fc_abc_2', 'completed'],
      ['function_call', 'fc_abc_3', 'completed'],
    ]);
  });

  it('keeps what a provider asks back with its reasoning in encrypted_content, and writes reasoning without text only when it asks', async () => {
    const events = await encode([
      { type: 'reasoning-start', id: '0' },
      { type: 'reasoning-delta', id: '0', delta: 'Hmm.' },
      {
        type: 'reasoning-delta',
        id: '0',
        delta: '',
        providerMetadata: { anthropic: { signature: 'sig-1' } },
      },
      { type: 'reasoning-end', id: '0' },
      {
        type: 'reasoning-start',
        id: '1',
        providerMetadata: { anthropic: { redactedData: 'redacted' } },
      },
      { type: 'reasoning-end', id: '1' },
      { type: 'reasoning-start', id: '2' },
      { type: 'reasoning-end', id: '2' },
      finish('stop'),
    ]);
    const items = dataOf(events, 'response.output_item.done').map(
      (data) => data.item,
    );
    expect(items).toEqual([
      {
        id: 'rs_abc_0',
        type: 'reasoning',
        summary: [{ type: 'summary_text', text: 'Hmm.' }],
        encrypted_content: seal({
          options: { anthropic: { signature: 'sig-1' } },
          text: 'Hmm.',
        }),
      },
      {
        id: 'rs_abc_1',
        type: 'reasoning',
        summary: [],
        encrypted_content: seal({
          options: { anthropic: { redactedData: 'redacted' } },
        }),
      },
    ]);
    expect(carriedBy(items[0])).toEqual({
      options: { anthropic: { signature: 'sig-1' } },
      text: 'Hmm.',
    });
    expect(typesOf(events).slice(-3)).toEqual([
      'response.output_item.added',
      'response.output_item.done',
      'response.completed',
    ]);
  });

  it('carries a call’s fields in a reasoning item done just before the call, and sends them back with it', async () => {
    const signed = (signature: string) => ({
      google: { thoughtSignature: signature },
    });
    const events = await encode([
      { type: 'reasoning-start', id: 'reasoning-0' },
      { type: 'reasoning-delta', id: 'reasoning-0', delta: 'Read both.' },
      { type: 'reasoning-end', id: 'reasoning-0' },
      { type: 'tool-input-start', id: 'call_a', toolName: 'read' },
      { type: 'tool-input-delta', id: 'call_a', delta: '{"path":"a"}' },
      { type: 'tool-input-end', id: 'call_a' },
      {
        type: 'tool-call',
        toolCallId: 'call_a',
        toolName: 'read',
        input: '{"path":"a"}',
        providerMetadata: signed('ts-a'),
      },
      {
        type: 'tool-call',
        toolCallId: 'call_b',
        toolName: 'read',
        input: '{"path":"b"}',
        providerMetadata: signed('ts-b'),
      },
      finish('tool-calls'),
    ]);
    const added = dataOf(events, 'response.output_item.added').map(
      (data) => (data.item as Record<string, unknown>).id,
    );
    const done = dataOf(events, 'response.output_item.done').map(
      (data) => data.item as Record<string, unknown>,
    );
    // The streamed call was added before its fields came, so its carrier
    // comes after it in index but is done before it; a call given whole
    // comes after its carrier in both.
    expect(added).toEqual([
      'rs_abc_0',
      'fc_abc_1',
      'rs_abc_2',
      'rs_abc_3',
      'fc_abc_4',
    ]);
    expect(done.map((item) => item.id)).toEqual([
      'rs_abc_0',
      'rs_abc_2',
      'fc_abc_1',
      'rs_abc_3',
      'fc_abc_4',
    ]);
    expect(done[0]?.encrypted_content).toBeUndefined();
    expect(done[1]).toMatchObject({ type: 'reasoning', summary: [] });
    expect(carriedBy(done[1])).toEqual({ calls: { call_a: signed('ts-a') } });
    expect(carriedBy(done[3])).toEqual({ calls: { call_b: signed('ts-b') } });
    // The closing response lists the items as the client keeps them.
    expect(
      (lastResponse(events).output as Record<string, unknown>[]).map(
        (item) => item.id,
      ),
    ).toEqual(done.map((item) => item.id));
    const options = responsesAdapter.parse({
      input: [
        { role: 'user', content: 'Read a and b.' },
        ...done,
        { type: 'function_call_output', call_id: 'call_a', output: 'A' },
        { type: 'function_call_output', call_id: 'call_b', output: 'B' },
      ],
    }).options;
    expect(options.prompt[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'Read both.' },
        {
          type: 'tool-call',
          toolCallId: 'call_a',
          toolName: 'read',
          input: { path: 'a' },
          providerOptions: signed('ts-a'),
        },
        {
          type: 'tool-call',
          toolCallId: 'call_b',
          toolName: 'read',
          input: { path: 'b' },
          providerOptions: signed('ts-b'),
        },
      ],
    });
  });

  it('round-trips a tool loop: the items Codex sends back read into the parts the provider gave', async () => {
    const patch = '*** Begin Patch\n*** End Patch';
    const request = {
      tools: [
        { type: 'function', name: 'shell', parameters: { type: 'object' } },
        { type: 'custom', name: 'apply_patch', format: { type: 'text' } },
      ],
    };
    const events = await encode(
      [
        { type: 'reasoning-start', id: '0' },
        { type: 'reasoning-delta', id: '0', delta: 'Run ls, then patch.' },
        {
          type: 'reasoning-delta',
          id: '0',
          delta: '',
          providerMetadata: { anthropic: { signature: 'sig-2' } },
        },
        { type: 'reasoning-end', id: '0' },
        {
          type: 'tool-call',
          toolCallId: 'toolu_a',
          toolName: 'shell',
          input: '{"command":["ls"]}',
        },
        {
          type: 'tool-call',
          toolCallId: 'toolu_b',
          toolName: 'apply_patch',
          input: JSON.stringify({ input: patch }),
        },
        finish('tool-calls'),
      ],
      request,
    );
    // Codex keeps each done item and sends it back, its outputs after it.
    const replayed = dataOf(events, 'response.output_item.done').map(
      (data) => data.item,
    );
    const options = responsesAdapter.parse({
      ...request,
      input: [
        { role: 'user', content: 'Tidy up.' },
        ...replayed,
        { type: 'function_call_output', call_id: 'toolu_a', output: 'a.txt' },
        {
          type: 'custom_tool_call_output',
          call_id: 'toolu_b',
          output: 'Done!',
        },
      ],
    }).options;
    expect(options.prompt.slice(1)).toEqual([
      {
        role: 'assistant',
        content: [
          {
            type: 'reasoning',
            text: 'Run ls, then patch.',
            providerOptions: { anthropic: { signature: 'sig-2' } },
          },
          {
            type: 'tool-call',
            toolCallId: 'toolu_a',
            toolName: 'shell',
            input: { command: ['ls'] },
          },
          {
            type: 'tool-call',
            toolCallId: 'toolu_b',
            toolName: 'apply_patch',
            input: { input: patch },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'toolu_a',
            toolName: 'shell',
            output: { type: 'text', value: 'a.txt' },
          },
          {
            type: 'tool-result',
            toolCallId: 'toolu_b',
            toolName: 'apply_patch',
            output: { type: 'text', value: 'Done!' },
          },
        ],
      },
    ]);
  });

  it('ends a length stop as response.incomplete for max_output_tokens', async () => {
    const events = await encode([
      { type: 'text-delta', id: '0', delta: 'Partial' },
      finish('length'),
    ]);
    const last = read(events.at(-1) ?? '');
    expect(last.event).toBe('response.incomplete');
    expect(last.data.type).toBe('response.incomplete');
    expect(last.data.response).toMatchObject({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      error: null,
      output: [{ type: 'message', status: 'completed' }],
    });
  });

  it('ends a content filter as incomplete, and a stream the provider broke off as failed', async () => {
    const filtered = await encode([finish('content-filter')]);
    expect(read(filtered.at(-1) ?? '').event).toBe('response.incomplete');
    expect(lastResponse(filtered).incomplete_details).toEqual({
      reason: 'content_filter',
    });
    const broken = await encode([
      { type: 'tool-input-start', id: 'toolu_9', toolName: 'shell' },
      { type: 'tool-input-delta', id: 'toolu_9', delta: '{"comm' },
      finish('interrupted'),
    ]);
    expect(read(broken.at(-1) ?? '').event).toBe('response.failed');
    expect(lastResponse(broken)).toMatchObject({
      status: 'failed',
      error: {
        code: 'server_error',
        message: "The model's answer broke off before it ended.",
      },
    });
    // The call it never finished is closed with what it streamed.
    expect(dataOf(broken, 'response.output_item.done')).toEqual([
      expect.objectContaining({
        item: expect.objectContaining({ arguments: '{"comm' }),
      }),
    ]);
  });

  it('reports the usage in the wire’s shape, as whole numbers', async () => {
    const usageAfter = async (used: LanguageModelV4Usage) =>
      lastResponse(await encode([finish('stop', used)])).usage;
    expect(
      await usageAfter(
        usage(
          { noCache: 3, cacheRead: 90, cacheWrite: 7 },
          { text: 20, reasoning: 30 },
        ),
      ),
    ).toEqual({
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 90 },
      output_tokens: 50,
      output_tokens_details: { reasoning_tokens: 30 },
      total_tokens: 150,
    });
    expect(await usageAfter(usage())).toEqual({
      input_tokens: 0,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 0,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 0,
    });
  });

  it('hides the calls the provider runs itself', async () => {
    const events = await encode([
      {
        type: 'tool-input-start',
        id: 'srvtoolu_1',
        toolName: 'web_search',
        providerExecuted: true,
      },
      { type: 'tool-input-delta', id: 'srvtoolu_1', delta: '{"q":"x"}' },
      {
        type: 'tool-call',
        toolCallId: 'srvtoolu_1',
        toolName: 'web_search',
        input: '{"q":"x"}',
        providerExecuted: true,
      },
      {
        type: 'tool-result',
        toolCallId: 'srvtoolu_1',
        toolName: 'web_search',
        result: { hits: [] },
      },
      {
        type: 'source',
        sourceType: 'url',
        id: 's1',
        url: 'https://example.com',
      },
      finish('stop'),
    ]);
    expect(typesOf(events)).toEqual([
      'response.created',
      'response.in_progress',
      'response.completed',
    ]);
  });

  it('echoes the request’s settings in the response, as OpenAI does', async () => {
    const tools = [{ type: 'function', name: 'shell', parameters: {} }];
    const events = await encode([finish('stop')], {
      instructions: 'Be brief.',
      tools,
      tool_choice: 'required',
      parallel_tool_calls: false,
      reasoning: { effort: 'medium', summary: 'auto' },
      text: { verbosity: 'low' },
      max_output_tokens: 1000,
      temperature: 0.5,
      top_p: 0.8,
      metadata: { run: '1' },
      store: true,
    });
    expect(lastResponse(events)).toMatchObject({
      instructions: 'Be brief.',
      tools,
      tool_choice: 'required',
      parallel_tool_calls: false,
      reasoning: { effort: 'medium', summary: 'auto' },
      text: { verbosity: 'low', format: { type: 'text' } },
      max_output_tokens: 1000,
      temperature: 0.5,
      top_p: 0.8,
      metadata: { run: '1' },
      store: false,
      output: [],
    });
  });

  it('throws when the parts end before they finish, or when one is an error', async () => {
    await expect(
      encode([{ type: 'text-delta', id: '0', delta: 'Hi' }]),
    ).rejects.toThrow("the model's stream ended before it finished");
    await expect(
      encode([{ type: 'error', error: new Error('overloaded') }]),
    ).rejects.toThrow('overloaded');
    const events: string[] = [];
    const stream = responsesAdapter.encodeStream(
      streamOf(
        [{ type: 'text-delta', id: '0', delta: 'Hi' }],
        new Error('the upstream hung up'),
      ),
      contextFor(),
    );
    await expect(
      (async () => {
        for await (const event of stream) events.push(event);
      })(),
    ).rejects.toThrow('the upstream hung up');
    expect(typesOf(events)).toEqual([
      'response.created',
      'response.in_progress',
      'response.output_item.added',
      'response.content_part.added',
      'response.output_text.delta',
    ]);
  });
});

describe('a whole answer', () => {
  const result = (
    content: LanguageModelV4GenerateResult['content'],
    unified: LanguageModelV4FinishReason['unified'] = 'stop',
  ): LanguageModelV4GenerateResult => ({
    content,
    finishReason: { unified, raw: undefined },
    usage: usage({ total: 12, cacheRead: 2 }, { total: 8, reasoning: 3 }),
    warnings: [],
  });

  it('writes the output items and the usage of a completed answer', () => {
    const answer = responsesAdapter.encodeAnswer(
      result(
        [
          {
            type: 'reasoning',
            text: 'Think.',
            providerMetadata: { anthropic: { signature: 'sig-3' } },
          },
          { type: 'text', text: 'Patching.' },
          { type: 'text', text: '' },
          {
            type: 'tool-call',
            toolCallId: 'toolu_1',
            toolName: 'shell',
            input: '',
            providerMetadata: { google: { thoughtSignature: 'ts-1' } },
          },
          {
            type: 'tool-call',
            toolCallId: 'toolu_2',
            toolName: 'apply_patch',
            input: '{"input":"*** Begin Patch"}',
          },
          {
            type: 'tool-call',
            toolCallId: 'srv_1',
            toolName: 'web_search',
            input: '{}',
            providerExecuted: true,
          },
        ],
        'tool-calls',
      ),
      contextFor({
        tools: [{ type: 'custom', name: 'apply_patch' }],
      }),
    );
    expect(answer).toMatchObject({
      id: 'resp_abc',
      object: 'response',
      created_at: 1_760_000_000,
      status: 'completed',
      model: 'gpt-5-codex',
      error: null,
      incomplete_details: null,
      output: [
        {
          id: 'rs_abc_0',
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: 'Think.' }],
          // It carries its own signature with the text it holds for, and
          // the call after it its own.
          encrypted_content: seal({
            options: { anthropic: { signature: 'sig-3' } },
            text: 'Think.',
            calls: { toolu_1: { google: { thoughtSignature: 'ts-1' } } },
          }),
        },
        {
          id: 'msg_abc_1',
          type: 'message',
          status: 'completed',
          content: [
            {
              type: 'output_text',
              annotations: [],
              logprobs: [],
              text: 'Patching.',
            },
          ],
          role: 'assistant',
        },
        {
          id: 'fc_abc_2',
          type: 'function_call',
          status: 'completed',
          arguments: '{}',
          call_id: 'toolu_1',
          name: 'shell',
        },
        {
          id: 'ctc_abc_3',
          type: 'custom_tool_call',
          status: 'completed',
          call_id: 'toolu_2',
          input: '*** Begin Patch',
          name: 'apply_patch',
        },
      ],
      usage: {
        input_tokens: 12,
        input_tokens_details: { cached_tokens: 2 },
        output_tokens: 8,
        output_tokens_details: { reasoning_tokens: 3 },
        total_tokens: 20,
      },
    });
    expect(answer.output).toHaveLength(4);
  });

  it('carries what calls before any reasoning ask back in a reasoning item with an empty summary just before the first of them', () => {
    const signed = (signature: string) => ({
      google: { thoughtSignature: signature },
    });
    const call = (id: string, signature?: string) =>
      ({
        type: 'tool-call',
        toolCallId: id,
        toolName: 'read',
        input: '{}',
        ...(signature !== undefined
          ? { providerMetadata: signed(signature) }
          : {}),
      }) as const;
    const answer = responsesAdapter.encodeAnswer(
      result(
        [
          { type: 'text', text: 'Reading.' },
          call('c1'),
          call('c2', 'ts-2'),
          call('c3', 'ts-3'),
          { type: 'reasoning', text: 'Then.' },
          call('c4', 'ts-4'),
        ],
        'tool-calls',
      ),
      contextFor(),
    );
    const output = answer.output as Record<string, unknown>[];
    expect(output.map((item) => [item.id, item.type])).toEqual([
      ['msg_abc_0', 'message'],
      ['fc_abc_1', 'function_call'],
      ['rs_abc_2', 'reasoning'],
      ['fc_abc_3', 'function_call'],
      ['fc_abc_4', 'function_call'],
      ['rs_abc_5', 'reasoning'],
      ['fc_abc_6', 'function_call'],
    ]);
    expect(output[2]).toMatchObject({ summary: [] });
    expect(carriedBy(output[2])).toEqual({
      calls: { c2: signed('ts-2'), c3: signed('ts-3') },
    });
    expect(carriedBy(output[5])).toEqual({ calls: { c4: signed('ts-4') } });
  });

  it('writes a length stop as incomplete', () => {
    const answer = responsesAdapter.encodeAnswer(
      result([{ type: 'text', text: 'Partial' }], 'length'),
      contextFor(),
    );
    expect(answer).toMatchObject({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
    });
  });
});

describe('a broken stream', () => {
  it('ends with response.failed naming the response, its error in the wire’s shape with the code Codex reads', () => {
    const event = responsesAdapter.encodeStreamError(
      'rate_limit',
      'The model provider answered HTTP 429: slow down',
      contextFor(),
    );
    expect(event).toMatch(
      /^event: response\.failed\ndata: \{"type":"response\.failed","response":\{"id":"resp_abc",/,
    );
    const failed = read(event ?? '');
    expect(failed.data).not.toHaveProperty('sequence_number');
    expect(failed.data.response).toMatchObject({
      id: 'resp_abc',
      object: 'response',
      created_at: 1_760_000_000,
      status: 'failed',
      model: 'gpt-5-codex',
      error: {
        message: 'The model provider answered HTTP 429: slow down',
        type: 'rate_limit_error',
        param: null,
        code: 'rate_limit_exceeded',
      },
      incomplete_details: null,
      output: [],
      usage: null,
    });
    const codeOf = (
      kind: Parameters<typeof responsesAdapter.encodeStreamError>[0],
    ) => {
      const raw = responsesAdapter.encodeStreamError(kind, 'x', contextFor());
      const response = read(raw ?? '').data.response as Record<
        string,
        Record<string, unknown>
      >;
      return response.error?.code;
    };
    expect(codeOf('budget')).toBe('insufficient_quota');
    expect(codeOf('timeout')).toBe('server_error');
    expect(codeOf('upstream')).toBe('server_error');
    expect(codeOf('authentication')).toBe('authentication_error');
  });
});
