/**
 * Validation helpers for workflow triggers.
 * Handles idempotency checks and header extraction.
 */

import type { QueryCtx } from '../../../_generated/server';

/**
 * Check if an idempotency key has already been used for this organization.
 * Returns the existing trigger log if duplicate, null otherwise.
 */
export async function checkIdempotency(
  ctx: QueryCtx,
  organizationId: string,
  idempotencyKey: string,
) {
  const existing = await ctx.db
    .query('wfTriggerLogs')
    .withIndex('by_idempotencyKey', (q) =>
      q
        .eq('organizationId', organizationId)
        .eq('idempotencyKey', idempotencyKey),
    )
    .first();

  return existing;
}

/**
 * Extract the idempotency key from request headers.
 */
export function extractIdempotencyKey(headers: Headers): string | null {
  return headers.get('x-idempotency-key');
}

/**
 * Extract client IP from request headers.
 */
export function extractClientIp(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    'unknown'
  );
}
