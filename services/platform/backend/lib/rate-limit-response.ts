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

/**
 * `Retry-After` in whole seconds, rounded up and never zero — the one figure
 * every door advertises, whichever body its protocol speaks.
 */
export function retryAfterSeconds(retryAfterMs: number): string {
  return String(Math.max(1, Math.ceil(retryAfterMs / 1000)));
}

/**
 * The same refusal for a door that answers with a bare `Response` and no
 * Hono context — the Slack events webhook, the SSE/screencast auth
 * pre-checks: 429, plain text, `Retry-After`, plus whatever headers the door
 * always sends (`Cache-Control: no-store`, `Vary`).
 */
export function rateLimitedPlainResponse(
  error: RateLimitExceededError,
  headers: Record<string, string> = {},
): Response {
  return new Response('Rate limit exceeded', {
    status: 429,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      ...headers,
      'retry-after': retryAfterSeconds(error.retryAfter),
    },
  });
}

/**
 * The rate-limit refusal behind an error, if any: the error itself, or the
 * `cause` a domain wrapper carries (a `DocumentError` / `TtsError` coded
 * `RATE_LIMITED`, so the wrapper's own consumers — the REST helpers, the
 * bridges — keep reading a code while the app door answers the one 429).
 * Null for anything else.
 */
export function rateLimitExceededCause(
  error: unknown,
): RateLimitExceededError | null {
  if (error instanceof RateLimitExceededError) return error;
  if (error instanceof Error && error.cause instanceof RateLimitExceededError) {
    return error.cause;
  }
  return null;
}
