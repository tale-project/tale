/**
 * Load all tools (Convex + MCP) and return them in a unified format
 */

import { loadConvexTools } from './load_convex_tools';
import { loadMCPTools } from './load_mcp_tools';
import type { LoadedTools } from '../workflow/helpers/nodes/llm/types';
import { ToolName } from './tool_registry';

export async function loadAllTools(
  convexToolNames?: ToolName[],
  mcpServerIds?: string[],
  variables: Record<string, unknown> = {},
): Promise<LoadedTools> {
  const convexTools = loadConvexTools(convexToolNames);
  const mcpTools = await loadMCPTools(mcpServerIds, variables);

  return {
    convexTools,
    mcpTools,
    totalCount: convexTools.length + Object.keys(mcpTools).length,
  };
}
