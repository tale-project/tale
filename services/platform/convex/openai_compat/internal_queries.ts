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
 * Resolve the user's organization for OpenAI-compatible endpoints.
 *
 * Resolution order:
 * 1. If `orgSlug` header is provided, look up the org by slug AND verify the
 *    caller is a non-disabled member. Without the membership check, an
 *    authenticated API key holder for org A could enumerate any org by
 *    passing `X-Organization-Slug: <orgB-slug>` (cross-tenant leak).
 * 2. Otherwise, look up the user's memberships.
 *    - Exactly one → return that org.
 *    - Zero → throw "no memberships".
 *    - Multiple → prefer the user's `lastActiveOrganizationId` if it points
 *      to a current non-disabled membership; only throw if it doesn't.
 *      Pre-fallback this returned a hard 400 even when the user had picked
 *      an active org in the dashboard.
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
      const canonicalSlug = orgRecord
        ? getString(orgRecord, 'slug')
        : undefined;
      if (!orgId || !canonicalSlug) {
        throw new Error(`Organization not found: ${args.orgSlug}`);
      }

      // Membership check — without this, any authenticated API key holder
      // could enumerate any org's model catalog by guessing its slug.
      const memberRes = await ctx.runQuery(
        components.betterAuth.adapter.findMany,
        {
          model: 'member',
          paginationOpts: { cursor: null, numItems: 1 },
          where: [
            { field: 'organizationId', value: orgId, operator: 'eq' },
            { field: 'userId', value: args.userId, operator: 'eq' },
          ],
        },
      );
      const member = memberRes?.page?.[0];
      if (!member || getString(member, 'role') === 'disabled') {
        // Phrase aligns with handleChatError → 403 ('Not a member ...').
        throw new Error(`Not a member of organization ${canonicalSlug}`);
      }

      return { organizationId: orgId, orgSlug: canonicalSlug };
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

    let pickedOrgId: string | undefined;
    if (members.length === 1) {
      pickedOrgId = getString(members[0], 'organizationId');
    } else {
      // Multi-org user: try the dashboard's lastActiveOrganizationId before
      // forcing the caller to set X-Organization-Slug. Resolves the M3 UX
      // regression where dev tools / scripts hit a hard 400 even though
      // the user had clearly picked an active org in the UI.
      const userRow = await ctx.runQuery(
        components.betterAuth.adapter.findOne,
        {
          model: 'user',
          where: [{ field: '_id', value: args.userId, operator: 'eq' }],
        },
      );
      const lastActive =
        userRow && isRecord(userRow)
          ? getString(userRow, 'lastActiveOrganizationId')
          : undefined;
      if (lastActive) {
        const memberOfLastActive = members.find(
          (m: Record<string, unknown>) =>
            getString(m, 'organizationId') === lastActive,
        );
        if (memberOfLastActive) {
          pickedOrgId = lastActive;
        }
      }
      if (!pickedOrgId) {
        throw new Error(
          'User belongs to multiple organizations. Provide X-Organization-Slug header.',
        );
      }
    }

    if (!pickedOrgId) {
      throw new Error('Organization ID missing from membership record');
    }

    // Look up the slug for downstream use
    const org = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'organization',
      where: [{ field: '_id', value: pickedOrgId, operator: 'eq' }],
    });

    const orgRecord = isRecord(org) ? org : undefined;
    const slug = orgRecord ? getString(orgRecord, 'slug') : undefined;
    if (!slug) {
      throw new Error('Organization slug not found');
    }

    return { organizationId: pickedOrgId, orgSlug: slug };
  },
});

/**
 * Fetch the latest toolsUsage and token counts for a thread.
 *
 * In agent mode, each request creates a single assistant message.
 * This query retrieves the most recent messageMetadata for the thread
 * and returns its toolsUsage array (used to build API citation data)
 * plus token counts for the usage field in the OpenAI response.
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
      inputTokens: v.optional(v.number()),
      outputTokens: v.optional(v.number()),
      totalTokens: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const metadata = await ctx.db
      .query('messageMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .order('desc')
      .first();

    if (!metadata) return null;

    return {
      toolsUsage: (metadata.toolsUsage ?? []).map((t) => ({
        toolName: t.toolName,
        output: t.output,
      })),
      citations: metadata.citations,
      inputTokens: metadata.inputTokens,
      outputTokens: metadata.outputTokens,
      totalTokens: metadata.totalTokens,
    };
  },
});
