import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { AppError } from '../../errors.ts';
import { textOf } from '../../testing/mcp-client.ts';
import { stubManager } from '../../testing/mcp-stub-manager.ts';
import { RemoteError } from '../browser/remote.ts';
import {
  AccessOffError,
  ToolError,
  defineTool,
  failure,
  jpegImage,
  json,
} from './tool.ts';
import type { ToolContext, ToolOutput } from './tool.ts';

const context: ToolContext = { manager: stubManager(), waitScale: 0 };

afterEach(() => {
  vi.restoreAllMocks();
});

/** A tool that does what the test says, over arguments of the usual kinds. */
function toolDoing(
  run: (args: { a: string; n: number }) => Promise<ToolOutput>,
) {
  return defineTool({
    name: 'overview',
    group: 'overview',
    title: 'A tool',
    description: 'Does something.',
    input: z.strictObject({
      a: z.string(),
      n: z.int().default(1),
    }),
    routes: [],
    run,
  });
}

describe('a tool call', () => {
  it('runs the tool with the arguments it parsed, defaults included', async () => {
    const run = vi.fn(() => Promise.resolve('Done.'));
    const result = await toolDoing(run).call({ a: 'x' }, context);
    expect(run).toHaveBeenCalledWith({ a: 'x', n: 1 }, context);
    expect(result).toEqual({ content: [{ type: 'text', text: 'Done.' }] });
  });

  it('takes no arguments for an empty object', async () => {
    const tool = defineTool({
      name: 'overview',
      group: 'overview',
      title: 'A tool',
      description: 'Does something.',
      input: z.strictObject({}),
      routes: [],
      run: () => Promise.resolve('Fine.'),
    });
    for (const none of [undefined, null, {}]) {
      expect(textOf(await tool.call(none, context))).toBe('Fine.');
    }
  });

  it('passes the result a tool made itself', async () => {
    const result = await toolDoing(() =>
      Promise.resolve(json({ list: [1, 2] })),
    ).call({ a: 'x' }, context);
    expect(result).toEqual({
      content: [
        { type: 'text', text: JSON.stringify({ list: [1, 2] }, null, 2) },
      ],
    });
  });

  it('says every problem with the arguments at once, as the answer and not as a protocol error', async () => {
    const run = vi.fn();
    const result = await toolDoing(run).call(
      { a: 5, n: 'two', extra: true },
      context,
    );
    expect(run).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      [
        'Invalid arguments for overview:',
        '- a: Invalid input: expected string, received number',
        '- n: Invalid input: expected number, received string',
        '- extra: is not an argument of this tool',
      ].join('\n'),
    );
  });

  it('names a field of a nested object that is not one', async () => {
    const tool = defineTool({
      name: 'create_secret',
      group: 'secrets',
      title: 'A tool',
      description: 'Does something.',
      input: z.strictObject({
        fields: z.array(z.strictObject({ label: z.string() })),
      }),
      routes: [],
      run: () => Promise.resolve('Fine.'),
    });
    const result = await tool.call(
      { fields: [{ label: 'a', oops: 1 }] },
      context,
    );
    expect(textOf(result)).toContain(
      '- fields.0.oops: is not a field of this object',
    );
  });

  it('says which kinds a value may be when it is none of them', async () => {
    const tool = defineTool({
      name: 'get_session',
      group: 'sessions',
      title: 'A tool',
      description: 'Does something.',
      input: z.strictObject({ session: z.union([z.string(), z.int()]) }),
      routes: [],
      run: () => Promise.resolve('x'),
    });
    for (const [session, saw] of [
      [true, 'boolean'],
      [null, 'null'],
      [[], 'array'],
    ] as const) {
      expect(textOf(await tool.call({ session }, context))).toBe(
        `Invalid arguments for get_session:\n- session: expected string, received ${saw}, or expected number, received ${saw}`,
      );
    }
  });

  it('refuses arguments that are not an object', async () => {
    const result = await toolDoing(() => Promise.resolve('x')).call(
      'text',
      context,
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('- arguments: ');
  });

  it('never quotes what was sent: it may be a password', async () => {
    const result = await toolDoing(() => Promise.resolve('x')).call(
      { a: { password: 'p4ssw0rd-value' }, n: 'p4ssw0rd-value', oops: 1 },
      context,
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).not.toContain('p4ssw0rd');
  });

  it('lists at most ten problems', async () => {
    const tool = defineTool({
      name: 'overview',
      group: 'overview',
      title: 'A tool',
      description: 'Does something.',
      input: z.strictObject({}),
      routes: [],
      run: () => Promise.resolve('x'),
    });
    const many = Object.fromEntries(
      Array.from({ length: 14 }, (_, index) => [`k${index}`, 1]),
    );
    const lines = textOf(await tool.call(many, context)).split('\n');
    expect(lines).toHaveLength(12);
    expect(lines.at(-1)).toBe('- and 4 more');
  });
});

