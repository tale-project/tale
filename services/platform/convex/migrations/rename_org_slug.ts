/**
 * Migration: Rename all organization slugs to "default".
 *
 * Self-hosted Tale deployments use a single organization.
 * This migration normalizes the slug to "default" for consistency.
 *
 * Idempotent: skips organizations that already have slug "default".
 *
 * Usage:
 *   bunx convex run migrations/rename_org_slug:renameOrgSlug
 */

import { isRecord, getString } from '../../lib/utils/type-guards';
import { components } from '../_generated/api';
import { internalMutation } from '../_generated/server';

const TARGET_SLUG = 'default';
const TARGET_NAME = 'Default';

export const renameOrgSlug = internalMutation({
  args: {},
  handler: async (ctx) => {
    const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'organization',
      paginationOpts: { cursor: null, numItems: 100 },
      where: [],
    });

    const orgs =
      result &&
      typeof result === 'object' &&
      'page' in result &&
      Array.isArray(result.page)
        ? result.page
        : [];

    let updated = 0;
    let skipped = 0;

    for (const org of orgs) {
      if (!isRecord(org)) continue;

      const id = getString(org, '_id');
      const slug = getString(org, 'slug');

      if (!id) continue;

      if (slug === TARGET_SLUG) {
        skipped++;
        continue;
      }

      await ctx.runMutation(components.betterAuth.adapter.updateMany, {
        input: {
          model: 'organization',
          where: [{ field: '_id', value: id, operator: 'eq' }],
          update: { slug: TARGET_SLUG, name: TARGET_NAME },
        },
        paginationOpts: { cursor: null, numItems: 1 },
      });
      updated++;
      console.log(
        `Updated organization ${id}: slug "${slug}" → "${TARGET_SLUG}"`,
      );
    }

    console.log(`Done. Updated: ${updated}, Skipped: ${skipped}`);
  },
});
