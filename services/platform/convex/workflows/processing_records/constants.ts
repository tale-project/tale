/**
 * Constants for workflow processing records
 */

/**
 * Special value for backoffHours that indicates a record should never be reprocessed.
 * When this value is used, records will only be processed once in their entire lifetime.
 *
 * @example
 * ```typescript
 * // Process each customer only once, never reprocess
 * findAndClaimUnprocessed(ctx, {
 *   organizationId,
 *   tableName: 'customers',
 *   wfDefinitionId,
 *   backoffHours: BACKOFF_NEVER_REPROCESS,
 * });
 * ```
 */
export const BACKOFF_NEVER_REPROCESS = -1;
