/**
 * Calculate the cutoff timestamp for workflow processing based on backoffHours.
 */

import { BACKOFF_NEVER_REPROCESS } from './constants';

/**
 * Calculate the cutoff timestamp for workflow processing based on backoffHours.
 * If backoffHours is BACKOFF_NEVER_REPROCESS (-1), returns epoch (1970-01-01)
 * to ensure records are never reprocessed once they have any processing record.
 */
export function calculateCutoffTimestamp(backoffHours: number): string {
  if (backoffHours === BACKOFF_NEVER_REPROCESS) {
    // Use epoch - any record that was ever processed will have processedAt >= 0
    return new Date(0).toISOString();
  }

  const cutoffDate = new Date();
  cutoffDate.setHours(cutoffDate.getHours() - backoffHours);
  return cutoffDate.toISOString();
}

