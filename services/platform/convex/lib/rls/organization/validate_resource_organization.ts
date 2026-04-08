/**
 * Validate resource belongs to user's organization
 * Updated to use Better Auth's string-based organization IDs
 */

import type { QueryCtx, MutationCtx } from '../../../_generated/server';
import { RLSError, OrganizationMismatchError } from '../errors';

/**
 * Validate resource belongs to user's organization
 */
export async function validateResourceOrganization<
  T extends { organizationId: string },
>(
  ctx: QueryCtx | MutationCtx,
  resource: T | null,
  userOrganizationId: string,
): Promise<T> {
  if (!resource) {
    throw new RLSError('Resource not found', 'NOT_FOUND');
  }

  if (resource.organizationId !== userOrganizationId) {
    throw new OrganizationMismatchError();
  }

  return resource;
}
