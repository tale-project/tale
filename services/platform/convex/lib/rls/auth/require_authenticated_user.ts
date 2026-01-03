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
import { authComponent } from '../../../auth';

/**
 * Require authenticated user from context
 * @throws {UnauthenticatedError} When user is not authenticated
 */
export async function requireAuthenticatedUser(
  ctx: QueryCtx | MutationCtx | ActionCtx,
): Promise<AuthenticatedUser> {
  const authUser = await authComponent.getAuthUser(ctx);

  if (!authUser || !authUser._id) {
    throw new UnauthenticatedError();
  }

  return {
    userId: authUser._id,
    email: authUser.email ?? undefined,
    name: authUser.name ?? undefined,
  };
}
