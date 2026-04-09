/**
 * Internal queries for OpenAI-compatible endpoint.
 *
 * Provides organization resolution from API key user context.
 */

import { v } from 'convex/values';

import { isRecord, getString } from '../../lib/utils/type-guards';
import { components } from '../_generated/api';
import { internalQuery } from '../_generated/server';

/**
 * Resolve the user's organization.
 *
 * - If orgSlug is provided, look up the organization by slug and return its ID.
 * - If not, find the user's memberships and auto-select when exactly one exists.
 */
export const resolveUserOrganization = internalQuery({
  args: {
    userId: v.string(),
    orgSlug: v.optional(v.string()),
  },
  returns: v.object({
    organizationId: v.string(),
    orgSlug: v.string(),
  }),
  handler: async (ctx, args) => {
    if (args.orgSlug) {
      const org = await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: 'organization',
        where: [{ field: 'slug', value: args.orgSlug, operator: 'eq' }],
      });

      const orgRecord = isRecord(org) ? org : undefined;
      const orgId = orgRecord ? getString(orgRecord, '_id') : undefined;
      if (!orgId) {
        throw new Error(`Organization not found: ${args.orgSlug}`);
      }

      return { organizationId: orgId, orgSlug: args.orgSlug };
    }

    // No slug provided — auto-resolve from user memberships
    const memberResult = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'member',
        paginationOpts: { cursor: null, numItems: 100 },
        where: [{ field: 'userId', value: args.userId, operator: 'eq' }],
      },
    );

    const members = (memberResult?.page ?? []).filter(
      (m: Record<string, unknown>) => getString(m, 'role') !== 'disabled',
    );

    if (members.length === 0) {
      throw new Error('User has no organization memberships');
    }

    if (members.length > 1) {
      throw new Error(
        'User belongs to multiple organizations. Provide X-Organization-Slug header.',
      );
    }

    const orgId = getString(members[0], 'organizationId');
    if (!orgId) {
      throw new Error('Organization ID missing from membership record');
    }

    // Look up the slug for downstream use
    const org = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'organization',
      where: [{ field: '_id', value: orgId, operator: 'eq' }],
    });

    const orgRecord = isRecord(org) ? org : undefined;
    const slug = orgRecord ? getString(orgRecord, 'slug') : undefined;
    if (!slug) {
      throw new Error('Organization slug not found');
    }

    return { organizationId: orgId, orgSlug: slug };
  },
});
