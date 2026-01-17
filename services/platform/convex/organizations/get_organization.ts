/**
 * Get an organization by ID
 */

import type { QueryCtx } from '../_generated/server';
import { components } from '../_generated/api';
import { authComponent } from '../../auth';
import { validateOrganizationAccess } from '../lib/rls';

// Minimal Better Auth organization shape we use server-side
type BAOrganization = {
  _id: string;
  name: string;
  slug?: string;
  logo?: string | null;
  createdAt: number;
  metadata?: unknown | null;
};

export async function getOrganization(
  ctx: QueryCtx,
  organizationId: string,
): Promise<BAOrganization | null> {
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    return null;
  }

  // Validate access with Better Auth roles; any non-disabled member is sufficient to read
  await validateOrganizationAccess(ctx, organizationId);

  // Load from Better Auth component
  const organization = await ctx.runQuery(
    components.betterAuth.adapter.findOne,
    {
      model: 'organization',
      where: [{ field: '_id', value: organizationId, operator: 'eq' }],
    },
  );

  if (!organization) {
    return null;
  }

  return organization as BAOrganization;
}
