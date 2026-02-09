'use node';

/**
 * CRM Agent Response Generation
 *
 * Thin wrapper around the generic agent response generator.
 */

import type { ActionCtx } from '../../_generated/server';

import {
  generateAgentResponse,
  type GenerateResponseResult,
} from '../../lib/agent_response';
import { createCrmAgent, CRM_AGENT_INSTRUCTIONS } from './agent';

export interface GenerateCrmResponseArgs {
  ctx: ActionCtx;
  threadId: string;
  userId?: string;
  organizationId: string;
  promptMessage: string;
  additionalContext?: Record<string, string>;
  parentThreadId?: string;
}

export type GenerateCrmResponseResult = GenerateResponseResult;

export async function generateCrmResponse(
  args: GenerateCrmResponseArgs,
): Promise<GenerateCrmResponseResult> {
  return generateAgentResponse(
    {
      agentType: 'crm',
      createAgent: createCrmAgent,
      model: process.env.OPENAI_FAST_MODEL || '',
      provider: 'openai',
      debugTag: '[CrmAgent]',
      instructions: CRM_AGENT_INSTRUCTIONS,
    },
    args,
  );
}
