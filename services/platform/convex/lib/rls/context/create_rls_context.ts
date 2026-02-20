/**
 * Create RLS context for organization-scoped operations using Better Auth
 */

import type { QueryCtx, MutationCtx } from '../../../_generated/server';
import type { AuthenticatedUser, RLSContext } from '../types';

import { requireAuthenticatedUser } from '../auth/require_authenticated_user';
import { getOrganizationMember } from '../organization/get_organization_member';

/**
 * Create RLS context for organization-scoped operations
 * Uses Better Auth's organization and member system
 */
export async function createRLSContext(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  user?: AuthenticatedUser,
): Promise<RLSContext> {
  const authUser = user ?? (await requireAuthenticatedUser(ctx));
  const member = await getOrganizationMember(ctx, organizationId, authUser);

  const role = member.role || 'member';

  return {
    user: authUser,
    member,
    organizationId,
    role,
    isAdmin: role.toLowerCase() === 'admin',
  };
}
