/**
 * Load Convex tools as an object (for merging with MCP tools)
 */

import { TOOL_REGISTRY_MAP, type ToolName } from './tool_registry';

export function loadConvexToolsAsObject(
  toolNames?: readonly ToolName[],
): Record<string, unknown> {
  if (!toolNames || toolNames.length === 0) {
    return {};
  }

  const tools: Record<string, unknown> = {};

  for (const toolName of toolNames) {
    const toolDef = TOOL_REGISTRY_MAP[toolName];
    if (toolDef) {
      tools[toolName] = toolDef.tool;
    } else {
      console.warn(`Tool '${toolName}' not found in registry`);
    }
  }

  console.log(
    `Loaded ${Object.keys(tools).length} Convex tools: ${toolNames.join(', ')}`,
  );
  return tools;
}
