/**
 * Validators for integration processing records action
 *
 * These validators are the source of truth for types.
 * Use `Infer<typeof validator>` to derive types.
 */

import { v } from 'convex/values';

/**
 * Validator for cursor format (timestamp format)
 */
export const cursorFormatValidator = v.union(
  v.literal('iso'),
  v.literal('epoch_ms'),
  v.literal('epoch_s'),
  v.literal('date'),
);

/**
 * Validator for cursor configuration
 *
 * - field: Field name in the response to extract cursor value from
 * - actionParam: Parameter name to pass cursor value to action (defaults to field)
 * - format: Timestamp format for parsing/formatting (for timestamp-based strategies)
 */
export const cursorConfigValidator = v.object({
  field: v.string(),
  actionParam: v.optional(v.string()),
  format: v.optional(cursorFormatValidator),
});

/**
 * Base fields shared by all find strategies
 */
const baseFindFields = {
  integration: v.string(),
  action: v.string(),
  params: v.optional(v.any()),
  uniqueKey: v.string(),
  tag: v.string(),
  filter: v.optional(v.string()),
  backoffHours: v.number(),
  /** Maximum number of records to return (default: 1) */
  limit: v.optional(v.number()),
};

/**
 * Validator for find_by_timestamp strategy
 */
export const findByTimestampValidator = v.object({
  strategy: v.literal('find_by_timestamp'),
  ...baseFindFields,
  cursor: cursorConfigValidator,
});

/**
 * Validator for find_by_cursor strategy
 */
export const findByCursorValidator = v.object({
  strategy: v.literal('find_by_cursor'),
  ...baseFindFields,
  cursor: cursorConfigValidator,
});

/**
 * Validator for find_by_id strategy
 */
export const findByIdValidator = v.object({
  strategy: v.literal('find_by_id'),
  ...baseFindFields,
  cursor: cursorConfigValidator,
});

/**
 * Validator for find_all strategy (no cursor needed)
 */
export const findAllValidator = v.object({
  strategy: v.literal('find_all'),
  ...baseFindFields,
});

/**
 * Validator for record_processed strategy
 */
export const recordProcessedValidator = v.object({
  strategy: v.literal('record_processed'),
  integration: v.string(),
  tag: v.string(),
  recordId: v.string(),
  metadata: v.optional(v.any()),
});

/**
 * Combined validator for all strategies
 */
export const integrationProcessingRecordsParamsValidator = v.union(
  findByTimestampValidator,
  findByCursorValidator,
  findByIdValidator,
  findAllValidator,
  recordProcessedValidator,
);
