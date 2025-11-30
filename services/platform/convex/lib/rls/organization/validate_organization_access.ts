/**
 * Validate organization access for any resource using Better Auth
 */

import type { QueryCtx, MutationCtx } from '../../../_generated/server';
import type { RLSContext } from '../types';
import { UnauthorizedError } from '../errors';
import { createRLSContext } from '../context/create_rls_context';

export type OrgRole = 'admin' | 'developer' | 'editor' | 'member' | 'disabled';

export const MEMBER_PLUS: readonly OrgRole[] = [
  'member',
  'editor',
  'developer',
  'admin',
];

export const ADMIN_ONLY: readonly OrgRole[] = ['admin'];

/**
 * Validate organization access for any resource
 * Note: Better Auth uses string-based roles: admin, developer, editor, member, disabled
 * This function enforces membership via allow-lists (e.g., ADMIN_ONLY, MEMBER_PLUS), no invented hierarchy
 */
export async function validateOrganizationAccess(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  allowed?: readonly OrgRole[],
): Promise<RLSContext> {
  const rlsContext = await createRLSContext(ctx, organizationId);

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