describe('what a tool refuses with', () => {
  it('is an answer flagged as an error, in the sentence it was refused with', async () => {
    for (const error of [
      new ToolError('Give an element number.'),
      new AppError(409, 'session_not_running', 'That session is not running.'),
      new RemoteError('There is no such tab.'),
    ]) {
      const result = await toolDoing(() => Promise.reject(error)).call(
        { a: 'x' },
        context,
      );
      expect(result).toEqual({
        content: [{ type: 'text', text: error.message }],
        isError: true,
      });
    }
  });

  it('is generic for a fault, which is logged', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fault = new TypeError(
      'cannot read /home/me/secret/path of undefined',
    );
    const result = await toolDoing(() => Promise.reject(fault)).call(
      { a: 'x' },
      context,
    );
    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: "overview failed unexpectedly. The app's log has the details.",
        },
      ],
      isError: true,
    });
    expect(logged).toHaveBeenCalledWith('the MCP tool overview failed', fault);
  });

  it('is generic for a fault that is thrown before the first wait too', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await toolDoing(() => {
      throw new TypeError('bug');
    }).call({ a: 'x' }, context);
    expect(result.isError).toBe(true);
  });
});

describe('a tool that sees AI access switched off', () => {
  it('lets the error through: the endpoint answers it, the model is not told', async () => {
    const tool = toolDoing(() => Promise.reject(new AccessOffError()));
    await expect(tool.call({ a: 'x' }, context)).rejects.toBeInstanceOf(
      AccessOffError,
    );
  });
});

describe('results', () => {
  it('failure flags the text as an error', () => {
    expect(failure('No.')).toEqual({
      content: [{ type: 'text', text: 'No.' }],
      isError: true,
    });
  });

  it('json writes an object or a list with indentation', () => {
    expect(textOf(json({ a: 1 }))).toBe('{\n  "a": 1\n}');
    expect(textOf(json([]))).toBe('[]');
  });

  it('jpegImage is a base64 image/jpeg', () => {
    expect(jpegImage(new TextEncoder().encode('jpeg-1'))).toEqual({
      content: [
        {
          type: 'image',
          data: Buffer.from('jpeg-1').toString('base64'),
          mimeType: 'image/jpeg',
        },
      ],
    });
  });
});

describe('the schema a tool advertises', () => {
  const tool = defineTool({
    name: 'click',
    group: 'browser',
    title: 'A tool',
    description: 'Does something.',
    input: z.strictObject({
      session: z.union([z.string(), z.int()]).describe('A session.'),
      x: z.int().nullish(),
      button: z.enum(['left', 'right']).default('left'),
      double: z.boolean().default(false),
    }),
    routes: [],
    run: () => Promise.resolve('x'),
  });

  it('is the JSON Schema of the arguments, without the dialect marker', () => {
    expect(tool.inputSchema).not.toHaveProperty('$schema');
    expect(tool.inputSchema).toMatchObject({
      type: 'object',
      required: ['session'], // what has a default or may be left out is not required
      additionalProperties: false,
      properties: {
        session: { description: 'A session.' },
        button: { type: 'string', enum: ['left', 'right'], default: 'left' },
        double: { type: 'boolean', default: false },
      },
    });
  });

  it('says integer for an integer and no more', () => {
    expect(JSON.stringify(tool.inputSchema)).toContain('"type":"integer"');
    expect(JSON.stringify(tool.inputSchema)).not.toContain('9007199254740991');
  });

  it('is plain JSON', () => {
    expect(JSON.parse(JSON.stringify(tool.inputSchema))).toEqual(
      tool.inputSchema,
    );
  });
});
