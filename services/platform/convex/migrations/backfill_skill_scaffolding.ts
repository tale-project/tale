/**
 * Migration: Backfill the `skills` domain for organizations created before
 * `skills` was added to the per-org filesystem scaffolder.
 *
 * Iterates every org and re-invokes `scaffoldNewOrganization`. That action
 * is idempotent per-domain (skips dirs that already have files), so this
 * migration only seeds the `skills` directory where it's missing without
 * touching any other domain. Forward-compatible with any future domain
 * we forget to seed: re-running this will pick it up too.
 *
 * Usage:
 *   bunx convex run migrations/backfill_skill_scaffolding:backfillSkillScaffolding
 */

import { isRecord, getString } from '../../lib/utils/type-guards';
import { components, internal } from '../_generated/api';
import { internalAction } from '../_generated/server';

export const backfillSkillScaffolding = internalAction({
  args: {},
  handler: async (ctx) => {
    let totalScaffolded = 0;
    let totalSkippedDefault = 0;

    const orgsResult = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'organization',
        paginationOpts: { cursor: null, numItems: 500 },
        where: [],
      },
    );

    const orgs = orgsResult?.page ?? [];
    if (orgs.length === 0) {
      console.log('[backfill_skill_scaffolding] No organizations found');
      return { totalScaffolded, totalSkippedDefault };
    }

    for (const orgRaw of orgs) {
      if (!isRecord(orgRaw)) continue;
      const slug = getString(orgRaw, 'slug');
      if (!slug) continue;

      if (slug === 'default') {
        totalSkippedDefault++;
        continue;
      }

      await ctx.runAction(
        internal.organizations.scaffold.scaffoldNewOrganization,
        { orgSlug: slug },
      );
      totalScaffolded++;
      console.log(
        `[backfill_skill_scaffolding] Scaffolded org "${slug}" (idempotent — only missing domains were seeded)`,
      );
    }

    console.log(
      `[backfill_skill_scaffolding] Done. Scaffolded: ${totalScaffolded}, Skipped default: ${totalSkippedDefault}`,
    );
    return { totalScaffolded, totalSkippedDefault };
  },
});
