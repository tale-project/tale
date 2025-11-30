'use node';

/**
 * MCP Client Manager
 *
 * Manages MCP server connections and tool retrieval using AI SDK
 */

import { experimental_createMCPClient as createMCPClient } from 'ai';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { MCPServerConfig } from '../types';

export class MCPClientManager {
  private clients = new Map<
    string,
    Awaited<ReturnType<typeof createMCPClient>>
  >();

  /**
   * Create or get existing MCP client for a server
   */
  async createClient(config: MCPServerConfig) {
    if (this.clients.has(config.serverId)) {
      return this.clients.get(config.serverId)!;
    }

    const url = new URL(config.url);

    // Use user-configured authentication headers
    const requestHeaders = {
      ...config.authConfig?.headers, // User-provided auth headers
    };

    const mcpClient = await createMCPClient({
      transport: new StreamableHTTPClientTransport(url, {
        sessionId: config.sessionId || `session_${Date.now()}`,
        requestInit: {
          headers: requestHeaders,
        },
      }),
    });

    this.clients.set(config.serverId, mcpClient);
    console.log(`Created MCP client for server: ${config.serverId}`);
    return mcpClient;
  }

  /**
   * Get raw tools payload from a specific MCP server without mapping.
   * Returns whatever the MCP client exposes so callers can pass it directly
   * to the LLM node as its `tools` configuration.
   */
  async getRawToolsFromServer(config: MCPServerConfig): Promise<unknown> {
    const client = await this.createClient(config);
    const tools = await client.tools();
    // Keep raw shape; some servers return an object keyed by tool name,
    // others may wrap in { tools: <object|string> }.
    return tools;
  }
}
