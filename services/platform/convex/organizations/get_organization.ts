import type { QueryCtx } from '../_generated/server';

import { components } from '../_generated/api';
import { authComponent } from '../auth';
import { validateOrganizationAccess } from '../lib/rls';

type BAOrganization = {
  _id: string;
  _creationTime: number;
  name: string;
  slug?: string;
  logo?: string | null;
  createdAt: number;
  metadata?: unknown;
};

export async function getOrganization(
  ctx: QueryCtx,
  organizationId: string,
): Promise<BAOrganization | null> {
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    return null;
  }

  await validateOrganizationAccess(ctx, organizationId);

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

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- third-party type
  return organization as BAOrganization;
}
