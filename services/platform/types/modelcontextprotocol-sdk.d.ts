// Type declarations for @modelcontextprotocol/sdk
// The package is a runtime dependency loaded in Node actions but not installed
// in the main workspace. These declarations cover only the API surface used
// by the MCP client factory.

declare module '@modelcontextprotocol/sdk/client/index.js' {
  export interface ClientInfo {
    name: string;
    version: string;
  }

  export interface ClientOptions {
    capabilities: Record<string, unknown>;
  }

  export interface Tool {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }

  export interface ListToolsResult {
    tools: Tool[];
  }

  export interface CallToolResult {
    content?: Array<{
      type: string;
      text?: string;
      data?: string;
      mimeType?: string;
    }>;
    isError?: boolean;
  }

  export interface Transport {
    close?(): Promise<void>;
  }

  export class Client {
    constructor(info: ClientInfo, options: ClientOptions);
    connect(transport: Transport): Promise<void>;
    close(): Promise<void>;
    listTools(): Promise<ListToolsResult>;
    callTool(args: {
      name: string;
      arguments: Record<string, unknown>;
    }): Promise<CallToolResult>;
  }
}

declare module '@modelcontextprotocol/sdk/client/sse.js' {
  import type { Transport } from '@modelcontextprotocol/sdk/client/index.js';

  export class SSEClientTransport implements Transport {
    constructor(
      url: URL,
      options?: { requestInit?: { headers?: Record<string, string> } },
    );
    close(): Promise<void>;
  }
}

declare module '@modelcontextprotocol/sdk/client/stdio.js' {
  import type { Transport } from '@modelcontextprotocol/sdk/client/index.js';

  export class StdioClientTransport implements Transport {
    constructor(options: {
      command: string;
      args?: string[];
      env?: Record<string, string>;
    });
    close(): Promise<void>;
  }
}

declare module '@modelcontextprotocol/sdk/client/streamableHttp.js' {
  import type { Transport } from '@modelcontextprotocol/sdk/client/index.js';

  export class StreamableHTTPClientTransport implements Transport {
    constructor(
      url: URL,
      options?: { requestInit?: { headers?: Record<string, string> } },
    );
    close(): Promise<void>;
  }
}
