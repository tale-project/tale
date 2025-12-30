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
  const result = await rateLimiter.limit(ctx, name, {
    key: `org:${organizationId}`,
    count,
    throws: false,
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
  const result = await rateLimiter.limit(ctx, name, {
    key: `user:${userId}`,
    count,
    throws: false,
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
  const result = await rateLimiter.limit(ctx, name, {
    key: `ip:${ip}`,
    count,
    throws: false,
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
  const result = await rateLimiter.check(ctx, name, {
    key,
    count,
  });

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
