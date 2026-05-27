/**
 * Operator-triggered re-seed: enumerate every registered org (incl.
 * `default`) and re-invoke `scaffoldNewOrganization({override:true,
 * strict:true})`. Driven by `tale deploy --override-all` via
 * `bunx convex run organizations/reseed_all_orgs:reseedAllOrgsFromBuiltin`.
 *
 * Semantics:
 *   - Always reseeds `default` even if absent from the org list (canonical
 *     template org).
 *   - Per-org try/catch records errors into the result map AND THEN the
 *     action throws at the end if any org failed, so `bunx convex run`
 *     exits non-zero. Without the final throw, the CLI would see exit-0
 *     from docker exec and report success on partial failure.
 *   - Per-org call uses `strict:true` so scaffold's per-domain failures
 *     surface as a thrown error here (instead of silent
 *     `console.error`-and-continue).
 *   - Deterministic order: collected slugs are sorted before processing
 *     so logs and partial-failure reruns are reproducible.
 *   - Cursor-paginated org enumeration (200/page) instead of the
 *     500-page-cap pattern in older backfills.
 *
 * Note: enumerates Better Auth `organization` rows. Filesystem-only org
 * subtrees (no DB row) are intentionally skipped — `--override-all` is
 * "reseed all registered orgs", not "reseed every dir on disk".
 *
 * Note: this is an ops re-runnable tool, not a one-shot migration. Lives
 * next to `scaffold.ts` (the thing it reinvokes), not in `migrations/`.
 */

import { v } from 'convex/values';

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
  returns: v.object({
    total: v.number(),
    succeeded: v.number(),
    failed: v.number(),
    results: v.array(
      v.union(
        v.object({ slug: v.string(), status: v.literal('ok') }),
        v.object({
          slug: v.string(),
          status: v.literal('error'),
          error: v.string(),
        }),
      ),
    ),
  }),
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
          { orgSlug: slug, override: true, strict: true },
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

    // CRITICAL: throw on any per-org failure so `bunx convex run` exits
    // non-zero. The aggregated `results` are also printed to console
    // above so per-org detail survives. Without this throw, the CLI
    // wrapper sees exit-0 from `docker exec` and reports
    // `success('Reseed complete.')` on partial failure.
    if (failed > 0) {
      const failedSlugs = results
        .filter(
          (r): r is Extract<OrgReseedResult, { status: 'error' }> =>
            r.status === 'error',
        )
        .map((r) => `${r.slug} (${r.error.split('\n')[0]})`)
        .join(', ');
      throw new Error(
        `reseedAllOrgs: ${failed}/${results.length} orgs failed — ${failedSlugs}`,
      );
    }

    return {
      total: results.length,
      succeeded,
      failed,
      results,
    };
  },
});
