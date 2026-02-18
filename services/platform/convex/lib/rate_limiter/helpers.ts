/**
 * Rate Limiter Helper Functions
 *
 * Provides convenient wrappers for rate limiting in mutations and actions.
 */

import type { GenericMutationCtx, GenericActionCtx } from 'convex/server';

import type { DataModel } from '../../_generated/dataModel';

import { rateLimiter, type RateLimitName } from './index';

export class RateLimitExceededError extends Error {
  readonly retryAfter: number;

  constructor(message: string, retryAfter: number) {
    super(message);
    this.name = 'RateLimitExceededError';
    this.retryAfter = retryAfter;
  }
}

type MutationCtx = GenericMutationCtx<DataModel>;
type ActionCtx = GenericActionCtx<DataModel>;

type RateLimitResult = { ok: true } | { ok: false; retryAfter: number };

// @convex-dev/rate-limiter uses per-name conditional types that TypeScript can't
// evaluate when the name parameter is the full RateLimitName union. These wrappers
// centralize the assertion. All configs return { ok, retryAfter } with throws: false.
async function limitRate(
  ctx: MutationCtx | ActionCtx,
  name: RateLimitName,
  opts: { key: string; count: number },
): Promise<RateLimitResult> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- RateLimitName union is too wide for @convex-dev/rate-limiter's per-name conditional type; narrowing to a single literal satisfies the constraint while all configs share the same result shape
  return rateLimiter.limit(ctx, name as 'ai:chat', {
    ...opts,
    throws: false,
  });
}

async function checkRate(
  ctx: MutationCtx | ActionCtx,
  name: RateLimitName,
  opts: { key: string; count: number },
): Promise<RateLimitResult> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same as limitRate above
  return rateLimiter.check(ctx, name as 'ai:chat', opts);
}

/**
 * Check and consume a rate limit token for organization-scoped operations.
 * Throws RateLimitExceededError if limit exceeded.
 */
export async function checkOrganizationRateLimit(
  ctx: MutationCtx | ActionCtx,
  name: RateLimitName,
  organizationId: string,
  count: number = 1,
): Promise<void> {
  const result = await limitRate(ctx, name, {
    key: `org:${organizationId}`,
    count,
  });

  if (!result.ok) {
    throw new RateLimitExceededError(
      `Rate limit exceeded for ${name}. Try again in ${Math.ceil(result.retryAfter / 1000)} seconds.`,
      result.retryAfter,
    );
  }
}

/**
 * Check and consume a rate limit token for user-scoped operations.
 * Throws RateLimitExceededError if limit exceeded.
 */
export async function checkUserRateLimit(
  ctx: MutationCtx | ActionCtx,
  name: RateLimitName,
  userId: string,
  count: number = 1,
): Promise<void> {
  const result = await limitRate(ctx, name, {
    key: `user:${userId}`,
    count,
  });

  if (!result.ok) {
    throw new RateLimitExceededError(
      `Rate limit exceeded for ${name}. Try again in ${Math.ceil(result.retryAfter / 1000)} seconds.`,
      result.retryAfter,
    );
  }
}

/**
 * Check and consume a rate limit token for IP-scoped operations.
 * Throws RateLimitExceededError if limit exceeded.
 */
export async function checkIpRateLimit(
  ctx: MutationCtx | ActionCtx,
  name: RateLimitName,
  ip: string,
  count: number = 1,
): Promise<void> {
  const result = await limitRate(ctx, name, {
    key: `ip:${ip}`,
    count,
  });

  if (!result.ok) {
    throw new RateLimitExceededError(
      `Rate limit exceeded. Try again in ${Math.ceil(result.retryAfter / 1000)} seconds.`,
      result.retryAfter,
    );
  }
}

/**
 * Check rate limit without consuming tokens (for pre-flight checks).
 */
export async function canPerformAction(
  ctx: MutationCtx | ActionCtx,
  name: RateLimitName,
  key: string,
  count: number = 1,
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const result = await checkRate(ctx, name, { key, count });

  return {
    allowed: result.ok,
    retryAfter: result.ok ? undefined : result.retryAfter,
  };
}

/**
 * Reset rate limit for a specific key (useful after failed operations).
 */
export async function resetRateLimit(
  ctx: MutationCtx,
  name: RateLimitName,
  key: string,
): Promise<void> {
  await rateLimiter.reset(ctx, name, { key });
}
