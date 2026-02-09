/**
 * Get authenticated user from context, returning null if not authenticated
 */

import type {
  QueryCtx,
  MutationCtx,
  ActionCtx,
} from '../../../_generated/server';
import type { AuthenticatedUser } from '../types';

import { UnauthenticatedError } from '../errors';
import { requireAuthenticatedUser } from './require_authenticated_user';

/**
 * Try to get authenticated user from context, returning null if not authenticated
 * This is useful for queries that should return empty results instead of errors
 */
export async function getAuthenticatedUser(
  ctx: QueryCtx | MutationCtx | ActionCtx,
): Promise<AuthenticatedUser | null> {
  try {
    return await requireAuthenticatedUser(ctx);
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return null;
    }
    throw error;
  }
}
