/**
 * Update an existing website
 */

import type { Id, Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

export interface UpdateWebsiteArgs {
  websiteId: Id<'websites'>;
  domain?: string;
  title?: string;
  description?: string;
  scanInterval?: string;
  lastScannedAt?: number;
  status?: 'active' | 'inactive' | 'error';
  metadata?: unknown;
}

/**
 * Update an existing website
 */
export async function updateWebsite(
  ctx: MutationCtx,
  args: UpdateWebsiteArgs,
): Promise<Doc<'websites'> | null> {
  const { websiteId, ...updateData } = args;

  // Get the existing website to check organization
  const existingWebsite = await ctx.db.get(websiteId);
  if (!existingWebsite) {
    throw new Error('Website not found');
  }

  // If domain provided, normalize to bare hostname and check for conflicts
  if (updateData.domain) {
    const ensureUrl = (s: string) =>
      s.startsWith('http://') || s.startsWith('https://') ? s : `https://${s}`;
    const normalized = new URL(ensureUrl(updateData.domain)).hostname;
    updateData.domain = normalized;

    if (normalized !== existingWebsite.domain) {
      const conflictingWebsite = await ctx.db
        .query('websites')
        .withIndex('by_organizationId_and_domain', (q) =>
          q
            .eq('organizationId', existingWebsite.organizationId)
            .eq('domain', normalized),
        )
        .first();

      if (conflictingWebsite && conflictingWebsite._id !== websiteId) {
        throw new Error(`Website with domain ${normalized} already exists`);
      }
    }
  }

  // If metadata is provided as an object, merge with existing metadata so we
  // don't drop fields like workflowId set by provisioning logic.
  if (
    'metadata' in updateData &&
    updateData.metadata !== undefined &&
    updateData.metadata !== null &&
    typeof updateData.metadata === 'object'
  ) {
    const existingMetadata = existingWebsite.metadata ?? {};
    updateData.metadata = {
      ...existingMetadata,
      ...updateData.metadata,
    };
  }

  // Remove undefined values
  const cleanUpdateData = Object.fromEntries(
    Object.entries(updateData).filter(([_, value]) => value !== undefined),
  );

  await ctx.db.patch(websiteId, cleanUpdateData);
  return await ctx.db.get(websiteId);
}
