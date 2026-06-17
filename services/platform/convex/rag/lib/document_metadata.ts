'use node';

/**
 * Validation for the flat document-metadata bag (#1517).
 *
 * `private_knowledge.documents.metadata` stores a FLAT map of scalar values
 * that `/search` can filter on via JSONB containment. Two callers share these
 * rules:
 *
 * - Ingestion (`uploadDocument`): the upload `metadata` form field is a
 *   free-form JSON blob that also carries transport keys (`source_created_at`,
 *   `folder_path`, …). `sanitizeDocumentMetadata` strips those + any
 *   non-conforming values, warning instead of failing the upload.
 * - The strict surfaces (`SearchFilters.metadata`, `PATCH /documents/metadata`):
 *   `validateMetadataObject` rejects bad shapes loudly.
 */

import { logger } from '../../lib/knowledge/logger';

export const MAX_METADATA_KEYS = 20;
export const MAX_METADATA_KEY_LENGTH = 64;
export const MAX_METADATA_STRING_LENGTH = 512;
export const MAX_METADATA_LIST_ITEMS = 50;

export type MetadataScalar = string | number | boolean;

/** Keys consumed by dedicated columns / transport concerns — never stored. */
export const RESERVED_METADATA_KEYS: ReadonlySet<string> = new Set([
  'source_created_at',
  'source_modified_at',
  'folder_path',
  'content_type',
  'file_id',
  'filename',
]);

/** True when a value is a valid stored scalar (string within length, num, bool). */
export function isValidScalar(value: unknown): value is MetadataScalar {
  if (typeof value === 'string') {
    return value.length <= MAX_METADATA_STRING_LENGTH;
  }
  return typeof value === 'number' || typeof value === 'boolean';
}

/**
 * Validate a metadata map strictly; throw on violation. With `allowLists`
 * true, list-of-scalar values are admitted (the IN-filter form used by
 * `SearchFilters.metadata`); stored metadata is scalar-only.
 */
export function validateMetadataObject(
  value: Record<string, unknown>,
  allowLists: boolean,
): Record<string, unknown> {
  const keys = Object.keys(value);
  if (keys.length > MAX_METADATA_KEYS) {
    throw new Error(`metadata exceeds ${MAX_METADATA_KEYS} keys`);
  }
  for (const key of keys) {
    const item = value[key];
    if (!key || key.length > MAX_METADATA_KEY_LENGTH) {
      throw new Error(
        `metadata key must be 1-${MAX_METADATA_KEY_LENGTH} characters: ${JSON.stringify(key.slice(0, 80))}`,
      );
    }
    if (RESERVED_METADATA_KEYS.has(key)) {
      throw new Error(`metadata key is reserved: ${JSON.stringify(key)}`);
    }
    if (Array.isArray(item)) {
      if (!allowLists) {
        throw new Error(
          `metadata value for ${JSON.stringify(key)} must be a scalar`,
        );
      }
      if (item.length === 0 || item.length > MAX_METADATA_LIST_ITEMS) {
        throw new Error(
          `metadata list for ${JSON.stringify(key)} must have 1-${MAX_METADATA_LIST_ITEMS} items`,
        );
      }
      if (!item.every((v) => isValidScalar(v))) {
        throw new Error(
          `metadata list for ${JSON.stringify(key)} must contain only scalars`,
        );
      }
    } else if (!isValidScalar(item)) {
      throw new Error(
        `metadata value for ${JSON.stringify(key)} must be a string, number, or boolean`,
      );
    }
  }
  return value;
}

/**
 * Extract the storable metadata map from an upload `metadata` blob. Lenient
 * counterpart of `validateMetadataObject`: reserved keys are silently skipped,
 * anything else non-conforming is dropped with a warning. Never throws — a bad
 * metadata value must not fail the upload.
 */
export function sanitizeDocumentMetadata(
  parsed: Record<string, unknown>,
): Record<string, MetadataScalar> {
  const sanitized: Record<string, MetadataScalar> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (RESERVED_METADATA_KEYS.has(key)) {
      continue;
    }
    if (Object.keys(sanitized).length >= MAX_METADATA_KEYS) {
      logger.warn(
        `Ignoring document metadata beyond ${MAX_METADATA_KEYS} keys`,
      );
      break;
    }
    if (!key || key.length > MAX_METADATA_KEY_LENGTH) {
      logger.warn(
        `Ignoring over-long document metadata key (${key.length} chars)`,
      );
      continue;
    }
    if (!isValidScalar(value)) {
      logger.warn(
        `Ignoring non-scalar document metadata value for key ${JSON.stringify(key)}`,
      );
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}
