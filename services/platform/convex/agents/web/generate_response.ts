'use node';

/**
 * Web Agent Response Generation
 *
 * Thin wrapper around the generic agent response generator.
 */

import type { ActionCtx } from '../../_generated/server';
import { createWebAgent, WEB_AGENT_INSTRUCTIONS } from './agent';
import {
  generateAgentResponse,
  type GenerateResponseResult,
} from '../../lib/agent_response';

export interface GenerateWebResponseArgs {
  ctx: ActionCtx;
  threadId: string;
  userId?: string;
  organizationId: string;
  taskDescription: string;
  additionalContext?: Record<string, string>;
  parentThreadId?: string;
}

export type GenerateWebResponseResult = GenerateResponseResult;

export async function generateWebResponse(
  args: GenerateWebResponseArgs,
): Promise<GenerateWebResponseResult> {
  return generateAgentResponse(
    {
      agentType: 'web',
      createAgent: createWebAgent,
      model: process.env.OPENAI_FAST_MODEL || '',
      provider: 'openai',
      debugTag: '[WebAgent]',
      instructions: WEB_AGENT_INSTRUCTIONS,
    },
    args,
  );
}
