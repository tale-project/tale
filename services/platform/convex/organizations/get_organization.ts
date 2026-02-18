import type { QueryCtx } from '../_generated/server';

import { isRecord, getString, getNumber } from '../../lib/utils/type-guards';
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

  const org = isRecord(organization) ? organization : undefined;
  const orgId = org ? getString(org, '_id') : undefined;
  const orgName = org ? getString(org, 'name') : undefined;
  const createdAt = org ? getNumber(org, 'createdAt') : undefined;
  const creationTime = org ? getNumber(org, '_creationTime') : undefined;

  if (
    !orgId ||
    !orgName ||
    createdAt === undefined ||
    creationTime === undefined
  ) {
    return null;
  }

  return {
    _id: orgId,
    _creationTime: creationTime,
    name: orgName,
    slug: org ? getString(org, 'slug') : undefined,
    logo: org ? getString(org, 'logo') : undefined,
    createdAt,
    metadata: org ? org.metadata : undefined,
  };
}
