import type { MCPServerRegistration } from '../types';
import { MCP_SERVER_CATALOG } from './mcp_server_catalog';

export function findMcpServerById(
  id: string,
): MCPServerRegistration | undefined {
  return MCP_SERVER_CATALOG.find((s) => s.serverId === id);
}

