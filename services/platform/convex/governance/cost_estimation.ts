/**
 * Simple model-to-cost-per-token mapping for usage cost estimation.
 *
 * Costs are in cents per 1M tokens. Falls back to a default rate
 * when a model is not in the mapping.
 */

interface ModelCost {
  inputCentsPerMillion: number;
  outputCentsPerMillion: number;
}

const MODEL_COSTS: Record<string, ModelCost> = {
  'gpt-4o': { inputCentsPerMillion: 250, outputCentsPerMillion: 1000 },
  'gpt-4o-mini': { inputCentsPerMillion: 15, outputCentsPerMillion: 60 },
  'gpt-4-turbo': { inputCentsPerMillion: 1000, outputCentsPerMillion: 3000 },
  'claude-sonnet-4-20250514': {
    inputCentsPerMillion: 300,
    outputCentsPerMillion: 1500,
  },
  'claude-3-5-haiku-20241022': {
    inputCentsPerMillion: 80,
    outputCentsPerMillion: 400,
  },
  'claude-opus-4-20250514': {
    inputCentsPerMillion: 1500,
    outputCentsPerMillion: 7500,
  },
};

const DEFAULT_COST: ModelCost = {
  inputCentsPerMillion: 200,
  outputCentsPerMillion: 800,
};

function getModelCost(modelId: string): ModelCost {
  const normalized = modelId.toLowerCase();
  for (const [key, cost] of Object.entries(MODEL_COSTS)) {
    if (normalized.includes(key)) {
      return cost;
    }
  }
  return DEFAULT_COST;
}

/**
 * Estimate cost in cents from token counts and model ID.
 */
export function estimateCostCents(
  modelId: string | undefined,
  inputTokens: number,
  outputTokens: number,
): number {
  const cost = getModelCost(modelId ?? '');
  const inputCost = (inputTokens / 1_000_000) * cost.inputCentsPerMillion;
  const outputCost = (outputTokens / 1_000_000) * cost.outputCentsPerMillion;
  return Math.round((inputCost + outputCost) * 100) / 100;
}
