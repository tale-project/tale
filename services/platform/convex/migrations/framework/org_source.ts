/**
 * The organization enumeration seam for node migrations: one paginated page
 * of `(id, slug)` pairs from the Better Auth component, normalized and
 * slug-validated. Extracted from the apply orchestration so the fleet loop in
 * `entrypoints.ts` depends on a plain internal query — which unit tests stub
 * or point at a component-registered test world — instead of reaching into
 * `components.betterAuth.adapter` inline.
 */

import { v } from 'convex/values';

import { isValidOrgSlug } from '../../../lib/shared/constants/org-slug';
import { getString, isRecord } from '../../../lib/utils/type-utils';
import { components } from '../../_generated/api';
import { internalQuery } from '../../_generated/server';

export const listOrgsPage = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
  },
  returns: v.object({
    page: v.array(v.object({ id: v.string(), slug: v.string() })),
    continueCursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const res: unknown = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'organization',
        paginationOpts: { cursor: args.cursor, numItems: args.numItems },
        where: [],
      },
    );
    const rawPage = isRecord(res) && Array.isArray(res.page) ? res.page : [];
    const page: Array<{ id: string; slug: string }> = [];
    for (const raw of rawPage) {
      if (!isRecord(raw)) continue;
      const id = getString(raw, '_id') ?? getString(raw, 'id');
      const slug = getString(raw, 'slug');
      // Rows without a valid slug have no config dir — nothing a node
      // migration could touch; skip them like the pre-seam loop did.
      if (!id || !slug || !isValidOrgSlug(slug)) continue;
      page.push({ id, slug });
    }
    return {
      page,
      continueCursor:
        isRecord(res) && typeof res.continueCursor === 'string'
          ? res.continueCursor
          : null,
      isDone:
        isRecord(res) && typeof res.isDone === 'boolean' ? res.isDone : true,
    };
  },
});
