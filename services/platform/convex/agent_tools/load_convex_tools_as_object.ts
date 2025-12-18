/**
 * Load Convex tools as an object for use with the Agent SDK
 */

import { TOOL_REGISTRY_MAP, type ToolName } from './tool_registry';

import { createDebugLog } from '../lib/debug_log';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

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

  debugLog(
    `Loaded ${Object.keys(tools).length} Convex tools: ${toolNames.join(', ')}`,
  );
  return tools;
}
