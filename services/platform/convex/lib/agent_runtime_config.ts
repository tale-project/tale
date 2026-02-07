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
