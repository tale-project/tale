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
  return lm.modelId;
}
