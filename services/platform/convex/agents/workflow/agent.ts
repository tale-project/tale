/**
 * Workflow Agent Configuration
 *
 * Specialized agent for workflow creation and editing with slim system prompt.
 * Detailed knowledge has been moved to tool descriptions and syntax_reference for on-demand retrieval.
 */

import { Agent } from '@convex-dev/agent';

import { components } from '../../_generated/api';
import { type ToolName } from '../../agent_tools/tool_registry';
import { getCodingModelOrThrow } from '../../lib/agent_runtime_config';
import { createAgentConfig } from '../../lib/create_agent_config';
import { createDebugLog } from '../../lib/debug_log';
import {
  WORKFLOW_AGENT_CORE_INSTRUCTIONS,
  WORKFLOW_AGENT_DELEGATION_INSTRUCTIONS,
} from '../../workflow_engine/instructions/core_instructions';

const debugLog = createDebugLog('DEBUG_WORKFLOW_AGENT', '[WorkflowAgent]');

export {
  WORKFLOW_AGENT_CORE_INSTRUCTIONS,
  WORKFLOW_AGENT_DELEGATION_INSTRUCTIONS,
};

export function createWorkflowAgent(options?: {
  withTools?: boolean;
  maxSteps?: number;
  convexToolNames?: ToolName[];
  workflowContext?: string;
  delegationMode?: boolean;
  model?: string;
}) {
  const withTools = options?.withTools ?? true;
  const delegationMode = options?.delegationMode ?? false;
  const maxSteps = options?.maxSteps ?? (delegationMode ? 20 : 30);
  const workflowContext = options?.workflowContext;
  const model = options?.model ?? getCodingModelOrThrow();

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
  }

  debugLog('createWorkflowAgent', {
    toolCount: withTools ? convexToolNames.length : 0,
    delegationMode,
    model,
  });

  const baseInstructions = WORKFLOW_AGENT_CORE_INSTRUCTIONS;
  const selectedInstructions = delegationMode
    ? WORKFLOW_AGENT_DELEGATION_INSTRUCTIONS
    : baseInstructions;

  const finalInstructions = workflowContext
    ? `${selectedInstructions}\n\n${workflowContext}`
    : selectedInstructions;

  const agentConfig = createAgentConfig({
    name: delegationMode
      ? 'workflow-assistant-delegated'
      : 'workflow-assistant',
    model,
    instructions: finalInstructions,
    ...(withTools ? { convexToolNames } : {}),
    maxSteps,
  });

  return new Agent(components.agent, agentConfig);
}
