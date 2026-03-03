/**
 * Require authenticated user from context
 */

import type {
  QueryCtx,
  MutationCtx,
  ActionCtx,
} from '../../../_generated/server';
import type { AuthenticatedUser } from '../types';

import { UnauthenticatedError } from '../errors';
import { getAuthUserIdentity } from './get_auth_user_identity';

/**
 * Require authenticated user from context.
 *
 * Uses JWT identity (0 DB queries) rather than authComponent.getAuthUser
 * which performs 2 cross-component DB queries. The JWT is already
 * cryptographically validated by Convex before the function runs.
 *
 * @throws {UnauthenticatedError} When user is not authenticated
 */
export async function requireAuthenticatedUser(
  ctx: QueryCtx | MutationCtx | ActionCtx,
): Promise<AuthenticatedUser> {
  const user = await getAuthUserIdentity(ctx);
  if (!user) {
    throw new UnauthenticatedError();
  }
  return user;
}
