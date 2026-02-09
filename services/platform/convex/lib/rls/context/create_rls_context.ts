/**
 * Create RLS context for organization-scoped operations using Better Auth
 */

import type { QueryCtx, MutationCtx } from '../../../_generated/server';
import type { RLSContext } from '../types';

import { requireAuthenticatedUser } from '../auth/require_authenticated_user';
import { getOrganizationMember } from '../organization/get_organization_member';

/**
 * Create RLS context for organization-scoped operations
 * Uses Better Auth's organization and member system
 */
export async function createRLSContext(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
): Promise<RLSContext> {
  const user = await requireAuthenticatedUser(ctx);
  const member = await getOrganizationMember(ctx, organizationId, user);

  const role = member.role || 'member';

  return {
    user,
    member,
    organizationId,
    role,
    isAdmin: role.toLowerCase() === 'admin',
  };
}
