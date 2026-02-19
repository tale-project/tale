'use node';

/**
 * Document Agent Response Generation
 *
 * Thin wrapper around the generic agent response generator.
 */

import type { ActionCtx } from '../../_generated/server';

import {
  generateAgentResponse,
  type GenerateResponseResult,
} from '../../lib/agent_response';
import { createDocumentAgent, DOCUMENT_AGENT_INSTRUCTIONS } from './agent';

export interface GenerateDocumentResponseArgs {
  ctx: ActionCtx;
  threadId: string;
  userId?: string;
  organizationId: string;
  promptMessage: string;
  additionalContext?: Record<string, string>;
  parentThreadId?: string;
  deadlineMs?: number;
}

export type GenerateDocumentResponseResult = GenerateResponseResult;

export async function generateDocumentResponse(
  args: GenerateDocumentResponseArgs,
): Promise<GenerateDocumentResponseResult> {
  const model = process.env.OPENAI_FAST_MODEL;
  if (!model) {
    throw new Error('OPENAI_FAST_MODEL environment variable is not configured');
  }

  return generateAgentResponse(
    {
      agentType: 'document',
      createAgent: createDocumentAgent,
      model,
      provider: 'openai',
      debugTag: '[DocumentAgent]',
      instructions: DOCUMENT_AGENT_INSTRUCTIONS,
    },
    args,
  );
}
