import { isRecord, getString } from '../../lib/utils/type-guards';
import { components } from '../_generated/api';
import type { ActionCtx, MutationCtx, QueryCtx } from '../_generated/server';

type AnyCtx = QueryCtx | MutationCtx | ActionCtx;

export async function resolveOrgSlug(
  ctx: AnyCtx,
  organizationId: string,
): Promise<string> {
  const org = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'organization',
    where: [{ field: '_id', value: organizationId, operator: 'eq' }],
  });

  const orgRecord = isRecord(org) ? org : undefined;
  const slug = orgRecord ? getString(orgRecord, 'slug') : undefined;
  if (!slug) {
    throw new Error(`Organization ${organizationId} not found or missing slug`);
  }
  return slug;
}
