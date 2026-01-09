/**
 * Safely extract a string value from untyped metadata object.
 * Uses runtime narrowing to avoid type casting in callers.
 */
export function getMetadataString(
  metadata: unknown,
  key: string,
): string | undefined {
  if (
    metadata !== null &&
    metadata !== undefined &&
    typeof metadata === 'object' &&
    key in metadata
  ) {
    const value = (metadata as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}
