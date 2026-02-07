/**
 * Delete an organization's logo
 */

import type { MutationCtx } from '../_generated/server';
import { authComponent } from '../auth';
import { validateOrganizationAccess } from '../lib/rls';

export async function deleteOrganizationLogo(
  ctx: MutationCtx,
  organizationId: string,
): Promise<void> {
  // Ensure user is authenticated
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    throw new Error('Unauthenticated');
  }

  // Validate access; actual org updates are managed via Better Auth client APIs
  await validateOrganizationAccess(ctx, organizationId, ['admin'] as const);

  // No-op: Organization profile updates (including logo) are handled via authClient.organization.update on the client.
  // This server-side function remains for backward compatibility and access checks.
  return;
}
