/**
 * Update an organization
 */

import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { authComponent } from '../../auth';
import { validateOrganizationAccess } from '../lib/rls';

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
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    throw new Error('Not authenticated');
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
