/**
 * MCP Tool Definition
 *
 * Generic MCP tool for the registry. Actual MCP tools are dynamically
 * bound per-server via create_bound_mcp_tool.ts, but this entry exists
 * so that the 'mcp' tool name is recognized in the registry.
 */

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { ToolDefinition } from '../types';

const mcpCallTool = createTool({
  description:
    'Execute a tool on a connected MCP (Model Context Protocol) server. ' +
    'MCP tools are dynamically bound per-server — use the specific server-bound tools instead. ' +
    'This generic entry is a fallback when no specific bindings are configured.',
  inputSchema: z.object({
    serverName: z.string().describe('Name of the MCP server to call'),
    toolName: z.string().describe('Name of the tool to execute on the server'),
    args: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Arguments to pass to the tool'),
  }),
  execute: async () => {
    return {
      error:
        'No MCP servers are bound to this agent. Configure MCP server bindings in the agent settings.',
    };
  },
});

export const mcpTool: ToolDefinition = {
  name: 'mcp',
  tool: mcpCallTool,
};
