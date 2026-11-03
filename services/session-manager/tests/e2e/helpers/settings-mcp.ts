import type { APIRequestContext, APIResponse } from '@playwright/test';
import { z } from 'zod';

/** The revision of the protocol the specs speak (the newest the server knows besides 2025-11-25). */
export const PROTOCOL_VERSION = '2025-06-18';

const initializeSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.number(),
  result: z.object({
    protocolVersion: z.string(),
    capabilities: z.object({ tools: z.object({ listChanged: z.boolean() }) }),
    serverInfo: z.object({
      name: z.string(),
      title: z.string(),
      version: z.string(),
    }),
    instructions: z.string(),
  }),
});
export type InitializeResult = z.infer<typeof initializeSchema>['result'];

const toolListSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.number(),
  result: z.object({
    tools: z.array(
      z.object({
        name: z.string(),
        description: z.string(),
        inputSchema: z.object({ type: z.literal('object') }).loose(),
        /** What the tool says about itself: `readOnlyHint` and the like. */
        annotations: z.record(z.string(), z.unknown()).optional(),
      }),
    ),
  }),
});

export interface McpTool {
  name: string;
  annotations: Record<string, unknown>;
}

const toolCallSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.number(),
  result: z.object({
    content: z.array(z.object({ type: z.string(), text: z.string() }).loose()),
    isError: z.boolean().optional(),
  }),
});

/**
 * An MCP client as an assistant is: JSON-RPC messages POSTed to `/mcp` as
 * `application/json`, with the `Accept` header the Streamable HTTP transport
 * asks clients for. The base URL of the request context says where.
 */
export class McpClient {
  #next = 1;

  constructor(private readonly request: APIRequestContext) {}

  /** One JSON-RPC message, answered as the server answers it (the status too). */
  send(
    method: string,
    params?: unknown,
    headers: Record<string, string> = {},
  ): Promise<APIResponse> {
    return this.post(
      { jsonrpc: '2.0', id: this.#next++, method, params },
      headers,
    );
  }

  post(
    message: unknown,
    headers: Record<string, string> = {},
  ): Promise<APIResponse> {
    return this.request.post('/mcp', {
      data: message,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...headers,
      },
    });
  }

  async initialize(): Promise<InitializeResult> {
    const response = await this.send('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'session-manager-e2e', version: '1.0.0' },
    });
    if (response.status() !== 200) {
      throw new Error(`initialize answered ${response.status()}`);
    }
    return initializeSchema.parse(await response.json()).result;
  }

  /** The tools `tools/list` offers, in the order it lists them, with what each says about itself. */
  async tools(): Promise<McpTool[]> {
    const response = await this.send('tools/list', undefined, {
      'MCP-Protocol-Version': PROTOCOL_VERSION,
    });
    if (response.status() !== 200) {
      throw new Error(`tools/list answered ${response.status()}`);
    }
    return toolListSchema
      .parse(await response.json())
      .result.tools.map((tool) => ({
        name: tool.name,
        annotations: tool.annotations ?? {},
      }));
  }

  /** The names of the tools `tools/list` offers, in the order it lists them. */
  async toolNames(): Promise<string[]> {
    return (await this.tools()).map((tool) => tool.name);
  }

  /** Calls a tool; the text of its answer, and whether it says it failed. */
  async call(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<{ text: string; isError: boolean }> {
    const response = await this.send(
      'tools/call',
      { name, arguments: args },
      { 'MCP-Protocol-Version': PROTOCOL_VERSION },
    );
    if (response.status() !== 200) {
      throw new Error(`tools/call ${name} answered ${response.status()}`);
    }
    const { result } = toolCallSchema.parse(await response.json());
    return {
      text: result.content.map((block) => block.text).join('\n'),
      isError: result.isError ?? false,
    };
  }
}

/** The body the endpoint answers with while AI access is off. */
export const AI_ACCESS_OFF = {
  error: 'ai_access_off',
  message: 'AI access is off. Turn it on in Settings.',
} as const;
