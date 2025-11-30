/**
 * Load Convex tools as an array (for backward compatibility with LLM nodes)
 */

import { TOOL_REGISTRY_MAP, type ToolName } from './tool_registry';

export function loadConvexTools(toolNames?: readonly ToolName[]): unknown[] {
  if (!toolNames || toolNames.length === 0) {
    return [];
  }

  const tools: unknown[] = [];

  for (const toolName of toolNames) {
    const toolDef = TOOL_REGISTRY_MAP[toolName];
    if (toolDef) {
      tools.push(toolDef.tool);
    } else {
      console.warn(`Tool '${toolName}' not found in registry`);
    }
  }

  console.log(`Loaded ${tools.length} Convex tools: ${toolNames.join(', ')}`);
  return tools;
}
