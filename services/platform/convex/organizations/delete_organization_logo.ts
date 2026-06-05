/**
 * Delete an organization's logo
 */

import type { MutationCtx } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { validateOrganizationAccess } from '../lib/rls/organization/validate_organization_access';

export async function deleteOrganizationLogo(
  ctx: MutationCtx,
  organizationId: string,
): Promise<void> {
  // Ensure user is authenticated
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) {
    throw new Error('Unauthenticated');
  }

  // Validate access; actual org updates are managed via Better Auth client APIs
  await validateOrganizationAccess(ctx, organizationId, ['admin'] as const);

  // No-op: Organization profile updates (including logo) are handled via authClient.organization.update on the client.
  // This server-side function remains for backward compatibility and access checks.
  return;
}
