/**
 * Create Integration Assistant Agent
 *
 * Specialized agent for external system operations with approval workflows.
 * Isolates potentially large database results from the main chat agent's context.
 */

import { Agent } from '@convex-dev/agent';
import { components } from '../_generated/api';
import { createAgentConfig } from './create_agent_config';
import { type ToolName } from '../agent_tools/tool_registry';
import { INTEGRATION_ASSISTANT_INSTRUCTIONS } from '../agent_tools/sub_agents/instructions/integration_instructions';
import { createDebugLog } from './debug_log';

const debugLog = createDebugLog('DEBUG_INTEGRATION_AGENT', '[IntegrationAgent]');

export function createIntegrationAgent(options?: {
  maxSteps?: number;
}) {
  const maxSteps = options?.maxSteps ?? 20;

  const convexToolNames: ToolName[] = [
    'integration',
    'integration_batch',
    'integration_introspect',
    'verify_approval',
    'request_human_input',
  ];

  debugLog('createIntegrationAgent Loaded tools', {
    convexCount: convexToolNames.length,
    maxSteps,
  });

  const agentConfig = createAgentConfig({
    name: 'integration-assistant',
    instructions: INTEGRATION_ASSISTANT_INSTRUCTIONS,
    convexToolNames,
    maxSteps,
  });

  return new Agent(components.agent, agentConfig);
}
