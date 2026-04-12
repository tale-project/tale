/**
 * Internal queries for OpenAI-compatible endpoint.
 *
 * Provides organization resolution and metadata queries
 * for the API key user context.
 */

import { v } from 'convex/values';

import { isRecord, getString } from '../../lib/utils/type-guards';
import { components } from '../_generated/api';
import { internalQuery } from '../_generated/server';
import { citationItemValidator } from '../streaming/validators';

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

/**
 * Fetch the latest toolsUsage for a thread.
 *
 * In agent mode, each request creates a single assistant message.
 * This query retrieves the most recent messageMetadata for the thread
 * and returns its toolsUsage array (used to build API citation data).
 */
export const getLatestThreadToolsUsage = internalQuery({
  args: {
    threadId: v.string(),
  },
  returns: v.union(
    v.object({
      toolsUsage: v.array(
        v.object({
          toolName: v.string(),
          output: v.optional(v.string()),
        }),
      ),
      citations: v.optional(v.array(citationItemValidator)),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const metadata = await ctx.db
      .query('messageMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .order('desc')
      .first();

    if (!metadata?.toolsUsage) return null;

    return {
      toolsUsage: metadata.toolsUsage.map((t) => ({
        toolName: t.toolName,
        output: t.output,
      })),
      citations: metadata.citations,
    };
  },
});
