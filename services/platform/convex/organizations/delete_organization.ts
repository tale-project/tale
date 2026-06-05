/**
 * Delete an organization and all related data
 */

import type { MutationCtx } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { validateOrganizationAccess } from '../lib/rls/organization/validate_organization_access';

export async function deleteOrganization(
  ctx: MutationCtx,
  organizationId: string,
): Promise<void> {
  // Ensure user is authenticated
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) {
    throw new Error('Unauthenticated');
  }

  await validateOrganizationAccess(ctx, organizationId, ['admin'] as const);

  // This project now uses Better Auth's Organizations plugin.
  // Organization deletion must be performed via the Better Auth client/plugin.
  // We intentionally prevent server-side hard deletion here to avoid dangling
  // Better Auth records.
  throw new Error(
    'deleteOrganization is deprecated. Use the Better Auth organization plugin (client) to delete organizations.',
  );
}
