/**
 * Create Workflow Assistant Agent
 *
 * Specialized agent for workflow creation and editing with slim system prompt.
 * Detailed knowledge has been moved to tool descriptions and syntax_reference for on-demand retrieval.
 */

import { Agent } from '@convex-dev/agent';
import { components } from '../_generated/api';
import { createAgentConfig } from './create_agent_config';
import { type ToolName } from '../agent_tools/tool_registry';
import {
  WORKFLOW_AGENT_CORE_INSTRUCTIONS,
  WORKFLOW_AGENT_DELEGATION_INSTRUCTIONS,
} from '../workflow_engine/instructions/core_instructions';

import { createDebugLog } from './debug_log';

const debugLog = createDebugLog('DEBUG_CHAT_AGENT', '[ChatAgent]');

export function createWorkflowAgent(options?: {
  withTools?: boolean;
  maxSteps?: number;
  convexToolNames?: ToolName[];
  /** Dynamic workflow context to append to the system prompt */
  workflowContext?: string;
  /** Delegation mode - used when called as a sub-agent from Chat Agent */
  delegationMode?: boolean;
}) {
  const withTools = options?.withTools ?? true;
  const delegationMode = options?.delegationMode ?? false;
  const maxSteps = options?.maxSteps ?? (delegationMode ? 20 : 30);
  const workflowContext = options?.workflowContext;

  // Build tool inputs (Convex tool names)
  let convexToolNames: ToolName[] = [];

  if (withTools) {
    const defaultWorkflowTools: ToolName[] = [
      'workflow_read',
      'workflow_examples',
      'update_workflow_step',
      'save_workflow_definition',
      'create_workflow',
      'database_schema',
    ];

    convexToolNames = options?.convexToolNames ?? defaultWorkflowTools;

    debugLog('createWorkflowAgent Loaded tools', {
      convexCount: convexToolNames.length,
      delegationMode,
    });
  }

  // Use slim core instructions - detailed knowledge moved to tool descriptions
  const baseInstructions = WORKFLOW_AGENT_CORE_INSTRUCTIONS;

  // Select instructions based on mode
  const selectedInstructions = delegationMode
    ? WORKFLOW_AGENT_DELEGATION_INSTRUCTIONS
    : baseInstructions;

  // Append workflow context to system prompt if provided
  const finalInstructions = workflowContext
    ? `${selectedInstructions}\n\n${workflowContext}`
    : selectedInstructions;

  // OPENAI_CODING_MODEL is required for workflow agent
  const model = (process.env.OPENAI_CODING_MODEL || '').trim();
  if (!model) {
    throw new Error(
      'OPENAI_CODING_MODEL environment variable is required for Workflow Agent but is not set',
    );
  }

  const agentConfig = createAgentConfig({
    name: delegationMode ? 'workflow-assistant-delegated' : 'workflow-assistant',
    model,
    instructions: finalInstructions,
    ...(withTools ? { convexToolNames } : {}),
    maxSteps,
  });

  return new Agent(components.agent, agentConfig);
}
