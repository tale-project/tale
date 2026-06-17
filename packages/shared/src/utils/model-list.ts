/**
 * Utilities for parsing comma-separated model lists from environment variables.
 */

/** Parse a comma-separated model list into trimmed, non-empty strings. */
export function parseModelList(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
}

/** Get the first model from a comma-separated model list, or null when empty. */
export function getFirstModel(value: string | null | undefined): string | null {
  const models = parseModelList(value);
  return models.length > 0 ? models[0] : null;
}

/** Get the first model from a comma-separated model list, or throw if none. */
export function getFirstModelOrThrow(
  value: string | null | undefined,
  varName: string,
): string {
  const model = getFirstModel(value);
  if (!model) {
    throw new Error(`${varName} is not set or contains no valid models.`);
  }
  return model;
}
