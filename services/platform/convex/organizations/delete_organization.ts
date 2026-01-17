/**
 * Delete an organization and all related data
 */

import type { MutationCtx } from '../_generated/server';
import { authComponent } from '../../auth';
import { validateOrganizationAccess } from '../lib/rls';

export async function deleteOrganization(
  ctx: MutationCtx,
  organizationId: string,
): Promise<void> {
  // Ensure user is authenticated
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    throw new Error('Not authenticated');
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
