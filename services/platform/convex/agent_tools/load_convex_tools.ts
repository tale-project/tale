/**
 * Load Convex tools as an array (for backward compatibility with LLM nodes)
 */

import { TOOL_REGISTRY_MAP, type ToolName } from './tool_registry';

import { createDebugLog } from '../lib/debug_log';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

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

  debugLog(`Loaded ${tools.length} Convex tools: ${toolNames.join(', ')}`);
  return tools;
}
