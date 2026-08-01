/**
 * Update an existing website
 */

import { ConvexError } from 'convex/values';

import type { Id, Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { ensureUrl } from './create_website';

export interface UpdateWebsiteArgs {
  websiteId: Id<'websites'>;
  domain?: string;
  kind?: 'site' | 'list';
  title?: string;
  description?: string;
  scanInterval?: string;
  lastScannedAt?: number;
  status?: 'idle' | 'scanning' | 'active' | 'error' | 'deleting';
  pageCount?: number;
  crawledPageCount?: number;
  metadata?: unknown;
  /**
   * Caller's organizationId — closes the cross-tenant write IDOR. Optional for
   * in-process callers (e.g. crawler internals); the REST handler and the
   * agent `website_write` tool MUST pass this so an agent in org A cannot patch
   * a website row in org B by id. Mirrors the customer/product/vendor pattern.
   */
  callerOrgId?: string;
}

/**
 * Update an existing website
 */
export async function updateWebsite(
  ctx: MutationCtx,
  args: UpdateWebsiteArgs,
): Promise<Doc<'websites'> | null> {
  const { websiteId, callerOrgId, ...updateData } = args;

  // Get the existing website to check organization
  const existingWebsite = await ctx.db.get(websiteId);
  if (!existingWebsite) {
    throw new ConvexError({
      code: 'WEBSITE_NOT_FOUND',
      message: 'Website not found',
    });
  }
  // Cross-tenant write guard: when the caller's org is known, the target row
  // must belong to it. Closes the IDOR on the agent tool / REST PATCH.
  if (
    callerOrgId !== undefined &&
    existingWebsite.organizationId !== callerOrgId
  ) {
    throw new ConvexError({
      code: 'WEBSITE_NOT_FOUND',
      message: 'Website not found',
    });
  }

  // If domain provided, normalize to bare hostname and check for conflicts
  if (updateData.domain) {
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
        throw new ConvexError({
          code: 'DUPLICATE_DOMAIN',
          message: `Website with domain ${normalized} already exists`,
        });
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
