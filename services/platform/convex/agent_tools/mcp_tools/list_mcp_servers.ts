import type { MCPServerRegistration } from '../types';
import { MCP_SERVER_CATALOG } from './mcp_server_catalog';

export function listMcpServers(): MCPServerRegistration[] {
  return MCP_SERVER_CATALOG;
}

