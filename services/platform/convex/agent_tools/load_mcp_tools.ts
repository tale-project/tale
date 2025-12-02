/**
 * Load MCP tools from configured servers
 */

import { MCPClientManager } from './mcp_tools/mcp_client_manager';
import type { MCPServerConfig } from './types';
import { findMcpServerById } from './mcp_tools/find_mcp_server_by_id';
import { replaceVariables } from '../lib/variables/replace_variables';

import { createDebugLog } from '../lib/debug_log';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

export async function loadMCPTools(
  mcpServerIds?: string[],
  variables: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  if (!mcpServerIds || mcpServerIds.length === 0) {
    return {};
  }

  const mcpManager = new MCPClientManager();
  let mcpToolsObject: Record<string, unknown> = {};

  // Normalize tool objects to preserve executable functions
  const normalize = (raw: unknown): Record<string, unknown> => {
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      if ('tools' in obj && obj.tools && typeof obj.tools === 'object') {
        return obj.tools as Record<string, unknown>;
      }
      return obj;
    }
    return {};
  };

  // Resolve server configurations
  const resolvedConfigs: MCPServerConfig[] = [];
  for (const serverId of mcpServerIds) {
    const def = findMcpServerById(serverId);
    if (!def) {
      console.warn(`MCP server id not found in catalog: ${serverId}`);
      continue;
    }
    const resolved = replaceVariables(def, variables) as MCPServerConfig;
    resolvedConfigs.push(resolved);
  }

  // Load tools from each server
  for (const cfg of resolvedConfigs) {
    const raw = await mcpManager.getRawToolsFromServer(cfg);
    const obj = normalize(raw);
    mcpToolsObject = { ...mcpToolsObject, ...obj };
  }

  debugLog(
    `Loaded MCP tools from ${resolvedConfigs.length} servers; ${Object.keys(mcpToolsObject).length} total tools`,
  );

  // Debug: verify each MCP tool has an executable handler
  for (const [name, def] of Object.entries(mcpToolsObject)) {
    const exec = (def as Record<string, unknown>)?.['execute'];
    const execType = typeof exec;
    debugLog(`MCP tool loaded: ${name}, execute type: ${execType}`);
  }

  return mcpToolsObject;
}
