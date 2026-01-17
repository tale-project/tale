/**
 * Create a new organization
 */

import type { MutationCtx } from '../_generated/server';
import { authComponent } from '../auth';

export interface CreateOrganizationArgs {
  name: string;
}

export async function createOrganization(
  ctx: MutationCtx,
  _args: CreateOrganizationArgs,
): Promise<string> {
  // Ensure user is authenticated
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    throw new Error('Not authenticated');
  }

  // This project now uses Better Auth's Organizations plugin.
  // Organization creation must be performed via the client SDK:
  // authClient.organization.create({ name, slug, logo, metadata })
  // For server-side creation, prefer calling the client from the UI.
  // Throw to make any remaining legacy call sites visible during testing.
  throw new Error(
    'createOrganization is deprecated. Use authClient.organization.create on the client.',
  );
}
