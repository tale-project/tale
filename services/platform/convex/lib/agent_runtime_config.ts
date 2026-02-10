export function getDefaultAgentRuntimeConfig() {
  const model = process.env.OPENAI_MODEL;
  if (!model) {
    throw new Error('OPENAI_MODEL environment variable is not set');
  }
  return {
    model,
    provider: 'openai' as const,
  };
}

/**
 * Returns the coding/advanced model if configured, or undefined.
 * Used by workflow agents and other agents that need a more capable model.
 */
export function getCodingModel(): string | undefined {
  return (process.env.OPENAI_CODING_MODEL || '').trim() || undefined;
}
