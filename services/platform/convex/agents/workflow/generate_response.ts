'use node';

/**
 * Workflow Agent Response Generation
 *
 * Thin wrapper around the generic agent response generator.
 * Includes special handling for delegationMode which is passed to the agent factory.
 */

import type { ActionCtx } from '../../_generated/server';

import {
  generateAgentResponse,
  type GenerateResponseResult,
} from '../../lib/agent_response';
import { WORKFLOW_AGENT_CORE_INSTRUCTIONS } from '../../workflow_engine/instructions/core_instructions';
import { createWorkflowAgent } from './agent';

export interface GenerateWorkflowResponseArgs {
  ctx: ActionCtx;
  threadId: string;
  userId?: string;
  organizationId: string;
  promptMessage: string;
  additionalContext?: Record<string, string>;
  parentThreadId?: string;
  delegationMode?: boolean;
  promptMessageId?: string;
}

export type GenerateWorkflowResponseResult = GenerateResponseResult;

export async function generateWorkflowResponse(
  args: GenerateWorkflowResponseArgs,
): Promise<GenerateWorkflowResponseResult> {
  const { delegationMode = false, ...baseArgs } = args;

  return generateAgentResponse(
    {
      agentType: 'workflow',
      createAgent: (options) =>
        createWorkflowAgent({ withTools: true, delegationMode, ...options }),
      model: process.env.OPENAI_CODING_MODEL || '',
      provider: 'openai',
      debugTag: '[WorkflowAgent]',
      instructions: WORKFLOW_AGENT_CORE_INSTRUCTIONS,
    },
    baseArgs,
  );
}
