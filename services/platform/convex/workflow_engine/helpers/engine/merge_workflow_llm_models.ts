/**
 * Merge workflow-level `config.models` into an LLM step's config when the
 * step defines neither `model` nor `models`. Mirrors the inheritance pattern
 * used for `retryPolicy` (step-level wins, workflow-level is the default).
 *
 * Handles both shapes accepted by `llmStepConfigValidator`:
 * - direct `LLMNodeConfig`
 * - wrapped `{ llmNode: LLMNodeConfig }`
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwnModelOrModels(llm: Record<string, unknown>): boolean {
  if (typeof llm.model === 'string' && llm.model.trim().length > 0) return true;
  if (Array.isArray(llm.models) && llm.models.length > 0) return true;
  return false;
}

export function mergeWorkflowLevelLLMModels(
  stepConfig: unknown,
  workflowModels: string[] | undefined,
): unknown {
  if (!workflowModels || workflowModels.length === 0) return stepConfig;
  if (!isRecord(stepConfig)) return stepConfig;

  // Wrapped form: `{ llmNode: { ... } }`
  if (isRecord(stepConfig.llmNode)) {
    const inner = stepConfig.llmNode;
    if (hasOwnModelOrModels(inner)) return stepConfig;
    return { ...stepConfig, llmNode: { ...inner, models: workflowModels } };
  }

  if (hasOwnModelOrModels(stepConfig)) return stepConfig;
  return { ...stepConfig, models: workflowModels };
}
