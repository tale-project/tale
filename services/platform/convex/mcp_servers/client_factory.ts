'use node';

/**
 * MCP Client Factory
 *
 * Creates ephemeral MCP client connections for tool discovery and execution.
 * Each call creates a fresh connection, calls the target method, then disconnects.
 *
 * Supports HTTP (SSE/Streamable HTTP) and stdio transports.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { decryptString } from '../lib/crypto/decrypt_string';
import { getOrRefreshToken } from './oauth2_helpers';

interface HttpConfig {
  url: string;
  headers?: Record<string, unknown>;
}

interface StdioConfig {
  command: string;
  args?: string[];
  env?: Record<string, unknown>;
}

interface BearerTokenConfig {
  tokenEncrypted: string;
}

interface OAuth2Config {
  clientId: string;
  clientSecretEncrypted: string;
  tokenUrl: string;
  authorizationUrl?: string;
  scopes?: string[];
  grantType: 'client_credentials' | 'authorization_code';
}

interface OAuth2Tokens {
  accessTokenEncrypted: string;
  refreshTokenEncrypted?: string;
  tokenExpiry?: number;
}

interface McpServerConfig {
  transportType: 'http' | 'stdio';
  httpConfig?: HttpConfig;
  stdioConfig?: StdioConfig;
  authType: 'none' | 'bearer' | 'oauth2';
  bearerToken?: BearerTokenConfig;
  oauth2Config?: OAuth2Config;
  oauth2Tokens?: OAuth2Tokens;
}

interface DiscoveredTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface ToolCallResult {
  content: Array<{
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

interface TokenUpdate {
  accessTokenEncrypted: string;
  refreshTokenEncrypted?: string;
  tokenExpiry?: number;
}

/**
 * Build authorization headers based on auth config.
 */
async function buildAuthHeaders(
  config: McpServerConfig,
): Promise<{ headers: Record<string, string>; tokenUpdate?: TokenUpdate }> {
  const headers: Record<string, string> = {};
  let tokenUpdate: TokenUpdate | undefined;

  if (config.authType === 'bearer' && config.bearerToken) {
    const token = await decryptString(config.bearerToken.tokenEncrypted);
    headers['Authorization'] = `Bearer ${token}`;
  } else if (config.authType === 'oauth2' && config.oauth2Config) {
    const result = await getOrRefreshToken(
      config.oauth2Config,
      config.oauth2Tokens,
    );
    headers['Authorization'] = `Bearer ${result.accessToken}`;
    tokenUpdate = {
      accessTokenEncrypted: result.accessTokenEncrypted,
      refreshTokenEncrypted: result.refreshTokenEncrypted,
      tokenExpiry: result.tokenExpiry,
    };
  }

  return { headers, tokenUpdate };
}

/**
 * Create an MCP client, connect, run a callback, then disconnect.
 */
async function withMcpClient<T>(
  config: McpServerConfig,
  callback: (client: Client) => Promise<T>,
): Promise<{ result: T; tokenUpdate?: TokenUpdate }> {
  const { headers: authHeaders, tokenUpdate } = await buildAuthHeaders(config);

  const client = new Client(
    { name: 'tale-platform', version: '1.0.0' },
    { capabilities: {} },
  );

  let transport;

  if (config.transportType === 'http' && config.httpConfig) {
    const url = new URL(config.httpConfig.url);

    // Merge custom headers with auth headers
    const allHeaders: Record<string, string> = {};
    if (config.httpConfig.headers) {
      for (const [key, value] of Object.entries(config.httpConfig.headers)) {
        if (typeof value === 'string') {
          allHeaders[key] = value;
        }
      }
    }
    Object.assign(allHeaders, authHeaders);

    // Try Streamable HTTP first, fall back to SSE
    try {
      transport = new StreamableHTTPClientTransport(url, {
        requestInit: {
          headers: allHeaders,
        },
      });
      await client.connect(transport);
    } catch {
      // Fall back to SSE transport
      transport = new SSEClientTransport(url, {
        requestInit: {
          headers: allHeaders,
        },
      });
      await client.connect(transport);
    }
  } else if (config.transportType === 'stdio' && config.stdioConfig) {
    const env: Record<string, string> = { ...process.env };
    if (config.stdioConfig.env) {
      for (const [key, value] of Object.entries(config.stdioConfig.env)) {
        if (typeof value === 'string') {
          env[key] = value;
        }
      }
    }

    transport = new StdioClientTransport({
      command: config.stdioConfig.command,
      args: config.stdioConfig.args,
      env,
    });
    await client.connect(transport);
  } else {
    throw new Error('Invalid transport configuration');
  }

  try {
    const result = await callback(client);
    return { result, tokenUpdate };
  } finally {
    try {
      await client.close();
    } catch {
      // Ignore close errors
    }
  }
}

/**
 * Discover tools from an MCP server.
 */
export async function discoverTools(
  config: McpServerConfig,
): Promise<{ tools: DiscoveredTool[]; tokenUpdate?: TokenUpdate }> {
  const { result, tokenUpdate } = await withMcpClient(
    config,
    async (client) => {
      const response = await client.listTools();
      return response.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- MCP SDK returns untyped JSON schema objects
        inputSchema: tool.inputSchema as Record<string, unknown> | undefined,
      }));
    },
  );

  return { tools: result, tokenUpdate };
}

/**
 * Execute a tool on an MCP server.
 */
export async function executeTool(
  config: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ result: ToolCallResult; tokenUpdate?: TokenUpdate }> {
  const { result, tokenUpdate } = await withMcpClient(
    config,
    async (client) => {
      const response = await client.callTool({
        name: toolName,
        arguments: args,
      });
      return {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- MCP SDK returns typed content array
        content: (response.content ?? []) as ToolCallResult['content'],
        isError: response.isError === true,
      };
    },
  );

  return { result, tokenUpdate };
}
