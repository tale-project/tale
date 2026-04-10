/**
 * Simple model-to-cost-per-token mapping for usage cost estimation.
 *
 * Costs are in cents per 1M tokens. Falls back to a default rate
 * when a model is not in the mapping.
 */

export interface ModelCost {
  inputCentsPerMillion: number;
  outputCentsPerMillion: number;
}

const MODEL_COSTS: Record<string, ModelCost> = {
  'gpt-4o-mini': { inputCentsPerMillion: 15, outputCentsPerMillion: 60 },
  'gpt-4o': { inputCentsPerMillion: 250, outputCentsPerMillion: 1000 },
  'gpt-4-turbo': { inputCentsPerMillion: 1000, outputCentsPerMillion: 3000 },
  'claude-3-5-haiku': {
    inputCentsPerMillion: 80,
    outputCentsPerMillion: 400,
  },
  'claude-haiku-4': {
    inputCentsPerMillion: 80,
    outputCentsPerMillion: 400,
  },
  'claude-sonnet-4': {
    inputCentsPerMillion: 300,
    outputCentsPerMillion: 1500,
  },
  'claude-opus-4': {
    inputCentsPerMillion: 1500,
    outputCentsPerMillion: 7500,
  },
  'text-embedding-3-small': {
    inputCentsPerMillion: 2,
    outputCentsPerMillion: 0,
  },
  'text-embedding-3-large': {
    inputCentsPerMillion: 13,
    outputCentsPerMillion: 0,
  },
};

/**
 * Conservative default: use the most expensive model cost as fallback.
 * Undercharging is worse than overcharging for budget enforcement.
 */
const DEFAULT_COST: ModelCost = {
  inputCentsPerMillion: 1500,
  outputCentsPerMillion: 7500,
};

/** Entries sorted by key length descending to avoid substring collision
 * (e.g. "gpt-4o-mini" must match before "gpt-4o"). */
const SORTED_MODEL_ENTRIES = Object.entries(MODEL_COSTS).sort(
  ([a], [b]) => b.length - a.length,
);

function getModelCost(modelId: string): ModelCost {
  const normalized = modelId.toLowerCase();
  for (const [key, cost] of SORTED_MODEL_ENTRIES) {
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
  providerCost?: ModelCost,
): number {
  const cost = providerCost ?? getModelCost(modelId ?? '');
  const inputCost = (inputTokens / 1_000_000) * cost.inputCentsPerMillion;
  const outputCost = (outputTokens / 1_000_000) * cost.outputCentsPerMillion;
  return Math.round((inputCost + outputCost) * 100) / 100;
}
