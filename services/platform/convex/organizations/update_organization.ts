/**
 * Update an organization
 */

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { validateOrganizationAccess } from '../lib/rls/organization/validate_organization_access';

export interface UpdateOrganizationArgs {
  organizationId: string;
  name?: string;
  logoId?: Id<'_storage'>;
}

export async function updateOrganization(
  ctx: MutationCtx,
  args: UpdateOrganizationArgs,
): Promise<void> {
  // Ensure user is authenticated
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) {
    throw new Error('Unauthenticated');
  }

  await validateOrganizationAccess(ctx, args.organizationId, [
    'admin',
  ] as const);

  // This project now uses Better Auth's Organizations plugin.
  // Organization updates (name, logo, metadata) must be performed via the client SDK:
  // authClient.organization.update({ id, name, logo, metadata })
  throw new Error(
    'updateOrganization is deprecated. Use authClient.organization.update on the client.',
  );
}
