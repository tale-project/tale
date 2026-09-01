/**
 * Helpers for the local `ssoProvisioningLinks` side table — per-resource SCIM state
 * (externalId, restore-role) keyed by `(organizationId, internalId)`.
 */

import type { MutationCtx, QueryCtx } from '../lib/ctx';
import type { Doc } from '../lib/rows';

type ScimResourceType = 'User' | 'Group';

export async function getLink(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  internalId: string,
): Promise<Doc<'ssoProvisioningLinks'> | null> {
  return ctx.db
    .query('ssoProvisioningLinks')
    .withIndex('by_org_internal', (q) =>
      q.eq('organizationId', organizationId).eq('internalId', internalId),
    )
    .first();
}

export async function findLinkByExternalId(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  externalId: string,
): Promise<Doc<'ssoProvisioningLinks'> | null> {
  return ctx.db
    .query('ssoProvisioningLinks')
    .withIndex('by_org_external', (q) =>
      q.eq('organizationId', organizationId).eq('externalId', externalId),
    )
    .first();
}

export interface UpsertLinkInput {
  organizationId: string;
  resourceType: ScimResourceType;
  internalId: string;
  externalId?: string;
  lastActiveRole?: string;
}

/** Insert or patch the link row, preserving fields not supplied. */
export async function upsertLink(
  ctx: MutationCtx,
  input: UpsertLinkInput,
): Promise<void> {
  const existing = await getLink(ctx, input.organizationId, input.internalId);
  const now = Date.now();
  if (existing) {
    await ctx.db.patch(existing._id, {
      // Only overwrite externalId/lastActiveRole when a value is provided.
      ...(input.externalId !== undefined
        ? { externalId: input.externalId }
        : {}),
      ...(input.lastActiveRole !== undefined
        ? { lastActiveRole: input.lastActiveRole }
        : {}),
      updatedAt: now,
    });
    return;
  }
  await ctx.db.insert('ssoProvisioningLinks', {
    organizationId: input.organizationId,
    resourceType: input.resourceType,
    internalId: input.internalId,
    externalId: input.externalId,
    lastActiveRole: input.lastActiveRole,
    createdAt: now,
    updatedAt: now,
  });
}

export async function deleteLink(
  ctx: MutationCtx,
  organizationId: string,
  internalId: string,
): Promise<void> {
  const existing = await getLink(ctx, organizationId, internalId);
  if (existing) {
    await ctx.db.delete(existing._id);
  }
}
