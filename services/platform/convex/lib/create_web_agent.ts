/**
 * Create Web Assistant Agent
 *
 * Specialized agent for web content fetching and search operations.
 * Isolates potentially large web page content from the main chat agent's context.
 */

import { Agent } from '@convex-dev/agent';
import { components } from '../_generated/api';
import { createAgentConfig } from './create_agent_config';
import { type ToolName } from '../agent_tools/tool_registry';
import { WEB_ASSISTANT_INSTRUCTIONS } from '../agent_tools/sub_agents/instructions/web_instructions';
import { createDebugLog } from './debug_log';

const debugLog = createDebugLog('DEBUG_WEB_AGENT', '[WebAgent]');

export function createWebAgent(options?: {
  maxSteps?: number;
}) {
  const maxSteps = options?.maxSteps ?? 5;

  const convexToolNames: ToolName[] = ['web_read'];

  debugLog('createWebAgent Loaded tools', {
    convexCount: convexToolNames.length,
    maxSteps,
  });

  const agentConfig = createAgentConfig({
    name: 'web-assistant',
    instructions: WEB_ASSISTANT_INSTRUCTIONS,
    convexToolNames,
    maxSteps,
    useFastModel: true,
  });

  return new Agent(components.agent, agentConfig);
}
