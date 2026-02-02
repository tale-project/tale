'use node';

/**
 * Integration Agent Response Generation
 *
 * Thin wrapper around the generic agent response generator.
 * Includes special handling for integrationsInfo which is merged into additionalContext.
 */

import type { ActionCtx } from '../../_generated/server';
import { createIntegrationAgent, INTEGRATION_AGENT_INSTRUCTIONS } from './agent';
import {
  generateAgentResponse,
  type GenerateResponseResult,
} from '../../lib/agent_response';

export interface GenerateIntegrationResponseArgs {
  ctx: ActionCtx;
  threadId: string;
  userId?: string;
  organizationId: string;
  promptMessage: string;
  additionalContext?: Record<string, string>;
  parentThreadId?: string;
  integrationsInfo?: string;
}

export type GenerateIntegrationResponseResult = GenerateResponseResult;

export async function generateIntegrationResponse(
  args: GenerateIntegrationResponseArgs,
): Promise<GenerateIntegrationResponseResult> {
  const model = process.env.OPENAI_FAST_MODEL;
  if (!model) {
    throw new Error('OPENAI_FAST_MODEL environment variable is not configured');
  }

  const { integrationsInfo, additionalContext, ...baseArgs } = args;

  // Merge integrations info into additional context
  const mergedAdditionalContext = {
    ...additionalContext,
    ...(integrationsInfo ? { available_integrations: integrationsInfo } : {}),
  };

  return generateAgentResponse(
    {
      agentType: 'integration',
      createAgent: createIntegrationAgent,
      model,
      provider: 'openai',
      debugTag: '[IntegrationAgent]',
      instructions: INTEGRATION_AGENT_INSTRUCTIONS,
    },
    {
      ...baseArgs,
      additionalContext:
        Object.keys(mergedAdditionalContext).length > 0
          ? mergedAdditionalContext
          : undefined,
    },
  );
}
