import type { Context, Env } from 'hono';
import type { Sql } from 'postgres';

import {
  checkOrganizationRateLimit,
  RateLimitExceededError,
  type RateLimitName,
} from './rate-limit.ts';

/**
 * The 429 an app route answers when an org or user budget is spent: the
 * `RATE_LIMITED` code plus `retryAfterMs` the surfaces read, and the
 * standard `Retry-After` header (whole seconds, rounded up, never zero) for
 * every generic client and proxy in between. One shape for every door, so a
 * spent budget never reads as an outage.
 */
export function rateLimitedResponse<E extends Env>(
  c: Context<E>,
  error: RateLimitExceededError,
): Response {
  return c.json(
    { error: 'RATE_LIMITED', data: { retryAfterMs: error.retryAfter } },
    429,
    { 'retry-after': String(Math.max(1, Math.ceil(error.retryAfter / 1000))) },
  );
}

/**
 * Charge an org-scoped rule and hand back the 429 to return when the budget
 * is spent, `null` when the call may proceed — the REST door's `chargeLane`
 * shape, so a route never has to wrap its whole body to map the refusal.
 */
export async function chargeOrgRateLimit<E extends Env>(
  sql: Sql,
  c: Context<E>,
  rule: RateLimitName,
  organizationId: string,
): Promise<Response | null> {
  try {
    await checkOrganizationRateLimit(sql, rule, organizationId);
    return null;
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return rateLimitedResponse(c, error);
    }
    throw error;
  }
}
