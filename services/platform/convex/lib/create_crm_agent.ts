/**
 * Create CRM Assistant Agent
 *
 * Specialized agent for CRM data operations (customers, products).
 * Isolates potentially large datasets from the main chat agent's context.
 */

import { Agent } from '@convex-dev/agent';
import { components } from '../_generated/api';
import { createAgentConfig } from './create_agent_config';
import { type ToolName } from '../agent_tools/tool_registry';
import { CRM_ASSISTANT_INSTRUCTIONS } from '../agent_tools/sub_agents/instructions/crm_instructions';
import { createDebugLog } from './debug_log';

const debugLog = createDebugLog('DEBUG_CRM_AGENT', '[CrmAgent]');

export function createCrmAgent(options?: {
  maxSteps?: number;
}) {
  const maxSteps = options?.maxSteps ?? 10;

  const convexToolNames: ToolName[] = [
    'customer_read',
    'product_read',
  ];

  debugLog('createCrmAgent Loaded tools', {
    convexCount: convexToolNames.length,
    maxSteps,
  });

  const agentConfig = createAgentConfig({
    name: 'crm-assistant',
    instructions: CRM_ASSISTANT_INSTRUCTIONS,
    convexToolNames,
    maxSteps,
    useFastModel: true,
  });

  return new Agent(components.agent, agentConfig);
}
