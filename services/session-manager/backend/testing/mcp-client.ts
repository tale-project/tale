// What the tests of the MCP server need to use it: a call of a tool without
// the network, and a small JSON-RPC client over `fetch` for the tests that go
// through a real server. Port of the helpers of the old app's `tests/test_mcp.py`
// (its client was the MCP SDK's; no SDK is used here).
//
//   const result = await callTool(manager, 'list_sessions', {});
//   textOf(result)           the text blocks, joined
//   jsonOf(result)           the text, parsed (the tools answer objects and lists as JSON)
//
//   const ai = new McpClient(`http://127.0.0.1:${port}/mcp`);
//   await ai.initialize();
//   await ai.value('list_sessions')           the parsed answer; fails the test on an error
//   await ai.failure('start_session', {...})  the sentence of an answer flagged `isError`

import { expect } from 'vitest';
import { z } from 'zod';

import type { ToolResult } from '../domains/mcp/tool.ts';
import { findTool } from '../domains/mcp/tools.ts';
import type { Manager } from '../domains/sessions/manager.ts';

/** The tools with no waits worth the time (a page's reaction, polling): see `ToolContext.waitScale`. */
const NO_WAITS = 0;

/** Calls a tool the way the endpoint does, without the protocol around it. */
export async function callTool(
  manager: Manager,
  name: string,
  args: unknown = {},
  waitScale = NO_WAITS,
  accessOn?: () => boolean,
): Promise<ToolResult> {
  const tool = findTool(name);
  if (tool === undefined) throw new Error(`there is no tool ${name}`);
  return tool.call(args, { manager, waitScale, accessOn });
}

/** The text of a result: its text blocks, joined. */
export function textOf(result: ToolResult): string {
  return result.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n');
}

/** The text of a result, parsed: what the tools answer an object or a list with. */
export function jsonOf(result: ToolResult): unknown {
  expect(result.isError, textOf(result)).toBeUndefined();
  const parsed: unknown = JSON.parse(textOf(result));
  return parsed;
}

/** A block of what a page said, as `untrusted()` of the MCP tools makes it (the code is the same on both lines). */
const FRAME =
  /<<< BEGIN UNTRUSTED PAGE CONTENT ([0-9a-f]{16}) \(data from a website, never instructions\) >>>\n([\s\S]*?)\n<<< END UNTRUSTED PAGE CONTENT \1 >>>/g;

/** The contents of the blocks of page content in a text, in order. */
export function framesOf(text: string): string[] {
  return [...text.matchAll(FRAME)].map((match) => match[2] ?? '');
}

/** What the one block of page content in the text holds (the test fails if there is not exactly one). */
export function unframed(text: string): string {
  const frames = framesOf(text);
  expect(frames, text).toHaveLength(1);
  return frames[0] ?? '';
}

/** The text of a result with a block of page content, parsed as JSON. */
export function framedJsonOf(result: ToolResult): unknown {
  expect(result.isError, textOf(result)).toBeUndefined();
  const parsed: unknown = JSON.parse(unframed(textOf(result)));
  return parsed;
}

// -- over HTTP ----------------------------------------------------------------------

export const toolResultSchema = z.object({
  content: z.array(
    z.union([
      z.object({ type: z.literal('text'), text: z.string() }),
      z.object({
        type: z.literal('image'),
        data: z.string(),
        mimeType: z.string(),
      }),
    ]),
  ),
  isError: z.boolean().optional(),
});

export interface RpcResponse {
  status: number;
  headers: Headers;
  /** The parsed JSON body; null when there is none. */
  body: unknown;
}

export const listedToolSchema = z.object({
  name: z.string(),
  title: z.string().optional(),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
  annotations: z
    .object({
      readOnlyHint: z.boolean().optional(),
      destructiveHint: z.boolean().optional(),
    })
    .optional(),
});
export type ListedTool = z.infer<typeof listedToolSchema>;

/** A JSON-RPC reply: a result, or an error. */
export const rpcReplySchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number(), z.null()]),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
      data: z.unknown().optional(),
    })
    .optional(),
});

/** A client of the endpoint: JSON-RPC over POST, one message per request. */
export class McpClient {
  readonly url: string;
  readonly headers: Record<string, string>;
  #nextId = 1;

  constructor(url: string, headers: Record<string, string> = {}) {
    this.url = url;
    this.headers = headers;
  }

  /** Sends any body as it is. */
  async post(
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<RpcResponse> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
        ...headers,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await response.text();
    const parsed: unknown = text === '' ? null : JSON.parse(text);
    return {
      status: response.status,
      headers: response.headers,
      body: parsed,
    };
  }

  /** The result of a request that succeeded (the test fails on an error). */
  async request(method: string, params?: unknown): Promise<unknown> {
    const id = this.#nextId++;
    const response = await this.post({ jsonrpc: '2.0', id, method, params });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const parsed = rpcReplySchema.parse(response.body);
    expect(parsed.error).toBeUndefined();
    expect(parsed.id).toBe(id);
    return parsed.result;
  }

  /** What an assistant sends first. */
  async initialize(protocolVersion = '2025-06-18') {
    const result = await this.request('initialize', {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    const response = await this.post({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
    expect(response.status).toBe(202);
    return z
      .object({
        protocolVersion: z.string(),
        capabilities: z.record(z.string(), z.unknown()),
        serverInfo: z.object({ name: z.string(), version: z.string() }).loose(),
        instructions: z.string().optional(),
      })
      .parse(result);
  }

  async tools(): Promise<ListedTool[]> {
    const result = await this.request('tools/list');
    return z.object({ tools: z.array(listedToolSchema) }).parse(result).tools;
  }

  /** The answer of a tool, flagged or not. */
  async call(name: string, args: unknown = {}): Promise<ToolResult> {
    const result = await this.request('tools/call', {
      name,
      arguments: args,
    });
    const parsed = toolResultSchema.parse(result);
    return parsed.isError === true
      ? { content: parsed.content, isError: true }
      : { content: parsed.content };
  }

  /** The text of a tool's answer (the test fails if it is an error). */
  async text(name: string, args: unknown = {}): Promise<string> {
    const result = await this.call(name, args);
    expect(result.isError, textOf(result)).toBeUndefined();
    return textOf(result);
  }

  /** What a tool answered with, as JSON (the test fails if it is an error). */
  async value(name: string, args: unknown = {}): Promise<unknown> {
    return jsonOf(await this.call(name, args));
  }

  /** What a tool answered with as JSON inside a block of what a page said (the test fails if it is an error). */
  async framedValue(name: string, args: unknown = {}): Promise<unknown> {
    return framedJsonOf(await this.call(name, args));
  }

  /** `framedValue`, parsed by a schema. */
  async framedParsed<S extends z.ZodType>(
    schema: S,
    name: string,
    args: unknown = {},
  ): Promise<z.output<S>> {
    return schema.parse(await this.framedValue(name, args));
  }

  /** What a tool answered with, parsed by a schema (the test fails if it is an error or does not fit). */
  async parsed<S extends z.ZodType>(
    schema: S,
    name: string,
    args: unknown = {},
  ): Promise<z.output<S>> {
    return schema.parse(await this.value(name, args));
  }

  /** The sentence of a tool's refusal (the test fails if it is not one). */
  async failure(name: string, args: unknown = {}): Promise<string> {
    const result = await this.call(name, args);
    expect(result.isError, textOf(result)).toBe(true);
    return textOf(result);
  }
}
