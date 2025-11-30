/**
 * Full trusted-headers authentication flow business logic.
 *
 * This wraps the lower-level helpers for:
 * - finding/creating the user from headers
 * - creating/reusing a Better Auth session
 */

import type { MutationCtx } from '../../_generated/server';
import { findOrCreateUserFromHeaders } from './find_or_create_user_from_headers';
import { createSessionForTrustedUser } from './create_session_for_trusted_user';

export interface TrustedHeadersAuthenticateArgs {
  email: string;
  name: string;
  role: string;
  existingSessionToken?: string;
  ipAddress?: string;
  userAgent?: string;
  secret?: string;
}

export interface TrustedHeadersAuthenticateResult {
  userId: string;
  organizationId: string | null;
  sessionToken: string;
  shouldClearOldSession: boolean;
}

export async function trustedHeadersAuthenticate(
  ctx: MutationCtx,
  args: TrustedHeadersAuthenticateArgs,
): Promise<TrustedHeadersAuthenticateResult> {
  const requiredSecret = process.env.TRUSTED_HEADERS_INTERNAL_SECRET;
  if (requiredSecret && args.secret !== requiredSecret) {
    throw new Error('Invalid internal secret for trusted headers authentication');
  }

  const { email, name, role, existingSessionToken, ipAddress, userAgent } = args;

  // First, find or create the user and ensure their profile matches headers
  const userResult = await findOrCreateUserFromHeaders(ctx, {
    email,
    name,
    role,
  });

  // Then, create or reuse a session for this user, handling account switching
  const sessionResult = await createSessionForTrustedUser(ctx, {
    userId: userResult.userId,
    existingSessionToken,
    ipAddress,
    userAgent,
  });

  return {
    userId: userResult.userId,
    organizationId: userResult.organizationId,
    sessionToken: sessionResult.sessionToken,
    shouldClearOldSession: sessionResult.shouldClearOldSession,
  };
}
