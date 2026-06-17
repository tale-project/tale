import { getString, isRecord } from '../../../lib/utils/type-utils';

/**
 * Safely extract a string value from untyped metadata object.
 * Uses runtime narrowing to avoid type casting in callers.
 */
export function getMetadataString(
  metadata: unknown,
  key: string,
): string | undefined {
  if (isRecord(metadata) && key in metadata) {
    return getString(metadata, key);
  }
  return undefined;
}
