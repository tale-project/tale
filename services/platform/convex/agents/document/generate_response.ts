'use node';

/**
 * Document Agent Response Generation
 *
 * Thin wrapper around the generic agent response generator.
 */

import type { ActionCtx } from '../../_generated/server';
import { createDocumentAgent } from './agent';
import {
  generateAgentResponse,
  type GenerateResponseResult,
} from '../../lib/agent_response';

export interface GenerateDocumentResponseArgs {
  ctx: ActionCtx;
  threadId: string;
  userId?: string;
  organizationId: string;
  taskDescription: string;
  additionalContext?: Record<string, string>;
  parentThreadId?: string;
}

export type GenerateDocumentResponseResult = GenerateResponseResult;

export async function generateDocumentResponse(
  args: GenerateDocumentResponseArgs,
): Promise<GenerateDocumentResponseResult> {
  return generateAgentResponse(
    {
      agentType: 'document',
      createAgent: createDocumentAgent,
      model: process.env.OPENAI_FAST_MODEL || '',
      provider: 'openai',
      debugTag: '[DocumentAgent]',
    },
    args,
  );
}
