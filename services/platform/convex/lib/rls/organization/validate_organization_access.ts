/**
 * Validate organization access for any resource using Better Auth
 */

import type { QueryCtx, MutationCtx } from '../../../_generated/server';
import type { AuthenticatedUser, RLSContext } from '../types';

import { createRLSContext } from '../context/create_rls_context';
import { UnauthorizedError } from '../errors';

export type OrgRole = 'admin' | 'developer' | 'editor' | 'member' | 'disabled';

export const MEMBER_PLUS: readonly OrgRole[] = [
  'member',
  'editor',
  'developer',
  'admin',
];

export const ADMIN_ONLY: readonly OrgRole[] = ['admin'];

/**
 * Validate organization access for any resource.
 *
 * Pass an existing `user` to skip the expensive `requireAuthenticatedUser`
 * call inside `createRLSContext` (saves 2 DB queries when the caller already
 * has an AuthenticatedUser from `getAuthUserIdentity`).
 */
export async function validateOrganizationAccess(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  allowed?: readonly OrgRole[],
  user?: AuthenticatedUser,
): Promise<RLSContext> {
  const rlsContext = await createRLSContext(ctx, organizationId, user);

  const role = (rlsContext.role || 'member').toLowerCase();

  // Block disabled accounts
  if (role === 'disabled') {
    throw new UnauthorizedError('disabled role');
  }

  // Determine allowed roles (default: any non-disabled member)
  const allowedList: readonly OrgRole[] = allowed ?? MEMBER_PLUS;

  if (!(allowedList as readonly string[]).includes(role)) {
    throw new UnauthorizedError('insufficient role');
  }

  return rlsContext;
}
