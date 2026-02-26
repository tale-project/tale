/**
 * Utilities for parsing comma-separated model lists from environment variables.
 *
 * Supports `OPENAI_MODEL=model-a,model-b,model-c` format.
 * Used by both Convex backend and frontend code.
 */

/**
 * Parse a comma-separated model list into an array of trimmed, non-empty strings.
 */
export function parseModelList(value: string | undefined | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
}

/**
 * Get the first model from a comma-separated model list.
 */
export function getFirstModel(
  value: string | undefined | null,
): string | undefined {
  const models = parseModelList(value);
  return models[0];
}

/**
 * Get the first model from a comma-separated model list, or throw if none available.
 */
export function getFirstModelOrThrow(
  value: string | undefined | null,
  envVarName: string,
): string {
  const model = getFirstModel(value);
  if (!model) {
    throw new Error(
      `[Environment] ${envVarName} is not set or contains no valid models.`,
    );
  }
  return model;
}
