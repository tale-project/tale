/**
 * Operator-triggered re-seed: enumerate every org (incl. `default`) and
 * re-invoke `scaffoldNewOrganization` with `override:true`. Driven by
 * `tale deploy --override-all` via `bunx convex run organizations/reseed_all_orgs:reseedAllOrgsFromBuiltin`.
 *
 * Semantics:
 *   - Always reseeds `default` even if absent from the org list (canonical
 *     template org).
 *   - Per-org try/catch: one failure logs + continues; the full result
 *     map is returned so the CLI surfaces succeeded/failed counts and
 *     exits non-zero on any failure.
 *   - Deterministic order: collected slugs are sorted before processing
 *     so logs and partial-failure reruns are reproducible.
 *   - Cursor-paginated org enumeration (200/page) instead of the
 *     500-page-cap pattern in older backfills — avoids silently capping
 *     deployments with many orgs.
 *
 * Note: this is an ops re-runnable tool, not a one-shot migration. Lives
 * next to `scaffold.ts` (the thing it reinvokes), not in `migrations/`.
 */

import { getString, isRecord } from '../../lib/utils/type-guards';
import { components, internal } from '../_generated/api';
import { internalAction } from '../_generated/server';

// Inlined to avoid importing from convex/lib/file_io.ts (which has 'use node'
// and would force this orchestration action into the Node runtime). Keep in
// sync with `validateOrgSlug` at services/platform/convex/lib/file_io.ts.
const ORG_SLUG_REGEX = /^[a-z0-9][a-z0-9_-]*$/;
function isValidOrgSlug(slug: string): boolean {
  return slug === 'default' || ORG_SLUG_REGEX.test(slug);
}

type OrgReseedResult =
  | { slug: string; status: 'ok' }
  | { slug: string; status: 'error'; error: string };

export const reseedAllOrgsFromBuiltin = internalAction({
  args: {},
  handler: async (ctx) => {
    const slugSet = new Set<string>(['default']);

    let cursor: string | null = null;
    let isDone = false;
    while (!isDone) {
      const res: unknown = await ctx.runQuery(
        components.betterAuth.adapter.findMany,
        {
          model: 'organization',
          paginationOpts: { cursor, numItems: 200 },
          where: [],
        },
      );
      const page = isRecord(res) && Array.isArray(res.page) ? res.page : [];
      for (const raw of page) {
        if (!isRecord(raw)) continue;
        const slug = getString(raw, 'slug');
        if (!slug) continue;
        if (!isValidOrgSlug(slug)) {
          console.warn(
            `[reseedAllOrgs] skipping invalid slug "${slug}" returned by betterAuth`,
          );
          continue;
        }
        slugSet.add(slug);
      }
      cursor =
        isRecord(res) && typeof res.continueCursor === 'string'
          ? res.continueCursor
          : null;
      isDone =
        isRecord(res) && typeof res.isDone === 'boolean' ? res.isDone : true;
    }

    const slugs = Array.from(slugSet).sort();
    const results: OrgReseedResult[] = [];

    for (const slug of slugs) {
      try {
        await ctx.runAction(
          internal.organizations.scaffold.scaffoldNewOrganization,
          { orgSlug: slug, override: true },
        );
        results.push({ slug, status: 'ok' });
        console.log(`[reseedAllOrgs] reseeded "${slug}"`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[reseedAllOrgs] "${slug}" failed:`, message);
        results.push({ slug, status: 'error', error: message });
      }
    }

    const succeeded = results.filter((r) => r.status === 'ok').length;
    const failed = results.length - succeeded;
    console.log(
      `[reseedAllOrgs] done: total=${results.length} succeeded=${succeeded} failed=${failed}`,
    );

    return {
      total: results.length,
      succeeded,
      failed,
      results,
    };
  },
});
