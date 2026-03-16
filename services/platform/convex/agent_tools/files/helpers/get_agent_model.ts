import type { ToolCtx } from '@convex-dev/agent';

/**
 * Extract the model ID string from the calling agent's configuration.
 * Used by file tools to ensure they use the same model as their parent agent.
 */
export function getAgentModelId(ctx: ToolCtx): string {
  if (!ctx.agent) {
    throw new Error(
      'getAgentModelId: ctx.agent is undefined. Tool must be invoked by an Agent.',
    );
  }
  const lm = ctx.agent.options.languageModel;
  if (typeof lm === 'string') return lm;
  if ('modelId' in lm && typeof lm.modelId === 'string') return lm.modelId;
  if ('model' in lm && typeof lm.model === 'string') return lm.model;
  throw new Error(
    'getAgentModelId: languageModel object has neither modelId nor model property',
  );
}
